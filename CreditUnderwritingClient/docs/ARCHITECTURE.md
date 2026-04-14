# Credit Loan Underwriting Architecture

## Source of Truth
- Process model: `CreditUnderwritingClient/docs/Credit-Loan-Underwriting-2.bpmn`
- This document maps the app architecture directly to that BPMN.

## Product Goal
- Build a business-facing underwriting workspace that orchestrates the credit loan lifecycle.
- Generate, review, revise, and approve a credit memo from a loan package using parallel agent tasks.
- Provide realtime visibility via StreamPath status + coordinator socket events.
- Reuse and extend the existing Data Service entities already created for loan and agent tasks.

## BPMN-Derived Process Flow
1. `New Loan Received`
2. Subprocess `Loan Package Intake`
   - `Update Step` (set ingesting)
   - `Save Loan Package`
   - `Index Loan Package`
3. `Create Agent Tasks`
4. Subprocess `Draft Credit Memo`
   - `Update Step` (set drafting)
   - Parallel fan-out from `Start Research Agents`
   - 8 parallel tasks:
   - `Executive Summary Agent`
   - `Financial Analysis Agent`
   - `Collateral Agent`
   - `Covenants Agent`
   - `Risk/Strength Analysis Agent`
   - `Risk Rating (RAC) Agent`
   - `Relationship Summary`
   - `Industry Search`
   - Each branch emits `Update Task`
   - Parallel join, then `Draft Credit Memo`
5. Subprocess `Underwriter Review`
   - `Review Draft Credit Memo`
   - `Approved` -> `Manager Review`
   - `Revisions` -> back to `Draft Credit Memo`
6. Subprocess `Manager Review`
   - `Review Draft Credit Memo`
   - `Approved` -> `Update Step` (Processing Approved Loan) -> Salesforce tasks
   - `Revisions` -> back to `Draft Credit Memo`
7. `Save Memo to Saleesforce`
8. `Setting the Salesforce Flag in Salesforce`
9. `Mark Complete`

## Domain Entities

### 1) `E2ELoan`
- Purpose: one record per loan underwriting case.
- Current staging schema is minimal and currently acts as the parent case container.
- Has StreamPath flow attached for loan lifecycle.

Verified staging schema snapshot (pulled on April 2, 2026):
- `Id` (`UUID`, system, primary key)
- `Name` (`STRING`, required, maxLength 200)
- `CreateTime` (`DATETIME_WITH_TZ`, system)
- `UpdateTime` (`DATETIME_WITH_TZ`, system)
- `CreatedBy` (`UUID`, FK -> `SystemUser`)
- `UpdatedBy` (`UUID`, FK -> `SystemUser`)

Planned extensions (future entity updates):
- `LoanNumber`, `BorrowerName`, `RequestedAmount`, `Currency`
- `PackageUri`, `PackageIndexedAt`
- `MemoComposedJson`
- `UnderwriterDecision`, `ManagerDecision`
- `SalesforceRecordId`, `SalesforceSyncState`
- `LastError`, `CorrelationId`

### 2) `E2EAgentTask`
- Purpose: one record per agent work item per loan.
- Tracks parallel memo section generation and outputs.
- Has StreamPath flow attached for agent task lifecycle.
- Includes all 8 BPMN branches as task records, including `Relationship Summary` and `Industry Search`.

Verified staging schema snapshot (pulled on April 2, 2026):
- `Id` (`UUID`, system, primary key)
- `Type` (`STRING`, required, maxLength 200)
- `SummaryText` (`MULTILINE_TEXT`, maxLength 10000)
- `Feedback` (`MULTILINE_TEXT`, maxLength 10000)
- `AgentFollowupQuestions` (`MULTILINE_TEXT`, maxLength 10000)
- `Confidence` (`DECIMAL`, precision 2)
- `Loan` (`UUID`, FK -> `E2ELoan`)
- `CreateTime` (`DATETIME_WITH_TZ`, system)
- `UpdateTime` (`DATETIME_WITH_TZ`, system)
- `CreatedBy` (`UUID`, FK -> `SystemUser`)
- `UpdatedBy` (`UUID`, FK -> `SystemUser`)

Canonical app model mapping (UI aliases -> actual staging fields):
- `TaskType` -> `Type`
- `LoanId` -> `Loan`
- `FeedbackText` -> `Feedback`
- `FollowupQuestionsJson` -> `AgentFollowupQuestions`

Planned extensions (future entity updates):
- `TaskKey`, `TaskName`, `AgentName`, `PromptVersion`, `InputContextRef`
- `OutputJson`, `UsesStaticInput`, `StatusMessage`
- `StartedAt`, `CompletedAt`, `Error`, `Attempt`

Versioning rule:
- Revision cycles overwrite the current task output fields (`SummaryText`, `OutputJson`) rather than creating memo versions.
- Auditability is preserved through StreamPath/status history + event logs.

## StreamPath Status Design

### Loan (`E2ELoan`) flow
- `NewLoanReceived`
- `Ingesting`
- `AgentTasksCreated`
- `DraftCreditMemo`
- `UnderwriterReview`
- `ManagerReview`
- `ProcessingApprovedLoan`
- `Completed`
- `Failed` (recommended terminal error status)

Key transitions from BPMN:
- `UnderwriterReview -> DraftCreditMemo` (Revisions)
- `ManagerReview -> DraftCreditMemo` (Revisions)
- `ManagerReview -> ProcessingApprovedLoan` (Approved)

### Agent task (`E2EAgentTask`) flow
- `Created`
- `Queued`
- `InProgress`
- `Completed`
- `Failed`
- `Cancelled` (optional)

SLA rule:
- No timeout/SLA-driven failure automation in the initial release.

## Locked Decisions From Answers
- Memo section content is stored and iterated on `E2EAgentTask` records.
- Revision cycles overwrite current agent output fields instead of creating memo versions.
- All 8 BPMN branches are represented as `E2EAgentTask` records.
- `Relationship Summary` and `Industry Search` use the same task payload shape as other agent tasks.
- Salesforce processing is orchestrator-driven and out of scope for front-end field mapping.
- Audit actor categories for timeline display are `User`, `Agent`, and `System`.

Canonical `TaskType` values:
- `executive_summary`
- `financial_analysis`
- `collateral`
- `covenants`
- `risk_strength_analysis`
- `risk_rating_rac`
- `relationship_summary`
- `industry_search`

## Orchestration and Event Model
- Frontend subscribes through StreamPath Coordinator websocket.
- App listens for:
- entity-change events for `E2ELoan`
- entity-change events for `E2EAgentTask`
- command result/error events for UI-initiated actions

Backend/coordinator responsibilities:
- Translate websocket events into feature-level state updates.
- Enforce transition validation before write (when write originates from app).
- Support optimistic UI only for user actions; reconcile on event acknowledgment.
- Auto-trigger Salesforce integration when manager review transitions to approved.

## UI Architecture by BPMN Phase
- Intake Workspace: loan package ingestion and indexing status.
- Agent Workbench: parallel task board with 8 memo section tasks and live status.
- Memo Composer: assembled memo sections + editable narrative.
- Underwriter Review Desk: approve or request revisions with comments.
- Manager Review Desk: final approval/revisions with audit trail.
- Completion + Integration Panel: Salesforce save/flag progress and completion state.

## UI Layout Blueprint (2 Main Screens)

### Screen 1: Loan Board
- Purpose: entry point listing all in-process loans from `E2ELoan`.
- Primary UI: card grid (one card per loan).
- Card behavior:
- Click loan card -> open Screen 2 for that loan context.
- Last card is always `Start New Loan` with a blue arrow CTA.
- `Start New Loan` action creates/initializes loan process then navigates to Screen 2.

### Screen 2: Loan Workspace
- Purpose: full working area for one selected loan.
- Layout: top panel + lower split panel.

Top panel:
- Tab A: Loan Flow Visualizer (same visualizer behavior/parity as StreamPath client visualizer).
- Tab B: Loan Package View with horizontal split:
- left = file explorer for loan package files
- right = PDF viewer for selected file

Lower-left panel:
- Live list of agent task statuses while running.
- When process is in review decision points, this area switches to validation actions:
- underwriter decision (`Approve` / `Revision`)
- manager decision (`Approve` / `Revision`)

Lower-right panel (Revision/Validation editor):
- Full credit memo shown in document-like layout.
- Each agent-generated section is editable via rich text editor.
- Right-side companion panel inside this area:
- follow-up questions for the selected section with answer inputs
- general feedback box below follow-up questions

State-driven behavior:
- If not in review phase, show task monitoring emphasis.
- If in underwriter/manager review phase, show memo editing + decision controls emphasis.

## Realtime UX Rules
- Loan status chip always visible and live.
- Agent tasks shown as grouped parallel branches by `TaskType`.
- Revisions reset only the memo-drafting-related statuses, not immutable intake metadata.
- Every transition must emit user-visible event log entry with timestamp and actor/source.
- Review comments/feedback are captured in associated `E2EAgentTask` records.

## Services and Boundaries
- `loan.service`: CRUD + transition operations for `E2ELoan`.
- `agentTask.service`: query/update/retry operations for `E2EAgentTask`.
- `memo.service`: assembly/read/write for memo document sections.
- `transition.service`: shared validation helper for status transition guard logic.
- `eventStream.service`: websocket lifecycle, reconnect, and dispatch.

## Error Handling
- Recoverable errors: show inline retry actions (task-level).
- Non-recoverable errors: push loan to `Failed` with reason.
- Stale update guard: reject writes if record version/timestamp has advanced.

## Audit and Traceability
- Persist transition history with:
- `entityType`, `recordId`, `fromStatusId`, `toStatusId`
- action source (`user`, `agent`, `system`)
- `correlationId`
- note/comment for review decisions

## MVP Delivery Slices
1. Entity schemas + StreamPath definitions for `E2ELoan` and `E2EAgentTask`.
2. Loan list + case detail shell with websocket updates.
3. Parallel agent task board and task detail.
4. Memo compose/review workspace with revision loop.
5. Manager approval + Salesforce completion path.

## Remaining Inputs Needed
- None for current architecture baseline.
- Next step is implementation against the verified schema snapshot + alias mapping above.
