import { UiPath } from '@uipath/uipath-typescript/core';
import { Entities } from '@uipath/uipath-typescript/entities';

import type { AppConfig } from './config.js';
import type { UiPathAuthProvider } from './uipathAuthProvider.js';

const STATUS_ENTITY_NAMES = new Set([
  'StreamPathStatusFlowDefinition',
  'StreamPathStatusNode',
  'StreamPathStatusTransition',
  'StreamPathStatusInstance',
  'StreamPathStatusHistory',
]);

const CACHE_TTL_MS = 30_000;

export type NormalizedFieldMetadata = {
  name: string;
  displayName: string;
  dataType: string;
  required: boolean;
  unique: boolean;
  primaryKey: boolean;
  systemField: boolean;
  foreignKey: boolean;
  maxLength?: number;
  decimalPrecision?: number;
  minValue?: number;
  maxValue?: number;
  relationship?: {
    entityId: string;
    entityTypeName: string;
    displayName: string;
    displayField?: string;
  };
};

export type NormalizedEntitySummary = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  entityType: string;
  recordCount?: number;
  isSystemEntity: boolean;
  isInfrastructureEntity: boolean;
  capabilities: {
    statusFlow: boolean;
  };
};

export type NormalizedEntitySchema = NormalizedEntitySummary & {
  fields: NormalizedFieldMetadata[];
};

type MetadataCache = {
  generatedAt: number;
  entities: NormalizedEntitySchema[];
};

export class UiPathMetadataService {
  private cache: MetadataCache | null = null;

  public constructor(
    private readonly config: AppConfig,
    private readonly authProvider: UiPathAuthProvider,
  ) {}

  public async listEntities(refresh = false): Promise<NormalizedEntitySummary[]> {
    const cache = await this.getCache(refresh);
    return cache.entities.map(({ fields: _fields, ...entity }) => entity);
  }

  public async getEntitySchema(
    entityTypeName: string,
    refresh = false,
  ): Promise<NormalizedEntitySchema> {
    const cache = await this.getCache(refresh);
    const entity = cache.entities.find(
      (candidate) =>
        candidate.name === entityTypeName ||
        candidate.displayName === entityTypeName ||
        candidate.id === entityTypeName,
    );

    if (!entity) {
      throw new Error(`Unable to find entity schema for \`${entityTypeName}\``);
    }

    return entity;
  }

  private async getCache(refresh: boolean): Promise<MetadataCache> {
    if (!refresh && this.cache && Date.now() - this.cache.generatedAt < CACHE_TTL_MS) {
      return this.cache;
    }

    const entitiesClient = await this.createEntitiesClient();
    const entities = await entitiesClient.getAll();
    const statusInfrastructureReady = [...STATUS_ENTITY_NAMES].every((entityName) =>
      entities.some((entity) => entity.name === entityName),
    );

    const normalized = entities.map((entity) => {
      const isInfrastructureEntity = STATUS_ENTITY_NAMES.has(entity.name);
      const isSystemEntity = entity.entityType === 'SystemEntity';

      return {
        id: entity.id,
        name: entity.name,
        displayName: entity.displayName,
        description: entity.description ?? '',
        entityType: entity.entityType,
        recordCount: entity.recordCount,
        isSystemEntity,
        isInfrastructureEntity,
        capabilities: {
          statusFlow: statusInfrastructureReady && !isInfrastructureEntity && !isSystemEntity,
        },
        fields: entity.fields.map((field) => ({
          name: field.name,
          displayName: field.displayName,
          dataType: field.fieldDataType?.name ?? 'UNKNOWN',
          required: field.isRequired,
          unique: field.isUnique,
          primaryKey: field.isPrimaryKey,
          systemField: field.isSystemField,
          foreignKey: field.isForeignKey,
          maxLength: field.fieldDataType?.lengthLimit,
          decimalPrecision: field.fieldDataType?.decimalPrecision,
          minValue: field.fieldDataType?.minValue,
          maxValue: field.fieldDataType?.maxValue,
          relationship: field.referenceEntity
            ? {
                entityId: field.referenceEntity.id,
                entityTypeName: field.referenceEntity.name,
                displayName: field.referenceEntity.displayName,
                displayField: field.referenceField?.definition?.name,
              }
            : undefined,
        })),
      };
    });

    this.cache = {
      generatedAt: Date.now(),
      entities: normalized,
    };

    return this.cache;
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
