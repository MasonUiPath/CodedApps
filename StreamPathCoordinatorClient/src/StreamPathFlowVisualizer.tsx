import { useEffect, useMemo, useState } from 'react';
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const FLOW_ENTITY = 'StreamPathStatusFlowDefinition';
const NODE_ENTITY = 'StreamPathStatusNode';
const TRANSITION_ENTITY = 'StreamPathStatusTransition';
const INSTANCE_ENTITY = 'StreamPathStatusInstance';
const HISTORY_ENTITY = 'StreamPathStatusHistory';

const NODE_WIDTH = 192;
const NODE_HEIGHT = 96;
const GRID_SIZE = 24;
const GRID_OFFSET = GRID_SIZE / 2;
const ORTHOGONAL_EDGE_OPTIONS = {
  type: 'smoothstep' as const,
  pathOptions: {
    borderRadius: 10,
    offset: 20,
  },
};
const COMPLETE_COLOR = 'var(--sp-active-green)';
const CURRENT_COLOR = 'var(--sp-active-blue)';
const FUTURE_COLOR = 'var(--sp-border)';
const DEFAULT_EDGE_COLOR = 'var(--sp-muted-text)';
const CURRENT_PULSE_COLOR = '#8CC4FF';
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

const BORDER_HANDLE_SPECS: BorderHandleSpec[] = [
  ...buildHandleOffsets(NODE_WIDTH).map((offset, index) => ({
    id: `top-${index + 1}`,
    side: 'top' as const,
    offset,
  })),
  ...buildHandleOffsets(NODE_HEIGHT).map((offset, index) => ({
    id: `right-${index + 1}`,
    side: 'right' as const,
    offset,
  })),
  ...buildHandleOffsets(NODE_WIDTH).map((offset, index) => ({
    id: `bottom-${index + 1}`,
    side: 'bottom' as const,
    offset,
  })),
  ...buildHandleOffsets(NODE_HEIGHT).map((offset, index) => ({
    id: `left-${index + 1}`,
    side: 'left' as const,
    offset,
  })),
];

type EntitySchema = {
  id: string;
  name: string;
  displayName: string;
  fields?: Array<{
    name: string;
    displayName: string;
    dataType: string;
  }>;
};

type EntityRecord = {
  Id?: string;
  id?: string;
  [key: string]: unknown;
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

type CommandRequest = {
  command: 'GET_MANY';
  entityTypeName?: string;
  entityId?: string;
  options?: Record<string, unknown>;
};

type EntityChangeMessage = {
  type: 'entity_change';
  eventId: string;
  entityId: string;
  entityTypeName: string;
  changedAt: string;
  changeType?: string;
  source: string;
  reason: string;
  payload?: unknown;
};

type StreamPathFlowVisualizerProps = {
  entity: EntitySchema;
  requestCommand: (payload: CommandRequest) => Promise<CommandResult>;
  lastEntityChange: EntityChangeMessage | null;
  appendEvent: (summary: string, detail?: string) => void;
};

type NodeState = 'future' | 'current' | 'complete';

type VisualizerNodeData = {
  label: string;
  description: string;
  inferredStart: boolean;
  inferredTerminal: boolean;
  nodeState: NodeState;
};

type VisualizerNode = Node<VisualizerNodeData>;
type VisualizerEdge = Edge<{ bidirectional?: boolean; pulseToCurrent?: boolean }>;
type WatchRecordOption = {
  id: string;
  label: string;
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
  return value === true;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getNodeDescription(record: Record<string, unknown>): string {
  const keys = ['Description', 'StatusDescription', 'NodeDescription', 'Details', 'Summary'];

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.toUpperCase() === right.toUpperCase());
}

function normalizeEntityTypeName(value: string | null | undefined): string {
  return (value ?? '').replace(/_/g, '').toUpperCase();
}

function sameEntityType(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeEntityTypeName(left);
  const normalizedRight = normalizeEntityTypeName(right);
  return normalizedLeft.length > 0 && normalizedRight.length > 0 && normalizedLeft === normalizedRight;
}

function pickStringValue(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

function getEventPayloadRecordId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  return pickStringValue(payload, ['recordId', 'RecordId', 'targetRecordId', 'TargetRecordId']);
}

function getEventPayloadInstanceId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  return pickStringValue(payload, ['statusInstanceId', 'StatusInstanceId', 'instanceId', 'InstanceId']);
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

function getHandleStyle(side: HandleSide, offset: string): Record<string, string | number> {
  const common = {
    width: 10,
    height: 10,
    borderRadius: 2,
    opacity: 0,
    zIndex: 3,
    pointerEvents: 'none',
    background: 'transparent',
    border: 'none',
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

function getHandleIdsForSide(side: HandleSide): string[] {
  return BORDER_HANDLE_SPECS.filter((handle) => handle.side === side).map((handle) => handle.id);
}

function getDefaultHandleIdForSide(side: HandleSide): string {
  const handles = getHandleIdsForSide(side);
  return handles[Math.floor(handles.length / 2)] ?? BORDER_HANDLE_SPECS[0].id;
}

function isStringFieldDataType(dataType: string): boolean {
  const normalized = dataType.toLowerCase();
  return normalized.includes('string') || normalized === 'text';
}

function chooseDisplayFieldName(
  fields: Array<{ name: string; dataType: string }> | undefined,
): string | null {
  if (!fields || fields.length === 0) {
    return null;
  }

  const exactNameField =
    fields.find((field) => field.name.toLowerCase() === 'name') ??
    fields.find((field) => field.name.toLowerCase().includes('name'));

  if (exactNameField) {
    return exactNameField.name;
  }

  const firstStringField = fields.find((field) => isStringFieldDataType(field.dataType));
  return firstStringField?.name ?? null;
}

function getDisplayValue(record: EntityRecord, displayFieldName: string | null): string {
  if (displayFieldName) {
    const preferredValue = record[displayFieldName];
    if (typeof preferredValue === 'string' && preferredValue.trim().length > 0) {
      return preferredValue.trim();
    }
  }

  const fallbackName = record.Name;
  if (typeof fallbackName === 'string' && fallbackName.trim().length > 0) {
    return fallbackName.trim();
  }

  return '';
}

function VisualizerPulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  style,
  data,
  label,
}: EdgeProps<VisualizerEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: ORTHOGONAL_EDGE_OPTIONS.pathOptions.borderRadius,
    offset: ORTHOGONAL_EDGE_OPTIONS.pathOptions.offset,
  });
  const labelText = typeof label === 'string' ? label.trim() : '';
  const edgeStroke =
    typeof style?.stroke === 'string' && style.stroke.length > 0 ? style.stroke : DEFAULT_EDGE_COLOR;
  const edgeBaseStyle = {
    ...style,
    stroke: edgeStroke,
    strokeWidth: style?.strokeWidth ?? 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  const labelTextWidth = Math.max(44, labelText.length * 6.6 + 16);
  const labelTextHeight = 18;
  const gapWidth = labelTextWidth + 8;
  const gapHeight = labelTextHeight + 8;
  const maskBoundsPadding = 240;
  const maskId = `sp-visualizer-transition-gap-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const useLabelMask = labelText.length > 0;
  const maskX = Math.min(sourceX, targetX) - maskBoundsPadding;
  const maskY = Math.min(sourceY, targetY) - maskBoundsPadding;
  const maskWidth = Math.abs(targetX - sourceX) + maskBoundsPadding * 2;
  const maskHeight = Math.abs(targetY - sourceY) + maskBoundsPadding * 2;
  const edgeStyle = useLabelMask
    ? {
        ...edgeBaseStyle,
        mask: `url(#${maskId})`,
        WebkitMask: `url(#${maskId})`,
      }
    : edgeBaseStyle;
  const pulsePathStyle = useLabelMask
    ? {
        mask: `url(#${maskId})`,
        WebkitMask: `url(#${maskId})`,
      }
    : undefined;

  return (
    <>
      {useLabelMask ? (
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
      <BaseEdge id={id} path={path} style={edgeStyle} markerStart={markerStart} markerEnd={markerEnd} />
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
      {data?.pulseToCurrent ? (
        <path
          d={path}
          fill="none"
          stroke={CURRENT_PULSE_COLOR}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="sp-visualizer-pulse-edge"
          style={pulsePathStyle}
        />
      ) : null}
    </>
  );
}

function VisualizerNodeCard({ data }: NodeProps<VisualizerNodeData>) {
  const borderColor =
    data.nodeState === 'current'
      ? CURRENT_COLOR
      : data.nodeState === 'complete'
        ? COMPLETE_COLOR
        : FUTURE_COLOR;

  const description = data.description.trim().length > 0 ? data.description.trim() : 'No description';

  const runtimeIndicator =
    data.nodeState === 'current' ? (
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: '2px solid rgba(102, 172, 255, 0.34)',
          borderTopColor: CURRENT_COLOR,
          flexShrink: 0,
          animation: 'sp-visualizer-current-spin 900ms linear infinite',
        }}
      />
    ) : data.nodeState === 'complete' ? (
      <Box
        component="svg"
        viewBox="0 0 10 10"
        sx={{ width: 10, height: 10, display: 'block', flexShrink: 0 }}
        aria-hidden
      >
        <circle cx="5" cy="5" r="5" fill={COMPLETE_COLOR} />
        <path
          d="M2.3 5.2 4.3 7 7.8 3.3"
          fill="none"
          stroke="#1B2228"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Box>
    ) : null;

  return (
    <Box
      sx={{
        width: NODE_WIDTH,
        minWidth: NODE_WIDTH,
        height: NODE_HEIGHT,
        px: 1.5,
        py: 1,
        borderRadius: 1,
        border: `1px solid ${borderColor}`,
        bgcolor: 'var(--sp-control-bg)',
        boxShadow: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      {BORDER_HANDLE_SPECS.map((handle) => (
        <Handle
          key={handle.id}
          type="source"
          position={getHandlePosition(handle.side)}
          id={handle.id}
          style={getHandleStyle(handle.side, handle.offset)}
        />
      ))}
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
        {runtimeIndicator}
      </Stack>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          mt: 1,
          fontSize: 12,
          lineHeight: 1.35,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {description}
      </Typography>
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

const nodeTypes = {
  visualizerStatus: VisualizerNodeCard,
};

const edgeTypes = {
  visualizerPulse: VisualizerPulseEdge,
};

export function StreamPathFlowVisualizer({
  entity,
  requestCommand,
  lastEntityChange,
  appendEvent,
}: StreamPathFlowVisualizerProps) {
  const [loading, setLoading] = useState(false);
  const [loadingRecordOptions, setLoadingRecordOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [watchedRecordId, setWatchedRecordId] = useState<string | null>(null);
  const [watchedInstanceId, setWatchedInstanceId] = useState<string | null>(null);
  const [recordOptions, setRecordOptions] = useState<WatchRecordOption[]>([]);
  const [displayFieldName, setDisplayFieldName] = useState<string | null>(null);
  const [flowName, setFlowName] = useState<string | null>(null);
  const [currentStatusLabel, setCurrentStatusLabel] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [nodes, setNodes] = useState<VisualizerNode[]>([]);
  const [edges, setEdges] = useState<VisualizerEdge[]>([]);

  const loadRecordOptions = async (): Promise<void> => {
    setLoadingRecordOptions(true);

    try {
      const preferredDisplayFieldName = chooseDisplayFieldName(entity.fields);
      setDisplayFieldName(preferredDisplayFieldName);

      const recordsResponse = await requestCommand({
        command: 'GET_MANY',
        entityTypeName: entity.name,
        options: { limit: 500, expansionLevel: 1 },
      });
      const allRecords = extractItems(recordsResponse.data);
      const uniqueOptions = new Map<string, WatchRecordOption>();

      for (const record of allRecords) {
        const id = getRecordId(record);
        if (!id) {
          continue;
        }

        const displayValue = getDisplayValue(record, preferredDisplayFieldName);
        const label = displayValue ? `${id}-${displayValue}` : id;
        uniqueOptions.set(id, { id, label });
      }

      const nextOptions = Array.from(uniqueOptions.values()).sort((left, right) =>
        left.label.localeCompare(right.label),
      );

      setRecordOptions(nextOptions);
      appendEvent(
        'Flow visualizer records loaded',
        `${nextOptions.length} record options for ${entity.displayName}`,
      );
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load record options';
      setError(message);
      appendEvent('Flow visualizer records load failed', message);
      setRecordOptions([]);
    } finally {
      setLoadingRecordOptions(false);
    }
  };

  const loadVisualizerData = async (
    reason: string,
    requestedRecordId = watchedRecordId,
  ): Promise<void> => {
    if (!requestedRecordId) {
      setError('Select a target record to watch status transitions.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [definitionsResponse, nodesResponse, transitionsResponse, instancesResponse, historyResponse] =
        await Promise.all([
          requestCommand({
            command: 'GET_MANY',
            entityTypeName: FLOW_ENTITY,
            options: { limit: 1000, expansionLevel: 2 },
          }),
          requestCommand({
            command: 'GET_MANY',
            entityTypeName: NODE_ENTITY,
            options: { limit: 2000, expansionLevel: 2 },
          }),
          requestCommand({
            command: 'GET_MANY',
            entityTypeName: TRANSITION_ENTITY,
            options: { limit: 2000, expansionLevel: 2 },
          }),
          requestCommand({
            command: 'GET_MANY',
            entityTypeName: INSTANCE_ENTITY,
            options: { limit: 2000, expansionLevel: 2 },
          }),
          requestCommand({
            command: 'GET_MANY',
            entityTypeName: HISTORY_ENTITY,
            options: { limit: 5000, expansionLevel: 2 },
          }),
        ]);

      const definitions = extractItems(definitionsResponse.data)
        .filter(
          (record) =>
            asString(record.TargetEntityDefinitionId) === entity.id &&
            sameEntityType(asString(record.TargetEntityType), entity.name),
        )
        .sort((left, right) => {
          if (asBoolean(left.IsActive) !== asBoolean(right.IsActive)) {
            return asBoolean(left.IsActive) ? -1 : 1;
          }

          return asNumber(right.Version) - asNumber(left.Version);
        });

      const activeDefinition = definitions[0] ?? null;
      const activeFlowId = getRecordId(activeDefinition);

      if (!activeDefinition || !activeFlowId) {
        setNodes([]);
        setEdges([]);
        setFlowName(null);
        setCurrentStatusLabel(null);
        setWatchedInstanceId(null);
        setError(`No workflow definition found for ${entity.displayName}.`);
        return;
      }

      const allNodes = extractItems(nodesResponse.data);
      const allTransitions = extractItems(transitionsResponse.data);
      const allInstances = extractItems(instancesResponse.data);
      const allHistory = extractItems(historyResponse.data);

      const flowNodes = allNodes.filter((record) => getRelatedId(record.FlowDefinition) === activeFlowId);
      const flowTransitions = allTransitions.filter(
        (record) => getRelatedId(record.FlowDefinition) === activeFlowId,
      );

      const matchingInstance = allInstances.find(
        (record) =>
          asString(record.TargetRecordId).toUpperCase() === requestedRecordId.toUpperCase() &&
          sameEntityType(asString(record.TargetEntityType), entity.name) &&
          getRelatedId(record.FlowDefinition) === activeFlowId,
      );

      if (!matchingInstance) {
        setNodes([]);
        setEdges([]);
        setFlowName(asString(activeDefinition.FlowName) || `${entity.displayName} workflow`);
        setCurrentStatusLabel(null);
        setWatchedInstanceId(null);
        setError(
          `No StreamPathStatusInstance found for record ${requestedRecordId} in ${entity.displayName}.`,
        );
        appendEvent('Flow visualizer instance missing', requestedRecordId);
        return;
      }

      const instanceId = getRecordId(matchingInstance);
      setWatchedInstanceId(instanceId ?? null);
      const currentNodeId = getRelatedId(matchingInstance.CurrentNodeKey);
      const currentLabel = asString(matchingInstance.CurrentStatusLabel);
      const historyForInstance =
        instanceId
          ? allHistory.filter((record) => getRelatedId(record.StatusInstance) === instanceId)
          : [];
      const completeNodeIds = new Set(
        historyForInstance
          .map((record) => getRelatedId(record.ToNode))
          .filter((value): value is string => Boolean(value)),
      );
      const traversedTransitionKeys = new Set(
        historyForInstance
          .map((record) => {
            const fromNodeId = getRelatedId(record.FromNode);
            const toNodeId = getRelatedId(record.ToNode);

            if (!fromNodeId || !toNodeId) {
              return null;
            }

            return `${fromNodeId.toUpperCase()}->${toNodeId.toUpperCase()}`;
          })
          .filter((key): key is string => Boolean(key)),
      );
      const latestTransitionIntoCurrent =
        currentNodeId
          ? [...historyForInstance]
              .filter((record) => getRelatedId(record.ToNode) === currentNodeId)
              .sort((left, right) => {
                const leftTime = Date.parse(asString(left.TransitionedAt) || asString(left.UpdateTime));
                const rightTime = Date.parse(asString(right.TransitionedAt) || asString(right.UpdateTime));
                return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
              })[0] ?? null
          : null;
      const previousNodeId = getRelatedId(latestTransitionIntoCurrent?.FromNode);

      const visualizerNodes: VisualizerNode[] = flowNodes.map((record, index) => {
        const nodeId = getRecordId(record) ?? `viz-node-${index}`;
        const nodeState: NodeState =
          nodeId === currentNodeId ? 'current' : completeNodeIds.has(nodeId) ? 'complete' : 'future';

        return {
          id: nodeId,
          type: 'visualizerStatus',
          position: {
            x: asNumber(record.PositionX) || 140 + index * 220,
            y: asNumber(record.PositionY) || 140 + (index % 3) * 144,
          },
          draggable: false,
          selectable: false,
          data: {
            label: asString(record.Label) || 'Untitled status',
            description: getNodeDescription(record),
            inferredStart: asBoolean(record.IsStart),
            inferredTerminal: asBoolean(record.IsTerminal),
            nodeState,
          },
        } satisfies VisualizerNode;
      });

      const visualizerEdges: VisualizerEdge[] = flowTransitions
        .map((record, index) => {
          const source = getRelatedId(record.FromNode);
          const target = getRelatedId(record.ToNode);

          if (!source || !target) {
            return null;
          }

          const bidirectional = asBoolean(record.Bidirectional);
          const metadata = parseTransitionMetadata(record.MetadataJson);
          const sourceHandle = metadata.sourceHandle ?? getDefaultHandleIdForSide('right');
          const targetHandle = metadata.targetHandle ?? getDefaultHandleIdForSide('left');
          const isActiveCurrentEdge = source === previousNodeId && target === currentNodeId;
          const transitionKey = `${source.toUpperCase()}->${target.toUpperCase()}`;
          const wasTraversed = traversedTransitionKeys.has(transitionKey);
          const sourceCompleted = completeNodeIds.has(source) && source !== currentNodeId;
          const completedTransition = wasTraversed && sourceCompleted;
          const targetState: NodeState =
            isActiveCurrentEdge
              ? 'current'
              : completedTransition
                ? 'complete'
                : 'future';
          const edgeColor =
            targetState === 'complete'
              ? COMPLETE_COLOR
              : targetState === 'current'
                ? CURRENT_COLOR
                : DEFAULT_EDGE_COLOR;
          const pulseToCurrent = targetState === 'current';

          return {
            id: getRecordId(record) ?? `viz-edge-${index}`,
            source,
            target,
            type: 'visualizerPulse',
            sourceHandle,
            targetHandle,
            style: {
              stroke: edgeColor,
              strokeWidth: 2,
            },
            markerStart: bidirectional
              ? {
                  type: MarkerType.ArrowClosed,
                  width: 18,
                  height: 18,
                  color: edgeColor,
                }
              : undefined,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 18,
              height: 18,
              color: edgeColor,
            },
            label: asString(record.Label),
            data: {
              bidirectional,
              pulseToCurrent,
            },
            selectable: false,
          } satisfies VisualizerEdge;
        })
        .filter((edge): edge is VisualizerEdge => edge !== null);

      setNodes(visualizerNodes);
      setEdges(visualizerEdges);
      setFlowName(asString(activeDefinition.FlowName) || `${entity.displayName} workflow`);
      setCurrentStatusLabel(currentLabel || null);
      setLastSyncedAt(new Date().toLocaleTimeString());
      appendEvent(
        'Flow visualizer refreshed',
        `${requestedRecordId} (${reason}) · ${visualizerNodes.length} statuses`,
      );
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load flow visualizer data';
      setError(message);
      appendEvent('Flow visualizer refresh failed', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!watchedRecordId || !lastEntityChange) {
      return;
    }

    const payloadRecordId = getEventPayloadRecordId(lastEntityChange.payload);
    const payloadInstanceId = getEventPayloadInstanceId(lastEntityChange.payload);
    const isWatchedRecordChange = sameId(payloadRecordId, watchedRecordId);
    const isWatchedInstanceChange = sameId(payloadInstanceId, watchedInstanceId);
    const isStreamPathChange =
      lastEntityChange.entityTypeName === INSTANCE_ENTITY ||
      lastEntityChange.entityTypeName === HISTORY_ENTITY;
    const isSelectedEntityChange = sameEntityType(lastEntityChange.entityTypeName, entity.name);

    const isRelevantChange =
      (isStreamPathChange &&
        (isWatchedRecordChange || isWatchedInstanceChange || (!payloadRecordId && !payloadInstanceId))) ||
      (isSelectedEntityChange && isWatchedRecordChange);

    if (!isRelevantChange) {
      return;
    }

    void loadVisualizerData(
      `Realtime ${lastEntityChange.entityTypeName} event ${lastEntityChange.eventId}`,
    );
  }, [entity.id, entity.name, lastEntityChange, watchedInstanceId, watchedRecordId]);

  useEffect(() => {
    setSelectedRecordId('');
    setWatchedRecordId(null);
    setWatchedInstanceId(null);
    setRecordOptions([]);
    setDisplayFieldName(null);
    setFlowName(null);
    setCurrentStatusLabel(null);
    setNodes([]);
    setEdges([]);
    setError(null);
    void loadRecordOptions();
  }, [entity.id]);

  const screenHint = useMemo(() => {
    if (!watchedRecordId) {
      return 'Select a target record to view the status flow in read-only mode.';
    }

    if (loading) {
      return 'Refreshing flow state…';
    }

    return 'Listening for StreamPath instance/history events and auto-refreshing.';
  }, [loading, watchedRecordId]);

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
          gap: 1,
          bgcolor: 'var(--sp-raised-bg)',
          borderBottom: '1px solid var(--sp-border)',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Flow Visualizer
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Read-only status progression for {entity.displayName}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <TextField
            select
            label="Target record"
            size="small"
            value={selectedRecordId}
            onChange={(event) => setSelectedRecordId(event.target.value)}
            sx={{ width: { xs: '100%', sm: 320 } }}
          >
            <MenuItem value="">
              {loadingRecordOptions ? 'Loading records…' : 'Select record'}
            </MenuItem>
            {recordOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            size="small"
            onClick={() => {
              const next = selectedRecordId.trim();

              if (!next) {
                setError('Select a target record before watching.');
                return;
              }

              setWatchedRecordId(next);
              void loadVisualizerData('Watch target changed', next);
            }}
            disabled={loading || loadingRecordOptions}
          >
            {watchedRecordId ? 'Watch' : 'Start watching'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => void loadVisualizerData('Manual refresh')}
            disabled={!watchedRecordId || loading}
          >
            Reload
          </Button>
        </Stack>
      </Box>

      {error ? (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      ) : null}

      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: '1px solid var(--sp-border)',
          bgcolor: 'rgba(43, 52, 60, 0.5)',
        }}
      >
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
          <Chip size="small" variant="outlined" label={`Flow ${flowName ?? 'not loaded'}`} />
          <Chip size="small" variant="outlined" label={`Record ${watchedRecordId ?? 'none'}`} />
          <Chip size="small" variant="outlined" label={`Current ${currentStatusLabel ?? 'unknown'}`} />
          <Chip size="small" variant="outlined" label={`Synced ${lastSyncedAt ?? 'never'}`} />
          <Chip
            size="small"
            variant="outlined"
            sx={{ borderColor: CURRENT_COLOR, color: CURRENT_COLOR }}
            label="Current"
          />
          <Chip
            size="small"
            variant="outlined"
            sx={{ borderColor: COMPLETE_COLOR, color: COMPLETE_COLOR }}
            label="Complete"
          />
          <Chip size="small" variant="outlined" sx={{ borderColor: FUTURE_COLOR }} label="Future" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {screenHint}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Dropdown format: &lt;Id&gt;-&lt;display field&gt; using{' '}
          {displayFieldName ? `"${displayFieldName}"` : 'record Id'}.
        </Typography>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          bgcolor: 'var(--sp-surface-bg)',
          '@keyframes sp-visualizer-current-spin': {
            '0%': { transform: 'rotate(0deg)' },
            '100%': { transform: 'rotate(360deg)' },
          },
          '@keyframes sp-visualizer-edge-pulse': {
            '0%': { strokeDashoffset: 0, opacity: 0.42 },
            '55%': { opacity: 1 },
            '100%': { strokeDashoffset: -48, opacity: 0.42 },
          },
          '.sp-visualizer-pulse-edge': {
            strokeDasharray: '10 14',
            animation: 'sp-visualizer-edge-pulse 1.05s linear infinite',
          },
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionMode={ConnectionMode.Loose}
          defaultEdgeOptions={ORTHOGONAL_EDGE_OPTIONS}
          proOptions={{ hideAttribution: true }}
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
    </Paper>
  );
}
