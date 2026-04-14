import type { Edge, Node } from '@xyflow/react';

export type LoanNodeState = 'future' | 'current' | 'complete';
export type LoanEdgeState = 'future' | 'active' | 'complete';

export type LoanStatusNodeData = {
  label: string;
  description: string;
  isStart: boolean;
  isTerminal: boolean;
  state: LoanNodeState;
  nodeHeight?: number;
};

export type LoanStatusEdgeData = {
  label?: string;
  state: LoanEdgeState;
  bidirectional?: boolean;
};

export type LoanStatusNode = Node<LoanStatusNodeData>;
export type LoanStatusEdge = Edge<LoanStatusEdgeData>;

export type LoanStatusGraph = {
  flowName: string;
  currentStatusLabel: string | null;
  hasInstance: boolean;
  nodes: LoanStatusNode[];
  edges: LoanStatusEdge[];
};
