import type { AppConfig } from './config.js';
import type { UiPathAuthProvider } from './uipathAuthProvider.js';
import { inflateRawSync } from 'node:zlib';

const FLOW_ENTITY = 'StreamPathStatusFlowDefinition';
const NODE_ENTITY = 'StreamPathStatusNode';
const TRANSITION_ENTITY = 'StreamPathStatusTransition';
const INSTANCE_ENTITY = 'StreamPathStatusInstance';
const HISTORY_ENTITY = 'StreamPathStatusHistory';

const QUERY_LIMIT = 5_000;
const COMPRESSED_JSON_PREFIX = 'spz1:';
const REDUNDANT_JSON_FIELDS = new Set(['GraphJson']);

type EntityRecord = Record<string, unknown>;

type QueryFilter = {
  fieldName: string;
  operator: '=';
  value: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractItems(payload: unknown): EntityRecord[] {
  if (isRecord(payload) && Array.isArray(payload.items)) {
    return payload.items.filter(isRecord);
  }

  if (isRecord(payload) && Array.isArray(payload.value)) {
    return payload.value.filter(isRecord);
  }

  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  return [];
}

function isCompressibleJsonField(fieldName: string): boolean {
  return fieldName.endsWith('Json') && !REDUNDANT_JSON_FIELDS.has(fieldName);
}

function decompressJsonString(value: string): string {
  const encoded = value.slice(COMPRESSED_JSON_PREFIX.length);
  const decoded = inflateRawSync(Buffer.from(encoded, 'base64'));
  return decoded.toString('utf8');
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeEntityName(value: string): string {
  return value.replace(/_/g, '').toLowerCase();
}

function getRecordId(record: unknown): string | undefined {
  if (!isRecord(record)) {
    return undefined;
  }

  const candidate = record.Id ?? record.id;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function getRelatedId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return getRecordId(value);
}

function sameId(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toUpperCase() === right.toUpperCase());
}

class HttpError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type FlowSnapshotResponse = {
  flowDefinition: EntityRecord | null;
  nodes: EntityRecord[];
  transitions: EntityRecord[];
  instance: EntityRecord | null;
  historyForInstance: EntityRecord[];
};

export class StreamPathFlowSnapshotService {
  public constructor(
    private readonly config: AppConfig,
    private readonly authProvider: UiPathAuthProvider,
  ) {}

  private getEntityBaseUrl(entityTypeName: string): string {
    const baseUrl = this.config.uipathBaseUrl.replace(/\/+$/, '');
    return `${baseUrl}/${this.config.uipathOrgName}/${this.config.uipathTenantName}/datafabric_/api/EntityService/${entityTypeName}`;
  }

  private async queryEntityRecords(
    entityTypeName: string,
    queryFilters: QueryFilter[],
    expansionLevel = 2,
    limit = QUERY_LIMIT,
  ): Promise<EntityRecord[]> {
    const token = await this.authProvider.getSecret();
    const response = await fetch(
      `${this.getEntityBaseUrl(entityTypeName)}/query?expansionLevel=${expansionLevel}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start: '0',
          limit: String(limit),
          filterGroup:
            queryFilters.length > 0
              ? {
                  logicalOperator: 0,
                  continueLogicalOperator: 0,
                  queryFilters,
                }
              : undefined,
        }),
      },
    );

    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const details =
        isRecord(parsed) && typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
      throw new HttpError(response.status, `${entityTypeName} query failed: ${details}`);
    }

    return extractItems(parsed).map((item) => transformReadDataForStreamPath(item) as EntityRecord);
  }

  public async getSnapshotForRecord(recordId: string, entityTypeName: string): Promise<FlowSnapshotResponse> {
    const normalizedEntityName = normalizeEntityName(entityTypeName);

    const allDefinitions = await this.queryEntityRecords(
      FLOW_ENTITY,
      [
        {
          fieldName: 'TargetEntityType',
          operator: '=',
          value: entityTypeName,
        },
      ],
      2,
    );

    const candidateDefinitions = allDefinitions
      .filter((record) => normalizeEntityName(asString(record.TargetEntityType)) === normalizedEntityName)
      .sort((left, right) => {
        if (asBoolean(left.IsActive) !== asBoolean(right.IsActive)) {
          return asBoolean(left.IsActive) ? -1 : 1;
        }

        return asNumber(right.Version) - asNumber(left.Version);
      });

    const flowDefinition = candidateDefinitions[0] ?? null;
    const flowDefinitionId = getRecordId(flowDefinition);
    if (!flowDefinition || !flowDefinitionId) {
      return {
        flowDefinition: null,
        nodes: [],
        transitions: [],
        instance: null,
        historyForInstance: [],
      };
    }

    const [nodes, transitions, instances] = await Promise.all([
      this.queryEntityRecords(
        NODE_ENTITY,
        [
          {
            fieldName: 'FlowDefinition.Id',
            operator: '=',
            value: flowDefinitionId,
          },
        ],
        2,
      ),
      this.queryEntityRecords(
        TRANSITION_ENTITY,
        [
          {
            fieldName: 'FlowDefinition.Id',
            operator: '=',
            value: flowDefinitionId,
          },
        ],
        2,
      ),
      this.queryEntityRecords(
        INSTANCE_ENTITY,
        [
          {
            fieldName: 'TargetRecordId',
            operator: '=',
            value: recordId,
          },
          {
            fieldName: 'FlowDefinition.Id',
            operator: '=',
            value: flowDefinitionId,
          },
        ],
        2,
      ),
    ]);

    const instance =
      instances.find(
        (record) =>
          sameId(asString(record.TargetRecordId), recordId) &&
          sameId(getRelatedId(record.FlowDefinition), flowDefinitionId),
      ) ?? null;

    const instanceId = getRecordId(instance);
    const historyForInstance = instanceId
      ? await this.queryEntityRecords(
          HISTORY_ENTITY,
          [
            {
              fieldName: 'StatusInstance.Id',
              operator: '=',
              value: instanceId,
            },
          ],
          2,
          10_000,
        )
      : [];

    return {
      flowDefinition,
      nodes,
      transitions,
      instance,
      historyForInstance,
    };
  }
}
