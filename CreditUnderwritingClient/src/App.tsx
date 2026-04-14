import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import {
  buildLoanStatusGraphFromStreamPath,
  entityAsString,
  entityRecordId,
  entitySameId,
  extractEntityRecords,
} from './features/loan-status-visualizer/streamPathGraph';
import { type LoanStatusGraph } from './features/loan-status-visualizer';
import { LexicalCommentableEditor } from './features/review-memo/LexicalCommentableEditor';
import {
  LoanWorkspaceTopPanel,
  type PublicPdfDocument as WorkspacePublicPdfDocument,
  type WorkspaceTopTab,
} from './features/loan-workspace/LoanWorkspaceTopPanel';

type Screen = 'loan_board' | 'loan_workspace';
type ConnectionState = 'connecting' | 'connected' | 'disconnected';

type DocumentMentionTrigger = {
  query: string;
  startOffset: number;
  endOffset: number;
};

type LoanCardModel = {
  id: string;
  name: string;
  stage: string;
  taskFlowsInitialized: boolean;
  updatedAt: string;
  updatedAtRaw: string;
};

type AgentTaskStatusState = 'current' | 'complete' | 'uninitialized';
type AgentTaskVisualState =
  | 'created'
  | 'in_progress'
  | 'review_underwriter'
  | 'review_manager'
  | 'review'
  | 'approved'
  | 'other';
type ReviewPhase = 'underwriter' | 'manager' | 'unknown';

type AgentTaskStatusCardModel = {
  id: string;
  name: string;
  taskType: string;
  currentNodeId: string | null;
  currentNodeLabel: string;
  currentNodeDescription: string;
  status: AgentTaskStatusState;
  visualState: AgentTaskVisualState;
  instanceId: string | null;
  flowDefinitionId: string | null;
  summaryText: string;
  confidence: number | null;
  feedback: string;
  followupQuestionsRaw: string;
  sectionOrder: string;
  availableNextNodes: Array<{ nodeId: string; label: string }>;
  updatedAt: string;
  updatedAtRaw: string;
};

type FollowupQuestion = {
  id: string;
  question: string;
  section: string;
};

type FollowupAnswerDraft = {
  id: string;
  question: string;
  answer: string;
};

type FollowupQuestionAnswerPayload = {
  question: string;
  answer: string;
};

type RevisionItemPayload = {
  quotedText: string;
  startOffset: number;
  endOffset: number;
  instruction: string;
};

type FeedbackPayload = {
  schema: string;
  action: 'REVISION';
  sectionOrder: string;
  revisedSectionText: string;
  revisionItems: RevisionItemPayload[];
  followupQuestionAnswers: FollowupQuestionAnswerPayload[];
  generalFeedback: string;
  submittedAt: string;
  reviewOwner: string;
  truncated?: boolean;
};

type TextComment = {
  id: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  comment: string;
  createdAt: string;
};

type PendingCommentDraft = {
  taskId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  anchorX: number;
  anchorY: number;
};

type CommandRequest = {
  command: 'GET' | 'GET_MANY' | 'CREATE' | 'UPDATE' | 'DELETE';
  entityTypeName?: string;
  entityId?: string;
  recordId?: string;
  recordIds?: string[];
  data?: Record<string, unknown>;
  options?: Record<string, unknown>;
};

type CommandResultMessage = {
  type: 'command_result';
  ok: boolean;
  correlationId: string;
  command: string;
  entityId?: string;
  entityTypeName?: string;
  data?: unknown;
  error?: string;
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

type ConnectedMessage = {
  type: 'connected';
  clientId: string;
  message: string;
};

type ErrorMessage = {
  type: 'error';
  error: string;
};

type EventResultMessage = {
  type: 'event_result';
  ok: boolean;
  correlationId: string;
  data?: unknown;
  error?: string;
};

type StatusTransitionResultMessage = {
  type: 'status_transition_result';
  ok: boolean;
  correlationId: string;
  data?: unknown;
  error?: string;
};

type FlowSnapshotResultMessage = {
  type: 'flow_snapshot_result';
  ok: boolean;
  correlationId: string;
  data?: unknown;
  error?: string;
};

type AgentTaskSnapshotResultMessage = {
  type: 'agent_task_snapshot_result';
  ok: boolean;
  correlationId: string;
  data?: unknown;
  error?: string;
};

type ConnectionDiagnosticLevel = 'info' | 'warn' | 'error';

type ConnectionDiagnosticEntry = {
  timestamp: string;
  level: ConnectionDiagnosticLevel;
  event: string;
  detail?: unknown;
};

type LoanFlowLoadOptions = {
  silent?: boolean;
  incremental?: boolean;
  reason?: string;
};

const MIN_TOP_PANEL_PERCENT = 28;
const MAX_TOP_PANEL_PERCENT = 72;
const APP_HEADER_HEIGHT_PX = 72;
const RECONNECT_DELAY_MS = 12000;
const VERBOSE_SOCKET_EVENT_LOGS = true;
const LOAN_ENTITY = 'E2ELoan';
const AGENT_TASK_ENTITY = 'E2EAgentTask';
const FLOW_ENTITY = 'StreamPathStatusFlowDefinition';
const NODE_ENTITY = 'StreamPathStatusNode';
const TRANSITION_ENTITY = 'StreamPathStatusTransition';
const INSTANCE_ENTITY = 'StreamPathStatusInstance';
const HISTORY_ENTITY = 'StreamPathStatusHistory';
const DEFAULT_COORDINATOR_BASE_URL = 'https://unbowled-paul-decisional.ngrok-free.dev';
const MAX_CONNECTION_DIAGNOSTICS = 40;
const DATA_SERVICE_TEXT_FIELD_LIMIT = 10_000;
const FRIENDLY_LOAN_NAME_PATTERN = /^Loan\s+(\d+)$/i;
const AGENT_TASK_FOLLOWUP_ANSWERS_PLACEHOLDER_FIELD = 'FollowupQuestionAnswersJson';
const AGENT_TASK_COMPLETED_PLACEHOLDER_FIELD = 'TaskCompleted';
const AGENT_TASK_APPROVED_FIELD = 'Approved';
const SAMPLE_PUBLIC_PDF_FILE_NAMES = [
  'Attachment N1 - Sample Loan Agreement.pdf',
  'Attachment N1 - Sample Loan Agreement-2.pdf',
  'Sherlock Homes 2026_Product Package Credit Memo_4-2-2026_11-20-42_AM_EDT.pdf',
];

function safeDebugPreview(value: unknown, maxLength = 800): string {
  try {
    const text = JSON.stringify(value);
    if (!text) {
      return '';
    }

    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  } catch {
    return String(value);
  }
}
const STATIC_CREDIT_MEMO_SECTIONS: Record<
  string,
  {
    title: string;
    rows: Array<{ label: string; value: string }>;
  }
> = {
  product_package_details: {
    title: 'Product Package Details',
    rows: [
      { label: 'Product Package', value: 'Sherlock Homes 2026 Package (Sample)' },
      { label: 'Package Type', value: 'Commercial Lending Bundle' },
      { label: 'Relationship Type', value: 'Commercial Banking' },
      { label: 'Package Start Date', value: '2026-04-01' },
      { label: 'Package Maturity', value: '2029-03-31' },
    ],
  },
  loan_request_details: {
    title: 'Loan Request Details',
    rows: [
      { label: 'Borrower Name', value: 'Sherlock Homes LLC (Sample)' },
      { label: 'Requested Amount', value: '$12,500,000' },
      { label: 'Purpose', value: 'Owner-occupied expansion + refinance' },
      { label: 'Requested Term', value: '36 months' },
      { label: 'Repayment Structure', value: 'Interest-only 12 mo, then amortizing' },
    ],
  },
  rate_and_payment_streams: {
    title: 'Rate and Payment Streams',
    rows: [
      { label: 'Base Rate', value: 'SOFR + 2.25% (Sample)' },
      { label: 'Payment Frequency', value: 'Monthly' },
      { label: 'Amortization', value: '20-year schedule after IO period' },
      { label: 'Prepayment Terms', value: 'Step-down penalty (sample)' },
      { label: 'Expected DSCR', value: '1.32x (stabilized)' },
    ],
  },
  collateral: {
    title: 'Collateral',
    rows: [
      { label: 'Primary Collateral', value: 'Mixed-use property, 1450 Market St' },
      { label: 'Estimated Value', value: '$18,900,000 (Sample)' },
      { label: 'Collateral Type', value: 'First lien mortgage' },
      { label: 'Guarantors', value: '2 personal guarantees (sample)' },
      { label: 'Perfection Status', value: 'UCC + title review pending final sign-off' },
    ],
  },
  loan_code_details: {
    title: 'Loan Code Details',
    rows: [
      { label: 'Loan Code', value: 'LN-SH-2026-003' },
      { label: 'Risk Bucket', value: 'Moderate (Sample)' },
      { label: 'Policy Program', value: 'Mid-Market Real Estate v2' },
      { label: 'Underwriting Segment', value: 'CRE - Regional' },
      { label: 'Exception Flag', value: 'None (Sample)' },
    ],
  },
};

const CREDIT_MEMO_SECTION_ORDER: ReadonlyArray<
  | { kind: 'static'; key: string }
  | { kind: 'agent'; key: string }
> = [
  { kind: 'static', key: 'product_package_details' },
  { kind: 'agent', key: 'executive_summary' },
  { kind: 'static', key: 'loan_request_details' },
  { kind: 'static', key: 'rate_and_payment_streams' },
  { kind: 'static', key: 'collateral' },
  { kind: 'agent', key: 'collateral' },
  { kind: 'agent', key: 'relationship_summary' },
  { kind: 'agent', key: 'covenants' },
  { kind: 'agent', key: 'underwriting_recommendations' },
  { kind: 'agent', key: 'risk_rating_rac' },
  { kind: 'agent', key: 'financial_analysis' },
  { kind: 'static', key: 'loan_code_details' },
];
const AGENT_SECTION_ORDER_BY_CANONICAL_TYPE: Record<string, string> = {
  executive_summary: '02 Executive Summary',
  relationship_summary: '07 Relationship Summary',
  collateral: '06 Collateral Analysis',
  covenants: '08 Covenants',
  underwriting_recommendations: '09 Underwriting Recommendations',
  risk_rating_rac: '10 Risk Acceptance Criteria (RAC)/Policy Exceptions',
  financial_analysis: '11 Financial Analysis',
  industry_search: '98 Industry Analysis',
};
const AGENT_TASK_TYPE_CANONICAL_ALIASES: Record<string, string> = {
  executivesummary: 'executive_summary',
  executivesummaryagent: 'executive_summary',
  relationshipsummary: 'relationship_summary',
  relationshipsummaryagent: 'relationship_summary',
  collateral: 'collateral',
  collateralagent: 'collateral',
  covenants: 'covenants',
  covenantsagent: 'covenants',
  riskstrengthanalysis: 'underwriting_recommendations',
  riskstrengthanalysisagent: 'underwriting_recommendations',
  underwriterrecommendations: 'underwriting_recommendations',
  underwriterrecommendationsagent: 'underwriting_recommendations',
  underwritingrecommendations: 'underwriting_recommendations',
  underwritingrecommendationsagent: 'underwriting_recommendations',
  rac: 'risk_rating_rac',
  racagent: 'risk_rating_rac',
  riskratingrac: 'risk_rating_rac',
  riskratingracagent: 'risk_rating_rac',
  riskacceptancecriteriaracpolicyexceptions: 'risk_rating_rac',
  financialanalysis: 'financial_analysis',
  financialanalysisagent: 'financial_analysis',
  industrysearch: 'industry_search',
  industrysearchagent: 'industry_search',
};

const SAMPLE_PUBLIC_PDF_DOCUMENTS: WorkspacePublicPdfDocument[] = SAMPLE_PUBLIC_PDF_FILE_NAMES.map(
  (fileName, index) => ({
    id: `sample-pdf-${index + 1}`,
    name: fileName,
    url: `/${encodeURIComponent(fileName)}`,
  }),
);

function getTrailingDocumentMentionTrigger(value: string): DocumentMentionTrigger | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
  if (!match) {
    return null;
  }

  const atIndex = value.lastIndexOf('@');
  if (atIndex < 0) {
    return null;
  }

  return {
    query: match[1] ?? '',
    startOffset: atIndex,
    endOffset: value.length,
  };
}

function getDocumentMentionSuggestions(query: string): PublicPdfDocument[] {
  const normalized = query.trim().toLowerCase();
  const ranked = SAMPLE_PUBLIC_PDF_DOCUMENTS.filter((document) => {
    if (!normalized) {
      return true;
    }
    return document.name.toLowerCase().includes(normalized);
  });

  return ranked.slice(0, 6);
}

function applyDocumentMention(
  value: string,
  trigger: DocumentMentionTrigger,
  documentName: string,
): string {
  const prefix = value.slice(0, trigger.startOffset);
  const suffix = value.slice(trigger.endOffset);
  const mention = `@[${documentName}] `;
  return `${prefix}${mention}${suffix}`;
}

function scrubDemoDocumentMentions(value: string): string {
  if (!value) {
    return value;
  }

  return value
    .replace(/@\[[^\]]+\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trimEnd();
}

function DocumentMentionSuggestionList({
  suggestions,
  onSelect,
}: {
  suggestions: PublicPdfDocument[];
  onSelect: (document: PublicPdfDocument) => void;
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        mt: 0.75,
        p: 0.5,
        borderColor: 'var(--sp-control-border)',
        bgcolor: 'var(--sp-control-bg)',
      }}
    >
      <Stack spacing={0.25}>
        {suggestions.map((document) => (
          <Button
            key={document.id}
            size="small"
            variant="text"
            onClick={() => onSelect(document)}
            sx={{
              justifyContent: 'flex-start',
              textTransform: 'none',
              px: 0.75,
              py: 0.35,
              minHeight: 24,
              color: 'var(--sp-muted-text)',
              '&:hover': {
                bgcolor: 'rgba(102, 172, 255, 0.1)',
                color: 'var(--sp-text)',
              },
            }}
          >
            <Box sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              @{document.name}
            </Box>
          </Button>
        ))}
      </Stack>
    </Paper>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessageWithType(value: unknown): value is { type: string } {
  return isRecord(value) && typeof value.type === 'string';
}

function normalizeEntityName(value: string): string {
  return value.replace(/_/g, '').toLowerCase();
}

function entityAsBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y') {
      return true;
    }
    if (
      normalized === 'false' ||
      normalized === '0' ||
      normalized === 'no' ||
      normalized === 'n' ||
      normalized === ''
    ) {
      return false;
    }
  }

  return false;
}

function formatUpdatedAt(dateIso: string): string {
  if (!dateIso) {
    return 'Unknown';
  }

  const parsed = Date.parse(dateIso);
  if (!Number.isFinite(parsed)) {
    return dateIso;
  }

  return new Date(parsed).toLocaleString();
}

function socketReadyStateLabel(value: number): string {
  switch (value) {
    case WebSocket.CONNECTING:
      return 'CONNECTING';
    case WebSocket.OPEN:
      return 'OPEN';
    case WebSocket.CLOSING:
      return 'CLOSING';
    case WebSocket.CLOSED:
      return 'CLOSED';
    default:
      return `UNKNOWN(${value})`;
  }
}

function getEventPayloadRecordId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const keys = ['recordId', 'RecordId', 'targetRecordId', 'TargetRecordId'];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

function getEventPayloadTaskId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  // Keep this strict to task-specific keys only.
  // Generic RecordId is ambiguous in history/instance payloads and can point to a loan record.
  const keys = ['taskId', 'TaskId', 'agentTaskId', 'AgentTaskId'];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

function getEventPayloadStatusInstanceId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const keys = [
    'statusInstanceId',
    'StatusInstanceId',
    'instanceId',
    'InstanceId',
    'streamPathStatusInstanceId',
    'StreamPathStatusInstanceId',
  ];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

function getReferenceId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  return entityAsString(value.Id) || entityAsString(value.id) || entityAsString(value.RecordId) || null;
}

function getRecordValue(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): unknown {
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

function getRecordStringValue(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): string {
  return entityAsString(getRecordValue(record, keys));
}

function getRecordRelatedId(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  const direct = getRecordStringValue(record, keys);
  if (direct) {
    return direct;
  }

  return getReferenceId(getRecordValue(record, keys));
}

function getAgentTaskLoanId(record: Record<string, unknown>): string | null {
  return (
    entityAsString(record.LoanId) ||
    entityAsString(record.LoanRecordId) ||
    entityAsString(record.Loan_RecordId) ||
    entityAsString(record.loanId) ||
    entityAsString(record.loanRecordId) ||
    entityAsString(record.loan_recordId) ||
    getReferenceId(record.Loan) ||
    getReferenceId(record.LoanRecord) ||
    getReferenceId(record.Loan_Record) ||
    getReferenceId(record.loan) ||
    getReferenceId(record.loanRecord) ||
    getReferenceId(record.loan_record) ||
    null
  );
}

function getAgentTaskDisplayName(record: Record<string, unknown>): string {
  return (
    entityAsString(record.Type) ||
    entityAsString(record.TaskName) ||
    entityAsString(record.AgentName) ||
    entityAsString(record.Name) ||
    entityRecordId(record) ||
    'Agent Task'
  );
}

function getLoanDisplayName(record: Record<string, unknown>, fallbackId: string): string {
  return (
    entityAsString(record.Name) ||
    entityAsString(record.name) ||
    entityAsString(record.LoanName) ||
    entityAsString(record.loanName) ||
    fallbackId
  );
}

function getAgentTaskType(record: Record<string, unknown>): string {
  return entityAsString(record.Type) || entityAsString(record.type) || 'agent_task';
}

function normalizeAgentTaskTypeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveCanonicalAgentTaskType(typeValue: string): string | null {
  const normalized = normalizeAgentTaskTypeToken(typeValue);
  if (!normalized) {
    return null;
  }

  return AGENT_TASK_TYPE_CANONICAL_ALIASES[normalized] ?? null;
}

function normalizeSectionOrderValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getSectionOrderForTask(record: Record<string, unknown>): string {
  const canonicalType = resolveCanonicalAgentTaskType(getAgentTaskType(record));
  if (canonicalType) {
    return AGENT_SECTION_ORDER_BY_CANONICAL_TYPE[canonicalType] ?? `99 ${getAgentTaskDisplayName(record)}`;
  }

  const explicitOrder = entityAsString(record.SectionOrder) || entityAsString(record.sectionOrder);
  if (explicitOrder) {
    return explicitOrder;
  }

  return `99 ${getAgentTaskDisplayName(record)}`;
}

function getSectionTitleFromOrder(sectionOrder: string): string {
  const trimmed = sectionOrder.trim();
  const match = trimmed.match(/^\d+\s+(.*)$/);
  if (match && match[1]) {
    return match[1];
  }

  return trimmed || 'Memo Section';
}

function formatConfidenceChipLabel(confidence: number | null): string {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return 'Agent Confidence N/A';
  }

  const percent = confidence <= 1 ? confidence * 100 : confidence;
  const clamped = Math.max(0, Math.min(100, percent));
  return `Agent Confidence ${Math.round(clamped)}%`;
}

function getCanonicalAgentTaskTypeFromCard(task: AgentTaskStatusCardModel): string | null {
  const fromType = resolveCanonicalAgentTaskType(task.taskType);
  if (fromType) {
    return fromType;
  }

  const token = normalizeSectionOrderValue(task.sectionOrder);
  if (token.includes('executive summary')) {
    return 'executive_summary';
  }
  if (token.includes('relationship summary')) {
    return 'relationship_summary';
  }
  if (token.includes('collateral analysis')) {
    return 'collateral';
  }
  if (token.includes('covenants')) {
    return 'covenants';
  }
  if (token.includes('underwriting recommendations')) {
    return 'underwriting_recommendations';
  }
  if (token.includes('risk acceptance criteria') || token.includes('rac')) {
    return 'risk_rating_rac';
  }
  if (token.includes('financial analysis')) {
    return 'financial_analysis';
  }

  return null;
}

function parseFollowupQuestions(rawValue: string): FollowupQuestion[] {
  if (!rawValue.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry, index) => {
        if (!isRecord(entry)) {
          return null;
        }

        const question = entityAsString(entry.question) || entityAsString(entry.Question);
        if (!question) {
          return null;
        }

        return {
          id: entityAsString(entry.id) || `q-${index + 1}`,
          question,
          section: entityAsString(entry.section) || entityAsString(entry.Section) || '',
        } satisfies FollowupQuestion;
      })
      .filter((entry): entry is FollowupQuestion => entry !== null);
  } catch {
    return [];
  }
}

function capTextForDataService(value: string, limit = DATA_SERVICE_TEXT_FIELD_LIMIT): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= limit) {
    return { value, truncated: false };
  }

  return {
    value: value.slice(0, limit),
    truncated: true,
  };
}

function capFollowupAnswersForStorage(followupAnswers: FollowupQuestionAnswerPayload[]): {
  json: string;
  truncated: boolean;
} {
  const maxQuestionLength = 800;
  const maxAnswerLength = 4_000;

  let truncated = false;
  const normalized = followupAnswers.map((entry) => {
    const question = capTextForDataService(entry.question, maxQuestionLength);
    const answer = capTextForDataService(entry.answer, maxAnswerLength);
    truncated = truncated || question.truncated || answer.truncated;
    return {
      question: question.value,
      answer: answer.value,
    } satisfies FollowupQuestionAnswerPayload;
  });

  let working = normalized;
  let json = JSON.stringify(working);
  while (json.length > DATA_SERVICE_TEXT_FIELD_LIMIT && working.length > 0) {
    working = working.slice(0, -1);
    truncated = true;
    json = JSON.stringify(working);
  }

  if (json.length > DATA_SERVICE_TEXT_FIELD_LIMIT) {
    return {
      json: '[]',
      truncated: true,
    };
  }

  return { json, truncated };
}

function capFeedbackPayloadForStorage(payload: FeedbackPayload): {
  json: string;
  truncated: boolean;
} {
  let truncated = false;
  const normalized: FeedbackPayload = {
    ...payload,
    reviewOwner: capTextForDataService(payload.reviewOwner, 64).value,
    sectionOrder: capTextForDataService(payload.sectionOrder, 256).value,
    revisedSectionText: capTextForDataService(payload.revisedSectionText, 4_500).value,
    revisionItems: payload.revisionItems.map((item) => {
      const instruction = capTextForDataService(item.instruction, 1_200);
      const quotedText = capTextForDataService(item.quotedText, 500);
      truncated = truncated || instruction.truncated || quotedText.truncated;
      return {
        ...item,
        instruction: instruction.value,
        quotedText: quotedText.value,
      };
    }),
    generalFeedback: capTextForDataService(payload.generalFeedback, 3_000).value,
    followupQuestionAnswers: payload.followupQuestionAnswers.map((entry) => {
      const question = capTextForDataService(entry.question, 600);
      const answer = capTextForDataService(entry.answer, 1_500);
      truncated = truncated || question.truncated || answer.truncated;
      return {
        ...entry,
        question: question.value,
        answer: answer.value,
      };
    }),
  };

  let working: FeedbackPayload = { ...normalized };
  let json = JSON.stringify(working);
  while (json.length > DATA_SERVICE_TEXT_FIELD_LIMIT && working.revisionItems.length > 0) {
    working = {
      ...working,
      revisionItems: working.revisionItems.slice(0, -1),
      truncated: true,
    };
    truncated = true;
    json = JSON.stringify(working);
  }

  while (json.length > DATA_SERVICE_TEXT_FIELD_LIMIT && working.followupQuestionAnswers.length > 0) {
    working = {
      ...working,
      followupQuestionAnswers: working.followupQuestionAnswers.slice(0, -1),
      truncated: true,
    };
    truncated = true;
    json = JSON.stringify(working);
  }

  if (json.length > DATA_SERVICE_TEXT_FIELD_LIMIT && working.generalFeedback.length > 0) {
    working = {
      ...working,
      generalFeedback: '',
      truncated: true,
    };
    truncated = true;
    json = JSON.stringify(working);
  }

  if (json.length > DATA_SERVICE_TEXT_FIELD_LIMIT && working.revisedSectionText.length > 0) {
    working = {
      ...working,
      revisedSectionText: '',
      truncated: true,
    };
    truncated = true;
    json = JSON.stringify(working);
  }

  if (json.length > DATA_SERVICE_TEXT_FIELD_LIMIT) {
    const minimalPayload = {
      schema: payload.schema,
      action: payload.action,
      sectionOrder: normalized.sectionOrder,
      revisedSectionText: '',
      revisionItems: [],
      followupQuestionAnswers: [],
      generalFeedback: '',
      submittedAt: payload.submittedAt,
      reviewOwner: normalized.reviewOwner,
      truncated: true,
    };
    json = JSON.stringify(minimalPayload);
    truncated = true;
  }

  if (json.length > DATA_SERVICE_TEXT_FIELD_LIMIT) {
    json = JSON.stringify({ truncated: true });
    truncated = true;
  }

  return { json, truncated };
}

function rebaseRangeForTextEdit(
  previousText: string,
  nextText: string,
  range: { startOffset: number; endOffset: number },
): { startOffset: number; endOffset: number; quotedText: string } | null {
  if (nextText.length === 0) {
    return null;
  }

  const previousLength = previousText.length;
  const nextLength = nextText.length;

  let prefixLength = 0;
  while (
    prefixLength < previousLength &&
    prefixLength < nextLength &&
    previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let previousSuffixStart = previousLength;
  let nextSuffixStart = nextLength;
  while (
    previousSuffixStart > prefixLength &&
    nextSuffixStart > prefixLength &&
    previousText[previousSuffixStart - 1] === nextText[nextSuffixStart - 1]
  ) {
    previousSuffixStart -= 1;
    nextSuffixStart -= 1;
  }

  const delta = nextLength - previousLength;
  const mapOffset = (offset: number, bias: 'start' | 'end'): number => {
    const bounded = Math.max(0, Math.min(offset, previousLength));
    if (bounded <= prefixLength) {
      return bounded;
    }
    if (bounded >= previousSuffixStart) {
      return bounded + delta;
    }
    return bias === 'start' ? prefixLength : nextSuffixStart;
  };

  let startOffset = mapOffset(range.startOffset, 'start');
  let endOffset = mapOffset(range.endOffset, 'end');

  startOffset = Math.max(0, Math.min(startOffset, nextLength));
  endOffset = Math.max(0, Math.min(endOffset, nextLength));
  if (endOffset <= startOffset) {
    endOffset = Math.min(nextLength, startOffset + 1);
    if (endOffset <= startOffset) {
      startOffset = Math.max(0, endOffset - 1);
    }
  }

  if (endOffset <= startOffset) {
    return null;
  }

  return {
    startOffset,
    endOffset,
    quotedText: nextText.slice(startOffset, endOffset),
  };
}

function rebaseCommentsForTextEdit(
  previousText: string,
  nextText: string,
  comments: TextComment[],
): TextComment[] {
  if (comments.length === 0 || previousText === nextText) {
    return comments;
  }

  const nextComments: TextComment[] = [];
  for (const comment of comments) {
    const rebased = rebaseRangeForTextEdit(previousText, nextText, comment);
    if (!rebased) {
      continue;
    }

    nextComments.push({
      ...comment,
      startOffset: rebased.startOffset,
      endOffset: rebased.endOffset,
      quotedText: rebased.quotedText,
    });
  }

  return nextComments;
}

function getAgentTaskStatus(
  instance: Record<string, unknown> | null,
  currentNode: Record<string, unknown> | null,
): AgentTaskStatusState {
  if (!instance) {
    return 'uninitialized';
  }

  const isTerminal = currentNode?.IsTerminal === true || currentNode?.isTerminal === true;
  if (isTerminal || instance.IsClosed === true || instance.isClosed === true) {
    return 'complete';
  }

  return 'current';
}

function getStatusToken(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getReviewPhaseFromLabel(label: string): ReviewPhase {
  const token = getStatusToken(label);
  if (token.includes('managerreview')) {
    return 'manager';
  }
  if (token.includes('underwriterreview')) {
    return 'underwriter';
  }
  return 'unknown';
}

function getReviewPhaseDisplayName(phase: ReviewPhase): string {
  if (phase === 'manager') {
    return 'Manager Review';
  }
  if (phase === 'underwriter') {
    return 'Underwriter Review';
  }
  return 'Review';
}

function isDraftCreditMemoStageLabel(label: string): boolean {
  const token = getStatusToken(label);
  return token.includes('draftcreditmemo') || token.includes('creditmemoentry');
}

function isReviewVisualState(value: AgentTaskVisualState): boolean {
  return value === 'review' || value === 'review_underwriter' || value === 'review_manager';
}

function getAgentTaskVisualState(
  status: AgentTaskStatusState,
  currentNodeLabel: string,
): AgentTaskVisualState {
  if (status === 'uninitialized') {
    return 'created';
  }

  const token = getStatusToken(currentNodeLabel);

  if (token === 'created') {
    return 'created';
  }

  if (token === 'inprogress' || token === 'processing' || token === 'running') {
    return 'in_progress';
  }

  if (token.includes('managerreview')) {
    return 'review_manager';
  }

  if (token.includes('underwriterreview')) {
    return 'review_underwriter';
  }

  if (token.includes('review') || token.includes('revision')) {
    return 'review';
  }

  if (token.includes('approved') || status === 'complete') {
    return 'approved';
  }

  return 'other';
}

function ensureWsPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/ws' : trimmed.endsWith('/ws') ? trimmed : `${trimmed}/ws`;
}

function toWebSocketUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());

    if (url.protocol === 'https:' || url.protocol === 'wss:') {
      url.protocol = 'wss:';
    } else if (url.protocol === 'http:' || url.protocol === 'ws:') {
      url.protocol = 'ws:';
    }

    url.pathname = ensureWsPath(url.pathname);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function getCoordinatorWsUrl(): string {
  const configuredUrl = import.meta.env.VITE_COORDINATOR_WS_URL;

  if (configuredUrl) {
    return toWebSocketUrl(configuredUrl);
  }

  const configuredHttpUrl = import.meta.env.VITE_COORDINATOR_HTTP_URL;

  if (configuredHttpUrl) {
    return toWebSocketUrl(configuredHttpUrl);
  }

  return toWebSocketUrl(DEFAULT_COORDINATOR_BASE_URL);
}

function getCoordinatorHttpBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_COORDINATOR_HTTP_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  return DEFAULT_COORDINATOR_BASE_URL;
}

function getNextFriendlyLoanName(existingLoans: LoanCardModel[]): string {
  const usedNumbers = new Set<number>();

  for (const loan of existingLoans) {
    const match = FRIENDLY_LOAN_NAME_PATTERN.exec(loan.name.trim());
    if (!match) {
      continue;
    }

    const numberValue = Number.parseInt(match[1], 10);
    if (Number.isFinite(numberValue) && numberValue > 0) {
      usedNumbers.add(numberValue);
    }
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `Loan ${String(nextNumber).padStart(3, '0')}`;
}

function PlaceholderBox({
  title,
  subtitle,
  minHeight = 120,
}: {
  title: string;
  subtitle?: string;
  minHeight?: number;
}) {
  return (
    <Box
      sx={{
        minHeight,
        border: '1px dashed var(--sp-control-border)',
        bgcolor: 'rgba(102, 172, 255, 0.05)',
        borderRadius: 1,
        p: 1.5,
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.25 }}>{title}</Typography>
      {subtitle ? (
        <Typography sx={{ fontSize: 12 }} color="text.secondary">
          {subtitle}
        </Typography>
      ) : null}
    </Box>
  );
}

function loanGraphTopologySignature(graph: LoanStatusGraph): string {
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
}

function mergeLoanGraphForIncrementalRefresh(
  current: LoanStatusGraph | null,
  incoming: LoanStatusGraph,
): LoanStatusGraph {
  if (!current) {
    return incoming;
  }

  if (loanGraphTopologySignature(current) !== loanGraphTopologySignature(incoming)) {
    return incoming;
  }

  const incomingNodeById = new Map(incoming.nodes.map((node) => [node.id.toUpperCase(), node]));
  const incomingEdgeById = new Map(incoming.edges.map((edge) => [edge.id.toUpperCase(), edge]));

  const mergedNodes = current.nodes.map((node) => {
    const nextNode = incomingNodeById.get(node.id.toUpperCase());
    if (!nextNode) {
      return node;
    }

    return {
      ...node,
      data: {
        ...node.data,
        ...nextNode.data,
      },
    };
  });

  const mergedEdges = current.edges.map((edge) => {
    const nextEdge = incomingEdgeById.get(edge.id.toUpperCase());
    if (!nextEdge) {
      return edge;
    }

    return {
      ...edge,
      data: {
        ...edge.data,
        ...nextEdge.data,
      },
    };
  });

  return {
    ...incoming,
    nodes: mergedNodes,
    edges: mergedEdges,
  };
}

export function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [coordinatorError, setCoordinatorError] = useState<string | null>(null);
  const [showCoordinatorErrorDetails, setShowCoordinatorErrorDetails] = useState(false);
  const [errorDetailsCopied, setErrorDetailsCopied] = useState(false);
  const [connectionDiagnostics, setConnectionDiagnostics] = useState<ConnectionDiagnosticEntry[]>([]);
  const [isLoansLoading, setIsLoansLoading] = useState(true);

  const [screen, setScreen] = useState<Screen>('loan_board');
  const [topTab, setTopTab] = useState<WorkspaceTopTab>('flow');
  const [topPanelPercent, setTopPanelPercent] = useState(34);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [flowRecenterSignal, setFlowRecenterSignal] = useState(0);
  const [selectedPublicPdfUrl, setSelectedPublicPdfUrl] = useState<string>(
    SAMPLE_PUBLIC_PDF_DOCUMENTS[0]?.url ?? '',
  );

  const [loans, setLoans] = useState<LoanCardModel[]>([]);
  const [selectedLoanId, setSelectedLoanId] = useState<string>('');

  const [loanStatusGraph, setLoanStatusGraph] = useState<LoanStatusGraph | null>(null);
  const [loanFlowLoading, setLoanFlowLoading] = useState(false);
  const [loanFlowError, setLoanFlowError] = useState<string | null>(null);
  const [agentTaskStatuses, setAgentTaskStatuses] = useState<AgentTaskStatusCardModel[]>([]);
  const [agentTasksLoading, setAgentTasksLoading] = useState(false);
  const [agentTasksError, setAgentTasksError] = useState<string | null>(null);
  const [deletingLoanId, setDeletingLoanId] = useState<string | null>(null);
  const [startReviewInFlightLoanId, setStartReviewInFlightLoanId] = useState<string | null>(null);
  const [reviewStartedLoanIds, setReviewStartedLoanIds] = useState<string[]>([]);
  const [editorDraftByTaskId, setEditorDraftByTaskId] = useState<Record<string, string>>({});
  const [commentsByTaskId, setCommentsByTaskId] = useState<Record<string, TextComment[]>>({});
  const [generalFeedbackByTaskId, setGeneralFeedbackByTaskId] = useState<Record<string, string>>({});
  const [followupAnswersByTaskId, setFollowupAnswersByTaskId] = useState<
    Record<string, Record<string, string>>
  >({});
  const [reviewEditsByTaskId, setReviewEditsByTaskId] = useState<Record<string, boolean>>({});
  const [pendingComment, setPendingComment] = useState<PendingCommentDraft | null>(null);
  const [pendingCommentText, setPendingCommentText] = useState('');
  const [taskActionInFlightById, setTaskActionInFlightById] = useState<Record<string, boolean>>({});
  const [activeMemoTaskId, setActiveMemoTaskId] = useState<string | null>(null);

  const workspaceSplitRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const socketGenerationRef = useRef(0);
  const shuttingDownRef = useRef(false);
  const pendingCommandsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: CommandResultMessage) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const pendingEventsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: EventResultMessage) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const pendingStatusTransitionsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: StatusTransitionResultMessage) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const pendingFlowSnapshotsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: FlowSnapshotResultMessage) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const pendingAgentTaskSnapshotsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: AgentTaskSnapshotResultMessage) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const socketReadyWaitersRef = useRef<Array<{ resolve: () => void; reject: (error: Error) => void }>>(
    [],
  );
  const loansLoadInFlightRef = useRef(false);
  const queuedLoansReloadRef = useRef(false);
  const flowLoadInFlightRef = useRef(false);
  const queuedFlowReloadLoanIdRef = useRef<{ loanId: string; options?: LoanFlowLoadOptions } | null>(
    null,
  );
  const agentTaskLoadInFlightRef = useRef(false);
  const queuedAgentTaskReloadLoanIdRef = useRef<string | null>(null);
  const agentTaskNodesByIdRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const agentTaskTransitionsRef = useRef<Record<string, unknown>[]>([]);
  const agentTaskMetaLoadedAtRef = useRef(0);
  const loanInstanceIdByLoanIdRef = useRef<Map<string, string>>(new Map());
  const loanIdByInstanceIdRef = useRef<Map<string, string>>(new Map());

  const selectedLoan = loans.find((loan) => entitySameId(loan.id, selectedLoanId)) ?? loans[0] ?? null;
  const activeLoanStageLabel = loanStatusGraph?.currentStatusLabel ?? selectedLoan?.stage ?? '';
  const activeReviewPhase: ReviewPhase = activeLoanStageLabel.toLowerCase().includes('manager')
    ? 'manager'
    : activeLoanStageLabel.toLowerCase().includes('underwriter')
      ? 'underwriter'
      : 'unknown';
  const hasStartedReviewForSelectedLoan =
    !!selectedLoan && reviewStartedLoanIds.some((loanId) => entitySameId(loanId, selectedLoan.id));
  const canStartReview = isDraftCreditMemoStageLabel(activeLoanStageLabel);
  const isStartReviewInFlight =
    !!selectedLoan && !!startReviewInFlightLoanId && entitySameId(startReviewInFlightLoanId, selectedLoan.id);
  const allTasksManagerReadyForReview =
    agentTaskStatuses.length > 0 &&
    agentTaskStatuses.every(
      (task) => task.visualState === 'review_manager' || task.visualState === 'approved',
    );
  const sortedAgentTaskStatuses = agentTaskStatuses
    .slice()
    .sort((left, right) =>
      normalizeSectionOrderValue(left.sectionOrder).localeCompare(normalizeSectionOrderValue(right.sectionOrder)),
    );
  const queuedAgentTasksByType = new Map<string, AgentTaskStatusCardModel[]>();
  const untypedAgentTasks: AgentTaskStatusCardModel[] = [];
  for (const task of sortedAgentTaskStatuses) {
    const canonicalType = getCanonicalAgentTaskTypeFromCard(task);
    if (!canonicalType) {
      untypedAgentTasks.push(task);
      continue;
    }

    const currentQueue = queuedAgentTasksByType.get(canonicalType);
    if (currentQueue) {
      currentQueue.push(task);
    } else {
      queuedAgentTasksByType.set(canonicalType, [task]);
    }
  }
  const memoSectionRenderItems: Array<
    | { kind: 'static'; section: { title: string; rows: Array<{ label: string; value: string }> } }
    | { kind: 'agent'; task: AgentTaskStatusCardModel }
  > = [];
  for (const section of CREDIT_MEMO_SECTION_ORDER) {
    if (section.kind === 'static') {
      const staticSection = STATIC_CREDIT_MEMO_SECTIONS[section.key];
      if (staticSection) {
        memoSectionRenderItems.push({ kind: 'static', section: staticSection });
      }
      continue;
    }

    const queue = queuedAgentTasksByType.get(section.key);
    const nextTask = queue?.shift();
    if (nextTask) {
      memoSectionRenderItems.push({ kind: 'agent', task: nextTask });
    }
  }
  for (const remainingQueue of queuedAgentTasksByType.values()) {
    for (const task of remainingQueue) {
      memoSectionRenderItems.push({ kind: 'agent', task });
    }
  }
  for (const task of untypedAgentTasks) {
    memoSectionRenderItems.push({ kind: 'agent', task });
  }

  const buildAgentTaskCardModel = useEffectEvent(
    (taskRecord: Record<string, unknown>, instance: Record<string, unknown> | null): AgentTaskStatusCardModel | null => {
      const taskId = entityRecordId(taskRecord);
      if (!taskId) {
        return null;
      }

      const nodeById = agentTaskNodesByIdRef.current;
      const allTransitions = agentTaskTransitionsRef.current;
      const currentNodeFromInstanceRaw = getRecordValue(instance, ['CurrentNodeKey', 'currentNodeKey']);
      const currentNodeFromInstance = isRecord(currentNodeFromInstanceRaw)
        ? (currentNodeFromInstanceRaw as Record<string, unknown>)
        : null;
      const currentNodeId =
        entityRecordId(currentNodeFromInstance) ||
        getRecordStringValue(instance, ['CurrentNodeId', 'currentNodeId']) ||
        null;
      const currentNode =
        (currentNodeId ? (nodeById.get(currentNodeId.toUpperCase()) ?? null) : null) ??
        currentNodeFromInstance;
      const currentNodeLabel =
        entityAsString(currentNode?.Label) ||
        entityAsString(currentNode?.label) ||
        getRecordStringValue(instance, ['CurrentStatusLabel', 'currentStatusLabel']) ||
        'Not Initialized';
      const currentNodeDescription =
        entityAsString(currentNode?.Description) ||
        entityAsString(currentNode?.description) ||
        '';
      const instanceId = instance ? entityRecordId(instance) : null;
      const flowDefinitionId = instance
        ? getRecordRelatedId(instance, ['FlowDefinition', 'flowDefinition'])
        : null;
      const taskType = getAgentTaskType(taskRecord);
      const sectionOrder = getSectionOrderForTask(taskRecord);
      const summaryText = entityAsString(taskRecord.SummaryText) || entityAsString(taskRecord.summaryText);
      const confidenceValue =
        typeof taskRecord.Confidence === 'number'
          ? taskRecord.Confidence
          : typeof taskRecord.confidence === 'number'
            ? taskRecord.confidence
            : null;
      const feedback = entityAsString(taskRecord.Feedback) || entityAsString(taskRecord.feedback);
      const followupQuestionsRaw =
        entityAsString(taskRecord.AgentFollowupQuestions) ||
        entityAsString(taskRecord.agentFollowupQuestions);
      const updatedAtRaw =
        getRecordStringValue(instance, ['UpdateTime', 'updateTime', 'UpdatedTime', 'updatedTime']) ||
        getRecordStringValue(taskRecord, ['UpdateTime', 'updateTime']) ||
        getRecordStringValue(taskRecord, ['CreateTime', 'createTime']);
      const status = getAgentTaskStatus(instance, currentNode);

      const availableNextNodes: Array<{ nodeId: string; label: string }> = [];
      if (currentNodeId && flowDefinitionId) {
        const nextNodeById = new Map<string, { nodeId: string; label: string }>();
        for (const transition of allTransitions) {
          if (
            !entitySameId(
              getRecordRelatedId(transition, ['FlowDefinition', 'flowDefinition']),
              flowDefinitionId,
            )
          ) {
            continue;
          }

          const fromNodeId = getRecordRelatedId(transition, ['FromNode', 'fromNode']);
          const toNodeId = getRecordRelatedId(transition, ['ToNode', 'toNode']);
          if (!fromNodeId || !toNodeId) {
            continue;
          }

          if (entitySameId(fromNodeId, currentNodeId)) {
            nextNodeById.set(toNodeId.toUpperCase(), {
              nodeId: toNodeId,
              label: entityAsString(nodeById.get(toNodeId.toUpperCase())?.Label) || toNodeId,
            });
            continue;
          }

          if (
            (transition.Bidirectional === true || transition.bidirectional === true) &&
            entitySameId(toNodeId, currentNodeId)
          ) {
            nextNodeById.set(fromNodeId.toUpperCase(), {
              nodeId: fromNodeId,
              label: entityAsString(nodeById.get(fromNodeId.toUpperCase())?.Label) || fromNodeId,
            });
          }
        }

        for (const nextNode of nextNodeById.values()) {
          availableNextNodes.push(nextNode);
        }
      }

      return {
        id: taskId,
        name: getAgentTaskDisplayName(taskRecord),
        taskType,
        currentNodeId,
        currentNodeLabel,
        currentNodeDescription,
        status,
        visualState: getAgentTaskVisualState(status, currentNodeLabel),
        instanceId,
        flowDefinitionId,
        summaryText,
        confidence: confidenceValue,
        feedback,
        followupQuestionsRaw,
        sectionOrder,
        availableNextNodes,
        updatedAt: formatUpdatedAt(updatedAtRaw),
        updatedAtRaw,
      };
    },
  );

  const appendConnectionDiagnostic = useEffectEvent(
    (event: string, detail?: unknown, level: ConnectionDiagnosticLevel = 'info') => {
      const entry: ConnectionDiagnosticEntry = {
        timestamp: new Date().toISOString(),
        level,
        event,
        detail,
      };

      setConnectionDiagnostics((current) => [entry, ...current].slice(0, MAX_CONNECTION_DIAGNOSTICS));

      if (level === 'error') {
        console.error('[underwriting-client]', event, detail);
      } else if (level === 'warn') {
        console.warn('[underwriting-client]', event, detail);
      } else {
        console.info('[underwriting-client]', event, detail);
      }
    },
  );

  const appendVerboseSocketLog = useEffectEvent((event: string, detail?: unknown) => {
    if (!VERBOSE_SOCKET_EVENT_LOGS) {
      return;
    }

    const timestamp = new Date().toISOString();
    console.info('[underwriting-client][ws-debug]', timestamp, event, detail);
  });

  const reportCoordinatorError = useEffectEvent((summary: string, detail?: unknown) => {
    setCoordinatorError(summary);
    appendConnectionDiagnostic('coordinator.error', { summary, detail }, 'error');
  });

  const clearCoordinatorError = useEffectEvent((context?: string) => {
    setCoordinatorError(null);
    setShowCoordinatorErrorDetails(false);
    if (context) {
      appendConnectionDiagnostic('coordinator.error.cleared', { context });
    }
  });

  useEffect(() => {
    if (!isResizingPanels) {
      return;
    }

    function onPointerMove(event: MouseEvent) {
      const container = workspaceSplitRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) {
        return;
      }

      const percent = ((event.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.max(MIN_TOP_PANEL_PERCENT, Math.min(MAX_TOP_PANEL_PERCENT, percent));
      setTopPanelPercent(clamped);
    }

    function onPointerUp() {
      setIsResizingPanels(false);
    }

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
    };
  }, [isResizingPanels]);

  const sendMessage = useEffectEvent((payload: object): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendVerboseSocketLog('ws.send.skipped.not_open', {
        readyState: socket ? socketReadyStateLabel(socket.readyState) : 'NO_SOCKET',
        payloadPreview: safeDebugPreview(payload),
      });
      return false;
    }

    appendVerboseSocketLog('ws.send', {
      readyState: socketReadyStateLabel(socket.readyState),
      payloadPreview: safeDebugPreview(payload),
    });
    socket.send(JSON.stringify(payload));
    return true;
  });

  const rejectSocketReadyWaiters = useEffectEvent((message: string) => {
    const waiters = socketReadyWaitersRef.current.splice(0);
    for (const waiter of waiters) {
      waiter.reject(new Error(message));
    }
  });

  const rejectAllPendingRequests = useEffectEvent((message: string) => {
    for (const pending of pendingCommandsRef.current.values()) {
      pending.reject(new Error(message));
    }
    pendingCommandsRef.current.clear();

    for (const pending of pendingEventsRef.current.values()) {
      pending.reject(new Error(message));
    }
    pendingEventsRef.current.clear();

    for (const pending of pendingStatusTransitionsRef.current.values()) {
      pending.reject(new Error(message));
    }
    pendingStatusTransitionsRef.current.clear();

    for (const pending of pendingFlowSnapshotsRef.current.values()) {
      pending.reject(new Error(message));
    }
    pendingFlowSnapshotsRef.current.clear();

    for (const pending of pendingAgentTaskSnapshotsRef.current.values()) {
      pending.reject(new Error(message));
    }
    pendingAgentTaskSnapshotsRef.current.clear();

    rejectSocketReadyWaiters(message);
  });

  const resolveSocketReadyWaiters = useEffectEvent(() => {
    const waiters = socketReadyWaitersRef.current.splice(0);
    for (const waiter of waiters) {
      waiter.resolve();
    }
  });

  const waitForSocketOpen = useEffectEvent(
    () =>
      new Promise<void>((resolve, reject) => {
        if (shuttingDownRef.current) {
          reject(new Error('WebSocket is not connected'));
          return;
        }

        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }

        socketReadyWaitersRef.current.push({ resolve, reject });
      }),
  );

  const sendMessageWhenConnected = useEffectEvent(async (payload: object): Promise<void> => {
    while (true) {
      if (shuttingDownRef.current) {
        throw new Error('WebSocket is not connected');
      }

      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          appendVerboseSocketLog('ws.send.connected', {
            payloadPreview: safeDebugPreview(payload),
          });
          socket.send(JSON.stringify(payload));
          return;
        } catch {
          appendVerboseSocketLog('ws.send.connected.failed_retry', {
            payloadPreview: safeDebugPreview(payload),
          });
          // Socket may close between OPEN check and send; wait for reconnect and retry.
        }
      }

      appendVerboseSocketLog('ws.send.wait_for_open', {
        payloadPreview: safeDebugPreview(payload),
      });
      await waitForSocketOpen();
    }
  });

  const requestCommand = useEffectEvent(
    (payload: CommandRequest): Promise<CommandResultMessage> =>
      new Promise((resolve, reject) => {
        const correlationId = crypto.randomUUID();
        appendVerboseSocketLog('command.request.queued', {
          correlationId,
          command: payload.command,
          entityTypeName: payload.entityTypeName ?? null,
          entityId: payload.entityId ?? payload.recordId ?? null,
        });
        pendingCommandsRef.current.set(correlationId, { resolve, reject });

        void sendMessageWhenConnected({
          type: 'command',
          correlationId,
          ...payload,
        }).catch((error) => {
          pendingCommandsRef.current.delete(correlationId);
          reject(error instanceof Error ? error : new Error('WebSocket is not connected'));
        });
      }),
  );

  const requestEvent = useEffectEvent(
    (eventPayload: {
      entityId: string;
      entityTypeName: string;
      changedAt: string;
      changeType?: 'CREATED' | 'UPDATED' | 'DELETED';
      source?: string;
      payload?: unknown;
      correlationId?: string;
    }): Promise<EventResultMessage> =>
      new Promise((resolve, reject) => {
        const correlationId = crypto.randomUUID();
        appendVerboseSocketLog('event.request.queued', {
          correlationId,
          entityTypeName: eventPayload.entityTypeName,
          entityId: eventPayload.entityId,
          changeType: eventPayload.changeType ?? 'UPDATED',
        });
        pendingEventsRef.current.set(correlationId, { resolve, reject });

        void sendMessageWhenConnected({
          type: 'event_request',
          correlationId,
          event: eventPayload,
        }).catch((error) => {
          pendingEventsRef.current.delete(correlationId);
          reject(error instanceof Error ? error : new Error('WebSocket is not connected'));
        });
      }),
  );

  const requestStatusTransition = useEffectEvent(
    (requestPayload: {
      recordId: string;
      targetNodeId: string;
      entityName?: string;
      RecordId?: string;
      NewStatusId?: string;
    }): Promise<StatusTransitionResultMessage> =>
      new Promise((resolve, reject) => {
        const correlationId = crypto.randomUUID();
        appendVerboseSocketLog('status.transition.request.queued', {
          correlationId,
          recordId: requestPayload.recordId ?? requestPayload.RecordId ?? null,
          targetNodeId: requestPayload.targetNodeId ?? requestPayload.NewStatusId ?? null,
          entityName: requestPayload.entityName ?? null,
        });
        pendingStatusTransitionsRef.current.set(correlationId, { resolve, reject });

        void sendMessageWhenConnected({
          type: 'status_transition_request',
          correlationId,
          request: requestPayload,
        }).catch((error) => {
          pendingStatusTransitionsRef.current.delete(correlationId);
          reject(error instanceof Error ? error : new Error('WebSocket is not connected'));
        });
      }),
  );

  const requestFlowSnapshot = useEffectEvent(
    (requestPayload: {
      recordId: string;
      entityTypeName?: string;
    }): Promise<FlowSnapshotResultMessage> =>
      new Promise((resolve, reject) => {
        const correlationId = crypto.randomUUID();
        appendVerboseSocketLog('flow.snapshot.request.queued', {
          correlationId,
          recordId: requestPayload.recordId,
          entityTypeName: requestPayload.entityTypeName ?? null,
        });
        pendingFlowSnapshotsRef.current.set(correlationId, { resolve, reject });

        void sendMessageWhenConnected({
          type: 'flow_snapshot_request',
          correlationId,
          ...requestPayload,
        }).catch((error) => {
          pendingFlowSnapshotsRef.current.delete(correlationId);
          reject(error instanceof Error ? error : new Error('WebSocket is not connected'));
        });
      }),
  );

  const requestAgentTaskSnapshot = useEffectEvent(
    (requestPayload: { loanRecordId: string }): Promise<AgentTaskSnapshotResultMessage> =>
      new Promise((resolve, reject) => {
        const correlationId = crypto.randomUUID();
        appendVerboseSocketLog('agent.task.snapshot.request.queued', {
          correlationId,
          loanRecordId: requestPayload.loanRecordId,
        });
        pendingAgentTaskSnapshotsRef.current.set(correlationId, { resolve, reject });

        void sendMessageWhenConnected({
          type: 'agent_task_snapshot_request',
          correlationId,
          ...requestPayload,
        }).catch((error) => {
          pendingAgentTaskSnapshotsRef.current.delete(correlationId);
          reject(error instanceof Error ? error : new Error('WebSocket is not connected'));
        });
      }),
  );

  const subscribeToEntities = useEffectEvent(() => {
    sendMessage({
      type: 'unsubscribe',
    });

    sendMessage({
      type: 'subscribe',
      subscriptions: [
        { entityTypeName: LOAN_ENTITY },
        { entityTypeName: AGENT_TASK_ENTITY },
        { entityTypeName: FLOW_ENTITY },
        { entityTypeName: NODE_ENTITY },
        { entityTypeName: TRANSITION_ENTITY },
        { entityTypeName: INSTANCE_ENTITY },
        { entityTypeName: HISTORY_ENTITY },
      ],
    });
  });

  const loadLoans = useEffectEvent(async (reason: string) => {
    if (loansLoadInFlightRef.current) {
      queuedLoansReloadRef.current = true;
      appendConnectionDiagnostic(
        'loans.load.skipped_inflight',
        {
          reason,
        },
        'warn',
      );
      return;
    }

    loansLoadInFlightRef.current = true;

    try {
      setIsLoansLoading(true);
      appendConnectionDiagnostic('loans.load.started', {
        reason,
        connectionState,
      });

      const [loansResponse, instancesResponse] = await Promise.all([
        requestCommand({
          command: 'GET_MANY',
          entityTypeName: LOAN_ENTITY,
          options: {
            limit: 5000,
            expansionLevel: 2,
          },
        }),
        requestCommand({
          command: 'GET_MANY',
          entityTypeName: INSTANCE_ENTITY,
          options: {
            limit: 5000,
            expansionLevel: 2,
          },
        }),
      ]);

      if (!loansResponse.ok) {
        throw new Error(loansResponse.error ?? 'Failed to load loans');
      }

      if (!instancesResponse.ok) {
        throw new Error(instancesResponse.error ?? 'Failed to load status instances');
      }

      const loanRecords = extractEntityRecords(loansResponse.data);
      const allInstances = extractEntityRecords(instancesResponse.data).filter((record) =>
        normalizeEntityName(
          getRecordStringValue(record, ['TargetEntityType', 'targetEntityType']),
        ) === normalizeEntityName(LOAN_ENTITY),
      );

      const latestInstanceByLoanId = new Map<string, Record<string, unknown>>();
      for (const instance of allInstances) {
        const targetRecordId = getRecordStringValue(instance, ['TargetRecordId', 'targetRecordId']);
        if (!targetRecordId) {
          continue;
        }

        const existing = latestInstanceByLoanId.get(targetRecordId);
        if (!existing) {
          latestInstanceByLoanId.set(targetRecordId, instance);
          continue;
        }

        const existingTime = Date.parse(
          getRecordStringValue(existing, ['UpdateTime', 'updateTime', 'UpdatedTime', 'updatedTime']),
        );
        const nextTime = Date.parse(
          getRecordStringValue(instance, ['UpdateTime', 'updateTime', 'UpdatedTime', 'updatedTime']),
        );
        const existingMillis = Number.isFinite(existingTime) ? existingTime : 0;
        const nextMillis = Number.isFinite(nextTime) ? nextTime : 0;
        if (nextMillis >= existingMillis) {
          latestInstanceByLoanId.set(targetRecordId, instance);
        }
      }

      const nextLoanInstanceIdByLoanId = new Map<string, string>();
      const nextLoanIdByInstanceId = new Map<string, string>();
      for (const [loanId, instance] of latestInstanceByLoanId.entries()) {
        const instanceId = entityRecordId(instance);
        if (!instanceId) {
          continue;
        }

        nextLoanInstanceIdByLoanId.set(loanId.toUpperCase(), instanceId);
        nextLoanIdByInstanceId.set(instanceId.toUpperCase(), loanId);
      }
      loanInstanceIdByLoanIdRef.current = nextLoanInstanceIdByLoanId;
      loanIdByInstanceIdRef.current = nextLoanIdByInstanceId;

      const nextLoans = loanRecords
        .map((record) => {
          const loanId = entityRecordId(record);
          if (!loanId) {
            return null;
          }

          const linkedInstance = latestInstanceByLoanId.get(loanId);
          const stageLabel =
            getRecordStringValue(linkedInstance, ['CurrentStatusLabel', 'currentStatusLabel']) ||
            entityAsString(
              (
                getRecordValue(linkedInstance, ['CurrentNodeKey', 'currentNodeKey']) as
                  | Record<string, unknown>
                  | undefined
              )?.Label,
            ) ||
            'Not Initialized';
          const updatedAtRaw =
            getRecordStringValue(record, ['UpdateTime', 'updateTime']) ||
            getRecordStringValue(record, ['CreateTime', 'createTime']) ||
            getRecordStringValue(linkedInstance, ['UpdateTime', 'updateTime', 'UpdatedTime', 'updatedTime']);

          return {
            id: loanId,
            name: getLoanDisplayName(record, loanId),
            stage: stageLabel,
            taskFlowsInitialized: entityAsBoolean(record.TaskFlowsInitialized ?? record.taskFlowsInitialized),
            updatedAt: formatUpdatedAt(updatedAtRaw),
            updatedAtRaw,
          } satisfies LoanCardModel;
        })
        .filter((loan): loan is LoanCardModel => loan !== null)
        .sort((left, right) => {
          const leftTime = Date.parse(left.updatedAtRaw);
          const rightTime = Date.parse(right.updatedAtRaw);
          return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        });

      setLoans(nextLoans);
      setSelectedLoanId((current) => {
        if (current && nextLoans.some((loan) => loan.id === current)) {
          return current;
        }

        return nextLoans[0]?.id ?? '';
      });

      clearCoordinatorError('loans.load.succeeded');
      appendConnectionDiagnostic('loans.load.succeeded', {
        reason,
        count: nextLoans.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load loans';
      reportCoordinatorError(message, { scope: 'loadLoans', reason });
    } finally {
      loansLoadInFlightRef.current = false;
      setIsLoansLoading(false);

      if (queuedLoansReloadRef.current) {
        queuedLoansReloadRef.current = false;
        appendConnectionDiagnostic('loans.load.run_queued_refresh');
        void loadLoans('queued_refresh');
      }
    }
  });

  const upsertLoanCard = useEffectEvent((nextLoan: LoanCardModel, context: string) => {
    setLoans((current) => {
      const next = [...current];
      const existingIndex = next.findIndex((loan) => entitySameId(loan.id, nextLoan.id));
      if (existingIndex >= 0) {
        next[existingIndex] = nextLoan;
      } else {
        next.push(nextLoan);
      }

      next.sort((left, right) => {
        const leftTime = Date.parse(left.updatedAtRaw);
        const rightTime = Date.parse(right.updatedAtRaw);
        const millisSort = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        if (millisSort !== 0) {
          return millisSort;
        }

        return left.name.localeCompare(right.name);
      });
      return next;
    });

    setSelectedLoanId((current) => current || nextLoan.id);
    appendConnectionDiagnostic('loan.card.upserted', { context, loanId: nextLoan.id, stage: nextLoan.stage });
  });

  const removeLoanCard = useEffectEvent((loanId: string, context: string) => {
    setLoans((current) => current.filter((loan) => !entitySameId(loan.id, loanId)));
    setSelectedLoanId((current) => (entitySameId(current, loanId) ? '' : current));
    setReviewStartedLoanIds((current) => current.filter((id) => !entitySameId(id, loanId)));

    if (entitySameId(selectedLoanId, loanId)) {
      setLoanStatusGraph(null);
      setAgentTaskStatuses([]);
      setAgentTasksError(null);
      setEditorDraftByTaskId({});
      setCommentsByTaskId({});
      setGeneralFeedbackByTaskId({});
      setFollowupAnswersByTaskId({});
      setReviewEditsByTaskId({});
      setPendingComment(null);
      setPendingCommentText('');
      setActiveMemoTaskId(null);
      setScreen('loan_board');
    }

    appendConnectionDiagnostic('loan.card.removed', { context, loanId }, 'warn');
  });

  const findLatestLoanInstance = useEffectEvent(async (loanId: string): Promise<Record<string, unknown> | null> => {
    const instancesResponse = await requestCommand({
      command: 'GET_MANY',
      entityTypeName: INSTANCE_ENTITY,
      options: {
        limit: 5000,
        expansionLevel: 2,
      },
    });

    if (!instancesResponse.ok) {
      throw new Error(instancesResponse.error ?? 'Failed to load status instances');
    }

    const allLoanInstances = extractEntityRecords(instancesResponse.data).filter(
      (record) =>
        normalizeEntityName(getRecordStringValue(record, ['TargetEntityType', 'targetEntityType'])) ===
        normalizeEntityName(LOAN_ENTITY),
    );
    const matches = allLoanInstances.filter((record) =>
      entitySameId(getRecordStringValue(record, ['TargetRecordId', 'targetRecordId']), loanId),
    );
    if (matches.length === 0) {
      return null;
    }

    matches.sort((left, right) => {
      const leftTime = Date.parse(
        getRecordStringValue(left, ['UpdateTime', 'updateTime', 'UpdatedTime', 'updatedTime']),
      );
      const rightTime = Date.parse(
        getRecordStringValue(right, ['UpdateTime', 'updateTime', 'UpdatedTime', 'updatedTime']),
      );
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });

    return matches[0] ?? null;
  });

  const resolveInstanceTargetContext = useEffectEvent(
    async (instanceId: string): Promise<{ targetEntityType: string; targetRecordId: string } | null> => {
      if (!instanceId) {
        return null;
      }

      const knownLoanId = loanIdByInstanceIdRef.current.get(instanceId.toUpperCase());
      if (knownLoanId) {
        return {
          targetEntityType: LOAN_ENTITY,
          targetRecordId: knownLoanId,
        };
      }

      const instanceResponse = await requestCommand({
        command: 'GET',
        entityTypeName: INSTANCE_ENTITY,
        recordId: instanceId,
        options: {
          expansionLevel: 2,
        },
      });

      if (!instanceResponse.ok || !isRecord(instanceResponse.data)) {
        return null;
      }

      const instanceRecord = instanceResponse.data;
      const targetEntityType = getRecordStringValue(instanceRecord, ['TargetEntityType', 'targetEntityType']);
      const targetRecordId = getRecordStringValue(instanceRecord, ['TargetRecordId', 'targetRecordId']);
      if (!targetEntityType || !targetRecordId) {
        return null;
      }

      if (normalizeEntityName(targetEntityType) === normalizeEntityName(LOAN_ENTITY)) {
        loanIdByInstanceIdRef.current.set(instanceId.toUpperCase(), targetRecordId);
        loanInstanceIdByLoanIdRef.current.set(targetRecordId.toUpperCase(), instanceId);
      }

      return {
        targetEntityType,
        targetRecordId,
      };
    },
  );

  const refreshSingleLoanCard = useEffectEvent(
    async (loanId: string, context: string, knownInstanceId?: string | null) => {
      if (!loanId) {
        return;
      }

      const loanResponse = await requestCommand({
        command: 'GET',
        entityTypeName: LOAN_ENTITY,
        recordId: loanId,
        options: {
          expansionLevel: 2,
        },
      });

      if (!loanResponse.ok || !isRecord(loanResponse.data)) {
        removeLoanCard(loanId, `${context}:missing_record`);
        return;
      }

      const loanRecord = loanResponse.data;

      let linkedInstance: Record<string, unknown> | null = null;
      if (knownInstanceId) {
        const contextResult = await resolveInstanceTargetContext(knownInstanceId);
        if (
          contextResult &&
          normalizeEntityName(contextResult.targetEntityType) === normalizeEntityName(LOAN_ENTITY) &&
          entitySameId(contextResult.targetRecordId, loanId)
        ) {
          const instanceResponse = await requestCommand({
            command: 'GET',
            entityTypeName: INSTANCE_ENTITY,
            recordId: knownInstanceId,
            options: {
              expansionLevel: 2,
            },
          });

          if (instanceResponse.ok && isRecord(instanceResponse.data)) {
            linkedInstance = instanceResponse.data;
          }
        }
      }

      if (!linkedInstance) {
        const mappedInstanceId = loanInstanceIdByLoanIdRef.current.get(loanId.toUpperCase());
        if (mappedInstanceId) {
          const instanceResponse = await requestCommand({
            command: 'GET',
            entityTypeName: INSTANCE_ENTITY,
            recordId: mappedInstanceId,
            options: {
              expansionLevel: 2,
            },
          });

          if (
            instanceResponse.ok &&
            isRecord(instanceResponse.data) &&
            entitySameId(
              getRecordStringValue(instanceResponse.data, ['TargetRecordId', 'targetRecordId']),
              loanId,
            )
          ) {
            linkedInstance = instanceResponse.data;
          }
        }
      }

      if (!linkedInstance) {
        linkedInstance = await findLatestLoanInstance(loanId);
      }

      const instanceId = linkedInstance ? entityRecordId(linkedInstance) : null;
      if (instanceId) {
        loanInstanceIdByLoanIdRef.current.set(loanId.toUpperCase(), instanceId);
        loanIdByInstanceIdRef.current.set(instanceId.toUpperCase(), loanId);
      }

      const stageLabel =
        getRecordStringValue(linkedInstance, ['CurrentStatusLabel', 'currentStatusLabel']) ||
        entityAsString(
          (
            getRecordValue(linkedInstance, ['CurrentNodeKey', 'currentNodeKey']) as
              | Record<string, unknown>
              | undefined
          )?.Label,
        ) ||
        'Not Initialized';
      const updatedAtRaw =
        getRecordStringValue(loanRecord, ['UpdateTime', 'updateTime']) ||
        getRecordStringValue(loanRecord, ['CreateTime', 'createTime']) ||
        getRecordStringValue(linkedInstance, ['UpdateTime', 'updateTime', 'UpdatedTime', 'updatedTime']);

      upsertLoanCard(
        {
          id: entityRecordId(loanRecord) || loanId,
          name: getLoanDisplayName(loanRecord, loanId),
          stage: stageLabel,
          taskFlowsInitialized: entityAsBoolean(
            loanRecord.TaskFlowsInitialized ?? loanRecord.taskFlowsInitialized,
          ),
          updatedAt: formatUpdatedAt(updatedAtRaw),
          updatedAtRaw,
        },
        context,
      );
    },
  );

  const loadLoanStatusFlow = useEffectEvent(async (loanRecordId: string, options?: LoanFlowLoadOptions) => {
    if (!loanRecordId) {
      setLoanStatusGraph(null);
      return;
    }

    const isSilent = options?.silent === true;
    const useIncrementalMerge = options?.incremental === true;
    const reason = options?.reason ?? 'default';

    if (flowLoadInFlightRef.current) {
      queuedFlowReloadLoanIdRef.current = {
        loanId: loanRecordId,
        options,
      };
      appendConnectionDiagnostic(
        'loan.flow.load.skipped_inflight',
        { loanRecordId, reason },
        'warn',
      );
      return;
    }

    flowLoadInFlightRef.current = true;

    try {
      if (!isSilent) {
        setLoanFlowLoading(true);
      }
      setLoanFlowError(null);
      appendConnectionDiagnostic('loan.flow.load.started', { loanRecordId, reason, isSilent });
      const snapshotResponse = await requestFlowSnapshot({
        recordId: loanRecordId,
        entityTypeName: LOAN_ENTITY,
      });
      if (!snapshotResponse.ok || !isRecord(snapshotResponse.data)) {
        throw new Error(snapshotResponse.error ?? 'Failed to load flow snapshot');
      }

      const snapshot = snapshotResponse.data;
      const activeDefinition = isRecord(snapshot.flowDefinition) ? snapshot.flowDefinition : null;
      const flowNodes = extractEntityRecords(snapshot.nodes);
      const flowTransitions = extractEntityRecords(snapshot.transitions);
      const matchingInstance = isRecord(snapshot.instance) ? snapshot.instance : null;
      const historyForInstance = extractEntityRecords(snapshot.historyForInstance);

      if (!activeDefinition) {
        if (!isSilent) {
          setLoanStatusGraph(null);
        }
        setLoanFlowError('No StreamPath workflow definition found for E2ELoan.');
        appendConnectionDiagnostic(
          'loan.flow.load.missing_definition',
          {
            loanRecordId,
            loanEntityType: LOAN_ENTITY,
            definitionsLoaded: 0,
          },
          'warn',
        );
        return;
      }

      const graph = buildLoanStatusGraphFromStreamPath({
        flowDefinition: activeDefinition,
        nodes: flowNodes,
        transitions: flowTransitions,
        instance: matchingInstance ?? null,
        historyForInstance,
      });

      if (useIncrementalMerge) {
        setLoanStatusGraph((current) => mergeLoanGraphForIncrementalRefresh(current, graph));
      } else {
        setLoanStatusGraph(graph);
      }
      setLoans((current) =>
        current.map((loan) =>
          entitySameId(loan.id, loanRecordId)
            ? {
                ...loan,
                stage: graph.currentStatusLabel ?? 'Not Initialized',
              }
            : loan,
        ),
      );

      if (!matchingInstance) {
        setLoanFlowError('No status instance found yet for this loan. Initialize workflow from coordinator.');
        appendConnectionDiagnostic('loan.flow.load.missing_instance', { loanRecordId }, 'warn');
      } else {
        const instanceId = entityRecordId(matchingInstance);
        if (instanceId) {
          loanInstanceIdByLoanIdRef.current.set(loanRecordId.toUpperCase(), instanceId);
          loanIdByInstanceIdRef.current.set(instanceId.toUpperCase(), loanRecordId);
        }
        appendConnectionDiagnostic('loan.flow.load.succeeded', {
          loanRecordId,
          flowName: graph.flowName,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          currentStatusLabel: graph.currentStatusLabel,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load StreamPath flow data';
      setLoanFlowError(message);
      if (!isSilent) {
        setLoanStatusGraph(null);
      }
      reportCoordinatorError(message, { scope: 'loadLoanStatusFlow', loanRecordId });
    } finally {
      flowLoadInFlightRef.current = false;
      if (!isSilent) {
        setLoanFlowLoading(false);
      }

      const queued = queuedFlowReloadLoanIdRef.current;
      if (queued) {
        queuedFlowReloadLoanIdRef.current = null;
        appendConnectionDiagnostic('loan.flow.load.run_queued_refresh', {
          loanRecordId: queued.loanId,
        });
        void loadLoanStatusFlow(queued.loanId, queued.options);
      }
    }
  });

  const loadAgentTaskStatuses = useEffectEvent(async (loanRecordId: string) => {
    if (!loanRecordId) {
      setAgentTaskStatuses([]);
      setAgentTasksLoading(false);
      setAgentTasksError(null);
      return;
    }

    if (agentTaskLoadInFlightRef.current) {
      queuedAgentTaskReloadLoanIdRef.current = loanRecordId;
      appendConnectionDiagnostic('agent.tasks.load.skipped_inflight', { loanRecordId }, 'warn');
      return;
    }

    agentTaskLoadInFlightRef.current = true;

    try {
      setAgentTasksLoading(true);
      setAgentTasksError(null);
      appendConnectionDiagnostic('agent.tasks.load.started', { loanRecordId });

      const snapshotResponse = await requestAgentTaskSnapshot({ loanRecordId });
      if (!snapshotResponse.ok || !isRecord(snapshotResponse.data)) {
        throw new Error(snapshotResponse.error ?? 'Failed to load agent task snapshot');
      }

      const snapshot = snapshotResponse.data;
      const linkedTasks = extractEntityRecords(snapshot.agentTasks);
      const nodes = extractEntityRecords(snapshot.nodes);
      const transitions = extractEntityRecords(snapshot.transitions);
      const latestInstances = extractEntityRecords(snapshot.latestInstances);

      const nodeById = new Map<string, Record<string, unknown>>();
      for (const node of nodes) {
        const nodeId = entityRecordId(node);
        if (nodeId) {
          nodeById.set(nodeId.toUpperCase(), node);
        }
      }
      agentTaskNodesByIdRef.current = nodeById;
      agentTaskTransitionsRef.current = transitions;
      agentTaskMetaLoadedAtRef.current = Date.now();

      const latestInstanceByTaskId = new Map<string, Record<string, unknown>>();
      for (const instance of latestInstances) {
        const targetTaskId = getRecordStringValue(instance, ['TargetRecordId', 'targetRecordId']);
        if (!targetTaskId) {
          continue;
        }
        latestInstanceByTaskId.set(targetTaskId.toUpperCase(), instance);
      }

      const nextStatuses = linkedTasks
        .map((taskRecord) => {
          const taskId = entityRecordId(taskRecord);
          if (!taskId) {
            return null;
          }

          const instance = latestInstanceByTaskId.get(taskId.toUpperCase()) ?? null;
          return buildAgentTaskCardModel(taskRecord, instance);
        })
        .filter((task): task is AgentTaskStatusCardModel => task !== null)
        .sort((left, right) => {
          const leftTime = Date.parse(left.updatedAtRaw);
          const rightTime = Date.parse(right.updatedAtRaw);
          const millisSort = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
          if (millisSort !== 0) {
            return millisSort;
          }

          return left.name.localeCompare(right.name);
        });

      const previousTaskById = new Map(agentTaskStatuses.map((task) => [task.id.toUpperCase(), task]));
      const shouldResetReviewInputs = (task: AgentTaskStatusCardModel): boolean => {
        const previousTask = previousTaskById.get(task.id.toUpperCase());
        const previousVisualState = previousTask?.visualState ?? 'other';
        const currentIsReview = isReviewVisualState(task.visualState);
        const previousIsReview = isReviewVisualState(previousVisualState);
        const enteredReview = currentIsReview && !previousIsReview;
        const switchedReviewStage =
          currentIsReview && previousIsReview && previousVisualState !== task.visualState;
        return enteredReview || switchedReviewStage;
      };

      setAgentTaskStatuses(nextStatuses);
      setEditorDraftByTaskId((current) => {
        const next = { ...current };
        for (const task of nextStatuses) {
          if (shouldResetReviewInputs(task)) {
            next[task.id] = task.summaryText || '';
            continue;
          }
          if (next[task.id] === undefined) {
            next[task.id] = task.summaryText || '';
          }
        }
        for (const taskId of Object.keys(next)) {
          if (!nextStatuses.some((task) => task.id === taskId)) {
            delete next[taskId];
          }
        }
        return next;
      });
      setCommentsByTaskId((current) => {
        const next: Record<string, TextComment[]> = {};
        for (const task of nextStatuses) {
          next[task.id] = shouldResetReviewInputs(task) ? [] : current[task.id] ?? [];
        }
        return next;
      });
      setGeneralFeedbackByTaskId((current) => {
        const next: Record<string, string> = {};
        for (const task of nextStatuses) {
          next[task.id] = shouldResetReviewInputs(task) ? '' : current[task.id] ?? '';
        }
        return next;
      });
      setFollowupAnswersByTaskId((current) => {
        const next: Record<string, Record<string, string>> = {};
        for (const task of nextStatuses) {
          next[task.id] = shouldResetReviewInputs(task) ? {} : current[task.id] ?? {};
        }
        return next;
      });
      setReviewEditsByTaskId((current) => {
        const next: Record<string, boolean> = {};
        for (const task of nextStatuses) {
          next[task.id] = shouldResetReviewInputs(task) ? false : current[task.id] ?? false;
        }
        return next;
      });
      setActiveMemoTaskId((current) => {
        if (current && nextStatuses.some((task) => task.id === current)) {
          return current;
        }

        const reviewTask = nextStatuses.find((task) => isReviewVisualState(task.visualState));
        return reviewTask?.id ?? null;
      });
      appendConnectionDiagnostic('agent.tasks.load.succeeded', {
        loanRecordId,
        count: nextStatuses.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load agent task statuses';
      setAgentTaskStatuses([]);
      setAgentTasksError(message);
      appendConnectionDiagnostic('agent.tasks.load.failed', { loanRecordId, message }, 'error');
    } finally {
      agentTaskLoadInFlightRef.current = false;
      setAgentTasksLoading(false);

      const queuedLoanId = queuedAgentTaskReloadLoanIdRef.current;
      if (queuedLoanId) {
        queuedAgentTaskReloadLoanIdRef.current = null;
        appendConnectionDiagnostic('agent.tasks.load.run_queued_refresh', {
          loanRecordId: queuedLoanId,
        });
        void loadAgentTaskStatuses(queuedLoanId);
      }
    }
  });

  const removeAgentTaskCard = useEffectEvent((taskId: string) => {
    setAgentTaskStatuses((current) => current.filter((task) => !entitySameId(task.id, taskId)));
    setEditorDraftByTaskId((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setCommentsByTaskId((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setGeneralFeedbackByTaskId((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setFollowupAnswersByTaskId((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setReviewEditsByTaskId((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setTaskActionInFlightById((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setActiveMemoTaskId((current) => (entitySameId(current, taskId) ? null : current));
  });

  const resolveTaskIdFromInstanceEvent = useEffectEvent(
    async (payload: EntityChangeMessage): Promise<string | null> => {
      const payloadTaskId = getEventPayloadTaskId(payload.payload);
      if (payloadTaskId && !entitySameId(payloadTaskId, payload.entityId)) {
        return payloadTaskId;
      }

      const instanceId = payload.entityId;
      if (!instanceId) {
        return null;
      }

      const targetContext = await resolveInstanceTargetContext(instanceId);
      if (!targetContext) {
        return null;
      }

      if (
        normalizeEntityName(targetContext.targetEntityType) !==
        normalizeEntityName(AGENT_TASK_ENTITY)
      ) {
        return null;
      }

      return targetContext.targetRecordId;
    },
  );

  const resolveLoanIdFromInstanceEvent = useEffectEvent(
    async (payload: EntityChangeMessage): Promise<string | null> => {
      const instanceId = payload.entityId;
      if (!instanceId) {
        return null;
      }

      const targetContext = await resolveInstanceTargetContext(instanceId);
      if (!targetContext) {
        return null;
      }

      if (
        normalizeEntityName(targetContext.targetEntityType) !==
        normalizeEntityName(LOAN_ENTITY)
      ) {
        return null;
      }

      return targetContext.targetRecordId;
    },
  );

  const resolveLoanIdFromHistoryEvent = useEffectEvent(
    async (payload: EntityChangeMessage): Promise<string | null> => {
      const payloadStatusInstanceId = getEventPayloadStatusInstanceId(payload.payload);
      if (payloadStatusInstanceId) {
        const targetContext = await resolveInstanceTargetContext(payloadStatusInstanceId);
        if (
          targetContext &&
          normalizeEntityName(targetContext.targetEntityType) === normalizeEntityName(LOAN_ENTITY)
        ) {
          return targetContext.targetRecordId;
        }
      }

      const historyId = payload.entityId;
      if (!historyId) {
        return null;
      }

      const historyResponse = await requestCommand({
        command: 'GET',
        entityTypeName: HISTORY_ENTITY,
        recordId: historyId,
        options: {
          expansionLevel: 2,
        },
      });

      if (!historyResponse.ok || !isRecord(historyResponse.data)) {
        return null;
      }

      const statusInstanceId =
        getReferenceId(historyResponse.data.StatusInstance) ||
        entityAsString(historyResponse.data.StatusInstanceId);
      if (!statusInstanceId) {
        return null;
      }

      const targetContext = await resolveInstanceTargetContext(statusInstanceId);
      if (
        !targetContext ||
        normalizeEntityName(targetContext.targetEntityType) !== normalizeEntityName(LOAN_ENTITY)
      ) {
        return null;
      }

      return targetContext.targetRecordId;
    },
  );

  const resolveTaskIdFromHistoryEvent = useEffectEvent(
    async (payload: EntityChangeMessage): Promise<string | null> => {
      const payloadTaskId = getEventPayloadTaskId(payload.payload);
      if (payloadTaskId && !entitySameId(payloadTaskId, payload.entityId)) {
        return payloadTaskId;
      }

      const payloadStatusInstanceId = getEventPayloadStatusInstanceId(payload.payload);
      if (payloadStatusInstanceId) {
        const targetContext = await resolveInstanceTargetContext(payloadStatusInstanceId);
        if (
          targetContext &&
          normalizeEntityName(targetContext.targetEntityType) === normalizeEntityName(AGENT_TASK_ENTITY)
        ) {
          return targetContext.targetRecordId;
        }
      }

      const historyId = payload.entityId;
      if (!historyId) {
        return null;
      }

      const historyResponse = await requestCommand({
        command: 'GET',
        entityTypeName: HISTORY_ENTITY,
        recordId: historyId,
        options: {
          expansionLevel: 2,
        },
      });

      if (!historyResponse.ok || !isRecord(historyResponse.data)) {
        return null;
      }

      const statusInstanceId =
        getReferenceId(historyResponse.data.StatusInstance) ||
        entityAsString(historyResponse.data.StatusInstanceId);
      if (!statusInstanceId) {
        return null;
      }

      const targetContext = await resolveInstanceTargetContext(statusInstanceId);
      if (
        !targetContext ||
        normalizeEntityName(targetContext.targetEntityType) !== normalizeEntityName(AGENT_TASK_ENTITY)
      ) {
        return null;
      }

      return targetContext.targetRecordId;
    },
  );

  const refreshSingleAgentTaskStatus = useEffectEvent(
    async (taskId: string, context: string, _knownInstanceId?: string) => {
      if (!selectedLoanId || !taskId) {
        return;
      }
      await loadAgentTaskStatuses(selectedLoanId);
      appendConnectionDiagnostic('agent.task.refresh.single', {
        context,
        taskId,
        selectedLoanId,
      });
    },
  );

  const handleSocketMessage = useEffectEvent((message: unknown) => {
    if (!isMessageWithType(message)) {
      appendVerboseSocketLog('socket.message.ignored.unknown_shape', {
        payloadPreview: safeDebugPreview(message),
      });
      return;
    }

    appendVerboseSocketLog('socket.message.received', {
      type: message.type,
      payloadPreview: safeDebugPreview(message),
    });

    if (message.type === 'connected') {
      const payload = message as ConnectedMessage;
      clearCoordinatorError('socket.connected_message');
      appendConnectionDiagnostic('socket.connected_message', {
        clientId: payload.clientId,
      });
      return;
    }

    if (message.type === 'error') {
      const payload = message as ErrorMessage;
      reportCoordinatorError(payload.error, { scope: 'socket.message.error' });
      return;
    }

    if (message.type === 'command_result') {
      const payload = message as CommandResultMessage;
      appendVerboseSocketLog('command.result.received', {
        correlationId: payload.correlationId,
        ok: payload.ok,
        command: payload.command,
        entityTypeName: payload.entityTypeName ?? null,
        entityId: payload.entityId ?? null,
        error: payload.error ?? null,
      });
      const pending = pendingCommandsRef.current.get(payload.correlationId);
      if (pending) {
        pendingCommandsRef.current.delete(payload.correlationId);
        pending.resolve(payload);
      }
      return;
    }

    if (message.type === 'event_result') {
      const payload = message as EventResultMessage;
      appendVerboseSocketLog('event.result.received', {
        correlationId: payload.correlationId,
        ok: payload.ok,
        error: payload.error ?? null,
      });
      const pending = pendingEventsRef.current.get(payload.correlationId);
      if (pending) {
        pendingEventsRef.current.delete(payload.correlationId);
        pending.resolve(payload);
      }
      return;
    }

    if (message.type === 'status_transition_result') {
      const payload = message as StatusTransitionResultMessage;
      appendVerboseSocketLog('status.transition.result.received', {
        correlationId: payload.correlationId,
        ok: payload.ok,
        error: payload.error ?? null,
      });
      const pending = pendingStatusTransitionsRef.current.get(payload.correlationId);
      if (pending) {
        pendingStatusTransitionsRef.current.delete(payload.correlationId);
        pending.resolve(payload);
      }
      return;
    }

    if (message.type === 'flow_snapshot_result') {
      const payload = message as FlowSnapshotResultMessage;
      appendVerboseSocketLog('flow.snapshot.result.received', {
        correlationId: payload.correlationId,
        ok: payload.ok,
        error: payload.error ?? null,
      });
      const pending = pendingFlowSnapshotsRef.current.get(payload.correlationId);
      if (pending) {
        pendingFlowSnapshotsRef.current.delete(payload.correlationId);
        pending.resolve(payload);
      }
      return;
    }

    if (message.type === 'agent_task_snapshot_result') {
      const payload = message as AgentTaskSnapshotResultMessage;
      appendVerboseSocketLog('agent.task.snapshot.result.received', {
        correlationId: payload.correlationId,
        ok: payload.ok,
        error: payload.error ?? null,
      });
      const pending = pendingAgentTaskSnapshotsRef.current.get(payload.correlationId);
      if (pending) {
        pendingAgentTaskSnapshotsRef.current.delete(payload.correlationId);
        pending.resolve(payload);
      }
      return;
    }

    if (message.type === 'entity_change') {
      const payload = message as EntityChangeMessage;
      const payloadRecordId = getEventPayloadRecordId(payload.payload);
      const changeType = payload.changeType ?? 'UPDATED';
      appendVerboseSocketLog('entity_change.received', {
        entityTypeName: payload.entityTypeName,
        entityId: payload.entityId,
        payloadRecordId,
        changeType,
        reason: payload.reason,
        source: payload.source,
      });

      if (payload.entityTypeName === LOAN_ENTITY) {
        const loanId = payloadRecordId || payload.entityId;
        if (!loanId) {
          return;
        }

        if (payload.changeType === 'DELETED') {
          removeLoanCard(loanId, `loan_change:${changeType}`);
          return;
        }

        void (async () => {
          try {
            await refreshSingleLoanCard(loanId, `loan_change:${changeType}`);
            if (selectedLoanId && entitySameId(selectedLoanId, loanId)) {
              await loadLoanStatusFlow(selectedLoanId, {
                silent: true,
                incremental: true,
                reason: 'entity_change.loan',
              });
            }
          } catch (error) {
            appendConnectionDiagnostic(
              'loan.refresh.single.failed',
              {
                message: error instanceof Error ? error.message : String(error),
                loanId,
              },
              'warn',
            );
            void loadLoans('entity_change.loan.fallback');
          }
        })();
        return;
      }

      if (payload.entityTypeName === AGENT_TASK_ENTITY) {
        const taskId = payloadRecordId || payload.entityId;
        if (!taskId) {
          return;
        }

        if (!selectedLoanId) {
          return;
        }

        if (payload.changeType === 'DELETED') {
          removeAgentTaskCard(taskId);
          return;
        }

        void refreshSingleAgentTaskStatus(taskId, `entity_change:${changeType}`);
        return;
      }

      if (payload.entityTypeName === INSTANCE_ENTITY) {
        void (async () => {
          try {
            const [loanId, taskId] = await Promise.all([
              resolveLoanIdFromInstanceEvent(payload),
              selectedLoanId ? resolveTaskIdFromInstanceEvent(payload) : Promise.resolve(null),
            ]);

            if (loanId) {
              await refreshSingleLoanCard(loanId, `instance_change:${changeType}`, payload.entityId);
              if (selectedLoanId && entitySameId(selectedLoanId, loanId)) {
                await loadLoanStatusFlow(selectedLoanId, {
                  silent: true,
                  incremental: true,
                  reason: 'entity_change.instance',
                });
              }
            }

            if (selectedLoanId && taskId) {
              await refreshSingleAgentTaskStatus(taskId, `instance_change:${changeType}`, payload.entityId);
            }
          } catch (error) {
            appendConnectionDiagnostic(
              'instance_change.refresh.failed',
              {
                message: error instanceof Error ? error.message : String(error),
                instanceId: payload.entityId,
              },
              'warn',
            );

            if (selectedLoanId) {
              void loadLoanStatusFlow(selectedLoanId, {
                silent: true,
                incremental: true,
                reason: 'entity_change.instance.fallback',
              });
              void loadAgentTaskStatuses(selectedLoanId);
            } else {
              void loadLoans('entity_change.instance.fallback');
            }
          }
        })();
        return;
      }

      if (payload.entityTypeName === HISTORY_ENTITY) {
        if (!selectedLoanId) {
          return;
        }

        void (async () => {
          try {
            const [loanId, taskId] = await Promise.all([
              resolveLoanIdFromHistoryEvent(payload),
              resolveTaskIdFromHistoryEvent(payload),
            ]);

            if (loanId && entitySameId(loanId, selectedLoanId)) {
              await loadLoanStatusFlow(selectedLoanId, {
                silent: true,
                incremental: true,
                reason: 'entity_change.history',
              });
            }

            if (taskId) {
              await refreshSingleAgentTaskStatus(taskId, `history_change:${changeType}`);
            }
          } catch (error) {
            appendConnectionDiagnostic(
              'history_change.refresh.failed',
              {
                message: error instanceof Error ? error.message : String(error),
                historyId: payload.entityId,
              },
              'warn',
            );
            void loadLoanStatusFlow(selectedLoanId, {
              silent: true,
              incremental: true,
              reason: 'entity_change.history.fallback',
            });
            void loadAgentTaskStatuses(selectedLoanId);
          }
        })();
      }
    }
  });

  useEffect(() => {
    shuttingDownRef.current = false;
    const connect = () => {
      if (shuttingDownRef.current) {
        return;
      }

      const existingSocket = socketRef.current;
      if (
        existingSocket &&
        (existingSocket.readyState === WebSocket.CONNECTING || existingSocket.readyState === WebSocket.OPEN)
      ) {
        appendConnectionDiagnostic(
          'socket.connect.skipped_existing',
          { readyState: socketReadyStateLabel(existingSocket.readyState) },
          'warn',
        );
        return;
      }

      setConnectionState('connecting');
      const wsUrl = getCoordinatorWsUrl();
      appendConnectionDiagnostic('socket.connect.attempt', {
        wsUrl,
        httpBaseUrl: getCoordinatorHttpBaseUrl(),
      });

      try {
        const socket = new WebSocket(wsUrl);
        const socketGeneration = socketGenerationRef.current + 1;
        socketGenerationRef.current = socketGeneration;
        socketRef.current = socket;
        const isCurrentSocket = () =>
          socketRef.current === socket && socketGenerationRef.current === socketGeneration;

        socket.onopen = () => {
          if (!isCurrentSocket()) {
            return;
          }

          setConnectionState('connected');
          clearCoordinatorError('socket.onopen');
          resolveSocketReadyWaiters();
          appendConnectionDiagnostic('socket.onopen', {
            wsUrl,
            readyState: socketReadyStateLabel(socket.readyState),
          });
          appendVerboseSocketLog('socket.onopen', {
            wsUrl,
            readyState: socketReadyStateLabel(socket.readyState),
          });
          subscribeToEntities();
          void loadLoans('socket_open');
        };

        socket.onmessage = (event) => {
          if (!isCurrentSocket()) {
            return;
          }

          appendVerboseSocketLog('socket.onmessage.raw', {
            rawPreview: String(event.data).slice(0, 1200),
            readyState: socketReadyStateLabel(socket.readyState),
          });

          try {
            const parsed = JSON.parse(String(event.data)) as unknown;
            handleSocketMessage(parsed);
          } catch {
            reportCoordinatorError('Received invalid websocket payload', {
              scope: 'socket.onmessage.parse',
              wsUrl,
              rawPreview: String(event.data).slice(0, 240),
              readyState: socketReadyStateLabel(socket.readyState),
            });
          }
        };

        socket.onerror = (event) => {
          if (!isCurrentSocket()) {
            return;
          }

          appendConnectionDiagnostic(
            'socket.onerror',
            {
              wsUrl,
              readyState: socketReadyStateLabel(socket.readyState),
              eventType: event.type,
            },
            'warn',
          );
          appendVerboseSocketLog('socket.onerror', {
            wsUrl,
            readyState: socketReadyStateLabel(socket.readyState),
            eventType: event.type,
          });
        };

        socket.onclose = (event) => {
          const currentSocket = isCurrentSocket();
          if (socketRef.current === socket) {
            socketRef.current = null;
          }

          if (!currentSocket) {
            return;
          }

          rejectAllPendingRequests('WebSocket connection closed');
          setConnectionState('disconnected');
          appendConnectionDiagnostic(
            'socket.onclose',
            {
              wsUrl,
              code: event.code,
              reason: event.reason || null,
              wasClean: event.wasClean,
              readyState: socketReadyStateLabel(socket.readyState),
            },
            event.wasClean ? 'info' : 'warn',
          );
          appendVerboseSocketLog('socket.onclose', {
            wsUrl,
            code: event.code,
            reason: event.reason || null,
            wasClean: event.wasClean,
            readyState: socketReadyStateLabel(socket.readyState),
          });

          if (!event.wasClean && !shuttingDownRef.current) {
            reportCoordinatorError(`WebSocket closed (${event.code})`, {
              scope: 'socket.onclose',
              wsUrl,
              code: event.code,
              reason: event.reason || null,
              wasClean: event.wasClean,
            });
          }

          if (!shuttingDownRef.current && reconnectTimeoutRef.current === null) {
            appendConnectionDiagnostic('socket.reconnect.scheduled', {
              delayMs: RECONNECT_DELAY_MS,
            }, 'warn');
            reconnectTimeoutRef.current = window.setTimeout(() => {
              reconnectTimeoutRef.current = null;
              connect();
            }, RECONNECT_DELAY_MS);
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to open websocket';
        reportCoordinatorError(message, { scope: 'socket.connect.catch' });
        setConnectionState('disconnected');

        if (!shuttingDownRef.current && reconnectTimeoutRef.current === null) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connect();
          }, RECONNECT_DELAY_MS);
        }
      }
    };

    connect();

    return () => {
      shuttingDownRef.current = true;
      socketGenerationRef.current += 1;

      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      rejectAllPendingRequests('WebSocket connection closed');

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onSecurityPolicyViolation = (event: SecurityPolicyViolationEvent) => {
      const detail = {
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        columnNumber: event.columnNumber,
        disposition: event.disposition,
      };

      appendConnectionDiagnostic('browser.securitypolicyviolation', detail, 'error');

      const wsUrl = getCoordinatorWsUrl();
      if (
        typeof event.blockedURI === 'string' &&
        (event.blockedURI === wsUrl || event.blockedURI.includes('ngrok-free.dev'))
      ) {
        reportCoordinatorError('Browser CSP blocked coordinator connection', detail);
      }
    };

    window.addEventListener('securitypolicyviolation', onSecurityPolicyViolation);

    return () => {
      window.removeEventListener('securitypolicyviolation', onSecurityPolicyViolation);
    };
  }, []);

  useEffect(() => {
    if (!selectedLoanId) {
      setLoanStatusGraph(null);
      setAgentTaskStatuses([]);
      setAgentTasksError(null);
      setEditorDraftByTaskId({});
      setCommentsByTaskId({});
      setGeneralFeedbackByTaskId({});
      setFollowupAnswersByTaskId({});
      setReviewEditsByTaskId({});
      setPendingComment(null);
      setPendingCommentText('');
      setActiveMemoTaskId(null);
      return;
    }

    void loadLoanStatusFlow(selectedLoanId);
    void loadAgentTaskStatuses(selectedLoanId);
  }, [selectedLoanId]);

  function openLoanWorkspace(loanId: string) {
    setSelectedLoanId(loanId);
    setScreen('loan_workspace');
    void loadLoanStatusFlow(loanId);
    void loadAgentTaskStatuses(loanId);
  }

  async function createNewLoan() {
    try {
      const friendlyLoanName = getNextFriendlyLoanName(loans);

      const result = await requestCommand({
        command: 'CREATE',
        entityTypeName: LOAN_ENTITY,
        data: {
          Name: friendlyLoanName,
        },
        options: {
          expansionLevel: 2,
        },
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'Create loan failed');
      }

      const created = isRecord(result.data) ? result.data : null;
      const recordId = entityRecordId(created);
      if (!recordId) {
        throw new Error('Create loan returned no Id');
      }

      const eventResponse = await requestEvent({
          entityId: recordId,
          entityTypeName: LOAN_ENTITY,
          changedAt: new Date().toISOString(),
          changeType: 'CREATED',
          source: 'credit_underwriting_client',
          payload: {
            RecordId: recordId,
          },
      });

      if (!eventResponse.ok) {
        throw new Error(eventResponse.error ?? 'Loan init event failed');
      }

      await loadLoans('loan_created');
      setSelectedLoanId(recordId);
      setScreen('loan_workspace');
      await loadLoanStatusFlow(recordId);
      appendConnectionDiagnostic('loan.create.succeeded', { recordId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create loan';
      reportCoordinatorError(message, { scope: 'createNewLoan' });
    }
  }

  async function deleteLoanCascade(loan: LoanCardModel) {
    if (deletingLoanId) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${loan.name}?\n\nThis will delete linked agent tasks, then the loan, then its workflow instances/history.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingLoanId(loan.id);

    try {
      appendConnectionDiagnostic('loan.delete.started', { loanId: loan.id, loanName: loan.name }, 'warn');

      const agentTasksResponse = await requestCommand({
        command: 'GET_MANY',
        entityTypeName: AGENT_TASK_ENTITY,
        options: {
          limit: 5000,
          expansionLevel: 2,
        },
      });

      if (!agentTasksResponse.ok) {
        throw new Error(agentTasksResponse.error ?? 'Failed to load agent tasks for deletion');
      }

      const linkedAgentTaskIds = extractEntityRecords(agentTasksResponse.data)
        .filter((record) => entitySameId(getAgentTaskLoanId(record), loan.id))
        .map((record) => entityRecordId(record))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      for (const taskId of linkedAgentTaskIds) {
        const deleteTaskResult = await requestCommand({
          command: 'DELETE',
          entityTypeName: AGENT_TASK_ENTITY,
          recordId: taskId,
        });

        if (!deleteTaskResult.ok) {
          throw new Error(deleteTaskResult.error ?? `Failed deleting agent task ${taskId}`);
        }
      }

      const deleteLoanResult = await requestCommand({
        command: 'DELETE',
        entityTypeName: LOAN_ENTITY,
        recordId: loan.id,
      });

      if (!deleteLoanResult.ok) {
        throw new Error(deleteLoanResult.error ?? `Failed deleting loan ${loan.id}`);
      }

      const instancesResponse = await requestCommand({
        command: 'GET_MANY',
        entityTypeName: INSTANCE_ENTITY,
        options: {
          limit: 5000,
          expansionLevel: 2,
        },
      });

      if (!instancesResponse.ok) {
        throw new Error(instancesResponse.error ?? 'Failed to load workflow instances for deletion');
      }

      const loanInstanceIds = extractEntityRecords(instancesResponse.data)
        .filter((record) => {
          if (
            !entitySameId(getRecordStringValue(record, ['TargetRecordId', 'targetRecordId']), loan.id)
          ) {
            return false;
          }

          const targetEntityType = getRecordStringValue(record, ['TargetEntityType', 'targetEntityType']);
          if (!targetEntityType) {
            return true;
          }

          return normalizeEntityName(targetEntityType) === normalizeEntityName(LOAN_ENTITY);
        })
        .map((record) => entityRecordId(record))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      if (loanInstanceIds.length > 0) {
        const historyResponse = await requestCommand({
          command: 'GET_MANY',
          entityTypeName: HISTORY_ENTITY,
          options: {
            limit: 10000,
            expansionLevel: 2,
          },
        });

        if (!historyResponse.ok) {
          throw new Error(historyResponse.error ?? 'Failed to load workflow history for deletion');
        }

        const historyIds = extractEntityRecords(historyResponse.data)
          .filter((record) => {
            const statusInstanceId =
              getRecordRelatedId(record, ['StatusInstance', 'statusInstance']) ||
              getRecordStringValue(record, ['StatusInstanceId', 'statusInstanceId']);
            return statusInstanceId ? loanInstanceIds.some((instanceId) => entitySameId(statusInstanceId, instanceId)) : false;
          })
          .map((record) => entityRecordId(record))
          .filter((id): id is string => typeof id === 'string' && id.length > 0);

        for (const historyId of historyIds) {
          const deleteHistoryResult = await requestCommand({
            command: 'DELETE',
            entityTypeName: HISTORY_ENTITY,
            recordId: historyId,
          });

          if (!deleteHistoryResult.ok) {
            throw new Error(deleteHistoryResult.error ?? `Failed deleting workflow history ${historyId}`);
          }
        }

        for (const instanceId of loanInstanceIds) {
          const deleteInstanceResult = await requestCommand({
            command: 'DELETE',
            entityTypeName: INSTANCE_ENTITY,
            recordId: instanceId,
          });

          if (!deleteInstanceResult.ok) {
            throw new Error(deleteInstanceResult.error ?? `Failed deleting workflow instance ${instanceId}`);
          }
        }
      }

      if (entitySameId(selectedLoanId, loan.id)) {
        setSelectedLoanId('');
        setScreen('loan_board');
      }
      setReviewStartedLoanIds((current) => current.filter((id) => !entitySameId(id, loan.id)));

      await loadLoans('loan_deleted');
      setLoanStatusGraph((current) => (entitySameId(selectedLoanId, loan.id) ? null : current));
      appendConnectionDiagnostic('loan.delete.succeeded', {
        loanId: loan.id,
        deletedAgentTaskCount: linkedAgentTaskIds.length,
        deletedInstanceCount: loanInstanceIds.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete loan';
      reportCoordinatorError(message, { scope: 'deleteLoanCascade', loanId: loan.id });
    } finally {
      setDeletingLoanId((current) => (entitySameId(current, loan.id) ? null : current));
    }
  }

  const emitEntityEvent = useEffectEvent(
    async (
      entityTypeName: string,
      entityId: string,
      changeType: 'CREATED' | 'UPDATED' | 'DELETED',
      payload?: unknown,
    ) => {
      const eventResponse = await requestEvent({
        entityId,
        entityTypeName,
        changedAt: new Date().toISOString(),
        changeType,
        source: 'credit_underwriting_client',
        payload,
      });

      if (!eventResponse.ok) {
        throw new Error(eventResponse.error ?? `Failed to emit ${changeType} event for ${entityTypeName}`);
      }
    },
  );

  const startReviewForSelectedLoan = useEffectEvent(async () => {
    if (!selectedLoanId) {
      return;
    }

    const loanId = selectedLoanId;
    if (startReviewInFlightLoanId && entitySameId(startReviewInFlightLoanId, loanId)) {
      return;
    }

    setStartReviewInFlightLoanId(loanId);

    try {
      if (selectedLoan?.taskFlowsInitialized === true) {
        setReviewStartedLoanIds((current) =>
          current.some((id) => entitySameId(id, loanId)) ? current : [...current, loanId],
        );
        await loadAgentTaskStatuses(loanId);
        appendConnectionDiagnostic('loan.start_review.succeeded', { loanId, alreadyInitialized: true });
        return;
      }

      const loanUpdate = await requestCommand({
        command: 'UPDATE',
        entityTypeName: LOAN_ENTITY,
        recordId: loanId,
        data: {
          TaskFlowsInitialized: true,
        },
        options: {
          expansionLevel: 2,
        },
      });

      if (!loanUpdate.ok) {
        throw new Error(loanUpdate.error ?? 'Failed to start review for loan');
      }

      setLoans((current) =>
        current.map((loan) =>
          entitySameId(loan.id, loanId)
            ? {
                ...loan,
                taskFlowsInitialized: true,
              }
            : loan,
        ),
      );
      setReviewStartedLoanIds((current) =>
        current.some((id) => entitySameId(id, loanId)) ? current : [...current, loanId],
      );

      await emitEntityEvent(LOAN_ENTITY, loanId, 'UPDATED', {
        RecordId: loanId,
        TaskFlowsInitialized: true,
      });

      await refreshSingleLoanCard(loanId, 'loan.start_review');
      await loadAgentTaskStatuses(loanId);
      appendConnectionDiagnostic('loan.start_review.succeeded', { loanId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start review';
      reportCoordinatorError(message, { scope: 'startReviewForSelectedLoan', loanId });
    } finally {
      setStartReviewInFlightLoanId((current) => (entitySameId(current, loanId) ? null : current));
    }
  });

  const updateAgentTaskRecord = useEffectEvent(
    async (taskId: string, data: Record<string, unknown>) => {
      const primaryUpdate = await requestCommand({
        command: 'UPDATE',
        entityTypeName: AGENT_TASK_ENTITY,
        recordId: taskId,
        data,
        options: {
          expansionLevel: 2,
        },
      });

      if (primaryUpdate.ok) {
        return;
      }

      const fallbackData = { ...data };
      delete fallbackData[AGENT_TASK_FOLLOWUP_ANSWERS_PLACEHOLDER_FIELD];
      delete fallbackData[AGENT_TASK_COMPLETED_PLACEHOLDER_FIELD];

      if (Object.keys(fallbackData).length === Object.keys(data).length) {
        throw new Error(primaryUpdate.error ?? `Failed to update ${AGENT_TASK_ENTITY}`);
      }

      appendConnectionDiagnostic(
        'agent.task.update.placeholder_fields.retry',
        {
          taskId,
          removedFields: [
            AGENT_TASK_FOLLOWUP_ANSWERS_PLACEHOLDER_FIELD,
            AGENT_TASK_COMPLETED_PLACEHOLDER_FIELD,
          ],
          error: primaryUpdate.error ?? 'Unknown update error',
        },
        'warn',
      );

      const fallbackUpdate = await requestCommand({
        command: 'UPDATE',
        entityTypeName: AGENT_TASK_ENTITY,
        recordId: taskId,
        data: fallbackData,
        options: {
          expansionLevel: 2,
        },
      });

      if (!fallbackUpdate.ok) {
        throw new Error(fallbackUpdate.error ?? `Failed to update ${AGENT_TASK_ENTITY}`);
      }
    },
  );

  const getTaskTransitionTarget = useEffectEvent(
    (task: AgentTaskStatusCardModel, targetKind: 'approved' | 'in_progress'): { nodeId: string; label: string } => {
      const nextNodes = task.availableNextNodes;
      const normalize = (label: string) => getStatusToken(label);

      if (targetKind === 'in_progress') {
        const preferred = nextNodes.find((nextNode) => {
          const token = normalize(nextNode.label);
          return (
            token.includes('inprogress') ||
            token.includes('processing') ||
            token.includes('running') ||
            token.includes('queued')
          );
        });
        if (preferred) {
          return preferred;
        }
      } else {
        if (task.visualState === 'review_underwriter') {
          const managerReviewTarget = nextNodes.find((nextNode) =>
            normalize(nextNode.label).includes('managerreview'),
          );
          if (managerReviewTarget) {
            return managerReviewTarget;
          }
        }

        const approvedTarget = nextNodes.find((nextNode) => {
          const token = normalize(nextNode.label);
          return token.includes('approved') || token.includes('complete') || token.includes('completed') || token.includes('done');
        });
        if (approvedTarget) {
          return approvedTarget;
        }
      }

      throw new Error(
        `No ${targetKind} transition found from ${task.currentNodeLabel}. Available: ${task.availableNextNodes
          .map((node) => node.label)
          .join(', ')}`,
      );
    },
  );

  const transitionAgentTask = useEffectEvent(
    async (task: AgentTaskStatusCardModel, targetKind: 'approved' | 'in_progress') => {
      const target = getTaskTransitionTarget(task, targetKind);
      const transitionResult = await requestStatusTransition({
        recordId: task.id,
        targetNodeId: target.nodeId,
        entityName: AGENT_TASK_ENTITY,
      });

      if (!transitionResult.ok) {
        throw new Error(transitionResult.error ?? 'Failed to transition task through coordinator');
      }
    },
  );

  const applyLoanDecision = useEffectEvent(async (decision: 'APPROVED' | 'REVISION') => {
    if (!selectedLoanId) {
      return;
    }

    const stageToken = activeLoanStageLabel.toLowerCase();
    const reviewOwnerKey: 'underwriter' | 'manager' = stageToken.includes('manager')
      ? 'manager'
      : 'underwriter';
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    if (reviewOwnerKey === 'underwriter') {
      patch.UnderwriterDecision = decision;
      patch.UnderwriterDecisionAt = nowIso;
      if (decision === 'APPROVED') {
        patch.ManagerDecision = '';
        patch.ManagerDecisionAt = null;
      }
    } else {
      patch.ManagerDecision = decision;
      patch.ManagerDecisionAt = nowIso;
      if (decision === 'REVISION') {
        patch.UnderwriterDecision = '';
        patch.UnderwriterDecisionAt = null;
      }
    }

    const loanUpdate = await requestCommand({
      command: 'UPDATE',
      entityTypeName: LOAN_ENTITY,
      recordId: selectedLoanId,
      data: patch,
      options: {
        expansionLevel: 2,
      },
    });

    if (!loanUpdate.ok) {
      throw new Error(loanUpdate.error ?? 'Failed to update loan review decision');
    }

    await emitEntityEvent(LOAN_ENTITY, selectedLoanId, 'UPDATED', {
      RecordId: selectedLoanId,
      ...patch,
    });
  });

  const submitTaskIteration = useEffectEvent(async (task: AgentTaskStatusCardModel) => {
    const followupQuestions = parseFollowupQuestions(task.followupQuestionsRaw);
    const followupAnswers: FollowupAnswerDraft[] = followupQuestions.map((question) => ({
      id: question.id,
      question: question.question,
      answer: followupAnswersByTaskId[task.id]?.[question.id] ?? '',
    }));
    const comments = commentsByTaskId[task.id] ?? [];
    const generalFeedbackRaw = (generalFeedbackByTaskId[task.id] ?? '').trim();
    const generalFeedback = scrubDemoDocumentMentions(generalFeedbackRaw);
    const summaryText = editorDraftByTaskId[task.id] ?? task.summaryText;
    const originalSummaryText = task.summaryText ?? '';
    const summaryChanged = summaryText !== originalSummaryText;
    const scrubbedSummaryText = scrubDemoDocumentMentions(summaryText);
    const cappedSummaryText = capTextForDataService(scrubbedSummaryText);
    const reviewOwnerKey = activeReviewPhase === 'manager' ? 'manager' : 'underwriter';

    if (
      !summaryChanged &&
      comments.length === 0 &&
      !generalFeedback &&
      !followupAnswers.some((entry) => entry.answer.trim())
    ) {
      throw new Error('Enter revision comments or feedback before sending to iterate');
    }

    const answeredFollowupQuestionAnswers: FollowupQuestionAnswerPayload[] = followupAnswers
      .map((entry) => ({
        question: entry.question.trim(),
        answer: scrubDemoDocumentMentions(entry.answer.trim()),
      }))
      .filter((entry) => entry.question.length > 0 && entry.answer.length > 0);

    const feedbackPayload: FeedbackPayload = {
      schema: 'credit_memo_feedback_v1',
      action: 'REVISION',
      sectionOrder: task.sectionOrder,
      revisedSectionText: cappedSummaryText.value,
      revisionItems: comments.map((comment) => ({
        quotedText: scrubDemoDocumentMentions(comment.quotedText),
        startOffset: comment.startOffset,
        endOffset: comment.endOffset,
        instruction: scrubDemoDocumentMentions(comment.comment),
      })),
      followupQuestionAnswers: answeredFollowupQuestionAnswers,
      generalFeedback,
      submittedAt: new Date().toISOString(),
      reviewOwner: reviewOwnerKey,
    };
    const cappedFeedback = capFeedbackPayloadForStorage(feedbackPayload);
    const cappedFollowupAnswers = capFollowupAnswersForStorage(answeredFollowupQuestionAnswers);

    const taskPatch: Record<string, unknown> = {
      SummaryText: cappedSummaryText.value,
      Feedback: cappedFeedback.json,
      UserAction: 'REVISION',
      UserActionAt: new Date().toISOString(),
      [AGENT_TASK_FOLLOWUP_ANSWERS_PLACEHOLDER_FIELD]: cappedFollowupAnswers.json,
    };

    if (cappedSummaryText.truncated || cappedFeedback.truncated || cappedFollowupAnswers.truncated) {
      appendConnectionDiagnostic(
        'agent.task.payload.truncated',
        {
          taskId: task.id,
          summary: {
            originalLength: summaryText.length,
            persistedLength: cappedSummaryText.value.length,
            truncated: cappedSummaryText.truncated,
          },
          feedback: {
            persistedLength: cappedFeedback.json.length,
            truncated: cappedFeedback.truncated,
          },
          followupQuestionAnswers: {
            persistedLength: cappedFollowupAnswers.json.length,
            truncated: cappedFollowupAnswers.truncated,
          },
        },
        'warn',
      );
    }

    await updateAgentTaskRecord(task.id, taskPatch);
    await emitEntityEvent(AGENT_TASK_ENTITY, task.id, 'UPDATED', {
      RecordId: task.id,
      ...taskPatch,
    });
    await transitionAgentTask(task, 'in_progress');
    await applyLoanDecision('REVISION');
  });

  const approveTaskSection = useEffectEvent(async (task: AgentTaskStatusCardModel) => {
    const summaryText = editorDraftByTaskId[task.id] ?? task.summaryText;
    const cappedSummaryText = capTextForDataService(scrubDemoDocumentMentions(summaryText));
    const finalApproval =
      task.visualState === 'review_manager' ||
      (task.visualState === 'review' && activeReviewPhase === 'manager');
    const taskPatch: Record<string, unknown> = {
      SummaryText: cappedSummaryText.value,
      [AGENT_TASK_APPROVED_FIELD]: finalApproval,
      UserAction: 'APPROVED',
      UserActionAt: new Date().toISOString(),
      [AGENT_TASK_COMPLETED_PLACEHOLDER_FIELD]: finalApproval,
    };

    if (cappedSummaryText.truncated) {
      appendConnectionDiagnostic(
        'agent.task.summary.truncated',
        {
          taskId: task.id,
          originalLength: summaryText.length,
          persistedLength: cappedSummaryText.value.length,
        },
        'warn',
      );
    }

    await updateAgentTaskRecord(task.id, taskPatch);
    await emitEntityEvent(AGENT_TASK_ENTITY, task.id, 'UPDATED', {
      RecordId: task.id,
      ...taskPatch,
    });
    await transitionAgentTask(task, 'approved');
  });

  const areAllAgentTasksApprovedForLoan = useEffectEvent(async (loanRecordId: string): Promise<boolean> => {
    if (!selectedLoanId || !entitySameId(selectedLoanId, loanRecordId)) {
      return false;
    }

    if (agentTaskStatuses.length === 0) {
      return false;
    }

    const phase: ReviewPhase = activeLoanStageLabel.toLowerCase().includes('manager')
      ? 'manager'
      : activeLoanStageLabel.toLowerCase().includes('underwriter')
        ? 'underwriter'
        : 'unknown';

    return agentTaskStatuses.every((task) => {
      const token = getStatusToken(task.currentNodeLabel);
      const visualState = task.visualState;
      if (phase === 'underwriter') {
        return (
          visualState === 'review_manager' ||
          visualState === 'approved' ||
          token.includes('underwriterapproved')
        );
      }

      if (phase === 'manager') {
        return visualState === 'approved' || token.includes('managerapproved');
      }

      return visualState === 'approved';
    });
  });

  const runTaskAction = useEffectEvent(
    async (task: AgentTaskStatusCardModel, action: 'approve' | 'iterate') => {
      if (!selectedLoanId) {
        return;
      }

      setTaskActionInFlightById((current) => ({ ...current, [task.id]: true }));
      try {
        if (action === 'iterate') {
          await submitTaskIteration(task);
        } else {
          await approveTaskSection(task);
        }

        await loadAgentTaskStatuses(selectedLoanId);
        await loadLoanStatusFlow(selectedLoanId, {
          silent: true,
          incremental: true,
          reason: 'task_action.refresh',
        });

        if (action === 'approve') {
          const allApproved = await areAllAgentTasksApprovedForLoan(selectedLoanId);
          if (allApproved) {
            await applyLoanDecision('APPROVED');
            await loadLoanStatusFlow(selectedLoanId, {
              silent: true,
              incremental: true,
              reason: 'task_action.all_approved',
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Task action failed';
        reportCoordinatorError(message, {
          scope: 'agent.task.action',
          taskId: task.id,
          action,
        });
      } finally {
        setTaskActionInFlightById((current) => {
          const next = { ...current };
          delete next[task.id];
          return next;
        });
      }
    },
  );

  const copyCoordinatorDebugSnapshot = useEffectEvent(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(coordinatorDebugSnapshot, null, 2));
      setErrorDetailsCopied(true);
      window.setTimeout(() => {
        setErrorDetailsCopied(false);
      }, 1600);
      appendConnectionDiagnostic('coordinator.error.details.copied');
    } catch (error) {
      appendConnectionDiagnostic(
        'coordinator.error.details.copy_failed',
        error instanceof Error ? error.message : String(error),
        'warn',
      );
    }
  });

  const coordinatorDebugSnapshot = {
    capturedAt: new Date().toISOString(),
    coordinatorError,
    connectionState,
    wsUrl: getCoordinatorWsUrl(),
    httpBaseUrl: getCoordinatorHttpBaseUrl(),
    socketReadyState: socketRef.current
      ? socketReadyStateLabel(socketRef.current.readyState)
      : 'NO_SOCKET',
    reconnectScheduled: reconnectTimeoutRef.current !== null,
    selectedLoanId: selectedLoanId || null,
    selectedLoanName: selectedLoan?.name ?? null,
    loanCount: loans.length,
    isLoansLoading,
    loanFlowLoading,
    loanFlowError,
    diagnostics: connectionDiagnostics,
  };
  const pendingCommentMentionTrigger = getTrailingDocumentMentionTrigger(pendingCommentText);
  const pendingCommentMentionSuggestions = pendingCommentMentionTrigger
    ? getDocumentMentionSuggestions(pendingCommentMentionTrigger.query)
    : [];

  return (
    <Box
      sx={{
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--sp-bottom-bg)',
      }}
    >
      <Box
        sx={{
          px: 3,
          py: 0,
          height: APP_HEADER_HEIGHT_PX,
          minHeight: APP_HEADER_HEIGHT_PX,
          maxHeight: APP_HEADER_HEIGHT_PX,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          borderBottom: '1px solid var(--sp-border)',
          bgcolor: 'var(--sp-chrome-bg)',
        }}
      >
        <Box
          sx={{
            width: { xs: 120, sm: 160, md: 220 },
            height: '100%',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {screen === 'loan_workspace' ? (
            <Button
              variant="text"
              size="small"
              onClick={() => setScreen('loan_board')}
              sx={{
                minHeight: 32,
                px: 1,
                border: '1px solid transparent',
                color: 'var(--sp-muted-text)',
                '&:hover': {
                  borderColor: 'var(--sp-border)',
                  bgcolor: 'var(--sp-control-bg)',
                  color: 'var(--sp-text)',
                },
                whiteSpace: 'nowrap',
              }}
            >
              ← Back To Loans
            </Button>
          ) : null}
        </Box>

        <Typography
          variant="h5"
          sx={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            maxWidth: { xs: 'calc(100% - 24px)', md: 'calc(100% - 480px)' },
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          End To End Credit - Loan Underwriting
        </Typography>

        <Box
          sx={{
            width: { xs: 120, sm: 160, md: 220 },
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          {/* Reserved space keeps centered title aligned with left-side back button area. */}
        </Box>
      </Box>

      {coordinatorError ? (
        <Box sx={{ m: 2, mb: 0 }}>
          <Alert
            severity="warning"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setShowCoordinatorErrorDetails((current) => !current)}
              >
                {showCoordinatorErrorDetails ? 'Hide Details' : 'Show Details'}
              </Button>
            }
          >
            {coordinatorError}
          </Alert>
          <Collapse in={showCoordinatorErrorDetails}>
            <Paper
              sx={{
                mt: 1,
                p: 1.25,
                bgcolor: 'var(--sp-control-bg)',
                borderColor: 'var(--sp-control-border)',
                maxHeight: 280,
                overflow: 'auto',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 1,
                }}
              >
                <Typography sx={{ fontSize: 12, color: 'var(--sp-muted-text)' }}>
                  Diagnostics Snapshot
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    void copyCoordinatorDebugSnapshot();
                  }}
                >
                  {errorDetailsCopied ? 'Copied' : 'Copy'}
                </Button>
              </Box>
              <Typography
                component="pre"
                sx={{
                  m: 0,
                  fontSize: 12,
                  fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--sp-text)',
                }}
              >
                {JSON.stringify(coordinatorDebugSnapshot, null, 2)}
              </Typography>
            </Paper>
          </Collapse>
        </Box>
      ) : null}

      {screen === 'loan_board' ? (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 3 }}>
          <Typography variant="h4" sx={{ mb: 2.5 }}>
            Loans In Process
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            }}
          >
            {isLoansLoading ? (
              <Paper sx={{ p: 2 }}>
                <Typography color="text.secondary" variant="body2">
                  Loading loans...
                </Typography>
              </Paper>
            ) : null}

            {!isLoansLoading && loans.length === 0 ? (
              <Paper sx={{ p: 2 }}>
                <Typography color="text.secondary" variant="body2">
                  No loans found.
                </Typography>
              </Paper>
            ) : null}

            {loans.map((loan) => (
              <Paper
                key={loan.id}
                onClick={() => openLoanWorkspace(loan.id)}
                sx={{
                  p: 2,
                  cursor: deletingLoanId === loan.id ? 'default' : 'pointer',
                  transition: 'border-color 140ms ease, background-color 140ms ease',
                  '&:hover': {
                    borderColor: 'var(--sp-active-blue)',
                    bgcolor: 'rgba(102, 172, 255, 0.06)',
                  },
                }}
              >
                <Stack spacing={1}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                    <Typography sx={{ fontWeight: 700 }}>{loan.name}</Typography>
                    <IconButton
                      size="small"
                      aria-label={`Delete ${loan.name}`}
                      disabled={deletingLoanId !== null}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteLoanCascade(loan);
                      }}
                      sx={{
                        color: 'var(--sp-logo-orange)',
                        p: 0.25,
                        border: 0,
                        bgcolor: 'transparent',
                        '&:hover': {
                          bgcolor: 'transparent',
                          color: '#ff5b5b',
                        },
                        '&.Mui-disabled': {
                          color: 'rgba(250, 72, 28, 0.45)',
                          bgcolor: 'transparent',
                        },
                      }}
                    >
                      <Icon icon="mdi:trash-can" width={18} height={18} />
                    </IconButton>
                  </Stack>
                  <Chip size="small" variant="outlined" label={loan.stage} sx={{ width: 'fit-content' }} />
                  <Typography variant="body2" color="text.secondary">
                    Last update: {loan.updatedAt}
                  </Typography>
                  {deletingLoanId === loan.id ? (
                    <Typography sx={{ fontSize: 12, color: 'var(--sp-logo-orange)' }}>Deleting...</Typography>
                  ) : null}
                </Stack>
              </Paper>
            ))}

            <Paper
              onClick={() => {
                void createNewLoan();
              }}
              sx={{
                p: 2,
                cursor: 'pointer',
                borderStyle: 'dashed',
                borderColor: 'var(--sp-active-blue)',
                bgcolor: 'rgba(102, 172, 255, 0.08)',
                transition: 'background-color 140ms ease',
                '&:hover': {
                  bgcolor: 'rgba(102, 172, 255, 0.14)',
                },
              }}
            >
              <Stack spacing={1.5} alignItems="flex-start" justifyContent="center" sx={{ minHeight: 130 }}>
                <Typography sx={{ fontWeight: 700, color: 'var(--sp-active-blue)' }}>Start New Loan</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 700, color: 'var(--sp-active-blue)', lineHeight: 1 }}>
                  →
                </Typography>
              </Stack>
            </Paper>
          </Box>
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, p: 2, overflow: 'hidden' }}>
          <Box
            ref={workspaceSplitRef}
            sx={{
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              overflow: 'hidden',
            }}
          >
            <LoanWorkspaceTopPanel
              loanName={selectedLoan?.name ?? 'Loan'}
              topTab={topTab}
              onTopTabChange={setTopTab}
              loanStatusGraph={loanStatusGraph}
              loanFlowLoading={loanFlowLoading}
              loanFlowError={loanFlowError}
              flowRecenterSignal={flowRecenterSignal}
              onFlowRecenter={() => {
                setFlowRecenterSignal((current) => current + 1);
              }}
              publicPdfDocuments={SAMPLE_PUBLIC_PDF_DOCUMENTS}
              selectedPublicPdfUrl={selectedPublicPdfUrl}
              onSelectedPublicPdfUrlChange={setSelectedPublicPdfUrl}
              topPanelPercent={topPanelPercent}
            />

            <Box
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingPanels(true);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                setIsResizingPanels(false);
                setTopPanelPercent(MIN_TOP_PANEL_PERCENT);
              }}
              sx={{
                flex: '0 0 22px',
                cursor: 'row-resize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Box
                sx={{
                  px: 0.75,
                  py: 0.1,
                  borderRadius: 1,
                  color: isResizingPanels ? 'var(--sp-active-blue)' : 'var(--sp-muted-text)',
                  transition: 'color 120ms ease, background-color 120ms ease',
                  userSelect: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  '&:hover': {
                    color: 'var(--sp-active-blue)',
                    bgcolor: 'rgba(102, 172, 255, 0.08)',
                  },
                }}
              >
                <Icon icon="mdi:dots-horizontal" width={22} height={22} />
              </Box>
            </Box>

            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Paper sx={{ p: 1.5, minHeight: 0, overflow: 'auto' }}>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                  <Typography variant="subtitle2" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Review Credit Memo
                  </Typography>
                  <Chip
                    size="small"
                    label={getReviewPhaseDisplayName(activeReviewPhase)}
                    variant="outlined"
                    sx={{
                      height: 22,
                      borderColor:
                        activeReviewPhase === 'manager'
                          ? '#f7d27a'
                          : activeReviewPhase === 'underwriter'
                            ? 'var(--sp-active-blue)'
                            : 'var(--sp-border)',
                      color:
                        activeReviewPhase === 'manager'
                          ? '#f7d27a'
                          : activeReviewPhase === 'underwriter'
                            ? 'var(--sp-active-blue)'
                            : 'var(--sp-muted-text)',
                      '& .MuiChip-label': {
                        fontWeight: 700,
                        px: 0.9,
                      },
                    }}
                  />
                </Stack>
                <Divider sx={{ my: 1.25 }} />

                {!hasStartedReviewForSelectedLoan ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderColor: 'var(--sp-control-border)',
                      bgcolor: 'rgba(18, 30, 45, 0.28)',
                    }}
                  >
                    <Stack spacing={1.25} alignItems="flex-start">
                      <Typography variant="body2" color="text.secondary">
                        Start review to load the draft credit memo sections for this loan.
                      </Typography>
                      <Button
                        variant="contained"
                        disabled={!selectedLoanId || isStartReviewInFlight || !canStartReview}
                        onClick={() => {
                          void startReviewForSelectedLoan();
                        }}
                        startIcon={
                          isStartReviewInFlight ? (
                            <CircularProgress size={14} thickness={6} sx={{ color: 'inherit' }} />
                          ) : (
                            <Icon icon="mdi:play-circle-outline" width={16} height={16} />
                          )
                        }
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                        }}
                      >
                        {isStartReviewInFlight ? 'Starting Review...' : 'Start Review'}
                      </Button>
                      {!canStartReview ? (
                        <Typography variant="caption" color="text.secondary">
                          Start review becomes available at the Draft Credit Memo stage.
                        </Typography>
                      ) : null}
                    </Stack>
                  </Paper>
                ) : (
                  <>
                    {!agentTasksLoading && agentTasksError ? (
                      <Alert severity="warning" sx={{ mb: 1 }}>
                        {agentTasksError}
                      </Alert>
                    ) : null}

                    {!agentTasksLoading && !agentTasksError && agentTaskStatuses.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No agent tasks found for this loan yet.
                      </Typography>
                    ) : null}

                    <Stack spacing={1.5}>
                      {memoSectionRenderItems.map((item) => {
                    if (item.kind === 'static') {
                      return (
                        <Paper
                          key={`static-${item.section.title}`}
                          variant="outlined"
                          sx={{
                            p: 1,
                            bgcolor: 'rgba(18, 30, 45, 0.3)',
                            borderColor: 'var(--sp-control-border)',
                          }}
                        >
                          <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.75 }}>{item.section.title}</Typography>
                          <Box
                            sx={{
                              border: '1px solid var(--sp-control-border)',
                              borderRadius: 1,
                              overflow: 'hidden',
                            }}
                          >
                            {item.section.rows.map((row, rowIndex) => (
                              <Box
                                key={`${item.section.title}-${row.label}`}
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: 'minmax(180px, 36%) minmax(0, 64%)',
                                  borderTop:
                                    rowIndex === 0 ? 'none' : '1px solid var(--sp-control-border)',
                                }}
                              >
                                <Typography
                                  sx={{
                                    px: 1,
                                    py: 0.75,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: 'var(--sp-muted-text)',
                                    bgcolor: 'rgba(8, 16, 26, 0.45)',
                                  }}
                                >
                                  {row.label}
                                </Typography>
                                <Typography sx={{ px: 1, py: 0.75, fontSize: 12 }}>{row.value}</Typography>
                              </Box>
                            ))}
                          </Box>
                        </Paper>
                      );
                    }

                    const task = item.task;
                      const holdManagerReviewUntilAllReady =
                        task.visualState === 'review_manager' && !allTasksManagerReadyForReview;
                      const effectiveVisualState: AgentTaskVisualState = holdManagerReviewUntilAllReady
                        ? 'approved'
                        : task.visualState;
                      const visualConfig =
                        holdManagerReviewUntilAllReady
                          ? {
                              statusLabel: 'Complete',
                              accentColor: 'var(--sp-active-green)',
                              tintColor: 'rgba(115, 200, 76, 0.12)',
                              message: 'Waiting for remaining sections to reach manager review.',
                              iconName: 'mdi:check-circle',
                              iconSpin: false,
                            }
                          : effectiveVisualState === 'created'
                          ? {
                              statusLabel: 'Created',
                              accentColor: 'var(--sp-muted-text)',
                              tintColor: 'rgba(102, 120, 138, 0.16)',
                              message: 'Awaiting for agent to start processing.',
                              iconName: 'mdi:loading',
                              iconSpin: true,
                            }
                          : effectiveVisualState === 'in_progress'
                            ? {
                                statusLabel: 'In Progress',
                                accentColor: 'var(--sp-active-blue)',
                                tintColor: 'rgba(102, 172, 255, 0.12)',
                                message: 'Agent currently processing.',
                                iconName: 'mdi:loading',
                                iconSpin: true,
                              }
                            : isReviewVisualState(effectiveVisualState)
                              ? {
                                  statusLabel:
                                    effectiveVisualState === 'review_manager'
                                      ? 'Manager Review'
                                      : effectiveVisualState === 'review_underwriter'
                                        ? 'Underwriter Review'
                                        : 'Review',
                                  accentColor: '#d8a800',
                                  tintColor: 'rgba(216, 168, 0, 0.15)',
                                  message:
                                    effectiveVisualState === 'review_manager'
                                      ? 'Manager reviewing this section.'
                                      : effectiveVisualState === 'review_underwriter'
                                        ? 'Underwriter reviewing this section.'
                                        : 'Revise the section below, or click the check above to approve.',
                                  iconName: 'mdi:clipboard-text-clock-outline',
                                  iconSpin: false,
                                }
                              : effectiveVisualState === 'approved'
                                ? {
                                    statusLabel: 'Approved',
                                    accentColor: 'var(--sp-active-green)',
                                    tintColor: 'rgba(115, 200, 76, 0.12)',
                                    message: 'Agent output approved.',
                                    iconName: 'mdi:check-circle',
                                    iconSpin: false,
                                  }
                                : {
                                    statusLabel: task.currentNodeLabel || 'Current',
                                    accentColor: 'var(--sp-active-blue)',
                                    tintColor: 'rgba(102, 172, 255, 0.1)',
                                    message: 'Agent status updated.',
                                    iconName: 'mdi:timeline-clock',
                                    iconSpin: false,
                                  };

                      const followupQuestions = parseFollowupQuestions(task.followupQuestionsRaw);
                      const draftText = editorDraftByTaskId[task.id] ?? task.summaryText ?? '';
                      const comments = commentsByTaskId[task.id] ?? [];
                      const generalFeedback = generalFeedbackByTaskId[task.id] ?? '';
                      const summaryMentionTrigger = getTrailingDocumentMentionTrigger(draftText);
                      const summaryMentionSuggestions = summaryMentionTrigger
                        ? getDocumentMentionSuggestions(summaryMentionTrigger.query)
                        : [];
                      const feedbackMentionTrigger = getTrailingDocumentMentionTrigger(generalFeedback);
                      const feedbackMentionSuggestions = feedbackMentionTrigger
                        ? getDocumentMentionSuggestions(feedbackMentionTrigger.query)
                        : [];
                      const hasRevisionInputs = reviewEditsByTaskId[task.id] === true;
                      const isReviewSection = isReviewVisualState(effectiveVisualState);
                      const isActiveMemo = entitySameId(activeMemoTaskId, task.id);
                      const actionInFlight = taskActionInFlightById[task.id] === true;

                      return (
                        <Paper
                          key={task.id}
                          sx={{
                            p: 1.25,
                            borderColor: visualConfig.accentColor,
                            bgcolor: visualConfig.tintColor,
                            cursor: 'text',
                            ...(isActiveMemo
                              ? {
                                  boxShadow: `0 0 0 2px ${visualConfig.accentColor}`,
                                }
                              : null),
                          }}
                          onClick={() => setActiveMemoTaskId(task.id)}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, flexWrap: 'wrap' }}>
                            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
                              <Box
                                sx={{
                                  color: visualConfig.accentColor,
                                  display: 'grid',
                                  placeItems: 'center',
                                  width: 16,
                                  height: 16,
                                  ...(visualConfig.iconSpin
                                    ? {
                                        animation: 'agentStatusSpin 1s linear infinite',
                                        '@keyframes agentStatusSpin': {
                                          '0%': { transform: 'rotate(0deg)' },
                                          '100%': { transform: 'rotate(360deg)' },
                                        },
                                      }
                                    : null),
                                }}
                              >
                                <Icon icon={visualConfig.iconName} width={16} height={16} />
                              </Box>
                              <Typography sx={{ fontSize: 13, fontWeight: 700, minWidth: 0 }} noWrap>
                                {task.sectionOrder || getSectionTitleFromOrder(task.sectionOrder)}
                              </Typography>
                            </Stack>
                            <Chip
                              size="small"
                              label={visualConfig.statusLabel}
                              sx={{
                                bgcolor: 'transparent',
                                borderColor: visualConfig.accentColor,
                                color: visualConfig.accentColor,
                                '& .MuiChip-label': {
                                  fontWeight: 700,
                                },
                              }}
                              variant="outlined"
                            />
                            <Chip
                              size="small"
                              label={formatConfidenceChipLabel(task.confidence)}
                              sx={{
                                bgcolor: 'transparent',
                                borderColor: visualConfig.accentColor,
                                color: visualConfig.accentColor,
                                '& .MuiChip-label': {
                                  fontWeight: 700,
                                },
                              }}
                              variant="outlined"
                            />
                            {isReviewSection ? (
                              hasRevisionInputs ? (
                                <IconButton
                                  size="small"
                                  disabled={actionInFlight}
                                  onClick={() => {
                                    void runTaskAction(task, 'iterate');
                                  }}
                                  sx={{ color: 'var(--sp-active-blue)' }}
                                >
                                  {actionInFlight ? (
                                    <CircularProgress size={16} thickness={5} sx={{ color: 'var(--sp-active-blue)' }} />
                                  ) : (
                                    <Icon icon="mdi:send" width={18} height={18} />
                                  )}
                                </IconButton>
                              ) : (
                                <IconButton
                                  size="small"
                                  disabled={actionInFlight}
                                  onClick={() => {
                                    void runTaskAction(task, 'approve');
                                  }}
                                  sx={{ color: 'var(--sp-active-green)' }}
                                >
                                  {actionInFlight ? (
                                    <CircularProgress size={16} thickness={5} sx={{ color: 'var(--sp-active-green)' }} />
                                  ) : (
                                    <Icon icon="mdi:check-circle" width={18} height={18} />
                                  )}
                                </IconButton>
                              )
                            ) : null}
                          </Stack>

                          <Typography sx={{ mt: 0.7, fontSize: 12, color: 'var(--sp-muted-text)' }}>
                            {visualConfig.message}
                          </Typography>

                          <Collapse in={isReviewSection} timeout={{ enter: 280, exit: 240 }} unmountOnExit>
                            <Box
                              sx={{
                                mt: 1.1,
                                display: 'grid',
                                gridTemplateColumns: {
                                  xs: '1fr',
                                  lg: 'minmax(0, 7fr) minmax(0, 3fr)',
                                },
                                height: {
                                  xs: 320,
                                  lg: 300,
                                },
                                gap: 1.25,
                                alignItems: 'stretch',
                              }}
                            >
                              <Box sx={{ minWidth: 0, minHeight: 0, height: '100%' }}>
                                <LexicalCommentableEditor
                                  taskId={task.id}
                                  value={draftText}
                                  height="100%"
                                  comments={comments}
                                  pendingDraft={entitySameId(pendingComment?.taskId, task.id) ? pendingComment : null}
                                  onValueChange={(nextValue) => {
                                    setActiveMemoTaskId(task.id);
                                    const previousValue = editorDraftByTaskId[task.id] ?? task.summaryText ?? '';
                                    setEditorDraftByTaskId((current) => ({
                                      ...current,
                                      [task.id]: nextValue,
                                    }));
                                    if (nextValue !== previousValue) {
                                      setReviewEditsByTaskId((current) => ({
                                        ...current,
                                        [task.id]: true,
                                      }));
                                    }
                                    setCommentsByTaskId((current) => {
                                      const existingComments = current[task.id] ?? [];
                                      if (existingComments.length === 0 || previousValue === nextValue) {
                                        return current;
                                      }

                                      const rebasedComments = rebaseCommentsForTextEdit(
                                        previousValue,
                                        nextValue,
                                        existingComments,
                                      );

                                      return {
                                        ...current,
                                        [task.id]: rebasedComments,
                                      };
                                    });
                                    const activePendingComment = pendingComment;
                                    if (activePendingComment && entitySameId(activePendingComment.taskId, task.id)) {
                                      const rebasedPending = rebaseRangeForTextEdit(
                                        previousValue,
                                        nextValue,
                                        activePendingComment,
                                      );
                                      setPendingComment(
                                        rebasedPending
                                          ? {
                                              ...activePendingComment,
                                              startOffset: rebasedPending.startOffset,
                                              endOffset: rebasedPending.endOffset,
                                              quotedText: rebasedPending.quotedText,
                                            }
                                          : null,
                                      );
                                    }
                                  }}
                                  onRangeSelected={(nextDraft) => {
                                    setActiveMemoTaskId(task.id);
                                    setPendingComment(nextDraft);
                                    setPendingCommentText('');
                                  }}
                                  onSelectionCleared={() => {
                                    if (!entitySameId(pendingComment?.taskId, task.id)) {
                                      return;
                                    }
                                    if (pendingCommentText.trim().length > 0) {
                                      return;
                                    }
                                    setPendingComment(null);
                                  }}
                                  onRemoveRevision={({ revisionId, pending }) => {
                                    setActiveMemoTaskId(task.id);
                                    if (pending) {
                                      if (entitySameId(pendingComment?.taskId, task.id)) {
                                        setPendingComment(null);
                                        setPendingCommentText('');
                                      }
                                      return;
                                    }

                                    setCommentsByTaskId((current) => {
                                      const taskComments = current[task.id] ?? [];
                                      const nextTaskComments = taskComments.filter(
                                        (comment) => !entitySameId(comment.id, revisionId),
                                      );
                                      if (nextTaskComments.length === taskComments.length) {
                                        return current;
                                      }
                                      setReviewEditsByTaskId((dirtyByTask) => ({
                                        ...dirtyByTask,
                                        [task.id]: true,
                                      }));
                                      return {
                                        ...current,
                                        [task.id]: nextTaskComments,
                                      };
                                    });
                                  }}
                                />
                                <DocumentMentionSuggestionList
                                  suggestions={summaryMentionSuggestions}
                                  onSelect={(document) => {
                                    if (!summaryMentionTrigger) {
                                      return;
                                    }
                                    setActiveMemoTaskId(task.id);
                                    const nextValue = applyDocumentMention(
                                      draftText,
                                      summaryMentionTrigger,
                                      document.name,
                                    );
                                    setEditorDraftByTaskId((current) => ({
                                      ...current,
                                      [task.id]: nextValue,
                                    }));
                                    setReviewEditsByTaskId((current) => ({
                                      ...current,
                                      [task.id]: true,
                                    }));
                                  }}
                                />
                              </Box>

                              <Box
                                sx={{
                                  minWidth: 0,
                                  alignSelf: 'stretch',
                                  minHeight: 0,
                                  height: '100%',
                                  display: 'flex',
                                  flexDirection: 'column',
                                }}
                              >
                                <TextField
                                  size="small"
                                  multiline
                                  label="Feedback for Agent"
                                  placeholder="Add reviewer guidance for the agent..."
                                  value={generalFeedback}
                                  onFocus={() => setActiveMemoTaskId(task.id)}
                                  onChange={(event) => {
                                    setActiveMemoTaskId(task.id);
                                    const nextValue = event.target.value;
                                    setGeneralFeedbackByTaskId((current) => ({
                                      ...current,
                                      [task.id]: nextValue,
                                    }));
                                    setReviewEditsByTaskId((current) => ({
                                      ...current,
                                      [task.id]: true,
                                    }));
                                  }}
                                  sx={{
                                    flex: 1,
                                    '& .MuiInputBase-root': {
                                      height: '100%',
                                      alignItems: 'flex-start',
                                      py: 0.6,
                                    },
                                    '& .MuiInputBase-inputMultiline': {
                                      height: '100% !important',
                                      overflow: 'auto !important',
                                    },
                                  }}
                                />
                                <DocumentMentionSuggestionList
                                  suggestions={feedbackMentionSuggestions}
                                  onSelect={(document) => {
                                    if (!feedbackMentionTrigger) {
                                      return;
                                    }
                                    setActiveMemoTaskId(task.id);
                                    const nextValue = applyDocumentMention(
                                      generalFeedback,
                                      feedbackMentionTrigger,
                                      document.name,
                                    );
                                    setGeneralFeedbackByTaskId((current) => ({
                                      ...current,
                                      [task.id]: nextValue,
                                    }));
                                    setReviewEditsByTaskId((current) => ({
                                      ...current,
                                      [task.id]: true,
                                    }));
                                  }}
                                />
                              </Box>
                            </Box>
                            {followupQuestions.length > 0 ? (
                              <Stack spacing={1} sx={{ mt: 1 }}>
                                {followupQuestions.map((question) => (
                                  <TextField
                                    key={`${task.id}-${question.id}`}
                                    size="small"
                                    multiline
                                    minRows={2}
                                    label={question.question}
                                    value={followupAnswersByTaskId[task.id]?.[question.id] ?? ''}
                                    onFocus={() => setActiveMemoTaskId(task.id)}
                                    onChange={(event) => {
                                      setActiveMemoTaskId(task.id);
                                      const nextValue = event.target.value;
                                      setFollowupAnswersByTaskId((current) => ({
                                        ...current,
                                        [task.id]: {
                                          ...(current[task.id] ?? {}),
                                          [question.id]: nextValue,
                                        },
                                      }));
                                      setReviewEditsByTaskId((current) => ({
                                        ...current,
                                        [task.id]: true,
                                      }));
                                    }}
                                  />
                                ))}
                              </Stack>
                            ) : null}
                          </Collapse>
                        </Paper>
                      );
                    })}
                    </Stack>
                  </>
                )}
              </Paper>
            </Box>
          </Box>
        </Box>
      )}

      {pendingComment ? (
        <Paper
          sx={{
            position: 'fixed',
            left: pendingComment.anchorX,
            top: pendingComment.anchorY,
            transform: 'translateY(-100%)',
            zIndex: 1600,
            width: 320,
            p: 1,
            borderColor: 'var(--sp-active-blue)',
            bgcolor: 'var(--sp-panel-bg)',
          }}
        >
          <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5 }}>Add Revision Comment</Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--sp-muted-text)', mb: 0.75 }}>
            “{pendingComment.quotedText}”
          </Typography>
          <TextField
            size="small"
            multiline
            minRows={2}
            fullWidth
            value={pendingCommentText}
            onChange={(event) => setPendingCommentText(event.target.value)}
            placeholder="Explain what should be revised..."
          />
          <DocumentMentionSuggestionList
            suggestions={pendingCommentMentionSuggestions}
            onSelect={(document) => {
              if (!pendingCommentMentionTrigger) {
                return;
              }
              setPendingCommentText((current) =>
                applyDocumentMention(current, pendingCommentMentionTrigger, document.name),
              );
            }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 0.75 }}>
            <Button
              size="small"
              onClick={() => {
                setPendingComment(null);
                setPendingCommentText('');
              }}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={!pendingCommentText.trim()}
              onClick={() => {
                const draft = pendingComment;
                if (!draft) {
                  return;
                }

                setCommentsByTaskId((current) => ({
                  ...current,
                  [draft.taskId]: [
                    ...(current[draft.taskId] ?? []),
                    {
                      id: crypto.randomUUID(),
                      startOffset: draft.startOffset,
                      endOffset: draft.endOffset,
                      quotedText: draft.quotedText,
                      comment: pendingCommentText.trim(),
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }));
                setReviewEditsByTaskId((current) => ({
                  ...current,
                  [draft.taskId]: true,
                }));
                setPendingComment(null);
                setPendingCommentText('');
              }}
            >
              Add
            </Button>
          </Stack>
        </Paper>
      ) : null}
    </Box>
  );
}
