import type { LoanStatusEdge, LoanStatusGraph, LoanStatusNode } from './types';

type EntityRecord = Record<string, unknown>;
type HandleSide = 'top' | 'right' | 'bottom' | 'left';

const GRID_SIZE = 24;
const NODE_WIDTH = 192;
const NODE_HEIGHT = 96;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sameId(left: string | undefined | null, right: string | undefined | null): boolean {
  return Boolean(left && right && left.toUpperCase() === right.toUpperCase());
}

function parseTransitionMetadataStrict(
  value: unknown,
  transitionId: string,
): { sourceHandle: string; targetHandle: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Transition ${transitionId} is missing MetadataJson`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error(`Transition ${transitionId} has invalid MetadataJson`);
  }

  const sourceHandle =
    typeof parsed.sourceHandle === 'string'
      ? parsed.sourceHandle
      : typeof parsed.sourceHandleId === 'string'
        ? parsed.sourceHandleId
        : null;
  const targetHandle =
    typeof parsed.targetHandle === 'string'
      ? parsed.targetHandle
      : typeof parsed.targetHandleId === 'string'
        ? parsed.targetHandleId
        : null;

  if (!sourceHandle || !targetHandle) {
    throw new Error(
      `Transition ${transitionId} metadata must include both sourceHandle and targetHandle`,
    );
  }

  return { sourceHandle, targetHandle };
}

function parseHandleId(handleId: string | undefined): { side: HandleSide; index: number } | null {
  if (!handleId) {
    return null;
  }

  const match = /^(top|right|bottom|left)-(\d+)$/.exec(handleId.trim());
  if (!match) {
    return null;
  }

  const side = match[1] as HandleSide;
  const index = Number.parseInt(match[2], 10);
  if (!Number.isFinite(index) || index < 1) {
    return null;
  }

  return { side, index };
}

function getHandleCount(side: HandleSide, nodeHeight: number): number {
  const length = side === 'left' || side === 'right' ? nodeHeight : NODE_WIDTH;
  return Math.max(1, Math.floor(length / GRID_SIZE) - 1);
}

function resolveHandleId(
  requestedHandleId: string,
  nodeHeight: number,
  transitionId: string,
  handleKind: 'sourceHandle' | 'targetHandle',
): string {
  const parsed = parseHandleId(requestedHandleId);
  if (!parsed) {
    throw new Error(
      `Transition ${transitionId} has invalid ${handleKind} format: "${requestedHandleId}"`,
    );
  }

  const side = parsed.side;
  const requestedIndex = parsed.index;
  const maxCount = getHandleCount(side, nodeHeight);
  if (requestedIndex > maxCount) {
    throw new Error(
      `Transition ${transitionId} ${handleKind} "${requestedHandleId}" is out of range for ${side} handles (max ${maxCount})`,
    );
  }

  return `${side}-${requestedIndex}`;
}

type BuildInput = {
  flowDefinition: EntityRecord | null;
  nodes: EntityRecord[];
  transitions: EntityRecord[];
  instance: EntityRecord | null;
  historyForInstance: EntityRecord[];
};

function inferPathToCurrentNode(
  nodes: EntityRecord[],
  transitions: EntityRecord[],
  currentNodeId: string | undefined,
): string[] {
  if (!currentNodeId) {
    return [];
  }

  const nodeIds = nodes.map((node) => getRecordId(node)).filter((id): id is string => Boolean(id));
  if (nodeIds.length === 0) {
    return [];
  }

  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const nodeId of nodeIds) {
    outgoing.set(nodeId, []);
    incomingCount.set(nodeId, 0);
  }

  for (const transition of transitions) {
    const fromNodeId = getRelatedId(getRecordField(transition, ['FromNode', 'fromNode']));
    const toNodeId = getRelatedId(getRecordField(transition, ['ToNode', 'toNode']));
    const bidirectional = getRecordField(transition, ['Bidirectional', 'bidirectional']) === true;

    if (!fromNodeId || !toNodeId || !outgoing.has(fromNodeId) || !outgoing.has(toNodeId)) {
      continue;
    }

    if (!outgoing.get(fromNodeId)?.includes(toNodeId)) {
      outgoing.get(fromNodeId)?.push(toNodeId);
      incomingCount.set(toNodeId, (incomingCount.get(toNodeId) ?? 0) + 1);
    }

    if (bidirectional && !outgoing.get(toNodeId)?.includes(fromNodeId)) {
      outgoing.get(toNodeId)?.push(fromNodeId);
      incomingCount.set(fromNodeId, (incomingCount.get(fromNodeId) ?? 0) + 1);
    }
  }

  const explicitStartId =
    nodes.find((node) => getRecordField(node, ['IsStart', 'isStart']) === true)?.Id ??
    nodes.find((node) => getRecordField(node, ['IsStart', 'isStart']) === true)?.id;
  const startNodeId =
    (typeof explicitStartId === 'string' ? explicitStartId : undefined) ??
    nodeIds.find((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0) ??
    nodeIds[0];

  if (!startNodeId) {
    return [];
  }

  if (sameId(startNodeId, currentNodeId)) {
    return [startNodeId];
  }

  const queue: string[] = [startNodeId];
  const visited = new Set<string>([startNodeId]);
  const previous = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const next of outgoing.get(current) ?? []) {
      if (visited.has(next)) {
        continue;
      }

      visited.add(next);
      previous.set(next, current);
      if (sameId(next, currentNodeId)) {
        const path: string[] = [next];
        let cursor: string | undefined = next;
        while (cursor && previous.has(cursor)) {
          cursor = previous.get(cursor);
          if (cursor) {
            path.unshift(cursor);
          }
        }
        return path;
      }

      queue.push(next);
    }
  }

  return [currentNodeId];
}

function isSimpleLinearPipeline(nodes: LoanStatusNode[], edges: LoanStatusEdge[]): boolean {
  if (nodes.length < 2 || edges.length === 0) {
    return false;
  }

  const neighborsByNode = new Map<string, Set<string>>();
  for (const node of nodes) {
    neighborsByNode.set(node.id, new Set());
  }

  for (const edge of edges) {
    if (!neighborsByNode.has(edge.source) || !neighborsByNode.has(edge.target)) {
      continue;
    }

    neighborsByNode.get(edge.source)!.add(edge.target);
    neighborsByNode.get(edge.target)!.add(edge.source);
  }

  const neighborCounts = [...neighborsByNode.values()].map((neighbors) => neighbors.size);
  if (neighborCounts.some((count) => count > 2)) {
    return false;
  }

  const endpoints = neighborCounts.filter((count) => count === 1).length;
  return endpoints <= 2;
}

function compactPipelineVerticalLayout(nodes: LoanStatusNode[], edges: LoanStatusEdge[]): LoanStatusNode[] {
  if (!isSimpleLinearPipeline(nodes, edges)) {
    return nodes;
  }

  const yValues = nodes
    .map((node) => node.position?.y)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (yValues.length === 0) {
    return nodes;
  }

  const sortedY = [...yValues].sort((left, right) => left - right);
  const medianY = sortedY[Math.floor(sortedY.length / 2)];

  return nodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x,
      y: medianY,
    },
  }));
}

export function buildLoanStatusGraphFromStreamPath(input: BuildInput): LoanStatusGraph {
  const flowName =
    asString(getRecordField(input.flowDefinition, ['FlowName', 'flowName'])) || 'Loan workflow';
  const currentNodeId = getRelatedId(
    getRecordField(input.instance, ['CurrentNodeKey', 'currentNodeKey', 'CurrentNodeId', 'currentNodeId']),
  );
  const currentStatusLabel =
    asString(getRecordField(input.instance, ['CurrentStatusLabel', 'currentStatusLabel'])) || null;
  const currentNodeRecord =
    currentNodeId
      ? input.nodes.find((nodeRecord) => sameId(getRecordId(nodeRecord), currentNodeId)) ?? null
      : null;
  const isCurrentNodeTerminal = asBoolean(
    getRecordField(currentNodeRecord, ['IsTerminal', 'isTerminal']),
  );

  const completeNodeIds = new Set(
    input.historyForInstance
      .map((record) => getRelatedId(getRecordField(record, ['ToNode', 'toNode'])))
      .filter((value): value is string => Boolean(value)),
  );

  const traversedTransitionKeys = new Set(
    input.historyForInstance
      .map((record) => {
        const fromNodeId = getRelatedId(getRecordField(record, ['FromNode', 'fromNode']));
        const toNodeId = getRelatedId(getRecordField(record, ['ToNode', 'toNode']));
        if (!fromNodeId || !toNodeId) {
          return null;
        }

        return `${fromNodeId.toUpperCase()}->${toNodeId.toUpperCase()}`;
      })
      .filter((value): value is string => Boolean(value)),
  );

  const inferredPathNodeIds =
    completeNodeIds.size === 0 && currentNodeId
      ? inferPathToCurrentNode(input.nodes, input.transitions, currentNodeId)
      : [];

  if (inferredPathNodeIds.length > 0) {
    for (const nodeId of inferredPathNodeIds) {
      completeNodeIds.add(nodeId);
    }

    for (let index = 1; index < inferredPathNodeIds.length; index += 1) {
      const fromNodeId = inferredPathNodeIds[index - 1];
      const toNodeId = inferredPathNodeIds[index];
      traversedTransitionKeys.add(`${fromNodeId.toUpperCase()}->${toNodeId.toUpperCase()}`);
    }
  }

  const latestTransitionIntoCurrent =
    currentNodeId
      ? [...input.historyForInstance]
          .filter((record) =>
            sameId(getRelatedId(getRecordField(record, ['ToNode', 'toNode'])), currentNodeId),
          )
          .sort((left, right) => {
            const leftTime = Date.parse(
              asString(getRecordField(left, ['TransitionedAt', 'transitionedAt', 'UpdateTime', 'updateTime'])),
            );
            const rightTime = Date.parse(
              asString(getRecordField(right, ['TransitionedAt', 'transitionedAt', 'UpdateTime', 'updateTime'])),
            );
            return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
          })[0] ?? null
      : null;
  const previousNodeId = getRelatedId(
    getRecordField(latestTransitionIntoCurrent, ['FromNode', 'fromNode']),
  ) ??
    (inferredPathNodeIds.length > 1 ? inferredPathNodeIds[inferredPathNodeIds.length - 2] : undefined);

  const nodes: LoanStatusNode[] = input.nodes.map((nodeRecord, index) => {
    const nodeId = getRecordId(nodeRecord) ?? `loan-node-${index}`;
    const description = asString(getRecordField(nodeRecord, ['Description', 'description']));
    const state =
      nodeId === currentNodeId
        ? isCurrentNodeTerminal
          ? 'complete'
          : 'current'
        : completeNodeIds.has(nodeId)
          ? 'complete'
          : 'future';

    return {
      id: nodeId,
      type: 'loanStatusNode',
      position: {
        x: asNumber(getRecordField(nodeRecord, ['PositionX', 'positionX'])) || 140 + index * 220,
        y: asNumber(getRecordField(nodeRecord, ['PositionY', 'positionY'])) || 120 + (index % 3) * 150,
      },
      data: {
        label: asString(getRecordField(nodeRecord, ['Label', 'label'])) || 'Untitled status',
        description,
        isStart: asBoolean(getRecordField(nodeRecord, ['IsStart', 'isStart'])),
        isTerminal: asBoolean(getRecordField(nodeRecord, ['IsTerminal', 'isTerminal'])),
        state,
      },
      draggable: false,
      selectable: false,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id.toUpperCase(), node]));

  const edges: LoanStatusEdge[] = input.transitions
    .map((transitionRecord, index) => {
      const source = getRelatedId(getRecordField(transitionRecord, ['FromNode', 'fromNode']));
      const target = getRelatedId(getRecordField(transitionRecord, ['ToNode', 'toNode']));
      const transitionId = getRecordId(transitionRecord) ?? `loan-edge-${index}`;

      if (!source || !target) {
        throw new Error(`Transition ${transitionId} is missing FromNode or ToNode`);
      }

      const metadata = parseTransitionMetadataStrict(
        getRecordField(transitionRecord, ['MetadataJson', 'metadataJson']),
        transitionId,
      );
      const bidirectional = asBoolean(
        getRecordField(transitionRecord, ['Bidirectional', 'bidirectional']),
      );
      const transitionKey = `${source.toUpperCase()}->${target.toUpperCase()}`;
      const wasTraversed = traversedTransitionKeys.has(transitionKey);
      const isActiveCurrentEdge =
        !isCurrentNodeTerminal && sameId(source, previousNodeId) && sameId(target, currentNodeId);
      const sourceCompleted = completeNodeIds.has(source) && !sameId(source, currentNodeId);
      const targetCompleted = completeNodeIds.has(target) && !sameId(target, currentNodeId);
      const targetIsTerminalCurrent = isCurrentNodeTerminal && sameId(target, currentNodeId);
      const isComplete = wasTraversed && sourceCompleted && (targetCompleted || targetIsTerminalCurrent);
      const sourceNode = nodeById.get(source.toUpperCase()) ?? null;
      const targetNode = nodeById.get(target.toUpperCase()) ?? null;
      if (!sourceNode || !targetNode) {
        throw new Error(
          `Transition ${transitionId} references unknown node(s): source=${source}, target=${target}`,
        );
      }
      const sourceNodeHeight = NODE_HEIGHT;
      const targetNodeHeight = NODE_HEIGHT;
      const rawLabel = asString(getRecordField(transitionRecord, ['Label', 'label']));
      const displayLabel = rawLabel.trim();
      const resolvedSourceHandle = resolveHandleId(
        metadata.sourceHandle,
        sourceNodeHeight,
        transitionId,
        'sourceHandle',
      );
      const resolvedTargetHandle = resolveHandleId(
        metadata.targetHandle,
        targetNodeHeight,
        transitionId,
        'targetHandle',
      );

      return {
        id: transitionId,
        source,
        target,
        sourceHandle: resolvedSourceHandle,
        targetHandle: resolvedTargetHandle,
        type: 'loanStatusEdge',
        data: {
          label: displayLabel || undefined,
          state: isActiveCurrentEdge ? 'active' : isComplete ? 'complete' : 'future',
          bidirectional,
        },
        selectable: false,
      };
    })
    .filter((edge): edge is LoanStatusEdge => Boolean(edge));

  const positionedNodes = compactPipelineVerticalLayout(nodes, edges);

  return {
    flowName,
    currentStatusLabel,
    hasInstance: Boolean(input.instance),
    nodes: positionedNodes,
    edges,
  };
}

export function extractEntityRecords(payload: unknown): EntityRecord[] {
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

export function entityRecordId(record: unknown): string | undefined {
  return getRecordId(record);
}

export function entityRelatedId(value: unknown): string | undefined {
  return getRelatedId(value);
}

export function entityAsString(value: unknown): string {
  return asString(value);
}

export function entitySameId(left: string | undefined | null, right: string | undefined | null): boolean {
  return sameId(left, right);
}
