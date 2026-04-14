import type { AppConfig } from './config.js';
import type { UiPathAuthProvider } from './uipathAuthProvider.js';
import type { UiPathRelay } from './uipathRelay.js';

const NODE_ENTITY = 'StreamPathStatusNode';
const TRANSITION_ENTITY = 'StreamPathStatusTransition';
const INSTANCE_ENTITY = 'StreamPathStatusInstance';
const HISTORY_ENTITY = 'StreamPathStatusHistory';

const QUERY_LIMIT = 5_000;

type EntityRecord = Record<string, unknown>;
type QueryFilter = {
  fieldName: string;
  operator: '=';
  value: string;
};

type TransitionApplyInput = {
  recordId: string;
  targetNodeId: string;
  entityName?: string;
  source?: string;
  notes?: string;
  onLog?: (step: string, data?: Record<string, unknown>) => void;
};

export type TransitionApplyResult = {
  changed: boolean;
  reason?: string;
  targetRecordId: string;
  targetEntityType: string;
  targetEntityDefinitionId: string;
  flowDefinitionId: string;
  instanceId: string;
  historyId?: string;
  fromNodeId?: string;
  toNodeId: string;
  targetNodeLabel: string;
  transitionId?: string;
  transitionedAt?: string;
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

function getCreatedRecordId(payload: unknown): string | undefined {
  const direct = getRecordId(payload);
  if (direct) {
    return direct;
  }

  const items = extractItems(payload);
  for (const item of items) {
    const id = getRecordId(item);
    if (id) {
      return id;
    }
  }

  if (isRecord(payload) && isRecord(payload.data)) {
    return getCreatedRecordId(payload.data);
  }

  return undefined;
}

function getRelatedId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return getRecordId(value);
}

function getRelatedLabel(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = value.Label ?? value.label;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function getRecordField(record: EntityRecord | null | undefined, keys: string[]): unknown {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function getRecordString(record: EntityRecord | null | undefined, keys: string[]): string {
  const value = getRecordField(record, keys);
  return typeof value === 'string' ? value : '';
}

function sameId(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toUpperCase() === right.toUpperCase());
}

function sameEntityType(left: string | undefined, right: string | undefined): boolean {
  return Boolean(
    left &&
      right &&
      left.replace(/_/g, '').toUpperCase() === right.replace(/_/g, '').toUpperCase(),
  );
}

export class StreamPathStatusTransitionService {
  public constructor(
    private readonly config: AppConfig,
    private readonly authProvider: UiPathAuthProvider,
    private readonly relay: UiPathRelay,
  ) {}

  private getEntityBaseUrl(entityTypeName: string): string {
    const baseUrl = this.config.uipathBaseUrl.replace(/\/+$/, '');
    return `${baseUrl}/${this.config.uipathOrgName}/${this.config.uipathTenantName}/datafabric_/api/EntityService/${entityTypeName}`;
  }

  private async readEntityRecord(
    entityTypeName: string,
    recordId: string,
    expansionLevel = 2,
  ): Promise<EntityRecord | null> {
    const token = await this.authProvider.getSecret();
    const response = await fetch(
      `${this.getEntityBaseUrl(entityTypeName)}/read/${recordId}?expansionLevel=${expansionLevel}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 404) {
      return null;
    }

    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const details =
        isRecord(parsed) && typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
      throw new HttpError(response.status, `${entityTypeName} read failed: ${details}`);
    }

    if (!isRecord(parsed)) {
      return null;
    }

    return parsed;
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

  public async applyTransition(input: TransitionApplyInput): Promise<TransitionApplyResult> {
    const log = input.onLog ?? (() => undefined);
    log('transition.start', {
      recordId: input.recordId,
      targetNodeId: input.targetNodeId,
      entityName: input.entityName ?? null,
    });

    const targetNode = await this.readEntityRecord(NODE_ENTITY, input.targetNodeId, 2);

    if (!targetNode) {
      log('transition.target_node_not_found', {
        targetNodeId: input.targetNodeId,
      });
      throw new HttpError(404, `Target status node ${input.targetNodeId} was not found`);
    }

    const flowDefinitionId = getRelatedId(getRecordField(targetNode, ['FlowDefinition', 'flowDefinition']));

    if (!flowDefinitionId) {
      log('transition.target_node_missing_flow_definition', {
        targetNodeId: input.targetNodeId,
      });
      throw new HttpError(422, 'Target status node is missing FlowDefinition reference');
    }

    const targetNodeId = getRecordId(targetNode);

    if (!targetNodeId) {
      log('transition.target_node_missing_id', {
        targetNodeId: input.targetNodeId,
      });
      throw new HttpError(422, 'Target status node is missing Id');
    }

    const targetNodeLabel = getRecordString(targetNode, ['Label', 'label']);
    const targetIsTerminal = getRecordField(targetNode, ['IsTerminal', 'isTerminal']) === true;
    const targetIsStart = getRecordField(targetNode, ['IsStart', 'isStart']) === true;
    log('transition.target_node_loaded', {
      targetNodeId,
      flowDefinitionId,
      targetNodeLabel,
      targetIsStart,
      targetIsTerminal,
    });

    const matchingInstances = (
      await this.queryEntityRecords(
        INSTANCE_ENTITY,
        [
          {
            fieldName: 'TargetRecordId',
            operator: '=',
            value: input.recordId,
          },
          {
            fieldName: 'FlowDefinition.Id',
            operator: '=',
            value: flowDefinitionId,
          },
        ],
        2,
      )
    ).filter(
      (instance) =>
        sameId(getRecordString(instance, ['TargetRecordId', 'targetRecordId']), input.recordId) &&
        sameId(getRelatedId(getRecordField(instance, ['FlowDefinition', 'flowDefinition'])), flowDefinitionId),
    );
    log('transition.instances_queried', {
      matchingInstanceCount: matchingInstances.length,
      recordId: input.recordId,
      flowDefinitionId,
    });

    if (matchingInstances.length === 0) {
      log('transition.no_matching_instance', {
        recordId: input.recordId,
        flowDefinitionId,
      });
      throw new HttpError(
        404,
        `No StreamPathStatusInstance found for record ${input.recordId} in flow ${flowDefinitionId}`,
      );
    }

    if (matchingInstances.length > 1) {
      log('transition.multiple_matching_instances', {
        recordId: input.recordId,
        flowDefinitionId,
        matchingInstanceCount: matchingInstances.length,
      });
      throw new HttpError(
        409,
        `Multiple StreamPathStatusInstance records found for record ${input.recordId} in flow ${flowDefinitionId}`,
      );
    }

    const instance = matchingInstances[0];
    const instanceId = getRecordId(instance);

    if (!instanceId) {
      log('transition.instance_missing_id', {
        recordId: input.recordId,
        flowDefinitionId,
      });
      throw new HttpError(422, 'Matched StreamPathStatusInstance is missing Id');
    }

    const targetEntityType = getRecordString(instance, ['TargetEntityType', 'targetEntityType']);
    const targetEntityDefinitionId = getRecordString(instance, [
      'TargetEntityDefinitionId',
      'targetEntityDefinitionId',
    ]);

    if (!targetEntityType || !targetEntityDefinitionId) {
      log('transition.instance_missing_target_context', {
        instanceId,
        targetEntityType,
        targetEntityDefinitionId,
      });
      throw new HttpError(422, 'Matched StreamPathStatusInstance is missing target entity context');
    }

    if (input.entityName && !sameEntityType(input.entityName, targetEntityType)) {
      log('transition.entity_name_mismatch', {
        instanceId,
        expectedEntityName: targetEntityType,
        receivedEntityName: input.entityName,
      });
      throw new HttpError(
        409,
        `Transition entity mismatch. Expected ${targetEntityType}, received ${input.entityName}`,
      );
    }

    const currentNodeId = getRelatedId(getRecordField(instance, ['CurrentNodeKey', 'currentNodeKey']));
    const currentNodeLabel = getRecordString(instance, ['CurrentStatusLabel', 'currentStatusLabel']);
    log('transition.instance_loaded', {
      instanceId,
      currentNodeId: currentNodeId ?? null,
      currentNodeLabel: currentNodeLabel || null,
      targetNodeId,
      targetNodeLabel: targetNodeLabel || null,
      targetEntityType,
      targetEntityDefinitionId,
    });

    if (sameId(currentNodeId, targetNodeId)) {
      log('transition.noop_already_at_target', {
        instanceId,
        currentNodeId: currentNodeId ?? null,
        targetNodeId,
      });
      return {
        changed: false,
        reason: 'already_at_target',
        targetRecordId: input.recordId,
        targetEntityType,
        targetEntityDefinitionId,
        flowDefinitionId,
        instanceId,
        fromNodeId: currentNodeId,
        toNodeId: targetNodeId,
        targetNodeLabel,
      };
    }

    let matchedTransitionId: string | undefined;

    if (!currentNodeId) {
      if (!targetIsStart) {
        log('transition.current_node_missing_and_target_not_start', {
          instanceId,
          targetNodeId,
          targetIsStart,
        });
        throw new HttpError(
          409,
          `Status instance ${instanceId} has no current node; target node must be a start node`,
        );
      }

      log('transition.current_node_missing_but_target_start_allowed', {
        instanceId,
        targetNodeId,
      });
    } else {
      const flowTransitions = await this.queryEntityRecords(
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

      const matchingTransition = flowTransitions.find((transition) => {
        if (!sameId(getRelatedId(getRecordField(transition, ['FlowDefinition', 'flowDefinition'])), flowDefinitionId)) {
          return false;
        }

        const fromNodeId = getRelatedId(getRecordField(transition, ['FromNode', 'fromNode']));
        const toNodeId = getRelatedId(getRecordField(transition, ['ToNode', 'toNode']));

        const forward = sameId(fromNodeId, currentNodeId) && sameId(toNodeId, targetNodeId);
        const reverse =
          getRecordField(transition, ['Bidirectional', 'bidirectional']) === true &&
          sameId(fromNodeId, targetNodeId) &&
          sameId(toNodeId, currentNodeId);

        return forward || reverse;
      });

      if (!matchingTransition) {
        const validTargetsFromCurrent = flowTransitions
          .flatMap((transition) => {
            const fromNodeId = getRelatedId(getRecordField(transition, ['FromNode', 'fromNode']));
            const toNodeId = getRelatedId(getRecordField(transition, ['ToNode', 'toNode']));
            const bidirectional = getRecordField(transition, ['Bidirectional', 'bidirectional']) === true;

            if (!fromNodeId || !toNodeId) {
              return [];
            }

            if (sameId(fromNodeId, currentNodeId)) {
              return [
                {
                  targetNodeId: toNodeId,
                  targetNodeLabel:
                    getRelatedLabel(getRecordField(transition, ['ToNode', 'toNode'])) ?? null,
                  transitionId: getRecordId(transition) ?? null,
                  via: 'forward',
                },
              ];
            }

            if (bidirectional && sameId(toNodeId, currentNodeId)) {
              return [
                {
                  targetNodeId: fromNodeId,
                  targetNodeLabel:
                    getRelatedLabel(getRecordField(transition, ['FromNode', 'fromNode'])) ?? null,
                  transitionId: getRecordId(transition) ?? null,
                  via: 'reverse_bidirectional',
                },
              ];
            }

            return [];
          })
          .filter((candidate, index, all) => {
            const currentKey = candidate.targetNodeId.toUpperCase();
            return (
              all.findIndex((other) => other.targetNodeId.toUpperCase() === currentKey) === index
            );
          });

        log('transition.no_matching_transition_edge', {
          instanceId,
          currentNodeId,
          currentNodeLabel: currentNodeLabel || null,
          targetNodeId,
          targetNodeLabel: targetNodeLabel || null,
          flowDefinitionId,
          validTargetsFromCurrent,
        });

        const validTargetList =
          validTargetsFromCurrent.length > 0
            ? validTargetsFromCurrent
                .map((candidate) =>
                  candidate.targetNodeLabel
                    ? `${candidate.targetNodeId} (${candidate.targetNodeLabel})`
                    : candidate.targetNodeId,
                )
                .join(', ')
            : '(none)';

        throw new HttpError(
          409,
          `No valid transition from ${currentNodeId}${currentNodeLabel ? ` (${currentNodeLabel})` : ''} to ${targetNodeId}${targetNodeLabel ? ` (${targetNodeLabel})` : ''} in flow ${flowDefinitionId}. Valid target nodes from current node: ${validTargetList}`,
        );
      }

      matchedTransitionId = getRecordId(matchingTransition);
      log('transition.edge_matched', {
        instanceId,
        matchedTransitionId: matchedTransitionId ?? null,
        currentNodeId,
        targetNodeId,
      });
    }

    const transitionedAt = new Date().toISOString();
    const previousStatusLabel = getRecordString(instance, ['CurrentStatusLabel', 'currentStatusLabel']);
    const previousLastTransitionAt = getRecordString(instance, ['LastTransitionAt', 'lastTransitionAt']);
    const previousIsClosed = getRecordField(instance, ['IsClosed', 'isClosed']) === true;
    log('transition.applying_update', {
      instanceId,
      fromNodeId: currentNodeId ?? null,
      toNodeId: targetNodeId,
      transitionedAt,
    });

    await this.relay.execute({
      type: 'command',
      command: 'UPDATE',
      entityTypeName: INSTANCE_ENTITY,
      recordId: instanceId,
      data: {
        CurrentNodeKey: targetNodeId,
        CurrentStatusLabel: targetNodeLabel,
        LastTransitionAt: transitionedAt,
        IsClosed: targetIsTerminal,
      },
    });

    let historyId: string | undefined;
    try {
      const historyResult = await this.relay.execute({
        type: 'command',
        command: 'CREATE',
        entityTypeName: HISTORY_ENTITY,
        data: {
          StatusInstance: instanceId,
          FlowDefinition: flowDefinitionId,
          FromNode: currentNodeId ?? null,
          ToNode: targetNodeId,
          TransitionedAt: transitionedAt,
          Notes: input.notes ?? 'Transitioned via StreamPath coordinator HTTP endpoint',
          EventJson: {
            source: input.source ?? 'coordinator_http',
            recordId: input.recordId,
            targetNodeId,
            previousNodeId: currentNodeId ?? null,
            transitionId: matchedTransitionId ?? null,
            transitionedAt,
          },
        },
      });

      historyId = getCreatedRecordId(historyResult.data);
      if (!historyId) {
        log('transition.history_missing_id', {
          instanceId,
          matchedTransitionId: matchedTransitionId ?? null,
          historyCreateResponseType:
            historyResult.data === null
              ? 'null'
              : Array.isArray(historyResult.data)
                ? 'array'
                : typeof historyResult.data,
        });
        throw new HttpError(
          500,
          `History creation did not return a record id for transition ${instanceId} ${currentNodeId ?? 'null'} -> ${targetNodeId}`,
        );
      }
    } catch (historyError) {
      log('transition.history_create_failed_rollback.started', {
        instanceId,
        fromNodeId: currentNodeId ?? null,
        attemptedToNodeId: targetNodeId,
      });
      try {
        await this.relay.execute({
          type: 'command',
          command: 'UPDATE',
          entityTypeName: INSTANCE_ENTITY,
          recordId: instanceId,
          data: {
            CurrentNodeKey: currentNodeId ?? null,
            CurrentStatusLabel: previousStatusLabel,
            LastTransitionAt: previousLastTransitionAt || null,
            IsClosed: previousIsClosed,
          },
        });
        log('transition.history_create_failed_rollback.completed', {
          instanceId,
          restoredNodeId: currentNodeId ?? null,
        });
      } catch (rollbackError) {
        log('transition.history_create_failed_rollback.failed', {
          instanceId,
          rollbackError:
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }

      throw historyError;
    }

    log('transition.history_created', {
      instanceId,
      historyId,
      matchedTransitionId: matchedTransitionId ?? null,
    });

    log('transition.completed', {
      changed: true,
      instanceId,
      fromNodeId: currentNodeId ?? null,
      toNodeId: targetNodeId,
      targetNodeLabel,
      transitionId: matchedTransitionId ?? null,
      historyId: historyId ?? null,
      transitionedAt,
    });

    return {
      changed: true,
      targetRecordId: input.recordId,
      targetEntityType,
      targetEntityDefinitionId,
      flowDefinitionId,
      instanceId,
      historyId,
      fromNodeId: currentNodeId,
      toNodeId: targetNodeId,
      targetNodeLabel,
      transitionId: matchedTransitionId,
      transitionedAt,
    };
  }
}
