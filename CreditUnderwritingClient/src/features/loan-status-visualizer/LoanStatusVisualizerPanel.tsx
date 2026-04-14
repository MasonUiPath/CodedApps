import { useEffect, useMemo, useRef } from 'react';
import { Alert, Box, Skeleton, Typography } from '@mui/material';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';

import { LoanStatusEdge } from './LoanStatusEdge';
import { LoanStatusNode } from './LoanStatusNode';
import type { LoanStatusGraph } from './types';

type LoanStatusVisualizerPanelProps = {
  graph: LoanStatusGraph | null;
  loading: boolean;
  error: string | null;
  recenterSignal?: number;
};

const nodeTypes: NodeTypes = {
  loanStatusNode: LoanStatusNode,
};

const edgeTypes: EdgeTypes = {
  loanStatusEdge: LoanStatusEdge,
};

const NODE_WIDTH = 192;
const NODE_HEIGHT = 96;
const FRAME_HORIZONTAL_PADDING_PX = 56;
const FRAME_VERTICAL_PADDING_PX = 14;
const FRAME_MIN_ZOOM = 0.35;
const FRAME_MAX_ZOOM = 1.25;

type LoadingNodeData = {
  compact?: boolean;
};

function LoanStatusLoadingNode({ data }: NodeProps<LoadingNodeData>) {
  const compact = data?.compact === true;

  return (
    <Box
      sx={{
        width: compact ? 170 : 194,
        minHeight: compact ? 98 : 112,
        border: '1px solid rgba(120, 133, 145, 0.45)',
        borderRadius: 2,
        px: 1.5,
        py: 1.25,
        bgcolor: 'rgba(10, 19, 33, 0.44)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 6, height: 6, pointerEvents: 'none' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 6, height: 6, pointerEvents: 'none' }}
      />
      <Skeleton
        variant="rounded"
        width={compact ? 84 : 98}
        height={24}
        sx={{
          borderRadius: 1.4,
          bgcolor: 'rgba(137, 162, 186, 0.28)',
        }}
      />
      <Skeleton
        variant="text"
        width="92%"
        sx={{ mt: 1.35, fontSize: '0.95rem', bgcolor: 'rgba(137, 162, 186, 0.22)' }}
      />
      <Skeleton
        variant="text"
        width="76%"
        sx={{ mt: 0.55, fontSize: '0.95rem', bgcolor: 'rgba(137, 162, 186, 0.22)' }}
      />
    </Box>
  );
}

const loadingNodeTypes: NodeTypes = {
  loanStatusLoadingNode: LoanStatusLoadingNode,
};

const loadingNodes: Node<LoadingNodeData>[] = [
  {
    id: 'loading-start',
    type: 'loanStatusLoadingNode',
    position: { x: 40, y: 80 },
    data: { compact: true },
    draggable: false,
    selectable: false,
  },
  {
    id: 'loading-1',
    type: 'loanStatusLoadingNode',
    position: { x: 290, y: 72 },
    data: {},
    draggable: false,
    selectable: false,
  },
  {
    id: 'loading-2',
    type: 'loanStatusLoadingNode',
    position: { x: 560, y: 72 },
    data: {},
    draggable: false,
    selectable: false,
  },
  {
    id: 'loading-end',
    type: 'loanStatusLoadingNode',
    position: { x: 830, y: 80 },
    data: { compact: true },
    draggable: false,
    selectable: false,
  },
  {
    id: 'loading-branch',
    type: 'loanStatusLoadingNode',
    position: { x: 560, y: 270 },
    data: {},
    draggable: false,
    selectable: false,
  },
];

const loadingEdgeStyle = {
  stroke: 'rgba(106, 160, 255, 0.62)',
  strokeWidth: 2,
  strokeDasharray: '7 5',
};

const loadingEdges: Edge[] = [
  {
    id: 'loading-e1',
    source: 'loading-start',
    target: 'loading-1',
    type: 'smoothstep',
    animated: true,
    style: loadingEdgeStyle,
  },
  {
    id: 'loading-e2',
    source: 'loading-1',
    target: 'loading-2',
    type: 'smoothstep',
    animated: true,
    style: loadingEdgeStyle,
  },
  {
    id: 'loading-e3',
    source: 'loading-2',
    target: 'loading-end',
    type: 'smoothstep',
    animated: true,
    style: loadingEdgeStyle,
  },
  {
    id: 'loading-e4',
    source: 'loading-2',
    target: 'loading-branch',
    type: 'smoothstep',
    animated: true,
    style: loadingEdgeStyle,
  },
];

function FlowChartLoadingSkeleton() {
  return (
    <ReactFlow
      nodes={loadingNodes}
      edges={loadingEdges}
      nodeTypes={loadingNodeTypes}
      fitView
      fitViewOptions={{ padding: 0.42, minZoom: 0.55, maxZoom: 1.05 }}
      minZoom={0.5}
      maxZoom={1.1}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling
      proOptions={{ hideAttribution: true }}
      connectionLineType={ConnectionLineType.SmoothStep}
      connectionMode={ConnectionMode.Loose}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="rgba(122, 132, 141, 0.22)"
      />
    </ReactFlow>
  );
}

export function LoanStatusVisualizerPanel({
  graph,
  loading,
  error,
  recenterSignal = 0,
}: LoanStatusVisualizerPanelProps) {
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const graphLayoutSignature = useMemo(() => {
    if (!graph) {
      return '';
    }

    const nodeSignature = graph.nodes
      .map((node) => `${node.id}@${Math.round(node.position.x)}:${Math.round(node.position.y)}`)
      .sort()
      .join('|');
    const edgeSignature = graph.edges
      .map(
        (edge) =>
          `${edge.id}:${edge.source}->${edge.target}:${edge.sourceHandle ?? ''}:${edge.targetHandle ?? ''}`,
      )
      .sort()
      .join('|');
    return `${nodeSignature}__${edgeSignature}`;
  }, [graph]);
  const showLoadingSkeleton = loading && (!graph || graph.nodes.length === 0);

  const applyPreferredViewport = (duration = 0) => {
    if (!graph || graph.nodes.length === 0) {
      return;
    }

    const instance = flowRef.current;
    const surface = surfaceRef.current;
    if (!instance || !surface) {
      return;
    }

    const surfaceWidth = surface.clientWidth;
    const surfaceHeight = surface.clientHeight;
    if (surfaceWidth <= 0 || surfaceHeight <= 0) {
      return;
    }

    const xs = graph.nodes.map((node) => node.position.x);
    const ys = graph.nodes.map((node) => node.position.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + NODE_WIDTH;
    const maxY = Math.max(...ys) + NODE_HEIGHT;

    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const availableWidth = Math.max(1, surfaceWidth - FRAME_HORIZONTAL_PADDING_PX * 2);
    const availableHeight = Math.max(1, surfaceHeight - FRAME_VERTICAL_PADDING_PX * 2);

    const zoomX = availableWidth / graphWidth;
    const zoomY = availableHeight / graphHeight;
    const zoom = Math.max(FRAME_MIN_ZOOM, Math.min(FRAME_MAX_ZOOM, Math.min(zoomX, zoomY)));

    const centerX = minX + graphWidth / 2;
    const centerY = minY + graphHeight / 2;
    const viewportX = surfaceWidth / 2 - centerX * zoom;
    const viewportY = surfaceHeight / 2 - centerY * zoom;

    instance.setViewport(
      {
        x: viewportX,
        y: viewportY,
        zoom,
      },
      {
        duration,
      },
    );
  };

  useEffect(() => {
    if (recenterSignal <= 0 || !flowRef.current) {
      return;
    }

    applyPreferredViewport(220);
  }, [recenterSignal]);

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) {
      return;
    }

    const frame = () => {
      applyPreferredViewport(0);
    };

    const raf = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [graphLayoutSignature]);

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          flex: 1,
          width: '100%',
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'stretch',
        }}
      >
        <Box
          ref={surfaceRef}
          sx={{
            height: '100%',
            minHeight: 0,
            width: '100%',
            border: '1px solid var(--sp-border)',
            borderRadius: 2,
            overflow: 'hidden',
            background:
              'radial-gradient(circle at 1px 1px, rgba(122, 132, 141, 0.2) 1px, transparent 0) 0 0 / 20px 20px, var(--sp-surface-bg)',
          }}
        >
        {showLoadingSkeleton ? (
          <FlowChartLoadingSkeleton />
        ) : null}

        {error ? (
          <Alert severity="warning" sx={{ m: 2 }}>
            {error}
          </Alert>
        ) : null}

        {graph && graph.nodes.length > 0 ? (
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          onInit={(instance) => {
            flowRef.current = instance;
            applyPreferredViewport(0);
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={FRAME_MIN_ZOOM}
          maxZoom={FRAME_MAX_ZOOM}
          panOnDrag
          zoomOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionMode={ConnectionMode.Loose}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="rgba(122, 132, 141, 0.22)"
          />
        </ReactFlow>
        ) : null}

        {!showLoadingSkeleton && !error && (!graph || graph.nodes.length === 0) ? (
          <Box sx={{ p: 2 }}>
            <Typography sx={{ fontSize: 13, color: 'var(--sp-muted-text)' }}>
              No StreamPath flow definition found for this loan.
            </Typography>
          </Box>
        ) : null}
        </Box>
      </Box>
    </Box>
  );
}
