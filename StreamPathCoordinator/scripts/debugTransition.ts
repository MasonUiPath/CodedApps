import { loadConfig } from '../src/config.js';
import { createUiPathAuthProvider } from '../src/uipathAuthProvider.js';
import { UiPathRelay } from '../src/uipathRelay.js';

type EntityRecord = Record<string, unknown>;

function asItems(value: unknown): EntityRecord[] {
  if (Array.isArray(value)) {
    return value as EntityRecord[];
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return record.items as EntityRecord[];
    }
    if (Array.isArray(record.value)) {
      return record.value as EntityRecord[];
    }
  }

  return [];
}

function getId(record: unknown): string {
  if (!record || typeof record !== 'object') {
    return '';
  }

  const candidate = (record as Record<string, unknown>).id ?? (record as Record<string, unknown>).Id;
  return typeof candidate === 'string' ? candidate : '';
}

function getRelatedId(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return getId(value);
}

function getArg(name: string): string {
  const args = process.argv.slice(2);
  const index = args.findIndex((token) => token === `--${name}`);
  if (index < 0) {
    return '';
  }

  return args[index + 1] ?? '';
}

async function run(): Promise<void> {
  const flowDefinitionId = getArg('flow-id');
  const currentNodeId = getArg('current-node-id');
  const targetNodeId = getArg('target-node-id');
  const instanceId = getArg('instance-id');

  if (!flowDefinitionId || !currentNodeId || !targetNodeId || !instanceId) {
    throw new Error(
      'Usage: tsx scripts/debugTransition.ts --flow-id <id> --current-node-id <id> --target-node-id <id> --instance-id <id>',
    );
  }

  const config = loadConfig();
  const authProvider = createUiPathAuthProvider(config);
  const relay = new UiPathRelay(config, authProvider);

  const [nodesResult, transitionsResult, instanceResult] = await Promise.all([
    relay.execute({
      command: 'GET_MANY',
      entityTypeName: 'StreamPathStatusNode',
      options: {
        top: 5000,
        filter: `FlowDefinition.Id eq '${flowDefinitionId}'`,
      },
    }),
    relay.execute({
      command: 'GET_MANY',
      entityTypeName: 'StreamPathStatusTransition',
      options: {
        top: 5000,
        filter: `FlowDefinition.Id eq '${flowDefinitionId}'`,
      },
    }),
    relay.execute({
      command: 'GET',
      entityTypeName: 'StreamPathStatusInstance',
      recordId: instanceId,
    }),
  ]);

  const nodes = asItems(nodesResult.data);
  const transitions = asItems(transitionsResult.data);
  const nodeById = new Map(
    nodes.map((node) => [
      getId(node).toUpperCase(),
      {
        id: getId(node),
        label: String(node.label ?? node.Label ?? ''),
      },
    ]),
  );

  const getLabel = (nodeId: string): string =>
    nodeById.get(nodeId.toUpperCase())?.label || '(unknown)';

  const validOutgoing = transitions
    .filter(
      (transition) =>
        getRelatedId(transition.fromNode ?? transition.FromNode).toUpperCase() ===
        currentNodeId.toUpperCase(),
    )
    .map((transition) => ({
      transitionId: getId(transition),
      label: String(transition.label ?? transition.Label ?? ''),
      toNodeId: getRelatedId(transition.toNode ?? transition.ToNode),
      toNodeLabel: getLabel(getRelatedId(transition.toNode ?? transition.ToNode)),
      bidirectional: Boolean(transition.bidirectional ?? transition.Bidirectional),
    }));

  const hasExactEdge = transitions.some((transition) => {
    const from = getRelatedId(transition.fromNode ?? transition.FromNode).toUpperCase();
    const to = getRelatedId(transition.toNode ?? transition.ToNode).toUpperCase();
    return from === currentNodeId.toUpperCase() && to === targetNodeId.toUpperCase();
  });

  const instanceRecord = instanceResult.data as Record<string, unknown>;
  const actualCurrentNodeId = getRelatedId(
    instanceRecord.currentNodeKey ?? instanceRecord.CurrentNodeKey,
  );

  console.log(
    JSON.stringify(
      {
        instance: {
          id: getId(instanceRecord),
          currentNodeId: actualCurrentNodeId,
          currentNodeLabel: getLabel(actualCurrentNodeId),
        },
        requested: {
          currentNodeId,
          currentNodeLabel: getLabel(currentNodeId),
          targetNodeId,
          targetNodeLabel: getLabel(targetNodeId),
        },
        hasExactEdge,
        validOutgoing,
      },
      null,
      2,
    ),
  );
}

void run();
