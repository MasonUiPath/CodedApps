import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  MarkerType,
  Position,
  type EdgeProps,
} from '@xyflow/react';
import { Box } from '@mui/material';

import type { LoanStatusEdgeData } from './types';

const EDGE_COLORS = {
  future: 'var(--sp-muted-text)',
  active: 'var(--sp-active-blue)',
  complete: 'var(--sp-active-green)',
} as const;

export function LoanStatusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
  markerStart,
  data,
}: EdgeProps<LoanStatusEdgeData>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
    offset: 20,
  });

  const state = data?.state ?? 'future';
  const edgeColor = EDGE_COLORS[state];
  const edgeLabel = (data?.label ?? '').trim();
  const markerSize = 18;
  const edgeBaseStyle = {
    stroke: edgeColor,
    strokeWidth: state === 'active' ? 2.6 : 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const labelTextWidth = Math.max(44, edgeLabel.length * 6.6 + 16);
  const labelTextHeight = 18;
  const gapWidth = labelTextWidth + 8;
  const gapHeight = labelTextHeight + 8;
  const maskBoundsPadding = 240;
  const maskId = `loan-transition-gap-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const useLabelMask = edgeLabel.length > 0;
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
      <BaseEdge
        id={id}
        path={path}
        markerStart={data?.bidirectional ? markerStart ?? {
          type: MarkerType.ArrowClosed,
          width: markerSize,
          height: markerSize,
          color: edgeColor,
        } : undefined}
        markerEnd={{
          type: MarkerType.ArrowClosed,
          width: markerSize,
          height: markerSize,
          color: edgeColor,
        }}
        style={edgeStyle}
      />

      {state === 'active' ? (
        <path
          d={path}
          fill="none"
          stroke="#8CC4FF"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="loan-pulse-edge"
          style={pulsePathStyle}
        />
      ) : null}

      {edgeLabel ? (
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
              color: edgeColor,
              bgcolor: 'transparent',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {edgeLabel}
          </Box>
        </EdgeLabelRenderer>
      ) : null}

      <style>
        {`
          @keyframes loanEdgePulse {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: -16; }
          }
          .loan-pulse-edge {
            stroke-dasharray: 7 9;
            animation: loanEdgePulse 0.95s linear infinite;
          }
        `}
      </style>
    </>
  );
}
