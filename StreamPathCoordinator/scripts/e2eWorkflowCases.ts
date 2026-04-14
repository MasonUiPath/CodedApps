import { loadConfig } from '../src/config.js';
import { createUiPathAuthProvider } from '../src/uipathAuthProvider.js';
import { UiPathRelay } from '../src/uipathRelay.js';

type EntityRecord = Record<string, unknown>;
type ChangeType = 'CREATED' | 'UPDATED' | 'DELETED';

type FlowContext = {
  entityName: string;
  flowDefinitionId: string;
  nodes: EntityRecord[];
  transitions: EntityRecord[];
  nodeById: Map<string, EntityRecord>;
};

type WorkflowRunSummary = {
  caseName: string;
  entityName: string;
  recordId: string;
  flowDefinitionId: string;
  instanceId: string;
  pathLabels: string[];
};

type AgentTaskSampleTemplate = {
  summaryText?: string;
  feedback?: string;
  followupQuestions?: string;
  confidence?: number;
};

const FLOW_ENTITY = 'StreamPathStatusFlowDefinition';
const NODE_ENTITY = 'StreamPathStatusNode';
const TRANSITION_ENTITY = 'StreamPathStatusTransition';
const INSTANCE_ENTITY = 'StreamPathStatusInstance';

const AGENT_TASK_TYPES = [
  'executive_summary',
  'financial_analysis',
  'collateral',
  'covenants',
  'risk_strength_analysis',
  'risk_rating_rac',
  'relationship_summary',
  'industry_search',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractItems(payload: unknown): EntityRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (isRecord(payload) && Array.isArray(payload.items)) {
    return payload.items.filter(isRecord);
  }

  if (isRecord(payload) && Array.isArray(payload.value)) {
    return payload.value.filter(isRecord);
  }

  if (isRecord(payload) && Array.isArray(payload.content)) {
    return payload.content.filter(isRecord);
  }

  return [];
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

function sameId(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toUpperCase() === right.toUpperCase());
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseArgs(argv: string[]): {
  caseName:
    | 'loan-full'
    | 'agent-full'
    | 'agent-batch'
    | 'loan-init'
    | 'agent-init'
    | 'loan-step'
    | 'agent-step'
    | 'loan-list'
    | 'agent-list';
  coordinatorUrl: string;
  loanRecordId?: string;
  recordId?: string;
  targetNodeId?: string;
  targetLabel?: string;
  taskType?: string;
} {
  const args = argv.slice(2);
  let caseName:
    | 'loan-full'
    | 'agent-full'
    | 'agent-batch'
    | 'loan-init'
    | 'agent-init'
    | 'loan-step'
    | 'agent-step'
    | 'loan-list'
    | 'agent-list' = 'loan-full';
  let coordinatorUrl = process.env.COORDINATOR_HTTP_URL ?? 'http://localhost:8080';
  let loanRecordId: string | undefined;
  let recordId: string | undefined;
  let targetNodeId: string | undefined;
  let targetLabel: string | undefined;
  let taskType: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];

    if (token === '--case' && next) {
      if (
        next === 'loan-full' ||
        next === 'agent-full' ||
        next === 'agent-batch' ||
        next === 'loan-init' ||
        next === 'agent-init' ||
        next === 'loan-step' ||
        next === 'agent-step' ||
        next === 'loan-list' ||
        next === 'agent-list'
      ) {
        caseName = next;
      }
      index += 1;
      continue;
    }

    if (token === '--coordinator-url' && next) {
      coordinatorUrl = next;
      index += 1;
      continue;
    }

    if (token === '--loan-record-id' && next) {
      loanRecordId = next;
      index += 1;
      continue;
    }

    if (token === '--record-id' && next) {
      recordId = next;
      index += 1;
      continue;
    }

    if (token === '--target-node-id' && next) {
      targetNodeId = next;
      index += 1;
      continue;
    }

    if (token === '--target-label' && next) {
      targetLabel = next;
      index += 1;
      continue;
    }

    if (token === '--task-type' && next) {
      taskType = next;
      index += 1;
      continue;
    }
  }

  return {
    caseName,
    coordinatorUrl: coordinatorUrl.replace(/\/+$/, ''),
    loanRecordId,
    recordId,
    targetNodeId,
    targetLabel,
    taskType,
  };
}

class WorkflowTestRunner {
  private readonly relay: UiPathRelay;

  private readonly coordinatorUrl: string;

  public constructor(coordinatorUrl: string) {
    const config = loadConfig();
    const authProvider = createUiPathAuthProvider(config);

    this.relay = new UiPathRelay(config, authProvider);
    this.coordinatorUrl = coordinatorUrl;

    console.log('[workflow-test] configuration', {
      coordinatorUrl: this.coordinatorUrl,
      uipathBaseUrl: `${config.uipathBaseUrl.replace(/\/+$/, '')}/${config.uipathOrgName}/${config.uipathTenantName}`,
      authMode: config.uipathAuthMode,
    });
  }

  private async getAllRecords(entityTypeName: string, limit = 5000): Promise<EntityRecord[]> {
    const result = await this.relay.execute({
      type: 'command',
      command: 'GET_MANY',
      entityTypeName,
      options: {
        limit,
        expansionLevel: 2,
      },
    });

    return extractItems(result.data);
  }

  private async createRecord(entityTypeName: string, data: Record<string, unknown>): Promise<EntityRecord> {
    const result = await this.relay.execute({
      type: 'command',
      command: 'CREATE',
      entityTypeName,
      data,
      options: {
        expansionLevel: 2,
      },
    });

    if (!isRecord(result.data)) {
      throw new Error(`CREATE ${entityTypeName} returned a non-record payload`);
    }

    return result.data;
  }

  private async updateRecord(
    entityTypeName: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.relay.execute({
      type: 'command',
      command: 'UPDATE',
      entityTypeName,
      recordId,
      data,
      options: {
        expansionLevel: 2,
      },
    });
  }

  private async postCoordinatorEvent(input: {
    entityId: string;
    entityTypeName: string;
    changeType: ChangeType;
    payload?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const body = {
      entityId: input.entityId,
      entityTypeName: input.entityTypeName,
      changedAt: nowIso(),
      changeType: input.changeType,
      source: 'workflow_test_runner',
      payload:
        input.payload ?? {
          RecordId: input.entityId,
        },
    };

    const response = await fetch(`${this.coordinatorUrl}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: unknown = text;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      throw new Error(
        `POST /events failed (${response.status}): ${
          typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
        }`,
      );
    }

    if (!isRecord(parsed)) {
      throw new Error(`POST /events returned unexpected payload: ${JSON.stringify(parsed)}`);
    }

    if (!asBoolean(parsed.accepted)) {
      throw new Error(`POST /events was not accepted: ${JSON.stringify(parsed)}`);
    }

    console.log('[workflow-test] /events accepted', {
      entityTypeName: input.entityTypeName,
      entityId: input.entityId,
      changeType: input.changeType,
    });

    return parsed;
  }

  private async postStatusTransition(input: {
    entityName: string;
    recordId: string;
    targetNodeId: string;
  }): Promise<Record<string, unknown>> {
    const body = {
      entityName: input.entityName,
      RecordId: input.recordId,
      NewStatusId: input.targetNodeId,
    };

    const response = await fetch(`${this.coordinatorUrl}/status/transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: unknown = text;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      throw new Error(
        `POST /status/transition failed (${response.status}): ${
          typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
        }`,
      );
    }

    if (!isRecord(parsed)) {
      throw new Error(
        `POST /status/transition returned unexpected payload: ${JSON.stringify(parsed)}`,
      );
    }

    if (!asBoolean(parsed.accepted)) {
      throw new Error(`POST /status/transition was not accepted: ${JSON.stringify(parsed)}`);
    }

    const changed = asBoolean(parsed.changed);
    console.log('[workflow-test] /status/transition accepted', {
      recordId: input.recordId,
      targetNodeId: input.targetNodeId,
      changed,
    });

    return parsed;
  }

  private assertCreatedEventInitialized(
    eventResponse: Record<string, unknown>,
    entityTypeName: string,
    recordId: string,
  ): void {
    const initialization = isRecord(eventResponse.initialization) ? eventResponse.initialization : null;
    if (!initialization || !asBoolean(initialization.initialized)) {
      throw new Error(
        `Expected coordinator CREATED event to initialize workflow for ${entityTypeName}/${recordId}. Response: ${JSON.stringify(eventResponse)}`,
      );
    }
  }

  private async getFlowContext(entityName: string): Promise<FlowContext> {
    const allFlows = await this.getAllRecords(FLOW_ENTITY, 2000);
    const flows = allFlows
      .filter((record) => normalizeLabel(asString(record.TargetEntityType)) === normalizeLabel(entityName))
      .sort((left, right) => {
        if (asBoolean(left.IsActive) !== asBoolean(right.IsActive)) {
          return asBoolean(left.IsActive) ? -1 : 1;
        }

        return asNumber(right.Version) - asNumber(left.Version);
      });

    const selected = flows[0];

    if (!selected) {
      throw new Error(`No flow definition found for ${entityName}`);
    }

    const flowDefinitionId = getRecordId(selected);
    if (!flowDefinitionId) {
      throw new Error(`Flow definition for ${entityName} is missing Id`);
    }

    const allNodes = await this.getAllRecords(NODE_ENTITY, 5000);
    const allTransitions = await this.getAllRecords(TRANSITION_ENTITY, 5000);

    const nodes = allNodes.filter((node) => sameId(getRelatedId(node.FlowDefinition), flowDefinitionId));
    const transitions = allTransitions.filter((transition) =>
      sameId(getRelatedId(transition.FlowDefinition), flowDefinitionId),
    );

    const nodeById = new Map<string, EntityRecord>();
    for (const node of nodes) {
      const id = getRecordId(node);
      if (id) {
        nodeById.set(id, node);
      }
    }

    return {
      entityName,
      flowDefinitionId,
      nodes,
      transitions,
      nodeById,
    };
  }

  private getPrimaryPath(flow: FlowContext): string[] {
    const nodeIds = flow.nodes.map(getRecordId).filter((id): id is string => Boolean(id));

    if (nodeIds.length === 0) {
      throw new Error(`Flow ${flow.flowDefinitionId} has no nodes`);
    }

    const outgoing = new Map<string, string[]>();
    const incomingCount = new Map<string, number>();

    for (const nodeId of nodeIds) {
      outgoing.set(nodeId, []);
      incomingCount.set(nodeId, 0);
    }

    for (const transition of flow.transitions) {
      const fromNodeId = getRelatedId(transition.FromNode);
      const toNodeId = getRelatedId(transition.ToNode);

      if (!fromNodeId || !toNodeId) {
        continue;
      }

      outgoing.get(fromNodeId)?.push(toNodeId);
      incomingCount.set(toNodeId, (incomingCount.get(toNodeId) ?? 0) + 1);

      if (asBoolean(transition.Bidirectional)) {
        outgoing.get(toNodeId)?.push(fromNodeId);
        incomingCount.set(fromNodeId, (incomingCount.get(fromNodeId) ?? 0) + 1);
      }
    }

    const explicitStart = flow.nodes.find((node) => asBoolean(node.IsStart));
    const explicitStartId = getRecordId(explicitStart);
    const startNodeId =
      explicitStartId ?? nodeIds.find((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0) ?? nodeIds[0];

    const explicitTerminalIds = flow.nodes
      .filter((node) => asBoolean(node.IsTerminal))
      .map(getRecordId)
      .filter((id): id is string => Boolean(id));

    const fallbackTerminalIds = nodeIds.filter((nodeId) => (outgoing.get(nodeId)?.length ?? 0) === 0);
    const terminalCandidates =
      explicitTerminalIds.length > 0
        ? explicitTerminalIds
        : fallbackTerminalIds.length > 0
          ? fallbackTerminalIds
          : [nodeIds[nodeIds.length - 1]];

    const terminalRank = (nodeId: string): number => {
      const node = flow.nodeById.get(nodeId);
      const label = normalizeLabel(asString(node?.Label));

      if (label.includes('complete') || label.includes('approved') || label.includes('end')) {
        return 0;
      }

      if (label.includes('failed') || label.includes('cancel')) {
        return 2;
      }

      return 1;
    };

    terminalCandidates.sort((left, right) => terminalRank(left) - terminalRank(right));

    const findPath = (targetNodeId: string): string[] | null => {
      const queue: string[] = [startNodeId];
      const visited = new Set<string>([startNodeId]);
      const previous = new Map<string, string>();

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }

        if (sameId(current, targetNodeId)) {
          const path: string[] = [current];
          let cursor: string | undefined = current;
          while (cursor && previous.has(cursor)) {
            cursor = previous.get(cursor);
            if (cursor) {
              path.unshift(cursor);
            }
          }
          return path;
        }

        const nextNodes = outgoing.get(current) ?? [];
        for (const nextNode of nextNodes) {
          if (visited.has(nextNode)) {
            continue;
          }

          visited.add(nextNode);
          previous.set(nextNode, current);
          queue.push(nextNode);
        }
      }

      return null;
    };

    for (const targetNodeId of terminalCandidates) {
      const path = findPath(targetNodeId);
      if (path && path.length > 0) {
        return path;
      }
    }

    throw new Error(
      `Unable to resolve a path from ${startNodeId} to any terminal node in flow ${flow.flowDefinitionId}`,
    );
  }

  private async getStatusInstance(
    entityName: string,
    recordId: string,
    flowDefinitionId?: string,
  ): Promise<EntityRecord | null> {
    const instances = await this.getAllRecords(INSTANCE_ENTITY, 5000);

    const matching = instances.filter((instance) => {
      const sameTargetEntity =
        normalizeLabel(asString(instance.TargetEntityType)) === normalizeLabel(entityName);
      const sameRecord = sameId(asString(instance.TargetRecordId), recordId);
      const sameFlow =
        !flowDefinitionId || sameId(getRelatedId(instance.FlowDefinition), flowDefinitionId);

      return sameTargetEntity && sameRecord && sameFlow;
    });

    if (matching.length === 0) {
      return null;
    }

    matching.sort((left, right) => {
      const leftTime = Date.parse(asString(left.UpdateTime));
      const rightTime = Date.parse(asString(right.UpdateTime));
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });

    return matching[0];
  }

  private async waitForInitialization(
    entityName: string,
    recordId: string,
    flowDefinitionId?: string,
    timeoutMs = 20_000,
  ): Promise<EntityRecord> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const instance = await this.getStatusInstance(entityName, recordId, flowDefinitionId);
      if (instance) {
        return instance;
      }

      await sleep(500);
    }

    throw new Error(
      `Timed out waiting for StreamPathStatusInstance initialization for ${entityName}/${recordId}`,
    );
  }

  private async getHistoryCountForInstance(instanceId: string): Promise<number> {
    const history = await this.getAllRecords('StreamPathStatusHistory', 10_000);
    return history.filter((record) => sameId(getRelatedId(record.StatusInstance), instanceId)).length;
  }

  private getOutgoingCandidates(flow: FlowContext, currentNodeId: string): string[] {
    const candidates: string[] = [];

    for (const transition of flow.transitions) {
      const fromNodeId = getRelatedId(transition.FromNode);
      const toNodeId = getRelatedId(transition.ToNode);
      const bidirectional = asBoolean(transition.Bidirectional);

      if (!fromNodeId || !toNodeId) {
        continue;
      }

      if (sameId(fromNodeId, currentNodeId)) {
        candidates.push(toNodeId);
        continue;
      }

      if (bidirectional && sameId(toNodeId, currentNodeId)) {
        candidates.push(fromNodeId);
      }
    }

    const deduped = new Map<string, string>();
    for (const candidate of candidates) {
      deduped.set(candidate.toUpperCase(), candidate);
    }

    return Array.from(deduped.values());
  }

  public async listAvailableTransitions(
    entityName: 'E2ELoan' | 'E2EAgentTask',
    recordId: string,
  ): Promise<{
    entityName: string;
    recordId: string;
    currentNodeId: string;
    currentLabel: string;
    options: Array<{ nodeId: string; label: string }>;
  }> {
    const flow = await this.getFlowContext(entityName);
    const instance = await this.waitForInitialization(entityName, recordId, flow.flowDefinitionId);
    const currentNodeId = getRelatedId(instance.CurrentNodeKey);
    if (!currentNodeId) {
      throw new Error(`Status instance for ${entityName}/${recordId} is missing CurrentNodeKey`);
    }

    const currentLabel = asString(flow.nodeById.get(currentNodeId)?.Label) || currentNodeId;
    const options = this.getOutgoingCandidates(flow, currentNodeId).map((nodeId) => ({
      nodeId,
      label: asString(flow.nodeById.get(nodeId)?.Label) || nodeId,
    }));

    return {
      entityName,
      recordId,
      currentNodeId,
      currentLabel,
      options,
    };
  }

  public async runLoanInitCase(): Promise<{
    caseName: 'loan-init';
    entityName: 'E2ELoan';
    recordId: string;
    flowDefinitionId: string;
    instanceId: string;
    currentNodeId: string;
    currentLabel: string;
  }> {
    const flow = await this.getFlowContext('E2ELoan');
    const createdLoan = await this.createRecord('E2ELoan', {
      Name: `Loan_Test_${new Date().toISOString().replace(/[:.]/g, '-')}`,
    });
    const recordId = getRecordId(createdLoan);

    if (!recordId) {
      throw new Error('Created E2ELoan record did not contain Id');
    }

    const createdEvent = await this.postCoordinatorEvent({
      entityId: recordId,
      entityTypeName: 'E2ELoan',
      changeType: 'CREATED',
      payload: {
        RecordId: recordId,
      },
    });
    this.assertCreatedEventInitialized(createdEvent, 'E2ELoan', recordId);

    const instance = await this.waitForInitialization('E2ELoan', recordId, flow.flowDefinitionId);
    const instanceId = getRecordId(instance);
    const currentNodeId = getRelatedId(instance.CurrentNodeKey);
    if (!instanceId || !currentNodeId) {
      throw new Error(`Initialized E2ELoan instance is missing required ids for ${recordId}`);
    }

    return {
      caseName: 'loan-init',
      entityName: 'E2ELoan',
      recordId,
      flowDefinitionId: flow.flowDefinitionId,
      instanceId,
      currentNodeId,
      currentLabel: asString(flow.nodeById.get(currentNodeId)?.Label) || currentNodeId,
    };
  }

  public async runAgentInitCase(input?: {
    loanRecordId?: string;
    taskType?: string;
  }): Promise<{
    caseName: 'agent-init';
    entityName: 'E2EAgentTask';
    recordId: string;
    flowDefinitionId: string;
    instanceId: string;
    currentNodeId: string;
    currentLabel: string;
    loanRecordId: string;
    taskType: string;
  }> {
    const parentLoanId = input?.loanRecordId ?? (await this.ensureLoanForAgentTask());
    const taskType = input?.taskType && input.taskType.length > 0 ? input.taskType : AGENT_TASK_TYPES[0];
    const flow = await this.getFlowContext('E2EAgentTask');

    const createdAgentTask = await this.createRecord('E2EAgentTask', {
      Type: taskType,
      Loan: parentLoanId,
      Feedback: 'Created by workflow test runner',
    });
    const recordId = getRecordId(createdAgentTask);
    if (!recordId) {
      throw new Error('Created E2EAgentTask record did not contain Id');
    }

    const createdEvent = await this.postCoordinatorEvent({
      entityId: recordId,
      entityTypeName: 'E2EAgentTask',
      changeType: 'CREATED',
      payload: {
        RecordId: recordId,
        Loan: parentLoanId,
        Type: taskType,
      },
    });
    this.assertCreatedEventInitialized(createdEvent, 'E2EAgentTask', recordId);

    const instance = await this.waitForInitialization('E2EAgentTask', recordId, flow.flowDefinitionId);
    const instanceId = getRecordId(instance);
    const currentNodeId = getRelatedId(instance.CurrentNodeKey);
    if (!instanceId || !currentNodeId) {
      throw new Error(`Initialized E2EAgentTask instance is missing required ids for ${recordId}`);
    }

    return {
      caseName: 'agent-init',
      entityName: 'E2EAgentTask',
      recordId,
      flowDefinitionId: flow.flowDefinitionId,
      instanceId,
      currentNodeId,
      currentLabel: asString(flow.nodeById.get(currentNodeId)?.Label) || currentNodeId,
      loanRecordId: parentLoanId,
      taskType,
    };
  }

  public async runSingleTransitionCase(input: {
    entityName: 'E2ELoan' | 'E2EAgentTask';
    recordId: string;
    targetNodeId?: string;
    targetLabel?: string;
  }): Promise<{
    caseName: 'single-transition';
    entityName: string;
    recordId: string;
    fromNodeId: string;
    fromLabel: string;
    toNodeId: string;
    toLabel: string;
    instanceId: string;
    historyCountBefore: number;
    historyCountAfter: number;
  }> {
    const flow = await this.getFlowContext(input.entityName);
    const instance = await this.waitForInitialization(input.entityName, input.recordId, flow.flowDefinitionId);
    const instanceId = getRecordId(instance);
    const fromNodeId = getRelatedId(instance.CurrentNodeKey);

    if (!instanceId || !fromNodeId) {
      throw new Error(
        `Unable to determine current status instance context for ${input.entityName}/${input.recordId}`,
      );
    }

    const candidates = this.getOutgoingCandidates(flow, fromNodeId);
    if (candidates.length === 0) {
      throw new Error(
        `No outgoing transitions available from current node ${fromNodeId} for ${input.entityName}/${input.recordId}`,
      );
    }

    let toNodeId: string | undefined;

    if (input.targetNodeId) {
      toNodeId = candidates.find((candidate) => sameId(candidate, input.targetNodeId));
      if (!toNodeId) {
        throw new Error(
          `Requested targetNodeId ${input.targetNodeId} is not reachable from current node ${fromNodeId}. Candidates: ${candidates.join(', ')}`,
        );
      }
    } else if (input.targetLabel) {
      const wanted = normalizeLabel(input.targetLabel);
      toNodeId = candidates.find((candidate) => {
        const label = asString(flow.nodeById.get(candidate)?.Label);
        return normalizeLabel(label) === wanted;
      });
      if (!toNodeId) {
        const labels = candidates.map((candidate) => asString(flow.nodeById.get(candidate)?.Label) || candidate);
        throw new Error(
          `Requested targetLabel "${input.targetLabel}" is not reachable from current node ${fromNodeId}. Candidates: ${labels.join(', ')}`,
        );
      }
    } else if (candidates.length === 1) {
      toNodeId = candidates[0];
    } else {
      const labels = candidates.map((candidate) => asString(flow.nodeById.get(candidate)?.Label) || candidate);
      throw new Error(
        `Multiple transitions available from current node ${fromNodeId}. Provide --target-node-id or --target-label. Candidates: ${labels.join(', ')}`,
      );
    }

    const fromLabel = asString(flow.nodeById.get(fromNodeId)?.Label) || fromNodeId;
    const toLabel = asString(flow.nodeById.get(toNodeId)?.Label) || toNodeId;

    const patch =
      input.entityName === 'E2ELoan'
        ? this.loanPatchForStep(fromLabel, toLabel)
        : this.agentPatchForStep(fromLabel, toLabel);
    await this.updateBusinessRecordAndEmit(
      input.entityName,
      input.recordId,
      patch,
      `${fromLabel} -> ${toLabel}`,
    );

    const historyCountBefore = await this.getHistoryCountForInstance(instanceId);
    const transitionResponse = await this.postStatusTransition({
      entityName: input.entityName,
      recordId: input.recordId,
      targetNodeId: toNodeId,
    });
    if (!asBoolean(transitionResponse.changed)) {
      throw new Error(
        `Transition was accepted but did not change state for ${input.entityName}/${input.recordId} (${fromNodeId} -> ${toNodeId})`,
      );
    }

    const refreshed = await this.waitForInitialization(input.entityName, input.recordId, flow.flowDefinitionId);
    const refreshedCurrentNodeId = getRelatedId(refreshed.CurrentNodeKey);
    if (!sameId(refreshedCurrentNodeId, toNodeId)) {
      throw new Error(
        `Transition verification failed for ${input.entityName}/${input.recordId}. Expected current node ${toNodeId}, got ${refreshedCurrentNodeId ?? 'null'}`,
      );
    }

    const historyCountAfter = await this.getHistoryCountForInstance(instanceId);
    if (historyCountAfter <= historyCountBefore) {
      throw new Error(
        `History verification failed for ${input.entityName}/${input.recordId}. Expected history count to increase, previous=${historyCountBefore}, current=${historyCountAfter}`,
      );
    }

    return {
      caseName: 'single-transition',
      entityName: input.entityName,
      recordId: input.recordId,
      fromNodeId,
      fromLabel,
      toNodeId,
      toLabel,
      instanceId,
      historyCountBefore,
      historyCountAfter,
    };
  }

  private async updateBusinessRecordAndEmit(
    entityName: string,
    recordId: string,
    patch: Record<string, unknown>,
    detail: string,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) {
      return;
    }

    await this.updateRecord(entityName, recordId, patch);
    await this.postCoordinatorEvent({
      entityId: recordId,
      entityTypeName: entityName,
      changeType: 'UPDATED',
      payload: {
        RecordId: recordId,
        ...patch,
      },
    });

    console.log('[workflow-test] business update + event', {
      entityName,
      recordId,
      detail,
      patch,
    });
  }

  private loanPatchForStep(currentLabel: string, targetLabel: string): Record<string, unknown> {
    const current = normalizeLabel(currentLabel);
    const target = normalizeLabel(targetLabel);

    if (current.includes('underwriter review')) {
      const decision = target.includes('draft') || target.includes('revision') ? 'REVISION' : 'APPROVED';
      return {
        UnderwriterDecision: decision,
        UnderwriterDecisionAt: nowIso(),
      };
    }

    if (current.includes('manager review')) {
      const decision = target.includes('draft') || target.includes('revision') ? 'REVISION' : 'APPROVED';
      return {
        ManagerDecision: decision,
        ManagerDecisionAt: nowIso(),
      };
    }

    return {};
  }

  private agentPatchForStep(currentLabel: string, targetLabel: string): Record<string, unknown> {
    const current = normalizeLabel(currentLabel);
    const target = normalizeLabel(targetLabel);

    if (current.includes('queued') && target.includes('progress')) {
      return {
        Feedback: 'Agent task queued and picked by worker.',
      };
    }

    if (current.includes('progress')) {
      return {
        SummaryText: `Automated summary generated at ${nowIso()}`,
        Confidence: 0.86,
      };
    }

    if (current.includes('review')) {
      const action = target.includes('revision') ? 'REVISION' : 'APPROVED';
      return {
        UserAction: action,
        AgentFollowupQuestions:
          action === 'APPROVED'
            ? 'No follow-up questions.'
            : 'Please expand debt coverage analysis with latest quarter data.',
      };
    }

    if (target.includes('complete') || target.includes('approved')) {
      return {
        Feedback: 'Task completed successfully.',
      };
    }

    return {};
  }

  private async executeFlowPath(input: {
    entityName: string;
    recordId: string;
    flow: FlowContext;
    path: string[];
    patchForStep: (currentLabel: string, targetLabel: string) => Record<string, unknown>;
  }): Promise<WorkflowRunSummary> {
    const pathLabels: string[] = [];

    const instance = await this.waitForInitialization(
      input.entityName,
      input.recordId,
      input.flow.flowDefinitionId,
    );
    const instanceId = getRecordId(instance);
    if (!instanceId) {
      throw new Error(
        `Initialized instance for ${input.entityName}/${input.recordId} did not contain an Id`,
      );
    }

    for (let index = 0; index < input.path.length; index += 1) {
      const nodeId = input.path[index];
      const node = input.flow.nodeById.get(nodeId);
      const label = asString(node?.Label) || nodeId;
      pathLabels.push(label);
    }

    const expectedStartNodeId = input.path[0];
    const currentNodeAtStart = getRelatedId(instance.CurrentNodeKey);
    if (!sameId(currentNodeAtStart, expectedStartNodeId)) {
      throw new Error(
        `Initialization verification failed for ${input.entityName}/${input.recordId}. Expected start node ${expectedStartNodeId}, got ${currentNodeAtStart ?? 'null'}`,
      );
    }

    let previousHistoryCount = await this.getHistoryCountForInstance(instanceId);

    for (let index = 1; index < input.path.length; index += 1) {
      const currentNodeId = input.path[index - 1];
      const targetNodeId = input.path[index];
      const currentNode = input.flow.nodeById.get(currentNodeId);
      const targetNode = input.flow.nodeById.get(targetNodeId);
      const currentLabel = asString(currentNode?.Label) || currentNodeId;
      const targetLabel = asString(targetNode?.Label) || targetNodeId;

      const patch = input.patchForStep(currentLabel, targetLabel);
      await this.updateBusinessRecordAndEmit(
        input.entityName,
        input.recordId,
        patch,
        `${currentLabel} -> ${targetLabel}`,
      );

      const transitionResponse = await this.postStatusTransition({
        entityName: input.entityName,
        recordId: input.recordId,
        targetNodeId,
      });

      if (!asBoolean(transitionResponse.changed)) {
        throw new Error(
          `Transition was accepted but did not change state for ${input.entityName}/${input.recordId} (${currentNodeId} -> ${targetNodeId})`,
        );
      }

      const refreshed = await this.waitForInitialization(
        input.entityName,
        input.recordId,
        input.flow.flowDefinitionId,
      );
      const refreshedCurrentNodeId = getRelatedId(refreshed.CurrentNodeKey);
      if (!sameId(refreshedCurrentNodeId, targetNodeId)) {
        throw new Error(
          `Transition verification failed for ${input.entityName}/${input.recordId}. Expected current node ${targetNodeId}, got ${refreshedCurrentNodeId ?? 'null'}`,
        );
      }

      const historyCount = await this.getHistoryCountForInstance(instanceId);
      if (historyCount <= previousHistoryCount) {
        throw new Error(
          `History verification failed for ${input.entityName}/${input.recordId}. Expected history count to increase after transition (${currentNodeId} -> ${targetNodeId}), previous=${previousHistoryCount}, current=${historyCount}`,
        );
      }
      previousHistoryCount = historyCount;
    }

    return {
      caseName: input.entityName,
      entityName: input.entityName,
      recordId: input.recordId,
      flowDefinitionId: input.flow.flowDefinitionId,
      instanceId,
      pathLabels,
    };
  }

  public async runLoanFullCase(): Promise<WorkflowRunSummary> {
    const flow = await this.getFlowContext('E2ELoan');

    const createdLoan = await this.createRecord('E2ELoan', {
      Name: `Loan_Test_${new Date().toISOString().replace(/[:.]/g, '-')}`,
    });
    const recordId = getRecordId(createdLoan);

    if (!recordId) {
      throw new Error('Created E2ELoan record did not contain Id');
    }

    const createdEvent = await this.postCoordinatorEvent({
      entityId: recordId,
      entityTypeName: 'E2ELoan',
      changeType: 'CREATED',
      payload: {
        RecordId: recordId,
      },
    });

    const initialization = isRecord(createdEvent.initialization) ? createdEvent.initialization : null;
    if (!initialization || !asBoolean(initialization.initialized)) {
      throw new Error(
        `Expected coordinator CREATED event to initialize workflow for E2ELoan/${recordId}. Response: ${JSON.stringify(createdEvent)}`,
      );
    }
    await this.waitForInitialization('E2ELoan', recordId, flow.flowDefinitionId);
    const path = this.getPrimaryPath(flow);

    const summary = await this.executeFlowPath({
      entityName: 'E2ELoan',
      recordId,
      flow,
      path,
      patchForStep: (current, target) => this.loanPatchForStep(current, target),
    });

    summary.caseName = 'loan-full';
    return summary;
  }

  public async runAgentFullCase(loanRecordId?: string): Promise<WorkflowRunSummary> {
    const parentLoanId = loanRecordId ?? (await this.ensureLoanForAgentTask());
    const flow = await this.getFlowContext('E2EAgentTask');

    const createdAgentTask = await this.createRecord('E2EAgentTask', {
      Type: AGENT_TASK_TYPES[0],
      Loan: parentLoanId,
      Feedback: 'Created by workflow test runner',
    });
    const recordId = getRecordId(createdAgentTask);

    if (!recordId) {
      throw new Error('Created E2EAgentTask record did not contain Id');
    }

    const createdEvent = await this.postCoordinatorEvent({
      entityId: recordId,
      entityTypeName: 'E2EAgentTask',
      changeType: 'CREATED',
      payload: {
        RecordId: recordId,
        Loan: parentLoanId,
        Type: AGENT_TASK_TYPES[0],
      },
    });

    const initialization = isRecord(createdEvent.initialization) ? createdEvent.initialization : null;
    if (!initialization || !asBoolean(initialization.initialized)) {
      throw new Error(
        `Expected coordinator CREATED event to initialize workflow for E2EAgentTask/${recordId}. Response: ${JSON.stringify(createdEvent)}`,
      );
    }
    await this.waitForInitialization('E2EAgentTask', recordId, flow.flowDefinitionId);
    const path = this.getPrimaryPath(flow);

    const summary = await this.executeFlowPath({
      entityName: 'E2EAgentTask',
      recordId,
      flow,
      path,
      patchForStep: (current, target) => this.agentPatchForStep(current, target),
    });

    summary.caseName = 'agent-full';
    return summary;
  }

  public async runAgentBatchCase(loanRecordId?: string): Promise<WorkflowRunSummary[]> {
    const parentLoanId = loanRecordId ?? (await this.ensureLoanForAgentTask());
    const flow = await this.getFlowContext('E2EAgentTask');
    const path = this.getPrimaryPath(flow);
    const summaries: WorkflowRunSummary[] = [];

    for (const taskType of AGENT_TASK_TYPES) {
      const createdAgentTask = await this.createRecord('E2EAgentTask', {
        Type: taskType,
        Loan: parentLoanId,
        Feedback: `Created by workflow test runner for ${taskType}`,
      });
      const recordId = getRecordId(createdAgentTask);

      if (!recordId) {
        throw new Error(`Created E2EAgentTask (${taskType}) did not contain Id`);
      }

      const createdEvent = await this.postCoordinatorEvent({
        entityId: recordId,
        entityTypeName: 'E2EAgentTask',
        changeType: 'CREATED',
        payload: {
          RecordId: recordId,
          Loan: parentLoanId,
          Type: taskType,
        },
      });

      const initialization = isRecord(createdEvent.initialization)
        ? createdEvent.initialization
        : null;
      if (!initialization || !asBoolean(initialization.initialized)) {
        throw new Error(
          `Expected coordinator CREATED event to initialize workflow for E2EAgentTask/${recordId}. Response: ${JSON.stringify(createdEvent)}`,
        );
      }
      await this.waitForInitialization('E2EAgentTask', recordId, flow.flowDefinitionId);

      const summary = await this.executeFlowPath({
        entityName: 'E2EAgentTask',
        recordId,
        flow,
        path,
        patchForStep: (current, target) => this.agentPatchForStep(current, target),
      });
      summary.caseName = `agent-batch:${taskType}`;
      summaries.push(summary);
    }

    return summaries;
  }

  private async ensureLoanForAgentTask(): Promise<string> {
    const flow = await this.getFlowContext('E2ELoan');

    const createdLoan = await this.createRecord('E2ELoan', {
      Name: `Loan_ForAgentTask_${new Date().toISOString().replace(/[:.]/g, '-')}`,
    });
    const loanId = getRecordId(createdLoan);

    if (!loanId) {
      throw new Error('Created supporting E2ELoan did not contain Id');
    }

    const createdEvent = await this.postCoordinatorEvent({
      entityId: loanId,
      entityTypeName: 'E2ELoan',
      changeType: 'CREATED',
      payload: {
        RecordId: loanId,
      },
    });

    const initialization = isRecord(createdEvent.initialization) ? createdEvent.initialization : null;
    if (!initialization || !asBoolean(initialization.initialized)) {
      throw new Error(
        `Expected coordinator CREATED event to initialize workflow for E2ELoan/${loanId}. Response: ${JSON.stringify(createdEvent)}`,
      );
    }
    await this.waitForInitialization('E2ELoan', loanId, flow.flowDefinitionId);
    return loanId;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const runner = new WorkflowTestRunner(args.coordinatorUrl);

  console.log('[workflow-test] starting', {
    caseName: args.caseName,
    coordinatorUrl: args.coordinatorUrl,
    loanRecordId: args.loanRecordId ?? null,
  });

  if (args.caseName === 'loan-full') {
    const summary = await runner.runLoanFullCase();
    console.log(
      JSON.stringify(
        {
          ok: true,
          caseName: 'loan-full',
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.caseName === 'loan-init') {
    const summary = await runner.runLoanInitCase();
    console.log(
      JSON.stringify(
        {
          ok: true,
          caseName: 'loan-init',
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.caseName === 'agent-full') {
    const summary = await runner.runAgentFullCase(args.loanRecordId);
    console.log(
      JSON.stringify(
        {
          ok: true,
          caseName: 'agent-full',
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.caseName === 'agent-init') {
    const summary = await runner.runAgentInitCase({
      loanRecordId: args.loanRecordId,
      taskType: args.taskType,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          caseName: 'agent-init',
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.caseName === 'loan-list') {
    if (!args.recordId) {
      throw new Error('--record-id is required for --case loan-list');
    }

    const summary = await runner.listAvailableTransitions('E2ELoan', args.recordId);
    console.log(
      JSON.stringify(
        {
          ok: true,
          caseName: 'loan-list',
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.caseName === 'agent-list') {
    if (!args.recordId) {
      throw new Error('--record-id is required for --case agent-list');
    }

    const summary = await runner.listAvailableTransitions('E2EAgentTask', args.recordId);
    console.log(
      JSON.stringify(
        {
          ok: true,
          caseName: 'agent-list',
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.caseName === 'loan-step') {
    if (!args.recordId) {
      throw new Error('--record-id is required for --case loan-step');
    }

    const summary = await runner.runSingleTransitionCase({
      entityName: 'E2ELoan',
      recordId: args.recordId,
      targetNodeId: args.targetNodeId,
      targetLabel: args.targetLabel,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          caseName: 'loan-step',
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.caseName === 'agent-step') {
    if (!args.recordId) {
      throw new Error('--record-id is required for --case agent-step');
    }

    const summary = await runner.runSingleTransitionCase({
      entityName: 'E2EAgentTask',
      recordId: args.recordId,
      targetNodeId: args.targetNodeId,
      targetLabel: args.targetLabel,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          caseName: 'agent-step',
          summary,
        },
        null,
        2,
      ),
    );
    return;
  }

  const summaries = await runner.runAgentBatchCase(args.loanRecordId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        caseName: 'agent-batch',
        count: summaries.length,
        summaries,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[workflow-test] failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
