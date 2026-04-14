import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

import {
  type AgentTaskSnapshotRequest,
  type FlowSnapshotRequest,
  type HttpEntityChangeEvent,
  type MetadataRequest,
  type NormalizedEntityChangeEvent,
  type RelayCommand,
  type StatusTransitionRequest,
  type SubscriptionFilter,
  wsClientMessageSchema,
} from './types.js';

type CommandExecutor = (command: RelayCommand) => Promise<{
  entityId: string;
  data: unknown;
}>;

type MetadataExecutor = (request: MetadataRequest) => Promise<unknown>;
type EventExecutor = (event: HttpEntityChangeEvent) => Promise<unknown>;
type StatusTransitionExecutor = (request: StatusTransitionRequest) => Promise<unknown>;
type FlowSnapshotExecutor = (request: FlowSnapshotRequest) => Promise<unknown>;
type AgentTaskSnapshotExecutor = (request: AgentTaskSnapshotRequest) => Promise<unknown>;
type ConnectionGuardResult = {
  allowed: boolean;
  reason?: string;
};
type ConnectionGuard = (request: IncomingMessage) => ConnectionGuardResult;

type ClientState = {
  id: string;
  socket: WebSocket;
  subscriptions: SubscriptionFilter[];
};

export class WsRelayHub {
  private readonly wss: WebSocketServer;

  private readonly clients = new Map<WebSocket, ClientState>();

  private readonly commandExecutor: CommandExecutor;

  private readonly metadataExecutor: MetadataExecutor;
  private readonly eventExecutor: EventExecutor;
  private readonly statusTransitionExecutor: StatusTransitionExecutor;
  private readonly flowSnapshotExecutor: FlowSnapshotExecutor;
  private readonly agentTaskSnapshotExecutor: AgentTaskSnapshotExecutor;
  private readonly connectionGuard: ConnectionGuard;

  public constructor(
    server: HttpServer,
    path: string,
    commandExecutor: CommandExecutor,
    metadataExecutor: MetadataExecutor,
    eventExecutor: EventExecutor,
    statusTransitionExecutor: StatusTransitionExecutor,
    flowSnapshotExecutor: FlowSnapshotExecutor,
    agentTaskSnapshotExecutor: AgentTaskSnapshotExecutor,
    connectionGuard?: ConnectionGuard,
  ) {
    this.commandExecutor = commandExecutor;
    this.metadataExecutor = metadataExecutor;
    this.eventExecutor = eventExecutor;
    this.statusTransitionExecutor = statusTransitionExecutor;
    this.flowSnapshotExecutor = flowSnapshotExecutor;
    this.agentTaskSnapshotExecutor = agentTaskSnapshotExecutor;
    this.connectionGuard = connectionGuard ?? (() => ({ allowed: true }));
    this.wss = new WebSocketServer({ server, path });

    this.wss.on('connection', (socket, request) => {
      const guard = this.connectionGuard(request);
      if (!guard.allowed) {
        this.send(socket, {
          type: 'error',
          error: guard.reason ?? 'WebSocket connection rejected',
        });
        socket.close(1008, 'Policy violation');
        return;
      }

      const state: ClientState = {
        id: randomUUID(),
        socket,
        subscriptions: [],
      };

      this.clients.set(socket, state);
      this.send(socket, {
        type: 'connected',
        clientId: state.id,
        message: 'Connected. Subscribe to receive entity change events.',
      });

      socket.on('message', (rawMessage) => {
        void this.handleMessage(state, rawMessage);
      });

      socket.on('close', () => {
        this.clients.delete(socket);
      });

      socket.on('error', () => {
        this.clients.delete(socket);
      });
    });
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public broadcastEntityChange(event: NormalizedEntityChangeEvent): number {
    let delivered = 0;

    for (const client of this.clients.values()) {
      if (!this.matchesAnySubscription(client.subscriptions, event)) {
        continue;
      }

      this.send(client.socket, {
        type: 'entity_change',
        ...event,
      });

      delivered += 1;
    }

    return delivered;
  }

  private async handleMessage(state: ClientState, rawMessage: WebSocket.RawData): Promise<void> {
    const maybeJson = this.tryParseJson(rawMessage);

    if (!maybeJson.success) {
      this.send(state.socket, {
        type: 'error',
        error: 'Invalid JSON payload',
      });
      return;
    }

    const parsedMessage = wsClientMessageSchema.safeParse(maybeJson.data);

    if (!parsedMessage.success) {
      this.send(state.socket, {
        type: 'error',
        error: parsedMessage.error.issues.map((issue) => issue.message).join('; '),
      });
      return;
    }

    const message = parsedMessage.data;

    if (message.type === 'subscribe') {
      state.subscriptions = this.mergeSubscriptions(state.subscriptions, message.subscriptions);
      this.send(state.socket, {
        type: 'subscribed',
        subscriptions: state.subscriptions,
      });
      return;
    }

    if (message.type === 'unsubscribe') {
      state.subscriptions = this.removeSubscriptions(state.subscriptions, message.subscriptions);
      this.send(state.socket, {
        type: 'unsubscribed',
        subscriptions: state.subscriptions,
      });
      return;
    }

    if (message.type === 'ping') {
      this.send(state.socket, { type: 'pong' });
      return;
    }

    if (message.type === 'metadata_request') {
      const correlationId = message.correlationId ?? randomUUID();

      try {
        const data = await this.metadataExecutor({
          ...message,
          correlationId,
        });

        this.send(state.socket, {
          type: 'metadata_result',
          ok: true,
          correlationId,
          action: message.action,
          entityTypeName: message.entityTypeName,
          data,
        });
      } catch (error) {
        this.send(state.socket, {
          type: 'metadata_result',
          ok: false,
          correlationId,
          action: message.action,
          entityTypeName: message.entityTypeName,
          error: error instanceof Error ? error.message : 'Unknown metadata error',
        });
      }

      return;
    }

    if (message.type === 'event_request') {
      const correlationId = message.correlationId ?? randomUUID();

      try {
        const data = await this.eventExecutor(message.event);

        this.send(state.socket, {
          type: 'event_result',
          ok: true,
          correlationId,
          data,
        });
      } catch (error) {
        this.send(state.socket, {
          type: 'event_result',
          ok: false,
          correlationId,
          error: error instanceof Error ? error.message : 'Unknown event error',
        });
      }

      return;
    }

    if (message.type === 'status_transition_request') {
      const correlationId = message.correlationId ?? randomUUID();

      try {
        const data = await this.statusTransitionExecutor(message.request);

        this.send(state.socket, {
          type: 'status_transition_result',
          ok: true,
          correlationId,
          data,
        });
      } catch (error) {
        this.send(state.socket, {
          type: 'status_transition_result',
          ok: false,
          correlationId,
          error: error instanceof Error ? error.message : 'Unknown status transition error',
        });
      }

      return;
    }

    if (message.type === 'flow_snapshot_request') {
      const correlationId = message.correlationId ?? randomUUID();

      try {
        const data = await this.flowSnapshotExecutor(message);

        this.send(state.socket, {
          type: 'flow_snapshot_result',
          ok: true,
          correlationId,
          data,
        });
      } catch (error) {
        this.send(state.socket, {
          type: 'flow_snapshot_result',
          ok: false,
          correlationId,
          error: error instanceof Error ? error.message : 'Unknown flow snapshot error',
        });
      }

      return;
    }

    if (message.type === 'agent_task_snapshot_request') {
      const correlationId = message.correlationId ?? randomUUID();

      try {
        const data = await this.agentTaskSnapshotExecutor(message);

        this.send(state.socket, {
          type: 'agent_task_snapshot_result',
          ok: true,
          correlationId,
          data,
        });
      } catch (error) {
        this.send(state.socket, {
          type: 'agent_task_snapshot_result',
          ok: false,
          correlationId,
          error: error instanceof Error ? error.message : 'Unknown agent task snapshot error',
        });
      }

      return;
    }

    const correlationId = message.correlationId ?? randomUUID();

    try {
      const result = await this.commandExecutor({
        ...message,
        correlationId,
      });

      this.send(state.socket, {
        type: 'command_result',
        ok: true,
        correlationId,
        command: message.command,
        entityId: result.entityId,
        entityTypeName: message.entityTypeName,
        data: result.data,
      });
    } catch (error) {
      this.send(state.socket, {
        type: 'command_result',
        ok: false,
        correlationId,
        command: message.command,
        entityId: message.entityId,
        entityTypeName: message.entityTypeName,
        error: error instanceof Error ? error.message : 'Unknown relay error',
      });
    }
  }

  private tryParseJson(
    rawMessage: WebSocket.RawData,
  ):
    | {
        success: true;
        data: unknown;
      }
    | {
        success: false;
      } {
    try {
      const text =
        typeof rawMessage === 'string'
          ? rawMessage
          : Array.isArray(rawMessage)
            ? Buffer.concat(rawMessage).toString('utf8')
            : Buffer.isBuffer(rawMessage)
              ? rawMessage.toString('utf8')
              : Buffer.from(rawMessage).toString('utf8');

      return {
        success: true,
        data: JSON.parse(text),
      };
    } catch {
      return { success: false };
    }
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(payload));
  }

  private mergeSubscriptions(
    existing: SubscriptionFilter[],
    incoming: SubscriptionFilter[],
  ): SubscriptionFilter[] {
    const deduped = new Map<string, SubscriptionFilter>();

    for (const filter of [...existing, ...incoming]) {
      deduped.set(this.subscriptionKey(filter), filter);
    }

    return [...deduped.values()];
  }

  private removeSubscriptions(
    existing: SubscriptionFilter[],
    toRemove?: SubscriptionFilter[],
  ): SubscriptionFilter[] {
    if (!toRemove || toRemove.length === 0) {
      return [];
    }

    const keysToRemove = new Set(toRemove.map((filter) => this.subscriptionKey(filter)));
    return existing.filter((filter) => !keysToRemove.has(this.subscriptionKey(filter)));
  }

  private matchesAnySubscription(
    subscriptions: SubscriptionFilter[],
    event: Pick<NormalizedEntityChangeEvent, 'entityTypeName' | 'entityId'>,
  ): boolean {
    if (subscriptions.length === 0) {
      return false;
    }

    return subscriptions.some((subscription) => {
      const entityTypeMatches =
        !subscription.entityTypeName || subscription.entityTypeName === event.entityTypeName;
      const entityIdMatches = !subscription.entityId || subscription.entityId === event.entityId;

      return entityTypeMatches && entityIdMatches;
    });
  }

  private subscriptionKey(filter: SubscriptionFilter): string {
    return `${filter.entityTypeName ?? '*'}::${filter.entityId ?? '*'}`;
  }
}
