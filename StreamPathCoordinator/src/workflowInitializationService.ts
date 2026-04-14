import type { AppConfig } from './config.js';
import type { UiPathAuthProvider } from './uipathAuthProvider.js';
import type { UiPathRelay } from './uipathRelay.js';

const FLOW_ENTITY = 'StreamPathStatusFlowDefinition';
const NODE_ENTITY = 'StreamPathStatusNode';
const TRANSITION_ENTITY = 'StreamPathStatusTransition';
const INSTANCE_ENTITY = 'StreamPathStatusInstance';
const HISTORY_ENTITY = 'StreamPathStatusHistory';

const STREAM_PATH_ENTITY_NAMES = new Set([
  FLOW_ENTITY,
  NODE_ENTITY,
  TRANSITION_ENTITY,
  INSTANCE_ENTITY,
  HISTORY_ENTITY,
]);

const QUERY_LIMIT = 5_000;

type EntityRecord = Record<string, unknown>;

type QueryFilter = {
  fieldName: string;
  operator: '=';
  value: string;
};

type InitializationInput = {
  entityTypeName: string;
  entityId: string;
  changedAt: string;
  payload?: unknown;
  source?: string;
};

export type InitializationResult = {
  initialized: boolean;
  reason?: string;
  flowDefinitionId?: string;
  targetRecordId?: string;
  instanceId?: string;
  historyId?: string;
  startNodeId?: string;
  startedAt?: string;
};

class HttpError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true;
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

function normalizeEntityName(value: string | undefined): string {
  return (value ?? '').replace(/_/g, '').toLowerCase();
}

function sameEntityType(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return normalizeEntityName(left) === normalizeEntityName(right);
}

function pickRecordIdFromPayload(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.length > 0) {
    return payload;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const directCandidates = [
    payload.recordId,
    payload.RecordId,
    payload.targetRecordId,
    payload.TargetRecordId,
    payload.id,
    payload.Id,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  const nestedRecord = payload.record;

  if (isRecord(nestedRecord)) {
    const nestedCandidates = [nestedRecord.id, nestedRecord.Id];
    for (const candidate of nestedCandidates) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
  }

  return null;
}

export class StreamPathWorkflowInitializationService {
  public constructor(
    private readonly config: AppConfig,
    private readonly authProvider: UiPathAuthProvider,
    private readonly relay: UiPathRelay,
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

    return extractItems(parsed);
  }

  private async getStartNode(flowDefinitionId: string): Promise<EntityRecord | null> {
    const explicitStartNodes = await this.queryEntityRecords(
      NODE_ENTITY,
      [
        {
          fieldName: 'FlowDefinition.Id',
          operator: '=',
          value: flowDefinitionId,
        },
        {
          fieldName: 'IsStart',
          operator: '=',
          value: 'true',
        },
      ],
      2,
    );

    if (explicitStartNodes.length > 0) {
      return explicitStartNodes[0];
    }

    const nodes = await this.queryEntityRecords(
      NODE_ENTITY,
      [
        {
          fieldName: 'FlowDefinition.Id',
          operator: '=',
          value: flowDefinitionId,
        },
      ],
      2,
    );

    if (nodes.length === 0) {
      return null;
    }

    const transitions = await this.queryEntityRecords(
      TRANSITION_ENTITY,
      [
        {
          fieldName: 'FlowDefinition.Id',
          operator: '=',
          value: flowDefinitionId,
        },
      ],
      2,
    );

    const toNodeIds = new Set(
      transitions
        .map((transition) => getRelatedId(transition.ToNode))
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    );

    const inferredStartNode =
      nodes.find((node) => !toNodeIds.has(getRecordId(node) ?? '')) ??
      [...nodes].sort((left, right) => {
        const yDiff = asNumber(left.PositionY) - asNumber(right.PositionY);
        if (yDiff !== 0) {
          return yDiff;
        }

        return asNumber(left.PositionX) - asNumber(right.PositionX);
      })[0];

    return inferredStartNode ?? null;
  }

  public async initializeForCreatedEvent(input: InitializationInput): Promise<InitializationResult> {
    if (STREAM_PATH_ENTITY_NAMES.has(input.entityTypeName)) {
      return {
        initialized: false,
        reason: 'ignored_infrastructure_entity',
      };
    }

    const targetRecordId = pickRecordIdFromPayload(input.payload) ?? input.entityId;

    if (!targetRecordId) {
      return {
        initialized: false,
        reason: 'missing_target_record_id',
      };
    }

    const matchingDefinitions = await this.queryEntityRecords(
      FLOW_ENTITY,
      [
        {
          fieldName: 'TargetEntityType',
          operator: '=',
          value: input.entityTypeName,
        },
      ],
      2,
      200,
    );

    if (matchingDefinitions.length === 0) {
      return {
        initialized: false,
        reason: 'no_flow_definition',
        targetRecordId,
      };
    }

    const activeDefinition =
      [...matchingDefinitions]
        .sort((left, right) => {
          if (asBoolean(left.IsActive) !== asBoolean(right.IsActive)) {
            return asBoolean(left.IsActive) ? -1 : 1;
          }

          return asNumber(right.Version) - asNumber(left.Version);
        })[0] ?? null;

    if (!activeDefinition) {
      return {
        initialized: false,
        reason: 'no_flow_definition',
        targetRecordId,
      };
    }

    const flowDefinitionId = getRecordId(activeDefinition);

    if (!flowDefinitionId) {
      throw new HttpError(422, 'Flow definition is missing Id');
    }

    const existingInstances = await this.queryEntityRecords(
      INSTANCE_ENTITY,
      [
        {
          fieldName: 'TargetRecordId',
          operator: '=',
          value: targetRecordId,
        },
        {
          fieldName: 'FlowDefinition.Id',
          operator: '=',
          value: flowDefinitionId,
        },
      ],
      2,
    );

    if (existingInstances.length > 0) {
      return {
        initialized: false,
        reason: 'already_initialized',
        flowDefinitionId,
        targetRecordId,
        instanceId: getRecordId(existingInstances[0]),
      };
    }

    const startNode = await this.getStartNode(flowDefinitionId);

    if (!startNode) {
      throw new HttpError(409, `Flow ${flowDefinitionId} has no available start node`);
    }

    const startNodeId = getRecordId(startNode);
    const startNodeLabel = asString(startNode.Label);

    if (!startNodeId) {
      throw new HttpError(422, 'Start node is missing Id');
    }

    const targetEntityDefinitionId =
      asString(activeDefinition.TargetEntityDefinitionId) || input.entityId;

    if (!targetEntityDefinitionId) {
      throw new HttpError(422, 'Flow definition is missing TargetEntityDefinitionId');
    }

    const initializedAt = new Date(input.changedAt || new Date().toISOString()).toISOString();
    const instanceUniqueKey = `${flowDefinitionId}::${targetRecordId}`;

    const instanceCreateResult = await this.relay.execute({
      type: 'command',
      command: 'CREATE',
      entityTypeName: INSTANCE_ENTITY,
      data: {
        TargetEntityType: input.entityTypeName,
        TargetEntityDefinitionId: targetEntityDefinitionId,
        TargetRecordId: targetRecordId,
        CurrentNodeKey: startNodeId,
        CurrentStatusLabel: startNodeLabel,
        StateJson: {
          initializedBy: input.source ?? 'event_created',
          initializedAt,
        },
        LastTransitionAt: initializedAt,
        IsClosed: asBoolean(startNode.IsTerminal),
        InstanceUniqueKey: instanceUniqueKey,
        FlowDefinition: flowDefinitionId,
      },
    });

    const instanceId = getRecordId(instanceCreateResult.data);

    if (!instanceId) {
      throw new HttpError(422, 'Created status instance is missing Id');
    }

    const historyCreateResult = await this.relay.execute({
      type: 'command',
      command: 'CREATE',
      entityTypeName: HISTORY_ENTITY,
      data: {
        StatusInstance: instanceId,
        FlowDefinition: flowDefinitionId,
        FromNode: null,
        ToNode: startNodeId,
        TransitionedAt: initializedAt,
        Notes: 'Initialized from CREATED entity event',
        EventJson: {
          source: input.source ?? 'event_created',
          targetRecordId,
          startNodeId,
          initializedAt,
        },
      },
    });

    return {
      initialized: true,
      flowDefinitionId,
      targetRecordId,
      instanceId,
      historyId: getRecordId(historyCreateResult.data),
      startNodeId,
      startedAt: initializedAt,
    };
  }
}
