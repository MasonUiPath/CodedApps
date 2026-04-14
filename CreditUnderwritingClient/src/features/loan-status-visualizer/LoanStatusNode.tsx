import { Box, Chip, Stack, Typography } from '@mui/material';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import type { LoanStatusNodeData } from './types';

const GRID_SIZE = 24;
const NODE_WIDTH = 192;
const NODE_HEIGHT = 96;

type HandleSide = 'top' | 'right' | 'bottom' | 'left';

function buildHandleOffsets(length: number): string[] {
  const count = Math.floor(length / GRID_SIZE) - 1;

  return Array.from({ length: count }, (_, index) => {
    const offset = ((index + 1) * GRID_SIZE * 100) / length;
    return `${offset}%`;
  });
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
      return { ...common, left: offset, top: 0, transform: 'translate(-50%, -50%)' };
    case 'right':
      return { ...common, top: offset, right: 0, transform: 'translate(50%, -50%)' };
    case 'bottom':
      return { ...common, left: offset, bottom: 0, transform: 'translate(-50%, 50%)' };
    case 'left':
      return { ...common, top: offset, left: 0, transform: 'translate(-50%, -50%)' };
  }
}

const BORDER_HANDLES = [
  ...buildHandleOffsets(NODE_WIDTH).map((offset, index) => ({ id: `top-${index + 1}`, side: 'top' as const, offset })),
  ...buildHandleOffsets(NODE_HEIGHT).map((offset, index) => ({ id: `right-${index + 1}`, side: 'right' as const, offset })),
  ...buildHandleOffsets(NODE_WIDTH).map((offset, index) => ({ id: `bottom-${index + 1}`, side: 'bottom' as const, offset })),
  ...buildHandleOffsets(NODE_HEIGHT).map((offset, index) => ({ id: `left-${index + 1}`, side: 'left' as const, offset })),
];

function StatusIndicator({ state }: { state: LoanStatusNodeData['state'] }) {
  if (state === 'current') {
    return (
      <Box
        sx={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          border: '2px solid var(--sp-active-blue)',
          borderTopColor: 'transparent',
          animation: 'loanNodeSpin 1s linear infinite',
          '@keyframes loanNodeSpin': {
            '0%': { transform: 'rotate(0deg)' },
            '100%': { transform: 'rotate(360deg)' },
          },
        }}
      />
    );
  }

  if (state === 'complete') {
    return (
      <Box
        sx={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          bgcolor: 'var(--sp-active-green)',
          color: '#122017',
          fontSize: 10,
          lineHeight: '12px',
          fontWeight: 800,
          textAlign: 'center',
        }}
      >
        ✓
      </Box>
    );
  }

  return <Box sx={{ width: 12, height: 12 }} />;
}

function LifecycleIcon({ kind }: { kind: 'start' | 'terminal' }) {
  if (kind === 'start') {
    return (
      <Box component="svg" viewBox="0 0 24 24" sx={{ width: 12, height: 12, display: 'block' }} aria-hidden>
        <circle cx="12" cy="12" r="10" fill="rgba(115, 200, 76, 0.2)" />
        <path d="M9 7.75L17 12 9 16.25V7.75Z" fill="var(--sp-active-green)" />
      </Box>
    );
  }

  return (
    <Box component="svg" viewBox="0 0 24 24" sx={{ width: 12, height: 12, display: 'block' }} aria-hidden>
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

export function LoanStatusNode({ data }: NodeProps<LoanStatusNodeData>) {
  const borderColor =
    data.state === 'current'
      ? 'var(--sp-active-blue)'
      : data.state === 'complete'
        ? 'var(--sp-active-green)'
        : 'var(--sp-border)';

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
      {BORDER_HANDLES.map((handle) => (
        <Handle
          key={handle.id}
          type="source"
          position={getHandlePosition(handle.side)}
          id={handle.id}
          style={getHandleStyle(handle.side, handle.offset)}
          isConnectable={false}
        />
      ))}

      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Chip
          size="small"
          label={data.label}
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
        <Stack direction="row" alignItems="center" spacing={0.75}>
          {data.isStart ? <LifecycleIcon kind="start" /> : null}
          {data.isTerminal ? <LifecycleIcon kind="terminal" /> : null}
          <StatusIndicator state={data.state} />
        </Stack>
      </Stack>

      <Typography
        sx={{
          fontSize: 12,
          lineHeight: 1.35,
          color: 'var(--sp-muted-text)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {data.description.trim().length > 0 ? data.description : 'No description'}
      </Typography>
    </Box>
  );
}
