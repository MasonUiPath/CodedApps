# Component Guide

## Goals
- Keep features small and composable so each implementation step fits in a narrow context window.
- Separate domain logic (underwriting rules/state) from presentation components.
- Reuse visual and interaction primitives across intake, review, and approval experiences.

## Top-Level App Composition
- `AppShell`
- `AppHeader`
- `LoanBoardScreen`
- `LoanWorkspaceScreen`

## Recommended Folder Structure
```text
src/
  app/
    AppShell.tsx
    AppRouter.tsx
    routes.ts
  screens/
    LoanBoardScreen.tsx
    LoanWorkspaceScreen.tsx
  theme/
    tokens.ts
    muiTheme.ts
  features/
    loans/
      components/
      hooks/
      services/
      types.ts
    intake/
      components/
      hooks/
      services/
      types.ts
    agentTasks/
      components/
      hooks/
      services/
      types.ts
    memo/
      components/
      hooks/
      services/
      types.ts
    reviews/
      components/
      hooks/
      services/
      types.ts
    integrations/
      components/
      hooks/
      services/
      types.ts
  components/
    layout/
    navigation/
    feedback/
    forms/
    data-display/
  hooks/
  services/
  state/
  utils/
```

## Shared UI Primitives
- `PageHeader`: title, subtitle, action area, optional status chips.
- `PanelCard`: common bordered card with consistent padding and header.
- `InfoRow`: label/value display for borrower or loan metadata.
- `SectionStack`: standard section spacing wrapper.
- `StatusPill`: consistent status color mapping and icon support.
- `EmptyState`: reusable no-data state with call-to-action.
- `AuditEventItem`: rendered event log item for transition/task updates.

## Screen-Level Layout Components
- `LoanCardGrid`
- `LoanCard`
- `StartLoanCard` (blue arrow CTA)
- `WorkspaceTopTabs`
- `FlowVisualizerPanel`
- `LoanPackageSplitView`
- `LoanFileExplorer`
- `LoanPdfViewer`
- `AgentStatusPanel`
- `ReviewActionPanel`
- `MemoDocumentEditor`
- `MemoSectionEditor`
- `FollowupQuestionsPanel`
- `GeneralFeedbackBox`

## Feature Modules
- `loans`
- Responsibilities:
- Case queue list, filters, sorting, assignment actions.
- Suggested components:
- `CaseQueueTable`, `CaseQueueFilters`, `CaseQueueToolbar`, `CaseQueueRowActions`.

- `intake`
- Responsibilities:
- Loan package ingest/index progress and metadata verification.
- Suggested components:
- `IntakeStatusCard`, `PackageArtifactList`, `IndexingProgress`.

- `agentTasks`
- Responsibilities:
- BPMN parallel branch tracking for memo section generation tasks.
- Suggested components:
- `AgentTaskBoard`, `AgentTaskLane`, `AgentTaskCard`, `AgentTaskOutputPreview`.

- `memo`
- Responsibilities:
- Draft memo composition from agent outputs and user edits.
- Suggested components:
- `MemoComposer`, `MemoSectionEditor`, `MemoSectionSourceBadge`, `MemoVersionPanel`.

- `reviews`
- Responsibilities:
- Underwriter and manager decision workflows with approve/revision loop.
- Suggested components:
- `UnderwriterReviewPanel`, `ManagerReviewPanel`, `DecisionActionBar`, `RevisionNotes`.

- `integrations`
- Responsibilities:
- Post-approval execution to Salesforce and completion state reporting.
- Suggested components:
- `IntegrationStatusPanel`, `SalesforceSyncCard`, `CompletionChecklist`.

## BPMN to Feature Mapping
- `Loan Package Intake` subprocess -> `intake` feature.
- `Create Agent Tasks` event + `Draft Credit Memo` parallel branches -> `agentTasks` + `memo`.
- `Underwriter Review` subprocess -> `reviews` (underwriter mode).
- `Manager Review` subprocess -> `reviews` (manager mode).
- `Save Memo to Salesforce` + flag setting -> `integrations`.

## TaskType Enum (Canonical)
- `executive_summary`
- `financial_analysis`
- `collateral`
- `covenants`
- `risk_strength_analysis`
- `risk_rating_rac`
- `relationship_summary`
- `industry_search`

## State and Data Boundaries
- Keep server calls in `services/` and never inside presentational components.
- Keep transformation logic in feature hooks (`useLoanQueue`, `useAgentTasks`, `useMemoDraft`, `useReviewFlow`).
- Use typed DTOs at service boundaries and feature-level view models in hooks.
- Maintain a single selected-loan context in app-level state, consumed by feature hooks.
- Add a thin adapter layer in `features/agentTasks/services` to map canonical UI names to staging fields:
- `TaskType <-> Type`
- `LoanId <-> Loan`
- `FeedbackText <-> Feedback`
- `FollowupQuestionsJson <-> AgentFollowupQuestions`

## UI State Modes (Workspace Screen)
- `monitoring_mode`
- Active while agent tasks are running and no review decision is pending.
- Emphasizes `AgentStatusPanel`.

- `review_mode_underwriter`
- Active when loan is in underwriter review.
- Emphasizes `MemoDocumentEditor` + `ReviewActionPanel`.

- `review_mode_manager`
- Active when loan is in manager review.
- Same layout as underwriter with manager decision controls.

## Implementation Order (Small Iterations)
1. Build `AppShell` + layout primitives.
2. Implement `loans` queue + selected loan context.
3. Implement `intake` and `agentTasks` views with mock events.
4. Implement `memo` compose surface.
5. Implement `reviews` with approve/revision actions.
6. Implement `integrations` completion path.
7. Integrate real APIs and coordinator websocket, then add audit/event rail.

## Naming Conventions
- Components: `PascalCase` (`AgentTaskBoard.tsx`).
- Hooks: `use` prefix (`useAgentTasks.ts`).
- Services: `camelCase` with `.service.ts` suffix (`loan.service.ts`).
- Types: colocated `types.ts` within each feature.

## Reuse Rules
- If used by 2+ features, promote to `src/components` or `src/hooks`.
- If logic includes underwriting domain terms, keep in feature scope.
- If a component accepts more than 8 props, prefer a typed view-model object.
