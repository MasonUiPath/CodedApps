import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';

import { loadConfig } from './config.js';
import { getErrorDetails } from './errorDetails.js';
import { StreamPathFlowSnapshotService } from './flowSnapshotService.js';
import { UiPathMetadataService } from './metadataService.js';
import { StreamPathStatusTransitionService } from './statusTransitionService.js';
import { configureTelemetryControls } from './telemetryControl.js';
import {
  type HttpEntityChangeEvent,
  type NormalizedEntityChangeEvent,
  httpEntityChangeEventSchema,
  statusTransitionRequestSchema,
} from './types.js';
import { createUiPathAuthProvider } from './uipathAuthProvider.js';
import { UiPathRelay } from './uipathRelay.js';
import {
  type InitializationResult,
  StreamPathWorkflowInitializationService,
} from './workflowInitializationService.js';
import { WsRelayHub } from './wsHub.js';

const config = loadConfig();
configureTelemetryControls(config);
const authProvider = createUiPathAuthProvider(config);
const app = express();
const server = createServer(app);

const relay = new UiPathRelay(config, authProvider);
const metadataService = new UiPathMetadataService(config, authProvider);
const flowSnapshotService = new StreamPathFlowSnapshotService(config, authProvider);
const statusTransitionService = new StreamPathStatusTransitionService(config, authProvider, relay);
const workflowInitializationService = new StreamPathWorkflowInitializationService(
  config,
  authProvider,
  relay,
);
const LOCALHOST_ALLOWED_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOCALHOST_ALLOWED_ORIGINS_TEXT =
  'any localhost origin (http://localhost:<port>, http://127.0.0.1:<port>, http://[::1]:<port>)';
const TRUSTED_ORCHESTRATOR_IPS = new Set([
  '20.124.53.40',
  '20.124.53.41',
  '20.124.53.42',
  '20.124.53.43',
  '20.121.182.72',
  '20.121.182.73',
  '20.121.182.74',
  '20.121.182.75',
  '20.121.104.124',
  '20.121.104.125',
  '20.121.104.126',
  '20.121.104.127',
  '40.114.108.32',
  '40.114.108.33',
  '40.114.108.34',
  '40.114.108.35',
  '40.114.108.220',
  '40.114.108.221',
  '40.114.108.222',
  '40.114.108.223',
  '20.232.224.12',
  '20.232.224.13',
  '20.232.224.14',
  '20.232.224.15',
  '20.66.65.144',
  '20.66.65.145',
  '20.66.65.146',
  '20.66.65.147',
]);

const FLOW_ENTITY = 'StreamPathStatusFlowDefinition';
const NODE_ENTITY = 'StreamPathStatusNode';
const TRANSITION_ENTITY = 'StreamPathStatusTransition';
const INSTANCE_ENTITY = 'StreamPathStatusInstance';
const LOAN_ENTITY = 'E2ELoan';
const AGENT_TASK_ENTITY = 'E2EAgentTask';
const SIMULATED_AGENT_TASK_TYPES = [
  'executive_summary',
  'financial_analysis',
  'collateral',
  'covenants',
  'risk_strength_analysis',
  'risk_rating_rac',
  'relationship_summary',
  'industry_search',
] as const;

type RequestLike = Pick<IncomingMessage, 'headers' | 'socket'>;
type ResolveClientIpOptions = {
  trustForwardedHeaders: boolean;
};

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === 'string' ? value : null;
}

function normalizeRemoteAddress(value: string | undefined | null): string {
  if (!value) {
    return '';
  }

  const lower = value.toLowerCase();
  const zoneIndex = lower.indexOf('%');
  return zoneIndex >= 0 ? lower.slice(0, zoneIndex) : lower;
}

function isLoopbackAddress(value: string): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }

    return LOCALHOST_ALLOWED_ORIGIN_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeIpCandidate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeRemoteAddress(trimmed);
  if (normalized.startsWith('::ffff:')) {
    return normalized.slice('::ffff:'.length);
  }

  return normalized;
}

function firstCsvToken(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const [first] = value.split(',');
  return first?.trim() || null;
}

function stripIpv4PortIfPresent(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (value.includes(':') && !value.includes('.')) {
    return value;
  }

  const match = value.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (!match) {
    return value;
  }

  return match[1] ?? value;
}

function resolveRequestClientIp(request: RequestLike, options: ResolveClientIpOptions): string | null {
  const forwardedFor = firstHeaderValue(request.headers['x-forwarded-for']);
  const realIp = firstHeaderValue(request.headers['x-real-ip']);
  const cfConnectingIp = firstHeaderValue(request.headers['cf-connecting-ip']);
  const remoteAddress = request.socket.remoteAddress ?? null;
  const remoteIp = stripIpv4PortIfPresent(normalizeIpCandidate(remoteAddress));

  if (!options.trustForwardedHeaders) {
    return remoteIp;
  }

  const forwardedIp = stripIpv4PortIfPresent(normalizeIpCandidate(firstCsvToken(forwardedFor)));
  const cfIp = stripIpv4PortIfPresent(normalizeIpCandidate(cfConnectingIp));
  const realIpNormalized = stripIpv4PortIfPresent(normalizeIpCandidate(realIp));

  return (
    forwardedIp ??
    cfIp ??
    realIpNormalized ??
    remoteIp
  );
}

type EntityRecord = Record<string, unknown>;
type FlowContext = {
  entityName: string;
  flowDefinitionId: string;
  flowDefinition: EntityRecord;
  nodes: EntityRecord[];
  transitions: EntityRecord[];
  nodeById: Map<string, EntityRecord>;
};

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeEntityName(value: string): string {
  return value.replace(/_/g, '').toLowerCase();
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

function getAgentTaskType(record: EntityRecord): string {
  return (
    asString(record.Type) ||
    asString(record.AgentType) ||
    asString(record.TaskType) ||
    asString(record.type) ||
    'agent_task'
  );
}

function getLoanIdFromAgentTaskRecord(record: EntityRecord): string | null {
  const directCandidates = [record.LoanId, record.LoanRecordId, record.loanId, record.loanRecordId];
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  const relationCandidates = [record.Loan, record.loan];
  for (const relation of relationCandidates) {
    const relatedId = getRelatedId(relation);
    if (relatedId) {
      return relatedId;
    }
  }

  return null;
}

function evaluateLocalhostOnlyPolicy(
  request: RequestLike,
): { allowed: true } | { allowed: false; reason: string; details: Record<string, unknown> } {
  const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
  const origin = firstHeaderValue(request.headers.origin);
  const host = firstHeaderValue(request.headers.host)?.toLowerCase() ?? null;

  if (!isLoopbackAddress(remoteAddress)) {
    return {
      allowed: false,
      reason: 'remote_address_not_loopback',
      details: {
        remoteAddress,
        origin,
        host,
      },
    };
  }

  if (origin && !isLocalhostOrigin(origin)) {
    return {
      allowed: false,
      reason: 'origin_not_allowed',
      details: {
        remoteAddress,
        origin,
        host,
        allowedOrigins: LOCALHOST_ALLOWED_ORIGINS_TEXT,
      },
    };
  }

  return { allowed: true };
}

function isTrustedExternalOrchestratorRequest(request: RequestLike): boolean {
  const sourceHeader = firstHeaderValue(request.headers['x-uipath-source']);
  const s2sRangeHeader = firstHeaderValue(request.headers['x-uipath-s2s-iprange']);
  const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
  const isFromLocalProxy = isLoopbackAddress(remoteAddress);
  const clientIp = resolveRequestClientIp(request, {
    trustForwardedHeaders: isFromLocalProxy,
  });

  if (!sourceHeader || !s2sRangeHeader) {
    return false;
  }

  const normalizedSource = sourceHeader.toLowerCase();
  if (!normalizedSource.includes('uipath')) {
    return false;
  }

  if (s2sRangeHeader.trim().length === 0) {
    return false;
  }

  if (!clientIp) {
    return false;
  }

  return TRUSTED_ORCHESTRATOR_IPS.has(clientIp);
}

type ProcessValidatedEventResult = {
  accepted: true;
  delivered: number;
  event: NormalizedEntityChangeEvent;
  initialization: InitializationResult | null;
};

type ApplyStatusTransitionAndBroadcastInput = {
  requestId: string;
  recordId: string;
  targetNodeId: string;
  entityName?: string;
  source: string;
  notes?: string;
};

type ApplyStatusTransitionAndBroadcastResult = {
  result: Awaited<ReturnType<StreamPathStatusTransitionService['applyTransition']>>;
  delivered: number;
};

const processValidatedEvent = async (
  parsedEvent: HttpEntityChangeEvent,
  requestId: string,
  channel: 'http' | 'ws',
): Promise<ProcessValidatedEventResult> => {
  const startedAtMs = Date.now();
  const event = {
    eventId: randomUUID(),
    ...parsedEvent,
    changedAt: new Date(parsedEvent.changedAt).toISOString(),
    source: parsedEvent.source ?? 'uipath',
    reason: 'entity_invalidated' as const,
  };
  console.log('[stream-path-coordinator] events.parsed', {
    requestId,
    channel,
    eventId: event.eventId,
    entityTypeName: event.entityTypeName,
    entityId: event.entityId,
    changeType: event.changeType ?? null,
    source: event.source,
    changedAt: event.changedAt,
    hasPayload: event.payload !== undefined,
    correlationId: event.correlationId ?? null,
  });

  const deliveredPrimary = wsHub.broadcastEntityChange(event);
  let deliveredInitialization = 0;
  let initialization: InitializationResult | null = null;
  console.log('[stream-path-coordinator] events.broadcast.primary', {
    requestId,
    channel,
    deliveredPrimary,
    wsClients: wsHub.getClientCount(),
  });

  const shouldAttemptInitialization =
    parsedEvent.changeType === 'CREATED' || parsedEvent.changeType === 'UPDATED';

  if (shouldAttemptInitialization) {
    console.log('[stream-path-coordinator] events.initialization.started', {
      requestId,
      channel,
      changeType: parsedEvent.changeType ?? null,
      entityTypeName: parsedEvent.entityTypeName,
      entityId: parsedEvent.entityId,
    });
    initialization = await workflowInitializationService.initializeForCreatedEvent({
      entityTypeName: parsedEvent.entityTypeName,
      entityId: parsedEvent.entityId,
      changedAt: event.changedAt,
      payload: parsedEvent.payload,
      source: event.source,
    });
    console.log('[stream-path-coordinator] events.initialization.result', {
      requestId,
      channel,
      initialized: initialization.initialized,
      reason: initialization.reason ?? null,
      targetRecordId: initialization.targetRecordId ?? null,
      flowDefinitionId: initialization.flowDefinitionId ?? null,
      instanceId: initialization.instanceId ?? null,
      historyId: initialization.historyId ?? null,
      startNodeId: initialization.startNodeId ?? null,
    });

    if (initialization.initialized && initialization.startedAt && initialization.instanceId) {
      const initialized = initialization;
      const startedAt = initialized.startedAt;
      const instanceId = initialized.instanceId;

      if (!startedAt || !instanceId) {
        throw new Error('Initialized workflow result is missing required identifiers');
      }

      const instanceEvent = {
        eventId: randomUUID(),
        entityId: instanceId,
        entityTypeName: 'StreamPathStatusInstance',
        changedAt: startedAt,
        changeType: 'CREATED' as const,
        source: 'coordinator_init',
        reason: 'entity_invalidated' as const,
        payload: {
          targetRecordId: initialized.targetRecordId ?? null,
          flowDefinitionId: initialized.flowDefinitionId ?? null,
        },
      };

      deliveredInitialization += wsHub.broadcastEntityChange(instanceEvent);

      if (typeof initialized.historyId === 'string' && initialized.historyId.length > 0) {
        const historyEvent = {
          eventId: randomUUID(),
          entityId: initialized.historyId,
          entityTypeName: 'StreamPathStatusHistory',
          changedAt: startedAt,
          changeType: 'CREATED' as const,
          source: 'coordinator_init',
          reason: 'entity_invalidated' as const,
          payload: {
            statusInstanceId: instanceId,
          },
        };

        deliveredInitialization += wsHub.broadcastEntityChange(historyEvent);
      }
    }
  } else {
    console.log('[stream-path-coordinator] events.initialization.skipped', {
      requestId,
      channel,
      changeType: parsedEvent.changeType ?? null,
    });
  }

  console.log('[stream-path-coordinator] events.completed', {
    requestId,
    channel,
    eventId: event.eventId,
    entityTypeName: event.entityTypeName,
    entityId: event.entityId,
    deliveredPrimary,
    deliveredInitialization,
    deliveredTotal: deliveredPrimary + deliveredInitialization,
    initialized: initialization?.initialized ?? false,
    initializationReason: initialization?.reason ?? null,
    durationMs: Date.now() - startedAtMs,
  });

  return {
    accepted: true,
    delivered: deliveredPrimary + deliveredInitialization,
    event,
    initialization,
  };
};

const applyStatusTransitionAndBroadcast = async (
  input: ApplyStatusTransitionAndBroadcastInput,
): Promise<ApplyStatusTransitionAndBroadcastResult> => {
  const result = await statusTransitionService.applyTransition({
    recordId: input.recordId,
    targetNodeId: input.targetNodeId,
    entityName: input.entityName,
    source: input.source,
    notes: input.notes,
    onLog: (step, data) => {
      console.log('[stream-path-coordinator] status.transition.trace', {
        requestId: input.requestId,
        step,
        ...(data ?? {}),
      });
    },
  });

  if (!result.changed || !result.transitionedAt) {
    return { result, delivered: 0 };
  }

  const instanceEvent = {
    eventId: randomUUID(),
    entityId: result.instanceId,
    entityTypeName: 'StreamPathStatusInstance',
    changedAt: result.transitionedAt,
    changeType: 'UPDATED' as const,
    source: input.source,
    reason: 'entity_invalidated' as const,
    payload: {
      recordId: result.targetRecordId,
      targetNodeId: input.targetNodeId,
    },
  };

  const historyEvent = result.historyId
    ? {
        eventId: randomUUID(),
        entityId: result.historyId,
        entityTypeName: 'StreamPathStatusHistory',
        changedAt: result.transitionedAt,
        changeType: 'CREATED' as const,
        source: input.source,
        reason: 'entity_invalidated' as const,
        payload: {
          statusInstanceId: result.instanceId,
          flowDefinitionId: result.flowDefinitionId,
        },
      }
    : null;

  const targetEntityEvent = {
    eventId: randomUUID(),
    entityId: result.targetRecordId,
    entityTypeName: result.targetEntityType,
    changedAt: result.transitionedAt,
    changeType: 'UPDATED' as const,
    source: input.source,
    reason: 'entity_invalidated' as const,
    payload: {
      recordId: result.targetRecordId,
      statusInstanceId: result.instanceId,
      targetNodeId: input.targetNodeId,
    },
  };

  const deliveredInstance = wsHub.broadcastEntityChange(instanceEvent);
  const deliveredHistory = historyEvent ? wsHub.broadcastEntityChange(historyEvent) : 0;
  const deliveredTargetEntity = wsHub.broadcastEntityChange(targetEntityEvent);
  return {
    result,
    delivered: deliveredInstance + deliveredHistory + deliveredTargetEntity,
  };
};

const getEntityBaseUrl = (entityTypeName: string): string => {
  const baseUrl = config.uipathBaseUrl.replace(/\/+$/, '');
  return `${baseUrl}/${config.uipathOrgName}/${config.uipathTenantName}/datafabric_/api/EntityService/${entityTypeName}`;
};

const queryEntityRecords = async (
  entityTypeName: string,
  queryFilters: QueryFilter[] = [],
  expansionLevel = 2,
  limit = 10_000,
): Promise<EntityRecord[]> => {
  const token = await authProvider.getSecret();
  const response = await fetch(
    `${getEntityBaseUrl(entityTypeName)}/query?expansionLevel=${expansionLevel}`,
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
    throw new Error(`${entityTypeName} query failed: ${details}`);
  }

  return extractItems(parsed);
};

const getFlowContext = async (entityName: string): Promise<FlowContext> => {
  const flowDefinitions = await queryEntityRecords(
    FLOW_ENTITY,
    [
      {
        fieldName: 'TargetEntityType',
        operator: '=',
        value: entityName,
      },
    ],
    2,
    2_000,
  );
  const normalizedEntityName = normalizeEntityName(entityName);
  const matchingFlows = flowDefinitions
    .filter(
      (flow) =>
        normalizeEntityName(asString(flow.TargetEntityType ?? flow.targetEntityType)) ===
        normalizedEntityName,
    )
    .sort((left, right) => {
      if (asBoolean(left.IsActive) !== asBoolean(right.IsActive)) {
        return asBoolean(left.IsActive) ? -1 : 1;
      }
      return asNumber(right.Version) - asNumber(left.Version);
    });

  const selectedFlow = matchingFlows[0];
  const flowDefinitionId = getRecordId(selectedFlow);
  if (!selectedFlow || !flowDefinitionId) {
    throw new Error(`No active StreamPath flow found for ${entityName}`);
  }

  const [nodes, transitions] = await Promise.all([
    queryEntityRecords(
      NODE_ENTITY,
      [
        {
          fieldName: 'FlowDefinition.Id',
          operator: '=',
          value: flowDefinitionId,
        },
      ],
      2,
      10_000,
    ),
    queryEntityRecords(
      TRANSITION_ENTITY,
      [
        {
          fieldName: 'FlowDefinition.Id',
          operator: '=',
          value: flowDefinitionId,
        },
      ],
      2,
      10_000,
    ),
  ]);

  const flowNodes = nodes.filter((node) =>
    sameId(getRelatedId(node.FlowDefinition ?? node.flowDefinition), flowDefinitionId),
  );
  const flowTransitions = transitions.filter((transition) =>
    sameId(
      getRelatedId(transition.FlowDefinition ?? transition.flowDefinition),
      flowDefinitionId,
    ),
  );
  const nodeById = new Map<string, EntityRecord>();
  for (const node of flowNodes) {
    const nodeId = getRecordId(node);
    if (nodeId) {
      nodeById.set(nodeId, node);
    }
  }

  return {
    entityName,
    flowDefinitionId,
    flowDefinition: selectedFlow,
    nodes: flowNodes,
    transitions: flowTransitions,
    nodeById,
  };
};

const getInstanceForRecord = async (
  entityName: string,
  recordId: string,
  flowDefinitionId: string,
): Promise<EntityRecord | null> => {
  const instances = await queryEntityRecords(
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
    100,
  );
  const normalizedEntityName = normalizeEntityName(entityName);
  const matching = instances.filter((instance) => {
    const sameRecord = sameId(
      getRelatedId(instance.TargetRecordId ?? instance.targetRecordId),
      recordId,
    );
    const sameFlow = sameId(
      getRelatedId(instance.FlowDefinition ?? instance.flowDefinition),
      flowDefinitionId,
    );
    return sameRecord && sameFlow;
  });

  if (matching.length === 0) {
    return null;
  }

  const entityMatched = matching.filter(
    (instance) =>
      normalizeEntityName(asString(instance.TargetEntityType ?? instance.targetEntityType)) ===
      normalizedEntityName,
  );
  const candidates = entityMatched.length > 0 ? entityMatched : matching;
  candidates.sort((left, right) => {
    const leftTime = Date.parse(asString(left.UpdateTime));
    const rightTime = Date.parse(asString(right.UpdateTime));
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
  return candidates[0];
};

const buildOutgoingMap = (flow: FlowContext): Map<string, string[]> => {
  const outgoing = new Map<string, string[]>();
  for (const node of flow.nodes) {
    const nodeId = getRecordId(node);
    if (nodeId) {
      outgoing.set(nodeId, []);
    }
  }

  for (const transition of flow.transitions) {
    const fromNodeId = getRelatedId(transition.FromNode ?? transition.fromNode);
    const toNodeId = getRelatedId(transition.ToNode ?? transition.toNode);
    if (!fromNodeId || !toNodeId) {
      continue;
    }

    outgoing.set(fromNodeId, [...(outgoing.get(fromNodeId) ?? []), toNodeId]);

    if (asBoolean(transition.Bidirectional ?? transition.bidirectional)) {
      outgoing.set(toNodeId, [...(outgoing.get(toNodeId) ?? []), fromNodeId]);
    }
  }

  for (const [nodeId, targets] of outgoing.entries()) {
    const deduped = new Map<string, string>();
    for (const target of targets) {
      deduped.set(target.toUpperCase(), target);
    }
    outgoing.set(nodeId, Array.from(deduped.values()));
  }

  return outgoing;
};

const findPathBetweenNodes = (
  flow: FlowContext,
  fromNodeId: string,
  toNodeId: string,
): string[] | null => {
  if (sameId(fromNodeId, toNodeId)) {
    return [fromNodeId];
  }

  const outgoing = buildOutgoingMap(flow);
  const queue: string[] = [fromNodeId];
  const visited = new Set<string>([fromNodeId.toUpperCase()]);
  const previous = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const nextNodes = outgoing.get(current) ?? [];
    for (const nextNode of nextNodes) {
      const marker = nextNode.toUpperCase();
      if (visited.has(marker)) {
        continue;
      }

      visited.add(marker);
      previous.set(nextNode, current);

      if (sameId(nextNode, toNodeId)) {
        const path: string[] = [nextNode];
        let cursor = nextNode;
        while (previous.has(cursor)) {
          const prior = previous.get(cursor);
          if (!prior) {
            break;
          }
          path.unshift(prior);
          cursor = prior;
        }
        return path;
      }

      queue.push(nextNode);
    }
  }

  return null;
};

const findNodeIdByLabels = (flow: FlowContext, fragments: string[]): string | null => {
  const normalizedFragments = fragments.map(normalizeLabel);
  for (const node of flow.nodes) {
    const nodeId = getRecordId(node);
    if (!nodeId) {
      continue;
    }

    const label = normalizeLabel(asString(node.Label));
    if (normalizedFragments.some((fragment) => label.includes(fragment))) {
      return nodeId;
    }
  }

  return null;
};

type LoanWorkflowSimulationSummary = {
  loanRecordId: string;
  loanTransitions: Array<{ fromNodeId: string; toNodeId: string }>;
  agentTaskIds: string[];
  createdAgentTaskIds: string[];
  agentTransitionCount: number;
  agentReviewNodeId: string | null;
};

type AgentTaskSnapshot = {
  loanRecordId: string;
  flowDefinition: EntityRecord;
  nodes: EntityRecord[];
  transitions: EntityRecord[];
  agentTasks: EntityRecord[];
  latestInstances: EntityRecord[];
};

const runLoanWorkflowSimulationToReview = async (
  loanRecordId: string,
  requestId: string,
): Promise<LoanWorkflowSimulationSummary> => {
  const changedAt = new Date().toISOString();

  await processValidatedEvent(
    {
      entityId: loanRecordId,
      entityTypeName: LOAN_ENTITY,
      changedAt,
      changeType: 'CREATED',
      source: 'coordinator_simulator',
      payload: {
        RecordId: loanRecordId,
      },
    },
    requestId,
    'http',
  );

  const loanFlow = await getFlowContext(LOAN_ENTITY);
  let loanInstance = await getInstanceForRecord(LOAN_ENTITY, loanRecordId, loanFlow.flowDefinitionId);
  if (!loanInstance) {
    throw new Error(`No loan status instance found for ${loanRecordId}`);
  }

  const loanTransitions: Array<{ fromNodeId: string; toNodeId: string }> = [];
  const draftMemoNodeId =
    findNodeIdByLabels(loanFlow, ['draft credit memo', 'credit memo entry', 'draft memo']) ??
    null;

  if (draftMemoNodeId) {
    const currentNodeId = getRelatedId(loanInstance.CurrentNodeKey);
    if (currentNodeId && !sameId(currentNodeId, draftMemoNodeId)) {
      const path = findPathBetweenNodes(loanFlow, currentNodeId, draftMemoNodeId);
      if (path && path.length > 1) {
        for (let index = 1; index < path.length; index += 1) {
          const fromNodeId = path[index - 1]!;
          const toNodeId = path[index]!;
          const transition = await applyStatusTransitionAndBroadcast({
            requestId,
            recordId: loanRecordId,
            targetNodeId: toNodeId,
            entityName: LOAN_ENTITY,
            source: 'coordinator_simulator',
            notes: 'Loan workflow simulator transition',
          });
          if (transition.result.changed) {
            loanTransitions.push({ fromNodeId, toNodeId });
          }
        }
      }
    }
  }

  const allAgentTasks = await queryEntityRecords(AGENT_TASK_ENTITY, [], 2, 10_000);
  const relatedAgentTasks = allAgentTasks.filter((task) =>
    sameId(getLoanIdFromAgentTaskRecord(task) ?? undefined, loanRecordId),
  );

  const existingTypes = new Set(
    relatedAgentTasks.map((task) => normalizeLabel(getAgentTaskType(task))),
  );

  const createdAgentTaskIds: string[] = [];
  for (const taskType of SIMULATED_AGENT_TASK_TYPES) {
    if (existingTypes.has(normalizeLabel(taskType))) {
      continue;
    }

    const created = await relay.execute({
      type: 'command',
      command: 'CREATE',
      entityTypeName: AGENT_TASK_ENTITY,
      data: {
        Type: taskType,
        Loan: loanRecordId,
        Feedback: 'Created by coordinator simulator.',
      },
      options: {
        expansionLevel: 2,
      },
    });

    const createdAgentTaskId = getCreatedRecordId(created.data);
    if (!createdAgentTaskId) {
      throw new Error(`Failed to resolve created ${AGENT_TASK_ENTITY} id for type ${taskType}`);
    }

    createdAgentTaskIds.push(createdAgentTaskId);
    await processValidatedEvent(
      {
        entityId: createdAgentTaskId,
        entityTypeName: AGENT_TASK_ENTITY,
        changedAt: new Date().toISOString(),
        changeType: 'CREATED',
        source: 'coordinator_simulator',
        payload: {
          RecordId: createdAgentTaskId,
          Loan: loanRecordId,
          Type: taskType,
        },
      },
      requestId,
      'http',
    );
  }

  const refreshedAgentTasks = (await queryEntityRecords(AGENT_TASK_ENTITY, [], 2, 10_000)).filter((task) =>
    sameId(getLoanIdFromAgentTaskRecord(task) ?? undefined, loanRecordId),
  );
  const agentTaskIds = refreshedAgentTasks
    .map((task) => getRecordId(task))
    .filter((id): id is string => Boolean(id));

  const agentFlow = await getFlowContext(AGENT_TASK_ENTITY);
  const inProgressNodeId = findNodeIdByLabels(agentFlow, ['in progress']);
  const reviewNodeId =
    findNodeIdByLabels(agentFlow, ['underwriter review']) ??
    findNodeIdByLabels(agentFlow, ['review']);
  let agentTransitionCount = 0;

  for (const agentTaskId of agentTaskIds) {
    let agentInstance = await getInstanceForRecord(
      AGENT_TASK_ENTITY,
      agentTaskId,
      agentFlow.flowDefinitionId,
    );
    if (!agentInstance) {
      await processValidatedEvent(
        {
          entityId: agentTaskId,
          entityTypeName: AGENT_TASK_ENTITY,
          changedAt: new Date().toISOString(),
          changeType: 'UPDATED',
          source: 'coordinator_simulator',
          payload: {
            RecordId: agentTaskId,
            Loan: loanRecordId,
          },
        },
        requestId,
        'http',
      );
      agentInstance = await getInstanceForRecord(
        AGENT_TASK_ENTITY,
        agentTaskId,
        agentFlow.flowDefinitionId,
      );
      if (!agentInstance) {
        throw new Error(`No agent task status instance found for ${agentTaskId}`);
      }
    }

    let currentNodeId = getRelatedId(agentInstance.CurrentNodeKey);
    if (!currentNodeId) {
      continue;
    }

    const applyPath = async (targetNodeId: string): Promise<void> => {
      const path = findPathBetweenNodes(agentFlow, currentNodeId!, targetNodeId);
      if (!path || path.length <= 1) {
        return;
      }

      for (let index = 1; index < path.length; index += 1) {
        const fromNodeId = path[index - 1]!;
        const toNodeId = path[index]!;
        const fromLabel = normalizeLabel(asString(agentFlow.nodeById.get(fromNodeId)?.Label));
        const toLabel = normalizeLabel(asString(agentFlow.nodeById.get(toNodeId)?.Label));

        if (fromLabel.includes('progress') && toLabel.includes('review')) {
          await relay.execute({
            type: 'command',
            command: 'UPDATE',
            entityTypeName: AGENT_TASK_ENTITY,
            recordId: agentTaskId,
            data: {
              SummaryText: `Simulated agent output for ${agentTaskId} at ${new Date().toISOString()}.`,
              Confidence: 0.88,
              AgentFollowupQuestions: JSON.stringify([
                'Can you expand variance analysis for the prior quarter?',
                'Please cite supporting package documents for collateral assumptions.',
              ]),
            },
          });

          await processValidatedEvent(
            {
              entityId: agentTaskId,
              entityTypeName: AGENT_TASK_ENTITY,
              changedAt: new Date().toISOString(),
              changeType: 'UPDATED',
              source: 'coordinator_simulator',
              payload: {
                RecordId: agentTaskId,
              },
            },
            requestId,
            'http',
          );
        }

        const transition = await applyStatusTransitionAndBroadcast({
          requestId,
          recordId: agentTaskId,
          targetNodeId: toNodeId,
          entityName: AGENT_TASK_ENTITY,
          source: 'coordinator_simulator',
          notes: 'Loan workflow simulator agent transition',
        });
        if (transition.result.changed) {
          agentTransitionCount += 1;
        }
      }

      currentNodeId = targetNodeId;
    };

    if (inProgressNodeId && !sameId(currentNodeId, inProgressNodeId)) {
      await applyPath(inProgressNodeId);
    }

    if (reviewNodeId && !sameId(currentNodeId, reviewNodeId)) {
      await applyPath(reviewNodeId);
    }
  }

  return {
    loanRecordId,
    loanTransitions,
    agentTaskIds,
    createdAgentTaskIds,
    agentTransitionCount,
    agentReviewNodeId: reviewNodeId,
  };
};

const getAgentTaskSnapshotForLoan = async (loanRecordId: string): Promise<AgentTaskSnapshot> => {
  const flow = await getFlowContext(AGENT_TASK_ENTITY);

  let relatedAgentTasks = await queryEntityRecords(
    AGENT_TASK_ENTITY,
    [
      {
        fieldName: 'Loan.Id',
        operator: '=',
        value: loanRecordId,
      },
    ],
    2,
    5_000,
  );

  if (relatedAgentTasks.length === 0) {
    const fallbackTasks = await queryEntityRecords(AGENT_TASK_ENTITY, [], 2, 10_000);
    relatedAgentTasks = fallbackTasks.filter((task) =>
      sameId(getLoanIdFromAgentTaskRecord(task) ?? undefined, loanRecordId),
    );
  }

  const taskIds = new Set(
    relatedAgentTasks
      .map((task) => getRecordId(task))
      .filter((id): id is string => Boolean(id))
      .map((id) => id.toUpperCase()),
  );

  const flowInstances = await queryEntityRecords(
    INSTANCE_ENTITY,
    [
      {
        fieldName: 'FlowDefinition.Id',
        operator: '=',
        value: flow.flowDefinitionId,
      },
    ],
    2,
    10_000,
  );

  const latestInstanceByTaskId = new Map<string, EntityRecord>();
  for (const instance of flowInstances) {
    const targetRecordId = asString(instance.TargetRecordId ?? instance.targetRecordId);
    if (!targetRecordId || !taskIds.has(targetRecordId.toUpperCase())) {
      continue;
    }

    const targetEntityType = asString(instance.TargetEntityType ?? instance.targetEntityType);
    if (normalizeEntityName(targetEntityType) !== normalizeEntityName(AGENT_TASK_ENTITY)) {
      continue;
    }

    const existing = latestInstanceByTaskId.get(targetRecordId.toUpperCase());
    if (!existing) {
      latestInstanceByTaskId.set(targetRecordId.toUpperCase(), instance);
      continue;
    }

    const existingTime = Date.parse(asString(existing.UpdateTime ?? existing.updateTime));
    const candidateTime = Date.parse(asString(instance.UpdateTime ?? instance.updateTime));
    const existingMillis = Number.isFinite(existingTime) ? existingTime : 0;
    const candidateMillis = Number.isFinite(candidateTime) ? candidateTime : 0;

    if (candidateMillis >= existingMillis) {
      latestInstanceByTaskId.set(targetRecordId.toUpperCase(), instance);
    }
  }

  return {
    loanRecordId,
    flowDefinition: flow.flowDefinition,
    nodes: flow.nodes,
    transitions: flow.transitions,
    agentTasks: relatedAgentTasks,
    latestInstances: Array.from(latestInstanceByTaskId.values()),
  };
};

const wsHub: WsRelayHub = new WsRelayHub(
  server,
  config.wsPath,
  (command) => relay.execute(command),
  async (request) => {
    if (request.action === 'list_entities') {
      return {
        generatedAt: new Date().toISOString(),
        entities: await metadataService.listEntities(request.refresh),
      };
    }

    return metadataService.getEntitySchema(request.entityTypeName!, request.refresh);
  },
  async (event): Promise<ProcessValidatedEventResult> => {
    const requestId = randomUUID();
    console.log('[stream-path-coordinator] events.received', {
      requestId,
      channel: 'ws',
      body: event,
    });
    return processValidatedEvent(event, requestId, 'ws');
  },
  async (request) => {
    const requestId = randomUUID();
    const recordId = request.recordId ?? request.RecordId;
    const targetNodeId = request.targetNodeId ?? request.NewStatusId;

    if (!recordId || !targetNodeId) {
      throw new Error('recordId/RecordId and targetNodeId/NewStatusId are required');
    }

    const { result, delivered } = await applyStatusTransitionAndBroadcast({
      requestId,
      recordId,
      targetNodeId,
      entityName: request.entityName,
      source: 'coordinator_ws',
      notes: 'Transitioned via StreamPath coordinator WebSocket endpoint',
    });

    return {
      accepted: true,
      changed: result.changed,
      delivered,
      requestId,
      result,
    };
  },
  async (request) => {
    const recordId = request.recordId.trim();
    const entityTypeName = request.entityTypeName?.trim() || LOAN_ENTITY;

    if (!recordId) {
      throw new Error('recordId is required');
    }

    return flowSnapshotService.getSnapshotForRecord(recordId, entityTypeName);
  },
  async (request) => {
    const loanRecordId = request.loanRecordId.trim();
    if (!loanRecordId) {
      throw new Error('loanRecordId is required');
    }

    return getAgentTaskSnapshotForLoan(loanRecordId);
  },
  (request) => {
    const policy = evaluateLocalhostOnlyPolicy(request);
    if (policy.allowed) {
      return { allowed: true };
    }

    console.warn('[stream-path-coordinator] ws.connection.rejected', {
      reason: policy.reason,
      ...policy.details,
    });
    return {
      allowed: false,
      reason: `Localhost-only mode: allowed origins are ${LOCALHOST_ALLOWED_ORIGINS_TEXT}`,
    };
  },
);

app.disable('x-powered-by');
app.use((req: Request, res: Response, next: NextFunction) => {
  const isExternalOrchestratorRoute =
    req.method === 'POST' && (req.path === '/events' || req.path === '/status/transition');
  const allowedByExternalOrchestrator =
    isExternalOrchestratorRoute && isTrustedExternalOrchestratorRequest(req);

  if (!allowedByExternalOrchestrator) {
    const policy = evaluateLocalhostOnlyPolicy(req);
    if (!policy.allowed) {
      console.warn('[stream-path-coordinator] http.request.rejected', {
        method: req.method,
        path: req.originalUrl,
        reason: policy.reason,
        ...policy.details,
        allowedByExternalOrchestrator,
      });
      res.status(403).json({
        error: 'Forbidden: request must come from localhost:8080 or trusted UiPath Orchestrator route',
        allowedOrigins: LOCALHOST_ALLOWED_ORIGINS_TEXT,
      });
      return;
    }
  }

  const origin = req.headers.origin;

  if (origin && isLocalhostOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use(express.json({ limit: config.jsonBodyLimit }));

app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    service: 'StreamPathCoordinator',
    status: 'ok',
    message: 'This is the coordinator API/WebSocket service. Open the web client at http://localhost:5173 during local development.',
    health: '/health',
    metadata: '/metadata/entities',
    websocket: config.wsPath,
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    wsClients: wsHub.getClientCount(),
    wsPath: config.wsPath,
    timestamp: new Date().toISOString(),
  });
});

app.get('/flow/snapshot', (req: Request, res: Response) => {
  void (async () => {
    const recordId = typeof req.query.recordId === 'string' ? req.query.recordId.trim() : '';
    const entityTypeNameRaw =
      typeof req.query.entityTypeName === 'string' ? req.query.entityTypeName.trim() : '';
    const entityTypeName = entityTypeNameRaw || 'E2ELoan';

    if (!recordId) {
      res.status(400).json({ error: 'recordId query param is required' });
      return;
    }

    const snapshot = await flowSnapshotService.getSnapshotForRecord(recordId, entityTypeName);
    res.status(200).json(snapshot);
  })().catch((error) => {
    const details = getErrorDetails(error);

    console.error('[stream-path-coordinator] /flow/snapshot failed', {
      method: req.method,
      url: req.originalUrl,
      error: details,
    });

    if (
      typeof details.statusCode === 'number' &&
      details.statusCode >= 400 &&
      details.statusCode < 500 &&
      typeof details.message === 'string'
    ) {
      res.status(details.statusCode).json({ error: details.message });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  });
});

app.post('/events', (req: Request, res: Response) => {
  const requestId = randomUUID();
  console.log('[stream-path-coordinator] events.received', {
    requestId,
    channel: 'http',
    method: req.method,
    path: req.originalUrl,
    body: req.body,
  });

  void (async () => {
    const parsed = httpEntityChangeEventSchema.safeParse(req.body);

    if (!parsed.success) {
      console.warn('[stream-path-coordinator] events.invalid_payload', {
        requestId,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'root',
          message: issue.message,
        })),
      });
      res.status(400).json({
        error: 'Invalid event payload',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'root',
          message: issue.message,
        })),
      });
      return;
    }

    const result = await processValidatedEvent(parsed.data, requestId, 'http');
    res.status(202).json(result);
  })().catch((error) => {
    const details = getErrorDetails(error);

    console.error('[stream-path-coordinator] /events failed', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      error: details,
    });

    if (
      typeof details.statusCode === 'number' &&
      details.statusCode >= 400 &&
      details.statusCode < 500 &&
      typeof details.message === 'string'
    ) {
      res.status(details.statusCode).json({ error: details.message });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  });
});

app.post('/status/transition', async (req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  const startedAtMs = Date.now();
  console.log('[stream-path-coordinator] status.transition.received', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    body: req.body,
  });

  const parsed = statusTransitionRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    console.warn('[stream-path-coordinator] status.transition.invalid_payload', {
      requestId,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
      })),
    });

    res.status(400).json({
      error: 'Invalid transition payload',
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
      })),
      requestId,
    });
    return;
  }

  try {
    const recordId = parsed.data.recordId ?? parsed.data.RecordId;
    const targetNodeId = parsed.data.targetNodeId ?? parsed.data.NewStatusId;
    console.log('[stream-path-coordinator] status.transition.parsed', {
      requestId,
      recordId,
      targetNodeId,
      entityName: parsed.data.entityName ?? null,
    });

    if (!recordId || !targetNodeId) {
      console.warn('[stream-path-coordinator] status.transition.missing_required_fields', {
        requestId,
        recordId: recordId ?? null,
        targetNodeId: targetNodeId ?? null,
      });
      res.status(400).json({
        error: 'recordId/RecordId and targetNodeId/NewStatusId are required',
        requestId,
      });
      return;
    }

    const { result, delivered } = await applyStatusTransitionAndBroadcast({
      requestId,
      recordId,
      targetNodeId,
      entityName: parsed.data.entityName,
      source: 'coordinator_http',
      notes: 'Transitioned via StreamPath coordinator HTTP endpoint',
    });

    if (result.changed && result.transitionedAt) {
      console.log('[stream-path-coordinator] status.transition.completed', {
        requestId,
        changed: true,
        delivered,
        durationMs: Date.now() - startedAtMs,
        instanceId: result.instanceId,
        historyId: result.historyId ?? null,
        transitionId: result.transitionId ?? null,
        fromNodeId: result.fromNodeId ?? null,
        toNodeId: result.toNodeId,
      });

      res.status(202).json({
        accepted: true,
        changed: true,
        delivered,
        requestId,
        result,
      });
      return;
    }

    console.log('[stream-path-coordinator] status.transition.completed', {
      requestId,
      changed: false,
      reason: result.reason ?? null,
      durationMs: Date.now() - startedAtMs,
      instanceId: result.instanceId,
      fromNodeId: result.fromNodeId ?? null,
      toNodeId: result.toNodeId,
    });

    res.status(200).json({
      accepted: true,
      changed: false,
      requestId,
      result,
    });
  } catch (error) {
    const details = getErrorDetails(error);
    console.error('[stream-path-coordinator] status.transition.failed', {
      requestId,
      recordId: parsed.data.recordId ?? parsed.data.RecordId ?? null,
      targetNodeId: parsed.data.targetNodeId ?? parsed.data.NewStatusId ?? null,
      durationMs: Date.now() - startedAtMs,
      error: details,
    });
    next(error);
  }
});

const handleLoanSimulationRequest = (req: Request<{ loanRecordId: string }>, res: Response) => {
  const requestId = randomUUID();
  const startedAtMs = Date.now();
  const loanRecordId = req.params.loanRecordId?.trim();

  if (!loanRecordId) {
    res.status(400).json({
      error: 'loanRecordId route param is required',
      requestId,
    });
    return;
  }

  console.log('[stream-path-coordinator] simulator.loan_review_ready.started', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    loanRecordId,
  });

  void (async () => {
    const summary = await runLoanWorkflowSimulationToReview(loanRecordId, requestId);
    console.log('[stream-path-coordinator] simulator.loan_review_ready.completed', {
      requestId,
      loanRecordId,
      createdAgentTaskCount: summary.createdAgentTaskIds.length,
      totalAgentTaskCount: summary.agentTaskIds.length,
      loanTransitionCount: summary.loanTransitions.length,
      agentTransitionCount: summary.agentTransitionCount,
      durationMs: Date.now() - startedAtMs,
    });

    res.status(200).json({
      ok: true,
      requestId,
      durationMs: Date.now() - startedAtMs,
      summary,
    });
  })().catch((error) => {
    const details = getErrorDetails(error);
    console.error('[stream-path-coordinator] simulator.loan_review_ready.failed', {
      requestId,
      loanRecordId,
      durationMs: Date.now() - startedAtMs,
      error: details,
    });

    if (
      typeof details.statusCode === 'number' &&
      details.statusCode >= 400 &&
      details.statusCode < 500 &&
      typeof details.message === 'string'
    ) {
      res.status(details.statusCode).json({ error: details.message, requestId });
      return;
    }

    res.status(500).json({
      error: 'Loan simulation failed',
      requestId,
      details: details.message ?? 'Unknown error',
    });
  });
};

app.get('/simulate/loan/:loanRecordId/review-ready', handleLoanSimulationRequest);
app.post('/simulate/loan/:loanRecordId/review-ready', handleLoanSimulationRequest);

app.get('/metadata/entities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refresh = req.query.refresh === 'true';
    const entities = await metadataService.listEntities(refresh);
    res.json({
      generatedAt: new Date().toISOString(),
      entities,
    });
  } catch (error) {
    next(error);
  }
});

app.get(
  '/metadata/entities/:entityTypeName',
  async (req: Request<{ entityTypeName: string }>, res: Response, next: NextFunction) => {
    try {
      const refresh = req.query.refresh === 'true';
      const entity = await metadataService.getEntitySchema(req.params.entityTypeName, refresh);
      res.json(entity);
    } catch (error) {
      next(error);
    }
  },
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const details = getErrorDetails(error);

  console.error('[stream-path-coordinator] request failed', {
    method: _req.method,
    url: _req.originalUrl,
    statusHint:
      typeof details.statusCode === 'number'
        ? details.statusCode
        : error instanceof SyntaxError
          ? 400
          : undefined,
    error: details,
  });

  if (error instanceof Error && error.message.startsWith('Unable to find entity schema')) {
    res.status(404).json({ error: error.message });
    return;
  }

  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Malformed JSON request body' });
    return;
  }

  if (
    typeof details.statusCode === 'number' &&
    details.statusCode >= 400 &&
    details.statusCode < 500 &&
    typeof details.message === 'string'
  ) {
    res.status(details.statusCode).json({ error: details.message });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
});

server.listen(config.port, () => {
  console.log(
    `[stream-path-coordinator] listening on http://localhost:${config.port} (ws path: ${config.wsPath})`,
  );
});

const shutdown = (signal: string): void => {
  console.log(`[stream-path-coordinator] received ${signal}, shutting down...`);

  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
