import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
} from '@xyflow/react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';

const FLOW_ENTITY = 'StreamPathStatusFlowDefinition';
const NODE_ENTITY = 'StreamPathStatusNode';
const TRANSITION_ENTITY = 'StreamPathStatusTransition';
const GRID_SIZE = 24;
const GRID_OFFSET = GRID_SIZE / 2;
const NODE_WIDTH = 192;
const MIN_NODE_HEIGHT = 96;
const NODE_X_GAP = 240;
const NODE_Y_GAP = 144;
const STATUS_NODE_DESCRIPTION_FIELD = 'Description';
const ORTHOGONAL_EDGE_OPTIONS = {
  type: 'workflow' as const,
  pathOptions: {
    borderRadius: 10,
    offset: 20,
  },
};
type HandleSide = 'top' | 'right' | 'bottom' | 'left';
type BorderHandleSpec = {
  id: string;
  side: HandleSide;
  offset: string;
};

function buildHandleOffsets(length: number): string[] {
  const count = Math.floor(length / GRID_SIZE) - 1;

  return Array.from({ length: count }, (_, index) => {
    const offset = ((index + 1) * GRID_SIZE * 100) / length;
    return `${offset}%`;
  });
}

function snapSizeToGrid(value: number): number {
  return Math.ceil(value / GRID_SIZE) * GRID_SIZE;
}

function estimateWrappedLineCount(text: string, maxCharsPerLine: number): number {
  const trimmed = text.trim();

  if (!trimmed) {
    return 0;
  }

  return trimmed
    .split(/\r?\n/g)
    .reduce((lineCount, line) => lineCount + Math.max(1, Math.ceil(line.length / maxCharsPerLine)), 0);
}

function getNodeHeight(description: string): number {
  const descriptionLines = estimateWrappedLineCount(description, 26);
  const rawHeight = 56 + descriptionLines * 16;
  return Math.max(MIN_NODE_HEIGHT, snapSizeToGrid(rawHeight));
}

function getBorderHandleSpecs(nodeHeight: number): BorderHandleSpec[] {
  return [
    ...buildHandleOffsets(NODE_WIDTH).map((offset, index) => ({
      id: `top-${index + 1}`,
      side: 'top' as const,
      offset,
    })),
    ...buildHandleOffsets(nodeHeight).map((offset, index) => ({
      id: `right-${index + 1}`,
      side: 'right' as const,
      offset,
    })),
    ...buildHandleOffsets(NODE_WIDTH).map((offset, index) => ({
      id: `bottom-${index + 1}`,
      side: 'bottom' as const,
      offset,
    })),
    ...buildHandleOffsets(nodeHeight).map((offset, index) => ({
      id: `left-${index + 1}`,
      side: 'left' as const,
      offset,
    })),
  ];
}

type EntitySchema = {
  id: string;
  name: string;
  displayName: string;
  capabilities: {
    statusFlow: boolean;
  };
};

type EntityRecord = {
  Id?: string;
  id?: string;
  [key: string]: unknown;
};

type CommandRequest = {
  command: 'GET_MANY' | 'CREATE' | 'UPDATE' | 'DELETE';
  entityTypeName?: string;
  entityId?: string;
  recordId?: string;
  recordIds?: string[];
  data?: Record<string, unknown>;
  options?: Record<string, unknown>;
};

type CommandResult = {
  type: 'command_result';
  ok: boolean;
  correlationId: string;
  command: string;
  entityId?: string;
  entityTypeName?: string;
  data?: unknown;
  error?: string;
};

type StatusFlowBuilderProps = {
  entity: EntitySchema;
  requestCommand: (payload: CommandRequest) => Promise<CommandResult>;
};

type FlowNodeData = {
  label: string;
  nodeKey: string;
  description: string;
};

type RuntimeFlowNodeData = FlowNodeData & {
  nodeHeight: number;
  inferredStart: boolean;
  inferredTerminal: boolean;
  quickEdit: boolean;
  hiddenHandleIds: string[];
  onSelect: (nodeId: string) => void;
  onCreateFromAnchor: (nodeId: string, anchorId: string) => void;
  onAddDirectional: (nodeId: string, direction: 'left' | 'right') => void;
  onCloseQuickEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onCopyNodeId: (nodeId: string) => Promise<boolean>;
};

type FlowNode = Node<FlowNodeData>;
type RuntimeFlowNode = Node<RuntimeFlowNodeData>;
type FlowEdge = Edge<{ persistedId?: string; bidirectional?: boolean }>;

type ExportedStatusFlowSchema = {
  kind: 'streampath-flow-schema';
  version: 1;
  exportedAt: string;
  source: {
    entityDefinitionId: string;
    entityTypeName: string;
    entityDisplayName: string;
    flowDefinitionId?: string;
  };
  flow: {
    flowName: string;
    flowKey: string;
    description: string;
    version: number;
  };
  nodes: Array<{
    nodeKey: string;
    label: string;
    description: string;
    positionX: number;
    positionY: number;
    isStart: boolean;
    isTerminal: boolean;
  }>;
  transitions: Array<{
    fromNodeKey: string;
    toNodeKey: string;
    label: string;
    bidirectional: boolean;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
};

function getCircleCenterOnNodeEdge(
  x: number,
  y: number,
  side: HandleSide,
  _radius: number,
) {
  switch (side) {
    case 'top':
      return { x, y };
    case 'right':
      return { x, y };
    case 'bottom':
      return { x, y };
    case 'left':
      return { x, y };
  }
}

function getHandleSideFromId(handleId: string | null | undefined, fallback: Position): HandleSide {
  if (handleId) {
    const prefix = handleId.split('-')[0];

    if (prefix === 'top' || prefix === 'right' || prefix === 'bottom' || prefix === 'left') {
      return prefix;
    }
  }

  switch (fallback) {
    case Position.Top:
      return 'top';
    case Position.Right:
      return 'right';
    case Position.Bottom:
      return 'bottom';
    case Position.Left:
      return 'left';
  }
}

function dispatchReconnectMouseDown(edgeId: string, type: 'source' | 'target', event: ReactMouseEvent<SVGCircleElement>) {
  const updater = document.querySelector<SVGCircleElement>(
    `.react-flow__edge[data-id="${edgeId}"] .react-flow__edgeupdater-${type}`,
  );

  if (!updater) {
    return;
  }

  updater.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY,
      button: 0,
      buttons: 1,
    }),
  );
}

function WorkflowEdge({
  id,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
  sourceHandleId,
  targetHandleId,
  markerStart,
  markerEnd,
  style,
  pathOptions,
  label,
  interactionWidth,
}: EdgeProps<FlowEdge>) {
  const endpointRadius = 5;
  const [hoveredEndpoint, setHoveredEndpoint] = useState<'source' | 'target' | null>(null);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: pathOptions?.borderRadius,
    offset: pathOptions?.offset,
    stepPosition: pathOptions?.stepPosition,
  });
  const sourceSide = getHandleSideFromId(sourceHandleId, sourcePosition);
  const targetSide = getHandleSideFromId(targetHandleId, targetPosition);
  const sourceCircle = getCircleCenterOnNodeEdge(sourceX, sourceY, sourceSide, endpointRadius);
  const targetCircle = getCircleCenterOnNodeEdge(targetX, targetY, targetSide, endpointRadius);
  const labelText = typeof label === 'string' ? label.trim() : '';
  const edgeStroke =
    typeof style?.stroke === 'string' && style.stroke.length > 0
      ? style.stroke
      : selected
        ? 'var(--sp-active-blue)'
        : 'var(--sp-muted-text)';
  const edgeBaseStyle = {
    ...style,
    stroke: edgeStroke,
    strokeWidth: style?.strokeWidth ?? 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  const labelTextWidth = Math.max(44, labelText.length * 6.6 + 16);
  const labelTextHeight = 18;
  const gapWidth = labelTextWidth + 18;
  const gapHeight = labelTextHeight + 10;
  const maskBoundsPadding = 240;
  const maskId = `sp-transition-gap-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const maskX = Math.min(sourceX, targetX) - maskBoundsPadding;
  const maskY = Math.min(sourceY, targetY) - maskBoundsPadding;
  const maskWidth = Math.abs(targetX - sourceX) + maskBoundsPadding * 2;
  const maskHeight = Math.abs(targetY - sourceY) + maskBoundsPadding * 2;
  const edgeStyle = labelText
    ? {
        ...edgeBaseStyle,
        mask: `url(#${maskId})`,
        WebkitMask: `url(#${maskId})`,
      }
    : edgeBaseStyle;

  return (
    <>
      {labelText ? (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={maskX} y={maskY} width={maskWidth} height={maskHeight}>
            <rect x={maskX} y={maskY} width={maskWidth} height={maskHeight} fill="white" />
            <rect
              x={labelX - gapWidth / 2}
              y={labelY - gapHeight / 2}
              width={gapWidth}
              height={gapHeight}
              rx={6}
              fill="black"
            />
          </mask>
        </defs>
      ) : null}
      <BaseEdge
        id={id}
        path={path}
        style={edgeStyle}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
      {labelText ? (
        <EdgeLabelRenderer>
          <Box
            className="nodrag nopan"
            sx={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              px: 1,
              py: '2px',
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.2,
              color: edgeStroke,
              bgcolor: 'transparent',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {labelText}
          </Box>
        </EdgeLabelRenderer>
      ) : null}
      {selected ? (
        <>
          <circle
            cx={sourceCircle.x}
            cy={sourceCircle.y}
            r={endpointRadius}
            fill={hoveredEndpoint === 'source' ? 'var(--sp-active-blue)' : 'var(--sp-panel-bg)'}
            stroke="var(--sp-active-blue)"
            strokeWidth={2}
            style={{ cursor: 'crosshair' }}
            onMouseEnter={() => setHoveredEndpoint('source')}
            onMouseLeave={() => setHoveredEndpoint((current) => (current === 'source' ? null : current))}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dispatchReconnectMouseDown(id, 'source', event);
            }}
          />
          <circle
            cx={targetCircle.x}
            cy={targetCircle.y}
            r={endpointRadius}
            fill={hoveredEndpoint === 'target' ? 'var(--sp-active-blue)' : 'var(--sp-panel-bg)'}
            stroke="var(--sp-active-blue)"
            strokeWidth={2}
            style={{ cursor: 'crosshair' }}
            onMouseEnter={() => setHoveredEndpoint('target')}
            onMouseLeave={() => setHoveredEndpoint((current) => (current === 'target' ? null : current))}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dispatchReconnectMouseDown(id, 'target', event);
            }}
          />
        </>
      ) : null}
    </>
  );
}

function WorkflowConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps) {
  const [path] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    borderRadius: ORTHOGONAL_EDGE_OPTIONS.pathOptions.borderRadius,
    offset: ORTHOGONAL_EDGE_OPTIONS.pathOptions.offset,
  });

  return (
    <path
      d={path}
      fill="none"
      stroke="var(--sp-active-blue)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
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

function getRelatedId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return getRecordId(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getNodeDescription(record: EntityRecord, descriptionField: string): string {
  return asString(record[descriptionField]).trim();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function createNodeKey(label: string): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${slugify(label || 'status') || 'status'}-${suffix}`;
}

function ClipboardIcon({ size = 14 }: { size?: number }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      sx={{ width: size, height: size, display: 'block' }}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M16 1H8a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2Zm-6 3V3h4v1h-4Zm9 17H5V6h2v1h10V6h2v15Z"
      />
    </Box>
  );
}

function StartStatusIcon({ size = 12 }: { size?: number }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" sx={{ width: size, height: size, display: 'block' }} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="rgba(115, 200, 76, 0.2)" />
      <path d="M9 7.75L17 12 9 16.25V7.75Z" fill="var(--sp-active-green)" />
    </Box>
  );
}

function EndStatusIcon({ size = 12 }: { size?: number }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" sx={{ width: size, height: size, display: 'block' }} aria-hidden>
      <path
        d="M8 2.5h8l5.5 5.5v8L16 21.5H8L2.5 16V8L8 2.5Z"
        fill="rgba(250, 72, 28, 0.2)"
        stroke="var(--sp-logo-orange)"
        strokeWidth="1.2"
      />
      <rect x="8.5" y="8.5" width="7" height="7" rx="0.8" fill="var(--sp-logo-orange)" />
    </Box>
  );
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (!value) {
    return false;
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back below if clipboard API is not available.
  }

  try {
    if (typeof document === 'undefined') {
      return false;
    }

    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', 'true');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.focus();
    input.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(input);
    return copied;
  } catch {
    return false;
  }
}

function createFlowKey(entityName: string): string {
  return `${slugify(entityName)}-workflow`;
}

function buildFlowUniqueKey(entityId: string, flowKey: string, version: number): string {
  return `${entityId}::${flowKey}::v${version}`;
}

function buildNodeUniqueKey(flowId: string, nodeKey: string): string {
  return `${flowId}::${nodeKey}`;
}

function buildTransitionUniqueKey(
  flowId: string,
  sourceId: string,
  targetId: string,
  options?: {
    label?: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    discriminator?: string | number;
  },
): string {
  const fingerprint = [
    options?.label ?? '',
    options?.sourceHandle ?? '',
    options?.targetHandle ?? '',
    String(options?.discriminator ?? ''),
  ].join('|');

  if (!fingerprint) {
    return `${flowId}::${sourceId}::${targetId}`;
  }

  let hash = 0;

  for (let index = 0; index < fingerprint.length; index += 1) {
    hash = (hash << 5) - hash + fingerprint.charCodeAt(index);
    hash |= 0;
  }

  return `${flowId}::${sourceId}::${targetId}::${Math.abs(hash).toString(16)}`;
}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function snapPosition(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: snapToGrid(position.x),
    y: snapToGrid(position.y),
  };
}

function parseHandleId(handleId: string): { side: HandleSide; index: number } | null {
  const [prefix, rawIndex] = handleId.split('-');

  if (prefix !== 'top' && prefix !== 'right' && prefix !== 'bottom' && prefix !== 'left') {
    return null;
  }

  const parsedIndex = Number.parseInt(rawIndex ?? '1', 10);
  return {
    side: prefix,
    index: Number.isFinite(parsedIndex) ? parsedIndex : 1,
  };
}

function getHandleSpec(handleId: string, nodeHeight = MIN_NODE_HEIGHT) {
  const specs = getBorderHandleSpecs(nodeHeight);
  const parsed = parseHandleId(handleId);

  if (parsed) {
    const sideHandles = specs.filter((handle) => handle.side === parsed.side);
    const clampedIndex = Math.min(Math.max(parsed.index, 1), sideHandles.length);
    return sideHandles[clampedIndex - 1] ?? specs[4];
  }

  return specs.find((handle) => handle.id === handleId) ?? specs[4];
}

function getOppositeSide(side: HandleSide) {
  switch (side) {
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}

function getOppositeHandleId(handleId: string, targetNodeHeight = MIN_NODE_HEIGHT): string {
  const parsed = parseHandleId(handleId);
  const sourceSide = parsed?.side ?? getHandleSpec(handleId).side;
  const sideHandles = getHandleIdsForSide(getOppositeSide(sourceSide), targetNodeHeight);
  const normalizedIndex = parsed?.index ?? 1;
  const mappedIndex = Math.min(Math.max(normalizedIndex, 1), sideHandles.length);

  return sideHandles[mappedIndex - 1] ?? getDefaultHandleIdForSide(getOppositeSide(sourceSide), targetNodeHeight);
}

function getNearestHandleId(event: ReactMouseEvent<HTMLDivElement>, nodeHeight: number): string | null {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const threshold = 18;
  const distances = {
    top: y,
    right: rect.width - x,
    bottom: rect.height - y,
    left: x,
  };
  const nearest = (Object.entries(distances) as Array<
    [HandleSide, number]
  >).sort((left, right) => left[1] - right[1])[0];

  if (!nearest || nearest[1] > threshold) {
    return null;
  }

  const sideHandles = getBorderHandleSpecs(nodeHeight).filter((handle) => handle.side === nearest[0]);
  const ratio = nearest[0] === 'top' || nearest[0] === 'bottom' ? x / rect.width : y / rect.height;

  return sideHandles
    .map((handle) => ({
      id: handle.id,
      distance: Math.abs(Number.parseFloat(handle.offset) / 100 - ratio),
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.id ?? null;
}

function parseTransitionMetadata(value: unknown): { sourceHandle?: string; targetHandle?: string } {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      sourceHandle: typeof parsed.sourceHandle === 'string' ? parsed.sourceHandle : undefined,
      targetHandle: typeof parsed.targetHandle === 'string' ? parsed.targetHandle : undefined,
    };
  } catch {
    return {};
  }
}

function createSnapshot(nodes: FlowNode[], edges: FlowEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.data.label,
      description: node.data.description,
      nodeKey: node.data.nodeKey,
      position: node.position,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      bidirectional: edge.data?.bidirectional ?? false,
      label: edge.label ?? '',
    })),
  });
}

function downloadTextFile(filename: string, content: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function normalizeImportNodes(rawNodes: unknown): ExportedStatusFlowSchema['nodes'] {
  if (!Array.isArray(rawNodes)) {
    throw new Error('Import payload is missing `nodes` array');
  }

  const usedKeys = new Set<string>();

  return rawNodes.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`Import node at index ${index} is not an object`);
    }

    const fallbackLabel = asString(candidate.label) || `Status ${index + 1}`;
    let nodeKey = asString(candidate.nodeKey);

    if (!nodeKey) {
      nodeKey = createNodeKey(fallbackLabel);
    }

    while (usedKeys.has(nodeKey)) {
      nodeKey = createNodeKey(nodeKey);
    }

    usedKeys.add(nodeKey);

    return {
      nodeKey,
      label: fallbackLabel,
      description: asString(candidate.description),
      positionX: snapToGrid(asNumber(candidate.positionX) || 140 + index * 180),
      positionY: snapToGrid(asNumber(candidate.positionY) || 140 + (index % 3) * NODE_Y_GAP),
      isStart: asBoolean(candidate.isStart),
      isTerminal: asBoolean(candidate.isTerminal),
    };
  });
}

function normalizeImportTransitions(
  rawTransitions: unknown,
  validNodeKeys: Set<string>,
): ExportedStatusFlowSchema['transitions'] {
  if (!Array.isArray(rawTransitions)) {
    return [];
  }

  const normalized: ExportedStatusFlowSchema['transitions'] = [];

  for (const candidate of rawTransitions) {
    if (!isRecord(candidate)) {
      continue;
    }

    const fromNodeKey = asString(candidate.fromNodeKey);
    const toNodeKey = asString(candidate.toNodeKey);

    if (!fromNodeKey || !toNodeKey) {
      continue;
    }

    if (!validNodeKeys.has(fromNodeKey) || !validNodeKeys.has(toNodeKey)) {
      continue;
    }

    normalized.push({
      fromNodeKey,
      toNodeKey,
      label: asString(candidate.label),
      bidirectional: asBoolean(candidate.bidirectional),
      sourceHandle: asString(candidate.sourceHandle) || null,
      targetHandle: asString(candidate.targetHandle) || null,
    });
  }

  return normalized;
}

function parseImportedSchema(payload: unknown): ExportedStatusFlowSchema {
  if (!isRecord(payload)) {
    throw new Error('Import file is not a valid object');
  }

  if (asString(payload.kind) !== 'streampath-flow-schema') {
    throw new Error('Import file has an unsupported format');
  }

  const flowRecord = isRecord(payload.flow) ? payload.flow : {};
  const nodes = normalizeImportNodes(payload.nodes);

  if (nodes.length === 0) {
    throw new Error('Import file contains no nodes');
  }

  const nodeKeys = new Set(nodes.map((node) => node.nodeKey));
  const transitions = normalizeImportTransitions(payload.transitions, nodeKeys);

  return {
    kind: 'streampath-flow-schema',
    version: 1,
    exportedAt: asString(payload.exportedAt) || new Date().toISOString(),
    source: {
      entityDefinitionId: isRecord(payload.source) ? asString(payload.source.entityDefinitionId) : '',
      entityTypeName: isRecord(payload.source) ? asString(payload.source.entityTypeName) : '',
      entityDisplayName: isRecord(payload.source) ? asString(payload.source.entityDisplayName) : '',
      flowDefinitionId: isRecord(payload.source) ? asString(payload.source.flowDefinitionId) || undefined : undefined,
    },
    flow: {
      flowName: asString(flowRecord.flowName) || 'Imported workflow',
      flowKey: asString(flowRecord.flowKey) || '',
      description: asString(flowRecord.description),
      version: Math.max(1, asNumber(flowRecord.version) || 1),
    },
    nodes,
    transitions,
  };
}

function getHandlePosition(side: HandleSide): Position {
  switch (side) {
    case 'top':
      return Position.Top;
    case 'right':
      return Position.Right;
    case 'bottom':
      return Position.Bottom;
    case 'left':
      return Position.Left;
  }
}

function getHandleIdsForSide(side: HandleSide, nodeHeight = MIN_NODE_HEIGHT): string[] {
  return getBorderHandleSpecs(nodeHeight).filter((handle) => handle.side === side).map((handle) => handle.id);
}

function getDefaultHandleIdForSide(side: HandleSide, nodeHeight = MIN_NODE_HEIGHT): string {
  const handles = getHandleIdsForSide(side, nodeHeight);
  const specs = getBorderHandleSpecs(nodeHeight);
  return handles[Math.floor(handles.length / 2)] ?? specs[0].id;
}

function getHandleLocalPoint(handleId: string, nodeHeight = MIN_NODE_HEIGHT) {
  const handle = getHandleSpec(handleId, nodeHeight);
  const offsetRatio = Number.parseFloat(handle.offset) / 100;

  switch (handle.side) {
    case 'top':
      return { x: NODE_WIDTH * offsetRatio, y: 0 };
    case 'right':
      return { x: NODE_WIDTH, y: nodeHeight * offsetRatio };
    case 'bottom':
      return { x: NODE_WIDTH * offsetRatio, y: nodeHeight };
    case 'left':
      return { x: 0, y: nodeHeight * offsetRatio };
  }
}

function getHandleStyle(
  side: HandleSide,
  offset: string,
): Record<string, string | number> {
  const common = {
    width: 10,
    height: 10,
    borderRadius: 2,
    border: '1px solid var(--sp-text)',
    background: 'var(--sp-active-blue)',
    opacity: 0,
    transition: 'opacity 120ms ease, transform 120ms ease',
    zIndex: 3,
  } satisfies Record<string, string | number>;

  switch (side) {
    case 'top':
      return {
        ...common,
        left: offset,
        top: 0,
        transform: 'translate(-50%, -50%)',
      };
    case 'right':
      return {
        ...common,
        top: offset,
        right: 0,
        transform: 'translate(50%, -50%)',
      };
    case 'bottom':
      return {
        ...common,
        left: offset,
        bottom: 0,
        transform: 'translate(-50%, 50%)',
      };
    case 'left':
      return {
        ...common,
        top: offset,
        left: 0,
        transform: 'translate(-50%, -50%)',
      };
  }
}

function StatusNodeCard({ id, data, selected }: NodeProps<RuntimeFlowNodeData>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const [hoveredHandleId, setHoveredHandleId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const hiddenHandleIds = new Set(data.hiddenHandleIds);

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.nodeHeight, id, updateNodeInternals]);

  const handleCopyNodeId = async (): Promise<void> => {
    const copied = await data.onCopyNodeId(id);
    setCopyState(copied ? 'copied' : 'failed');

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setCopyState('idle');
      }, 1800);
    }
  };

  return (
    <Box
      onMouseDown={(event) => {
        event.stopPropagation();
        data.onSelect(id);
      }}
      onMouseMove={(event) => {
        const nearestHandleId = getNearestHandleId(event, data.nodeHeight);

        if (nearestHandleId && hiddenHandleIds.has(nearestHandleId)) {
          setHoveredHandleId(null);
          return;
        }

        setHoveredHandleId(nearestHandleId);
      }}
      onMouseLeave={() => {
        setHoveredHandleId(null);
      }}
      sx={{
        position: 'relative',
        '&:hover .sp-node-handle': {
          opacity: 1,
        },
      }}
    >
      <NodeToolbar isVisible={data.quickEdit} position={Position.Top} offset={14}>
        <Paper
          sx={{
            p: 1,
            minWidth: 240,
            border: '1px solid var(--sp-border)',
            bgcolor: 'var(--sp-panel-bg)',
            boxShadow: '0 8px 18px rgba(0, 0, 0, 0.24)',
          }}
        >
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
              <Chip
                size="small"
                variant="outlined"
                label={`ID: ${id}`}
                sx={{
                  maxWidth: 190,
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                }}
              />
              <Tooltip title="Copy node ID">
                <IconButton size="small" aria-label="Copy node ID" onClick={() => void handleCopyNodeId()}>
                  <ClipboardIcon />
                </IconButton>
              </Tooltip>
              {copyState === 'copied' ? (
                <Typography variant="caption" color="success.main">
                  Copied
                </Typography>
              ) : null}
              {copyState === 'failed' ? (
                <Typography variant="caption" color="warning.main">
                  Copy failed
                </Typography>
              ) : null}
            </Stack>
            <Stack direction="row" spacing={0.75}>
              <Button size="small" variant="outlined" onClick={() => data.onAddDirectional(id, 'left')}>
                Before
              </Button>
              <Button size="small" variant="outlined" onClick={() => data.onAddDirectional(id, 'right')}>
                After
              </Button>
              <Button size="small" variant="text" color="warning" onClick={() => data.onDelete(id)}>
                Remove
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="contained" onClick={() => data.onCloseQuickEdit(id)}>
                Done
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </NodeToolbar>

      {getBorderHandleSpecs(data.nodeHeight).map((handle) => {
        if (hiddenHandleIds.has(handle.id)) {
          return null;
        }

        return (
          <Handle
            key={handle.id}
            type="source"
            position={getHandlePosition(handle.side)}
            id={handle.id}
            className={`sp-node-handle${hoveredHandleId === handle.id ? ' sp-node-handle-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              data.onCreateFromAnchor(id, handle.id);
            }}
            style={{
              ...getHandleStyle(handle.side, handle.offset),
              opacity: hoveredHandleId === handle.id ? 1 : 0,
            }}
          />
        );
      })}

      <Box
        sx={{
          width: NODE_WIDTH,
          minWidth: NODE_WIDTH,
          minHeight: MIN_NODE_HEIGHT,
          height: data.nodeHeight,
          px: 1.5,
          py: 1,
          borderRadius: 1,
          border: selected ? '1px solid var(--sp-active-blue)' : '1px solid var(--sp-border)',
          bgcolor: 'var(--sp-control-bg)',
          boxShadow: selected ? '0 0 0 1px rgba(102, 172, 255, 0.2)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          overflow: 'hidden',
        }}
      >
        <Typography
          sx={{
            minHeight: 0,
          }}
        >
          <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
            <Chip
              size="small"
              label={data.label || 'Untitled status'}
              sx={{
                maxWidth: 136,
                height: 22,
                bgcolor: 'var(--sp-chrome-bg)',
                borderColor: 'var(--sp-border)',
                '& .MuiChip-label': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: 700,
                  fontSize: 12,
                  px: 0.9,
                },
              }}
            />
            {data.inferredStart ? <StartStatusIcon /> : null}
            {data.inferredTerminal ? <EndStatusIcon /> : null}
          </Stack>
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mt: 1,
            fontSize: 12,
            lineHeight: 1.35,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {data.description.trim() ? data.description : 'No description'}
        </Typography>
      </Box>

    </Box>
  );
}

const nodeTypes = {
  status: StatusNodeCard,
};

const edgeTypes = {
  workflow: WorkflowEdge,
};

export function StatusFlowBuilder({ entity, requestCommand }: StatusFlowBuilderProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [flowDefinition, setFlowDefinition] = useState<EntityRecord | null>(null);
  const [flowName, setFlowName] = useState(`${entity.displayName} workflow`);
  const [loadedNodeIds, setLoadedNodeIds] = useState<string[]>([]);
  const [loadedEdgeIds, setLoadedEdgeIds] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [quickEditNodeId, setQuickEditNodeId] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );
  const selectedEdgeHandleMap = useMemo(() => {
    const next = new Map<string, string[]>();

    if (!selectedEdge) {
      return next;
    }

    const getNodeHandleIds = (nodeId: string): string[] => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      const nodeHeight = getNodeHeight(node?.data.description ?? '');
      return getBorderHandleSpecs(nodeHeight).map((handle) => handle.id);
    };

    next.set(
      selectedEdge.source,
      selectedEdge.sourceHandle
        ? [selectedEdge.sourceHandle]
        : getNodeHandleIds(selectedEdge.source),
    );

    next.set(
      selectedEdge.target,
      selectedEdge.targetHandle
        ? [...(next.get(selectedEdge.target) ?? []), selectedEdge.targetHandle]
        : getNodeHandleIds(selectedEdge.target),
    );

    next.forEach((handleIds, nodeId) => {
      next.set(nodeId, Array.from(new Set(handleIds)));
    });

    return next;
  }, [nodes, selectedEdge]);

  const incomingNodeIds = useMemo(() => new Set(edges.map((edge) => edge.target)), [edges]);
  const outgoingNodeIds = useMemo(() => new Set(edges.map((edge) => edge.source)), [edges]);

  const updateNodeLabel = (nodeId: string, label: string) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                label,
              },
            }
          : node,
      ),
    );
  };

  const updateNodeDescription = (nodeId: string, description: string) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                description,
              },
            }
          : node,
      ),
    );
  };

  const closeQuickEdit = (nodeId: string) => {
    if (quickEditNodeId === nodeId) {
      setQuickEditNodeId(null);
    }
  };

  const deleteNodeById = (nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setSelectedEdgeId(null);
    setQuickEditNodeId((current) => (current === nodeId ? null : current));
  };

  const copyNodeId = async (nodeId: string): Promise<boolean> => {
    const copied = await copyTextToClipboard(nodeId);
    setStatusMessage(copied ? `Copied node ID: ${nodeId}` : `Unable to copy node ID: ${nodeId}`);
    return copied;
  };

  const createNodeFromAnchor = (nodeId: string, anchorId: string) => {
    const originNode = nodes.find((candidate) => candidate.id === nodeId);

    if (!originNode) {
      return;
    }

    const originNodeHeight = getNodeHeight(originNode.data.description);
    const handle = getHandleSpec(anchorId, originNodeHeight);
    const nextLabel = `Status ${nodes.length + 1}`;
    const nextNodeId = `temp-node-${crypto.randomUUID()}`;
    const nextPosition = (() => {
      switch (handle.side) {
        case 'left':
          return snapPosition({ x: originNode.position.x - NODE_X_GAP, y: originNode.position.y });
        case 'right':
          return snapPosition({ x: originNode.position.x + NODE_X_GAP, y: originNode.position.y });
        case 'top':
          return snapPosition({ x: originNode.position.x, y: originNode.position.y - NODE_Y_GAP });
        case 'bottom':
          return snapPosition({ x: originNode.position.x, y: originNode.position.y + NODE_Y_GAP });
      }
    })();

    const nextNode: FlowNode = {
      id: nextNodeId,
      type: 'status',
      position: nextPosition,
      data: {
        label: nextLabel,
        nodeKey: createNodeKey(nextLabel),
        description: '',
      },
    };
    const nextNodeHeight = getNodeHeight(nextNode.data.description);

    const nextEdge: FlowEdge = {
      id: `temp-edge-${crypto.randomUUID()}`,
      source: nodeId,
      target: nextNodeId,
      sourceHandle: anchorId,
      targetHandle: getOppositeHandleId(anchorId, nextNodeHeight),
      ...ORTHOGONAL_EDGE_OPTIONS,
      label: '',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
      },
      data: {
        bidirectional: false,
      },
    };

    setNodes((current) => [...current, nextNode]);
    setEdges((current) => [...current, nextEdge]);
    setSelectedNodeId(nextNodeId);
    setSelectedEdgeId(null);
    setQuickEditNodeId(nextNodeId);
  };

  const decorateNodes = useMemo<RuntimeFlowNode[]>(
    () =>
      nodes.map((node) => {
        const nodeHeight = getNodeHeight(node.data.description);

        return {
          ...node,
          type: 'status',
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          style: {
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            borderRadius: 0,
            padding: 0,
            width: 'auto',
          },
          data: {
            ...node.data,
            nodeHeight,
            inferredStart: !incomingNodeIds.has(node.id),
            inferredTerminal: !outgoingNodeIds.has(node.id),
            quickEdit: quickEditNodeId === node.id,
            hiddenHandleIds: selectedEdgeHandleMap.get(node.id) ?? [],
            onSelect: (nodeId: string) => {
              setSelectedNodeId(nodeId);
              setSelectedEdgeId(null);
              setQuickEditNodeId(nodeId);
            },
            onCreateFromAnchor: createNodeFromAnchor,
            onAddDirectional: (nodeId: string, direction: 'left' | 'right') => {
              const anchor = nodes.find((candidate) => candidate.id === nodeId);

              if (!anchor) {
                return;
              }

              const nextLabel = `Status ${nodes.length + 1}`;
              const nextNodeId = `temp-node-${crypto.randomUUID()}`;
              const nextNode: FlowNode = {
                id: nextNodeId,
                type: 'status',
                position: snapPosition({
                  x: anchor.position.x + (direction === 'right' ? NODE_X_GAP : -NODE_X_GAP),
                  y: anchor.position.y,
                }),
                data: {
                  label: nextLabel,
                  nodeKey: createNodeKey(nextLabel),
                  description: '',
                },
              };

              const anchorHeight = getNodeHeight(anchor.data.description);
              const nextNodeHeight = getNodeHeight(nextNode.data.description);

              const nextEdge: FlowEdge = {
                id: `temp-edge-${crypto.randomUUID()}`,
                source: direction === 'right' ? nodeId : nextNodeId,
                target: direction === 'right' ? nextNodeId : nodeId,
                sourceHandle: getDefaultHandleIdForSide('right', direction === 'right' ? anchorHeight : nextNodeHeight),
                targetHandle: getDefaultHandleIdForSide('left', direction === 'right' ? nextNodeHeight : anchorHeight),
                ...ORTHOGONAL_EDGE_OPTIONS,
                label: '',
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 18,
                  height: 18,
                },
                data: {
                  bidirectional: false,
                },
              };

              setNodes((current) => [...current, nextNode]);
              setEdges((current) => [...current, nextEdge]);
              setSelectedNodeId(nextNodeId);
              setSelectedEdgeId(null);
              setQuickEditNodeId(nextNodeId);
            },
            onCloseQuickEdit: closeQuickEdit,
            onDelete: deleteNodeById,
            onCopyNodeId: copyNodeId,
          },
        };
      }),
    [copyNodeId, incomingNodeIds, nodes, outgoingNodeIds, quickEditNodeId, selectedEdgeHandleMap],
  );

  async function loadBuilder(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const [definitionsResponse, nodesResponse, transitionsResponse] = await Promise.all([
        requestCommand({
          command: 'GET_MANY',
          entityTypeName: FLOW_ENTITY,
          options: { limit: 1000, expansionLevel: 2 },
        }),
        requestCommand({
          command: 'GET_MANY',
          entityTypeName: NODE_ENTITY,
          options: { limit: 1000, expansionLevel: 2 },
        }),
        requestCommand({
          command: 'GET_MANY',
          entityTypeName: TRANSITION_ENTITY,
          options: { limit: 1000, expansionLevel: 2 },
        }),
      ]);

      const definitions = extractItems(definitionsResponse.data)
        .filter(
          (record) =>
            asString(record.TargetEntityDefinitionId) === entity.id &&
            asString(record.TargetEntityType) === entity.name,
        )
        .sort((left, right) => {
          if (asBoolean(left.IsActive) !== asBoolean(right.IsActive)) {
            return asBoolean(left.IsActive) ? -1 : 1;
          }

          return asNumber(right.Version) - asNumber(left.Version);
        });

      const activeDefinition = definitions[0] ?? null;
      const activeFlowId = getRecordId(activeDefinition);
      const allNodes = extractItems(nodesResponse.data);
      const allTransitions = extractItems(transitionsResponse.data);

      const flowNodes = activeFlowId
        ? allNodes.filter((record) => getRelatedId(record.FlowDefinition) === activeFlowId)
        : [];
      const flowTransitions = activeFlowId
        ? allTransitions.filter((record) => getRelatedId(record.FlowDefinition) === activeFlowId)
        : [];

      setFlowDefinition(activeDefinition);
      setFlowName(
        activeDefinition ? asString(activeDefinition.FlowName) : `${entity.displayName} workflow`,
      );
      setLoadedNodeIds(flowNodes.map((record) => getRecordId(record)).filter(Boolean) as string[]);
      setLoadedEdgeIds(
        flowTransitions.map((record) => getRecordId(record)).filter(Boolean) as string[],
      );

      setNodes(
        flowNodes.map((record, index) => ({
          id: getRecordId(record) ?? `temp-node-${index}`,
          type: 'status',
          position: snapPosition({
            x: asNumber(record.PositionX) || 140 + index * 180,
            y: asNumber(record.PositionY) || 140 + (index % 3) * NODE_Y_GAP,
          }),
          data: {
            label: asString(record.Label) || 'Untitled status',
            nodeKey: asString(record.NodeKey) || createNodeKey(asString(record.Label)),
            description: getNodeDescription(record, STATUS_NODE_DESCRIPTION_FIELD),
          },
        })),
      );

      setEdges(
        flowTransitions
          .map((record, index) => {
            const source = getRelatedId(record.FromNode);
            const target = getRelatedId(record.ToNode);

            if (!source || !target) {
              return null;
            }

            const metadata = parseTransitionMetadata(record.MetadataJson);
            const bidirectional = asBoolean(record.Bidirectional);

            return {
              id: getRecordId(record) ?? `temp-edge-${index}`,
              source,
              target,
              ...ORTHOGONAL_EDGE_OPTIONS,
              sourceHandle: metadata.sourceHandle,
              targetHandle: metadata.targetHandle,
              label: asString(record.Label),
              markerStart: bidirectional
                ? {
                    type: MarkerType.ArrowClosed,
                    width: 18,
                    height: 18,
                  }
                : undefined,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 18,
                height: 18,
              },
              data: {
                persistedId: getRecordId(record),
                bidirectional,
              },
            } satisfies FlowEdge;
          })
          .filter((edge): edge is FlowEdge => edge !== null),
      );

      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setQuickEditNodeId(null);
      setStatusMessage(activeDefinition ? null : 'Create the first status to begin the workflow.');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load workflow');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBuilder();
  }, [entity.id, entity.name]);

  const handleReconnect = (originalEdge: FlowEdge, connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }

    let nextSelectedEdgeId: string | null = originalEdge.id;

    setEdges((current) => {
      const reconnectingEdge = current.find((edge) => edge.id === originalEdge.id);

      if (!reconnectingEdge) {
        return current;
      }

      const conflictingEdge = current.find(
        (edge) =>
          edge.id !== originalEdge.id &&
          edge.source === connection.source &&
          edge.target === connection.target,
      );

      if (!conflictingEdge) {
        return current.map((edge) =>
          edge.id === originalEdge.id
            ? {
                ...edge,
                source: connection.source!,
                target: connection.target!,
                sourceHandle: connection.sourceHandle,
                targetHandle: connection.targetHandle,
              }
            : edge,
        );
      }

      nextSelectedEdgeId = conflictingEdge.id;
      return current.filter((edge) => edge.id !== originalEdge.id);
    });

    setSelectedEdgeId(nextSelectedEdgeId);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      const target = event.target;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (selectedEdgeId) {
        event.preventDefault();
        setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
        setSelectedEdgeId(null);
        return;
      }

      if (selectedNodeId) {
        event.preventDefault();
        deleteNodeById(selectedNodeId);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedEdgeId, selectedNodeId]);

  function createInitialNode(): void {
    const label = 'Status 1';
    const id = `temp-node-${crypto.randomUUID()}`;

    setNodes([
      {
        id,
        type: 'status',
        position: snapPosition({ x: 280, y: 180 }),
        data: {
          label,
          nodeKey: createNodeKey(label),
          description: '',
        },
      },
    ]);
    setEdges([]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setQuickEditNodeId(id);
    setStatusMessage(null);
  }

  function deleteSelectedNode(): void {
    if (!selectedNodeId) {
      return;
    }

    deleteNodeById(selectedNodeId);
  }

  function deleteSelectedEdge(): void {
    if (!selectedEdgeId) {
      return;
    }

    setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }

  async function saveWorkflow(): Promise<void> {
    setSaving(true);
    setError(null);
    setStatusMessage(null);

    try {
      const version = 1;
      const flowKey = asString(flowDefinition?.FlowKey) || createFlowKey(entity.name);
      const normalizedFlowName = flowName.trim() || `${entity.displayName} workflow`;
      const flowPayload = {
        TargetEntityType: entity.name,
        TargetEntityDefinitionId: entity.id,
        FlowKey: flowKey,
        FlowName: normalizedFlowName,
        Version: version,
        IsActive: true,
        Description: `Workflow for ${entity.displayName}`,
        GraphJson: createSnapshot(nodes, edges),
        FlowUniqueKey: buildFlowUniqueKey(entity.id, flowKey, version),
      } satisfies Record<string, unknown>;

      let persistedFlowId = getRecordId(flowDefinition);

      if (persistedFlowId) {
        await requestCommand({
          command: 'UPDATE',
          entityTypeName: FLOW_ENTITY,
          recordId: persistedFlowId,
          data: flowPayload,
        });
      } else {
        const createdFlow = await requestCommand({
          command: 'CREATE',
          entityTypeName: FLOW_ENTITY,
          data: flowPayload,
        });

        persistedFlowId = getRecordId(createdFlow.data);

        if (!persistedFlowId) {
          throw new Error('Flow definition was created without a returned Id');
        }
      }

      const removedEdgeIds = loadedEdgeIds.filter(
        (edgeId) => !edges.some((edge) => edge.id === edgeId),
      );

      if (removedEdgeIds.length > 0) {
        await requestCommand({
          command: 'DELETE',
          entityTypeName: TRANSITION_ENTITY,
          recordIds: removedEdgeIds,
        });
      }

      const nodeIdMap = new Map<string, string>();

      for (const node of nodes) {
        const isStart = !incomingNodeIds.has(node.id);
        const isTerminal = !outgoingNodeIds.has(node.id);
        const payload: Record<string, unknown> = {
          FlowDefinition: persistedFlowId,
          NodeKey: node.data.nodeKey,
          Label: node.data.label.trim() || 'Untitled status',
          NodeType: 'status',
          IsStart: isStart,
          IsTerminal: isTerminal,
          PositionX: node.position.x,
          PositionY: node.position.y,
          StyleJson: null,
          MetadataJson: null,
          NodeUniqueKey: buildNodeUniqueKey(persistedFlowId, node.data.nodeKey),
        };
        payload[STATUS_NODE_DESCRIPTION_FIELD] = node.data.description.trim();

        if (node.id.startsWith('temp-node-')) {
          const createdNode = await requestCommand({
            command: 'CREATE',
            entityTypeName: NODE_ENTITY,
            data: payload,
          });
          const createdId = getRecordId(createdNode.data);

          if (!createdId) {
            throw new Error('A new status node was created without a returned Id');
          }

          nodeIdMap.set(node.id, createdId);
        } else {
          await requestCommand({
            command: 'UPDATE',
            entityTypeName: NODE_ENTITY,
            recordId: node.id,
            data: payload,
          });
          nodeIdMap.set(node.id, node.id);
        }
      }

      const removedNodeIds = loadedNodeIds.filter(
        (nodeId) => !nodes.some((node) => (nodeIdMap.get(node.id) ?? node.id) === nodeId),
      );

      for (const edge of edges) {
        const sourceId = nodeIdMap.get(edge.source) ?? edge.source;
        const targetId = nodeIdMap.get(edge.target) ?? edge.target;
        const payload = {
          FlowDefinition: persistedFlowId,
          FromNode: sourceId,
          ToNode: targetId,
          Bidirectional: edge.data?.bidirectional ?? false,
          Label: typeof edge.label === 'string' ? edge.label : '',
          ConditionJson: null,
          MetadataJson: JSON.stringify({
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null,
          }),
          TransitionUniqueKey: buildTransitionUniqueKey(persistedFlowId, sourceId, targetId, {
            label: typeof edge.label === 'string' ? edge.label : '',
            sourceHandle: edge.sourceHandle ?? null,
            targetHandle: edge.targetHandle ?? null,
            discriminator: edge.id,
          }),
        } satisfies Record<string, unknown>;

        if (edge.id.startsWith('temp-edge-')) {
          await requestCommand({
            command: 'CREATE',
            entityTypeName: TRANSITION_ENTITY,
            data: payload,
          });
        } else {
          await requestCommand({
            command: 'UPDATE',
            entityTypeName: TRANSITION_ENTITY,
            recordId: edge.id,
            data: payload,
          });
        }
      }

      if (removedNodeIds.length > 0) {
        await requestCommand({
          command: 'DELETE',
          entityTypeName: NODE_ENTITY,
          recordIds: removedNodeIds,
        });
      }

      setQuickEditNodeId(null);
      setStatusMessage('Workflow saved');
      await loadBuilder();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save workflow');
    } finally {
      setSaving(false);
    }
  }

  function buildExportPayload(): ExportedStatusFlowSchema {
    const flowKey = asString(flowDefinition?.FlowKey) || createFlowKey(entity.name);
    const normalizedFlowName = flowName.trim() || `${entity.displayName} workflow`;
    const description =
      asString(flowDefinition?.Description).trim() || `Workflow for ${entity.displayName}`;
    const version = Math.max(1, asNumber(flowDefinition?.Version) || 1);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const exportNodes = nodes.map((node) => ({
      nodeKey: node.data.nodeKey,
      label: node.data.label.trim() || 'Untitled status',
      description: node.data.description.trim(),
      positionX: snapToGrid(node.position.x),
      positionY: snapToGrid(node.position.y),
      isStart: !incomingNodeIds.has(node.id),
      isTerminal: !outgoingNodeIds.has(node.id),
    }));

    const exportTransitions = edges
      .map((edge) => {
        const sourceNode = nodeById.get(edge.source);
        const targetNode = nodeById.get(edge.target);

        if (!sourceNode || !targetNode) {
          return null;
        }

        return {
          fromNodeKey: sourceNode.data.nodeKey,
          toNodeKey: targetNode.data.nodeKey,
          label: typeof edge.label === 'string' ? edge.label : '',
          bidirectional: edge.data?.bidirectional ?? false,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
        };
      })
      .filter((transition): transition is ExportedStatusFlowSchema['transitions'][number] => transition !== null);

    return {
      kind: 'streampath-flow-schema',
      version: 1,
      exportedAt: new Date().toISOString(),
      source: {
        entityDefinitionId: entity.id,
        entityTypeName: entity.name,
        entityDisplayName: entity.displayName,
        flowDefinitionId: getRecordId(flowDefinition),
      },
      flow: {
        flowName: normalizedFlowName,
        flowKey,
        description,
        version,
      },
      nodes: exportNodes,
      transitions: exportTransitions,
    };
  }

  function exportWorkflowSchema(): void {
    setError(null);
    setStatusMessage(null);

    if (nodes.length === 0) {
      setError('There is no workflow schema to export.');
      return;
    }

    const payload = buildExportPayload();
    const filename = `${slugify(entity.name)}-streampath-schema.json`;
    downloadTextFile(filename, JSON.stringify(payload, null, 2));
    setStatusMessage(`Exported ${payload.nodes.length} statuses and ${payload.transitions.length} transitions.`);
  }

  async function importWorkflowSchemaFromText(rawText: string): Promise<void> {
    setSaving(true);
    setError(null);
    setStatusMessage(null);

    try {
      let parsedPayload: unknown = null;

      try {
        parsedPayload = JSON.parse(rawText);
      } catch {
        throw new Error('Import file is not valid JSON.');
      }

      const imported = parseImportedSchema(parsedPayload);
      const [definitionsResponse, nodesResponse, transitionsResponse] = await Promise.all([
        requestCommand({
          command: 'GET_MANY',
          entityTypeName: FLOW_ENTITY,
          options: { limit: 1000, expansionLevel: 2 },
        }),
        requestCommand({
          command: 'GET_MANY',
          entityTypeName: NODE_ENTITY,
          options: { limit: 1000, expansionLevel: 2 },
        }),
        requestCommand({
          command: 'GET_MANY',
          entityTypeName: TRANSITION_ENTITY,
          options: { limit: 1000, expansionLevel: 2 },
        }),
      ]);

      const definitions = extractItems(definitionsResponse.data)
        .filter(
          (record) =>
            asString(record.TargetEntityDefinitionId) === entity.id &&
            asString(record.TargetEntityType) === entity.name,
        )
        .sort((left, right) => {
          if (asBoolean(left.IsActive) !== asBoolean(right.IsActive)) {
            return asBoolean(left.IsActive) ? -1 : 1;
          }

          return asNumber(right.Version) - asNumber(left.Version);
        });

      const targetDefinition = definitions[0] ?? null;
      const flowKey = imported.flow.flowKey || asString(targetDefinition?.FlowKey) || createFlowKey(entity.name);
      const normalizedFlowName = imported.flow.flowName.trim() || `${entity.displayName} workflow`;
      const version = Math.max(1, imported.flow.version || asNumber(targetDefinition?.Version) || 1);

      const transitionIncoming = new Set(imported.transitions.map((transition) => transition.toNodeKey));
      const transitionOutgoing = new Set(imported.transitions.map((transition) => transition.fromNodeKey));
      const graphNodeIdByKey = new Map<string, string>();

      const snapshotNodes: FlowNode[] = imported.nodes.map((node, index) => {
        const graphNodeId = `import-node-${index + 1}`;
        graphNodeIdByKey.set(node.nodeKey, graphNodeId);

        return {
          id: graphNodeId,
          type: 'status',
          position: {
            x: node.positionX,
            y: node.positionY,
          },
          data: {
            label: node.label,
            nodeKey: node.nodeKey,
            description: node.description,
          },
        };
      });

      const snapshotEdges: FlowEdge[] = imported.transitions
        .map((transition, index) => {
          const source = graphNodeIdByKey.get(transition.fromNodeKey);
          const target = graphNodeIdByKey.get(transition.toNodeKey);

          if (!source || !target) {
            return null;
          }

          return {
            id: `import-edge-${index + 1}`,
            source,
            target,
            ...ORTHOGONAL_EDGE_OPTIONS,
            sourceHandle: transition.sourceHandle ?? undefined,
            targetHandle: transition.targetHandle ?? undefined,
            label: transition.label,
            markerStart: transition.bidirectional
              ? {
                  type: MarkerType.ArrowClosed,
                  width: 18,
                  height: 18,
                }
              : undefined,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 18,
              height: 18,
            },
            data: {
              bidirectional: transition.bidirectional,
            },
          } satisfies FlowEdge;
        })
        .filter((edge): edge is FlowEdge => edge !== null);

      const flowPayload = {
        TargetEntityType: entity.name,
        TargetEntityDefinitionId: entity.id,
        FlowKey: flowKey,
        FlowName: normalizedFlowName,
        Version: version,
        IsActive: true,
        Description: imported.flow.description || `Workflow for ${entity.displayName}`,
        GraphJson: createSnapshot(snapshotNodes, snapshotEdges),
        FlowUniqueKey: buildFlowUniqueKey(entity.id, flowKey, version),
      } satisfies Record<string, unknown>;

      let persistedFlowId = getRecordId(targetDefinition);

      if (persistedFlowId) {
        await requestCommand({
          command: 'UPDATE',
          entityTypeName: FLOW_ENTITY,
          recordId: persistedFlowId,
          data: flowPayload,
        });
      } else {
        const createdFlow = await requestCommand({
          command: 'CREATE',
          entityTypeName: FLOW_ENTITY,
          data: flowPayload,
        });

        persistedFlowId = getRecordId(createdFlow.data);

        if (!persistedFlowId) {
          throw new Error('Flow definition was created without a returned Id');
        }
      }

      const allNodes = extractItems(nodesResponse.data);
      const allTransitions = extractItems(transitionsResponse.data);
      const existingNodes = allNodes.filter(
        (record) => getRelatedId(record.FlowDefinition) === persistedFlowId,
      );
      const existingTransitions = allTransitions.filter(
        (record) => getRelatedId(record.FlowDefinition) === persistedFlowId,
      );

      const existingTransitionIds = existingTransitions
        .map((record) => getRecordId(record))
        .filter((recordId): recordId is string => Boolean(recordId));
      const existingNodeIds = existingNodes
        .map((record) => getRecordId(record))
        .filter((recordId): recordId is string => Boolean(recordId));

      if (existingTransitionIds.length > 0) {
        await requestCommand({
          command: 'DELETE',
          entityTypeName: TRANSITION_ENTITY,
          recordIds: existingTransitionIds,
        });
      }

      if (existingNodeIds.length > 0) {
        await requestCommand({
          command: 'DELETE',
          entityTypeName: NODE_ENTITY,
          recordIds: existingNodeIds,
        });
      }

      const nodeIdByKey = new Map<string, string>();
      const importedNodeByKey = new Map(
        imported.nodes.map((node) => [node.nodeKey, node]),
      );

      for (const node of imported.nodes) {
        const isStart = node.isStart || !transitionIncoming.has(node.nodeKey);
        const isTerminal = node.isTerminal || !transitionOutgoing.has(node.nodeKey);
        const nodePayload: Record<string, unknown> = {
          FlowDefinition: persistedFlowId,
          NodeKey: node.nodeKey,
          Label: node.label,
          NodeType: 'status',
          IsStart: isStart,
          IsTerminal: isTerminal,
          PositionX: node.positionX,
          PositionY: node.positionY,
          StyleJson: null,
          MetadataJson: null,
          NodeUniqueKey: buildNodeUniqueKey(persistedFlowId, node.nodeKey),
        };
        nodePayload[STATUS_NODE_DESCRIPTION_FIELD] = node.description;

        const createdNode = await requestCommand({
          command: 'CREATE',
          entityTypeName: NODE_ENTITY,
          data: nodePayload,
        });
        const createdNodeId = getRecordId(createdNode.data);

        if (!createdNodeId) {
          throw new Error(`Imported node ${node.label} was created without a returned Id`);
        }

        nodeIdByKey.set(node.nodeKey, createdNodeId);
      }

      for (let transitionIndex = 0; transitionIndex < imported.transitions.length; transitionIndex += 1) {
        const transition = imported.transitions[transitionIndex];
        const sourceId = nodeIdByKey.get(transition.fromNodeKey);
        const targetId = nodeIdByKey.get(transition.toNodeKey);

        if (!sourceId || !targetId) {
          continue;
        }

        const sourceNode = importedNodeByKey.get(transition.fromNodeKey);
        const targetNode = importedNodeByKey.get(transition.toNodeKey);
        const sourceHandle =
          transition.sourceHandle ??
          getDefaultHandleIdForSide('right', getNodeHeight(sourceNode?.description ?? ''));
        const targetHandle =
          transition.targetHandle ??
          getDefaultHandleIdForSide('left', getNodeHeight(targetNode?.description ?? ''));

        await requestCommand({
          command: 'CREATE',
          entityTypeName: TRANSITION_ENTITY,
          data: {
            FlowDefinition: persistedFlowId,
            FromNode: sourceId,
            ToNode: targetId,
            Bidirectional: transition.bidirectional,
            Label: transition.label,
            ConditionJson: null,
            MetadataJson: JSON.stringify({
              sourceHandle,
              targetHandle,
            }),
            TransitionUniqueKey: buildTransitionUniqueKey(persistedFlowId, sourceId, targetId, {
              label: transition.label,
              sourceHandle,
              targetHandle,
              discriminator: transitionIndex,
            }),
          } satisfies Record<string, unknown>,
        });
      }

      setFlowName(normalizedFlowName);
      setStatusMessage(
        `Imported ${imported.nodes.length} statuses and ${imported.transitions.length} transitions for ${entity.displayName}.`,
      );
      await loadBuilder();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import workflow schema');
    } finally {
      setSaving(false);
    }
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    const rawText = await file.text();
    await importWorkflowSchemaFromText(rawText);
  }

  return (
    <Paper
      square
      sx={{
        overflow: 'hidden',
        bgcolor: 'var(--sp-panel-bg)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
          bgcolor: 'var(--sp-raised-bg)',
          borderBottom: '1px solid var(--sp-border)',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Workflow Builder
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Define statuses and transitions for {entity.displayName}
          </Typography>
        </Box>

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          flexWrap="wrap"
          alignItems="center"
          sx={{ justifyContent: { xs: 'flex-start', md: 'flex-end' } }}
        >
          <TextField
            label="Workflow name"
            size="small"
            value={flowName}
            onChange={(event) => setFlowName(event.target.value)}
            sx={{
              width: { xs: '100%', sm: 260 },
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'var(--sp-control-bg)',
              },
            }}
          />
          <Chip
            label={entity.displayName}
            variant="outlined"
            sx={{
              height: 32,
              px: 0.25,
              borderColor: 'var(--sp-control-border)',
              backgroundColor: 'var(--sp-control-bg)',
              color: 'var(--sp-text)',
            }}
          />
          <Button
            variant="outlined"
            size="small"
            onClick={exportWorkflowSchema}
            disabled={loading || saving || nodes.length === 0}
          >
            Export schema
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => importFileInputRef.current?.click()}
            disabled={loading || saving}
          >
            Import schema
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => void loadBuilder()}
            disabled={loading || saving}
          >
            Reload
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => void saveWorkflow()}
            disabled={loading || saving}
          >
            {saving ? 'Saving...' : 'Save workflow'}
          </Button>
          <input
            ref={importFileInputRef}
            type="file"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              void handleImportFileChange(event);
            }}
            style={{ display: 'none' }}
            accept="application/json,.json"
          />
        </Stack>
      </Box>

      {error ? (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      ) : null}

      {statusMessage ? (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          {statusMessage}
        </Alert>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 300px' },
          flex: 1,
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            minWidth: 0,
            borderRight: { xl: '1px solid var(--sp-border)' },
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              bgcolor: 'var(--sp-surface-bg)',
            }}
          >
            {nodes.length === 0 && !loading ? (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 4,
                  display: 'grid',
                  placeItems: 'center',
                  pointerEvents: 'none',
                }}
              >
                <Box
                  component="button"
                  type="button"
                  onClick={createInitialNode}
                  sx={{
                    width: 54,
                    height: 54,
                    borderRadius: 999,
                    border: '1px solid rgba(102, 172, 255, 0.45)',
                    bgcolor: 'var(--sp-active-blue)',
                    color: '#081018',
                    fontSize: 30,
                    lineHeight: 1,
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    boxShadow: '0 0 0 8px rgba(102, 172, 255, 0.08)',
                  }}
                >
                  +
                </Box>
              </Box>
            ) : null}

            <ReactFlow
              nodes={decorateNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionLineComponent={WorkflowConnectionLine}
              connectionLineType={ConnectionLineType.SmoothStep}
              connectionMode={ConnectionMode.Loose}
              defaultEdgeOptions={ORTHOGONAL_EDGE_OPTIONS}
              edgesReconnectable
              reconnectRadius={6}
              onReconnect={handleReconnect}
              snapToGrid
              snapGrid={[GRID_SIZE, GRID_SIZE]}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={(connection: Connection) => {
                if (!connection.source || !connection.target || connection.source === connection.target) {
                  return;
                }

                setEdges((current) => {
                  return addEdge(
                    {
                      ...connection,
                      id: `temp-edge-${crypto.randomUUID()}`,
                      ...ORTHOGONAL_EDGE_OPTIONS,
                      label: '',
                      markerEnd: {
                        type: MarkerType.ArrowClosed,
                        width: 18,
                        height: 18,
                      },
                      data: {
                        bidirectional: false,
                      },
                    },
                    current,
                  );
                });
              }}
              onNodeClick={(_, node) => {
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
                setQuickEditNodeId(node.id);
              }}
              onNodeDoubleClick={(_, node) => {
                setQuickEditNodeId(node.id);
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
              }}
              onEdgeClick={(_, edge) => {
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
                setQuickEditNodeId(null);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                setQuickEditNodeId(null);
              }}
              fitView
            >
              <Background
                variant={BackgroundVariant.Dots}
                color="rgba(162, 175, 183, 0.18)"
                gap={GRID_SIZE}
                offset={GRID_OFFSET}
                size={1.2}
              />
              <MiniMap pannable zoomable />
              <Controls showInteractive={false} />
            </ReactFlow>
          </Box>
        </Box>

        <Box sx={{ p: 2, overflow: 'auto' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Inspector
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Select a status to edit its fields here. Double-click still opens quick actions.
          </Typography>

          <Divider sx={{ my: 2 }} />

          {selectedNode ? (
            <Stack spacing={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Status
              </Typography>
              <TextField
                label="Status name"
                size="small"
                value={selectedNode.data.label}
                onChange={(event) => updateNodeLabel(selectedNode.id, event.target.value)}
              />
              <TextField
                label="Status description"
                size="small"
                multiline
                minRows={3}
                value={selectedNode.data.description}
                onChange={(event) => updateNodeDescription(selectedNode.id, event.target.value)}
              />
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`ID: ${selectedNode.id}`}
                  sx={{
                    maxWidth: '100%',
                    '& .MuiChip-label': {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  }}
                />
                <Tooltip title="Copy node ID">
                  <IconButton
                    size="small"
                    aria-label="Copy selected node ID"
                    onClick={() => {
                      void copyNodeId(selectedNode.id);
                    }}
                  >
                    <ClipboardIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Stack direction="row" spacing={0.75}>
                {!incomingNodeIds.has(selectedNode.id) ? <Chip size="small" label="Start" /> : null}
                {!outgoingNodeIds.has(selectedNode.id) ? <Chip size="small" label="End" /> : null}
              </Stack>
              <Button variant="outlined" onClick={() => setQuickEditNodeId(selectedNode.id)}>
                Quick actions
              </Button>
              <Button variant="outlined" color="warning" onClick={deleteSelectedNode}>
                Delete status
              </Button>
            </Stack>
          ) : null}

          {selectedEdge ? (
            <Stack spacing={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Transition
              </Typography>
              <Box
                sx={{
                  p: 1,
                  border: '1px solid var(--sp-border)',
                  bgcolor: 'var(--sp-control-bg)',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {[
                  `edge.id: ${selectedEdge.id}`,
                  `source: ${selectedEdge.source}`,
                  `target: ${selectedEdge.target}`,
                  `sourceHandle: ${selectedEdge.sourceHandle ?? 'null'}`,
                  `targetHandle: ${selectedEdge.targetHandle ?? 'null'}`,
                  `hidden[source]: ${(selectedEdgeHandleMap.get(selectedEdge.source) ?? []).join(', ') || 'none'}`,
                  `hidden[target]: ${(selectedEdgeHandleMap.get(selectedEdge.target) ?? []).join(', ') || 'none'}`,
                ].join('\n')}
              </Box>
              <TextField
                label="Transition label"
                size="small"
                value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
                onChange={(event) => {
                  const nextLabel = event.target.value;
                  setEdges((current) =>
                    current.map((edge) =>
                      edge.id === selectedEdge.id
                        ? {
                            ...edge,
                            label: nextLabel,
                          }
                      : edge,
                    ),
                  );
                }}
              />
              <Stack direction="row" spacing={1} alignItems="center">
                <Checkbox
                  checked={selectedEdge.data?.bidirectional ?? false}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setEdges((current) =>
                      current.map((edge) =>
                        edge.id === selectedEdge.id
                          ? {
                              ...edge,
                              markerStart: checked
                                ? {
                                    type: MarkerType.ArrowClosed,
                                    width: 18,
                                    height: 18,
                                  }
                                : undefined,
                              data: {
                                ...edge.data,
                                bidirectional: checked,
                              },
                            }
                          : edge,
                      ),
                    );
                  }}
                />
                <Typography>Bidirectional</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                You can define separate reverse transitions to support distinct labels like Approve and Reject.
              </Typography>
              <Button variant="outlined" color="warning" onClick={deleteSelectedEdge}>
                Delete transition
              </Button>
            </Stack>
          ) : null}

          {!selectedNode && !selectedEdge ? (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                Use the center plus to create the first status.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                After that, hover the left or right side of any status to add a connected status in that direction.
              </Typography>
            </Stack>
          ) : null}
        </Box>
      </Box>
    </Paper>
  );
}
