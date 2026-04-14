import { UiPath } from '@uipath/uipath-typescript/core';
import { Entities } from '@uipath/uipath-typescript/entities';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import type { AppConfig } from './config.js';
import type { RelayCommand } from './types.js';
import type { UiPathAuthProvider } from './uipathAuthProvider.js';

type RelayExecutionResult = {
  entityId: string;
  data: unknown;
};

type ResolvedEntityContext = {
  entityId: string;
  entityName?: string;
};

const STREAM_PATH_ENTITY_NAMES = new Set([
  'StreamPathStatusFlowDefinition',
  'StreamPathStatusNode',
  'StreamPathStatusTransition',
  'StreamPathStatusInstance',
  'StreamPathStatusHistory',
]);

const REDUNDANT_JSON_FIELDS = new Set(['GraphJson']);

const COMPRESSED_JSON_PREFIX = 'spz1:';
const MULTILINE_TEXT_MAX_LENGTH = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStreamPathEntity(entityName?: string): boolean {
  return Boolean(entityName && STREAM_PATH_ENTITY_NAMES.has(entityName));
}

function isCompressibleJsonField(fieldName: string): boolean {
  return fieldName.endsWith('Json') && !REDUNDANT_JSON_FIELDS.has(fieldName);
}

function compressJsonString(raw: string): string {
  const compressed = deflateRawSync(Buffer.from(raw, 'utf8'), { level: 9 });
  return `${COMPRESSED_JSON_PREFIX}${compressed.toString('base64')}`;
}

function decompressJsonString(value: string): string {
  const encoded = value.slice(COMPRESSED_JSON_PREFIX.length);
  const decoded = inflateRawSync(Buffer.from(encoded, 'base64'));
  return decoded.toString('utf8');
}

function transformWriteDataForStreamPath(
  entityName: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const transformed = { ...data };

  for (const fieldName of REDUNDANT_JSON_FIELDS) {
    delete transformed[fieldName];
  }

  for (const [fieldName, value] of Object.entries(transformed)) {
    if (!isCompressibleJsonField(fieldName)) {
      continue;
    }

    if (value === undefined) {
      delete transformed[fieldName];
      continue;
    }

    if (value === null) {
      transformed[fieldName] = null;
      continue;
    }

    const rawText =
      typeof value === 'string'
        ? value
        : (() => {
            try {
              return JSON.stringify(value);
            } catch {
              throw new Error(`${entityName}.${fieldName} could not be serialized to JSON`);
            }
          })();

    if (!rawText) {
      transformed[fieldName] = rawText;
      continue;
    }

    const compressed = rawText.startsWith(COMPRESSED_JSON_PREFIX)
      ? rawText
      : compressJsonString(rawText);

    if (compressed.length > MULTILINE_TEXT_MAX_LENGTH) {
      throw new Error(
        `${entityName}.${fieldName} exceeds ${MULTILINE_TEXT_MAX_LENGTH} characters even after compression`,
      );
    }

    transformed[fieldName] = compressed;
  }

  return transformed;
}

function transformReadDataForStreamPath(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformReadDataForStreamPath(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const transformed: Record<string, unknown> = {};

  for (const [key, original] of Object.entries(value)) {
    if (REDUNDANT_JSON_FIELDS.has(key)) {
      continue;
    }

    const nested = transformReadDataForStreamPath(original);

    if (
      isCompressibleJsonField(key) &&
      typeof nested === 'string' &&
      nested.startsWith(COMPRESSED_JSON_PREFIX)
    ) {
      transformed[key] = decompressJsonString(nested);
      continue;
    }

    transformed[key] = nested;
  }

  return transformed;
}

export class UiPathRelay {
  private readonly entityIdByName = new Map<string, string>();
  private readonly entityNameById = new Map<string, string>();

  public constructor(
    private readonly config: AppConfig,
    private readonly authProvider: UiPathAuthProvider,
  ) {}

  public async execute(command: RelayCommand): Promise<RelayExecutionResult> {
    const entities = await this.createEntitiesClient();
    const { entityId, entityName } = await this.resolveEntityContext(command, entities);
    const applyReadTransform = isStreamPathEntity(entityName);

    switch (command.command) {
      case 'GET': {
        if (!command.recordId) {
          throw new Error('GET requires `recordId`');
        }

        const result = await entities.getRecordById(entityId, command.recordId, command.options);
        return {
          entityId,
          data: applyReadTransform ? transformReadDataForStreamPath(result) : result,
        };
      }

      case 'GET_MANY': {
        if (command.recordId) {
          throw new Error('GET_MANY does not accept `recordId`; use `GET` for single-record fetches');
        }

        const result = await entities.getAllRecords(entityId, command.options);
        return {
          entityId,
          data: applyReadTransform ? transformReadDataForStreamPath(result) : result,
        };
      }

      case 'CREATE': {
        if (!command.data) {
          throw new Error('CREATE requires `data`');
        }

        const payload =
          applyReadTransform && isRecord(command.data)
            ? transformWriteDataForStreamPath(entityName!, command.data)
            : command.data;
        const result = await entities.insertRecordById(entityId, payload, command.options);
        return {
          entityId,
          data: applyReadTransform ? transformReadDataForStreamPath(result) : result,
        };
      }

      case 'UPDATE': {
        if (!command.recordId) {
          throw new Error('UPDATE requires `recordId`');
        }

        if (!command.data) {
          throw new Error('UPDATE requires `data`');
        }

        const payload =
          applyReadTransform && isRecord(command.data)
            ? transformWriteDataForStreamPath(entityName!, command.data)
            : command.data;
        const result = await entities.updateRecordById(
          entityId,
          command.recordId,
          payload,
          command.options,
        );
        return {
          entityId,
          data: applyReadTransform ? transformReadDataForStreamPath(result) : result,
        };
      }

      case 'DELETE': {
        const recordIds = command.recordIds ?? (command.recordId ? [command.recordId] : []);

        if (recordIds.length === 0) {
          throw new Error('DELETE requires `recordId` or `recordIds`');
        }

        return {
          entityId,
          data: await entities.deleteRecordsById(entityId, recordIds, command.options),
        };
      }

      default: {
        const commandValue: never = command.command;
        throw new Error(`Unsupported command: ${commandValue}`);
      }
    }
  }

  private async resolveEntityContext(
    command: RelayCommand,
    entities: Entities,
  ): Promise<ResolvedEntityContext> {
    if (command.entityTypeName) {
      const cachedEntityId = this.entityIdByName.get(command.entityTypeName);

      if (cachedEntityId) {
        return {
          entityId: cachedEntityId,
          entityName: this.entityNameById.get(cachedEntityId) ?? command.entityTypeName,
        };
      }

      const allEntities = await entities.getAll();
      const matchedEntity = allEntities.find(
        (entity) =>
          entity.name === command.entityTypeName || entity.displayName === command.entityTypeName,
      );

      if (!matchedEntity) {
        throw new Error(`Unable to resolve entity type \`${command.entityTypeName}\``);
      }

      this.cacheEntity(matchedEntity.id, matchedEntity.name, matchedEntity.displayName);
      return {
        entityId: matchedEntity.id,
        entityName: matchedEntity.name,
      };
    }

    if (command.entityId) {
      const cachedName = this.entityNameById.get(command.entityId);

      if (cachedName) {
        return {
          entityId: command.entityId,
          entityName: cachedName,
        };
      }

      const allEntities = await entities.getAll();
      const matchedEntity = allEntities.find((entity) => entity.id === command.entityId);

      if (matchedEntity) {
        this.cacheEntity(matchedEntity.id, matchedEntity.name, matchedEntity.displayName);
        return {
          entityId: matchedEntity.id,
          entityName: matchedEntity.name,
        };
      }

      return {
        entityId: command.entityId,
      };
    }

    throw new Error('command requires `entityId` or `entityTypeName`');
  }

  private cacheEntity(entityId: string, entityName: string, entityDisplayName: string): void {
    this.entityIdByName.set(entityName, entityId);
    this.entityIdByName.set(entityDisplayName, entityId);
    this.entityNameById.set(entityId, entityName);
  }

  private async createEntitiesClient(): Promise<Entities> {
    const sdk = new UiPath({
      baseUrl: this.config.uipathBaseUrl,
      orgName: this.config.uipathOrgName,
      tenantName: this.config.uipathTenantName,
      secret: await this.authProvider.getSecret(),
    });

    return new Entities(sdk);
  }
}
