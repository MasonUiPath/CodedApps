import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import SvgIcon from '@mui/material/SvgIcon';
import { StatusFlowBuilder } from './StatusFlowBuilder';
import { StreamPathFlowVisualizer } from './StreamPathFlowVisualizer';

const MAX_EVENT_LOG_ENTRIES = 12;
const RECONNECT_DELAY_MS = 3000;
const METADATA_RETRY_INTERVAL_MS = 2000;
const SCHEMA_MIN_WIDTH = 300;
const SCHEMA_MAX_WIDTH = 520;
const SCHEMA_DIVIDER_WIDTH = 8;

type ConnectionState = 'connecting' | 'connected' | 'disconnected';
type AppScreen = 'explorer' | 'workflow' | 'visualizer';

type EntitySummary = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  entityType: string;
  recordCount?: number;
  isSystemEntity: boolean;
  isInfrastructureEntity: boolean;
  capabilities: {
    statusFlow: boolean;
  };
};

type FieldMetadata = {
  name: string;
  displayName: string;
  dataType: string;
  required: boolean;
  unique: boolean;
  primaryKey: boolean;
  systemField: boolean;
  foreignKey: boolean;
  maxLength?: number;
  decimalPrecision?: number;
  minValue?: number;
  maxValue?: number;
  relationship?: {
    entityId: string;
    entityTypeName: string;
    displayName: string;
    displayField?: string;
  };
};

type EntitySchema = EntitySummary & {
  fields: FieldMetadata[];
};

type EntityRecord = {
  Id?: string;
  id?: string;
  [key: string]: unknown;
};

type EventLogEntry = {
  id: string;
  summary: string;
  detail?: string;
  time: string;
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

type CommandRequest = {
  command: 'GET' | 'GET_MANY' | 'CREATE' | 'UPDATE' | 'DELETE';
  entityId?: string;
  entityTypeName?: string;
  recordId?: string;
  recordIds?: string[];
  data?: Record<string, unknown>;
  options?: Record<string, unknown>;
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

type SubscribedMessage = {
  type: 'subscribed';
  subscriptions: unknown[];
};

type MetadataResultMessage = {
  type: 'metadata_result';
  ok: boolean;
  correlationId: string;
  action: 'list_entities' | 'get_entity_schema';
  entityTypeName?: string;
  data?: unknown;
  error?: string;
};

const STREAM_PATH_INSTANCE_ENTITY = 'StreamPathStatusInstance';
const STREAM_PATH_HISTORY_ENTITY = 'StreamPathStatusHistory';

function RefreshIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ fontSize: 18 }}>
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M20 20v-5h-5M4 4v5h5m10.938 2A8.001 8.001 0 0 0 5.07 8m-1.008 5a8.001 8.001 0 0 0 14.868 3"
      />
    </SvgIcon>
  );
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

  const { hostname, protocol } = window.location;

  if (import.meta.env.DEV) {
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${hostname}:8080/ws`;
  }

  return toWebSocketUrl(`${protocol}//${window.location.host}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessageWithType(value: unknown): value is { type: string } {
  return isRecord(value) && typeof value.type === 'string';
}

function extractRecords(payload: unknown): {
  items: EntityRecord[];
  totalCount?: number;
} {
  if (isRecord(payload) && Array.isArray(payload.items)) {
    return {
      items: payload.items.filter(isRecord),
      totalCount: typeof payload.totalCount === 'number' ? payload.totalCount : undefined,
    };
  }

  if (isRecord(payload) && Array.isArray(payload.value)) {
    return {
      items: payload.value.filter(isRecord),
      totalCount:
        typeof payload.totalRecordCount === 'number' ? payload.totalRecordCount : undefined,
    };
  }

  if (Array.isArray(payload)) {
    return {
      items: payload.filter(isRecord),
    };
  }

  return { items: [] };
}

function collectColumns(records: EntityRecord[], schema?: EntitySchema | null): string[] {
  const orderedFields = schema?.fields.map((field) => field.name) ?? [];
  const keys = new Set<string>(orderedFields);

  for (const record of records) {
    Object.keys(record).forEach((key) => keys.add(key));
  }

  return [...orderedFields, ...[...keys].filter((key) => !orderedFields.includes(key))];
}

function getDefaultVisibleColumns(columns: string[], schema?: EntitySchema | null): string[] {
  if (columns.length === 0) {
    return [];
  }

  const systemFieldNames = new Set(
    (schema?.fields ?? []).filter((field) => field.systemField).map((field) => field.name),
  );

  const nonSystemColumns = columns.filter((column) => !systemFieldNames.has(column));
  return nonSystemColumns.length > 0 ? nonSystemColumns : columns;
}

function formatCellValue(value: unknown, field?: FieldMetadata): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (field?.relationship && isRecord(value)) {
    const preferredKeys = [
      field.relationship.displayField,
      'Name',
      'displayName',
      'name',
      'Id',
      'id',
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const key of preferredKeys) {
      const candidate = value[key];

      if (
        typeof candidate === 'string' ||
        typeof candidate === 'number' ||
        typeof candidate === 'boolean'
      ) {
        return String(candidate);
      }
    }
  }

  return JSON.stringify(value);
}

function getRowId(record: EntityRecord, index: number): string {
  const candidate = typeof record.Id === 'string' ? record.Id : record.id;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : `row-${index}`;
}

function getConnectionChipColor(state: ConnectionState): 'success' | 'warning' | 'default' {
  if (state === 'connected') {
    return 'success';
  }

  if (state === 'connecting') {
    return 'warning';
  }

  return 'default';
}

function getDefaultEntityName(entities: EntitySummary[]): string | null {
  const preferred =
    entities.find((entity) => !entity.isInfrastructureEntity && !entity.isSystemEntity) ??
    entities.find((entity) => !entity.isInfrastructureEntity) ??
    entities[0];

  return preferred?.name ?? null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [selectedEntityName, setSelectedEntityName] = useState<string | null>(null);
  const [selectedEntitySchema, setSelectedEntitySchema] = useState<EntitySchema | null>(null);
  const [activeScreen, setActiveScreen] = useState<AppScreen>('explorer');
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
  const [isRecordsLoading, setIsRecordsLoading] = useState(false);
  const [visibleColumnsByEntity, setVisibleColumnsByEntity] = useState<Record<string, string[]>>({});
  const [columnMenuAnchorEl, setColumnMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [schemaPaneWidth, setSchemaPaneWidth] = useState(360);
  const [isResizingSchema, setIsResizingSchema] = useState(false);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [metadataLoadedAt, setMetadataLoadedAt] = useState<string | null>(null);
  const [lastEntityChange, setLastEntityChange] = useState<EntityChangeMessage | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shuttingDownRef = useRef(false);
  const metadataLoadInFlightRef = useRef(false);
  const queuedMetadataReloadRef = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeSessionRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const pendingCommandsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: CommandResultMessage) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const pendingMetadataRef = useRef(
    new Map<
      string,
      {
        resolve: (value: MetadataResultMessage) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const socketReadyWaitersRef = useRef<Array<{ resolve: () => void; reject: (error: Error) => void }>>(
    [],
  );

  const appendEvent = useEffectEvent((summary: string, detail?: string) => {
    setEventLog((current) => [
      {
        id: crypto.randomUUID(),
        summary,
        detail,
        time: new Date().toLocaleTimeString(),
      },
      ...current,
    ].slice(0, MAX_EVENT_LOG_ENTRIES));
  });

  const sendMessage = useEffectEvent((payload: object): boolean => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendEvent('Unable to send message', 'WebSocket is not connected');
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  });

  const rejectSocketReadyWaiters = useEffectEvent((message: string) => {
    const waiters = socketReadyWaitersRef.current.splice(0);
    for (const waiter of waiters) {
      waiter.reject(new Error(message));
    }
  });

  const rejectPendingRequests = useEffectEvent((message: string) => {
    for (const pending of pendingCommandsRef.current.values()) {
      pending.reject(new Error(message));
    }
    pendingCommandsRef.current.clear();

    for (const pending of pendingMetadataRef.current.values()) {
      pending.reject(new Error(message));
    }
    pendingMetadataRef.current.clear();

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
          socket.send(JSON.stringify(payload));
          return;
        } catch {
          // Socket could close between OPEN check and send; wait for reconnect and retry.
        }
      }

      await waitForSocketOpen();
    }
  });

  const requestCommand = useEffectEvent(
    (payload: CommandRequest): Promise<CommandResultMessage> =>
      new Promise((resolve, reject) => {
        const correlationId = crypto.randomUUID();

        pendingCommandsRef.current.set(correlationId, {
          resolve,
          reject,
        });

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

  const requestMetadata = useEffectEvent(
    (
      payload: {
        action: 'list_entities' | 'get_entity_schema';
        entityTypeName?: string;
        refresh?: boolean;
      },
    ): Promise<MetadataResultMessage> =>
      new Promise((resolve, reject) => {
        const correlationId = crypto.randomUUID();

        pendingMetadataRef.current.set(correlationId, {
          resolve,
          reject,
        });

        void sendMessageWhenConnected({
          type: 'metadata_request',
          correlationId,
          ...payload,
        }).catch((error) => {
          pendingMetadataRef.current.delete(correlationId);
          reject(error instanceof Error ? error : new Error('WebSocket is not connected'));
        });
      }),
  );

  const loadEntities = useEffectEvent(async (refresh = false) => {
    if (metadataLoadInFlightRef.current) {
      queuedMetadataReloadRef.current = true;
      return;
    }

    metadataLoadInFlightRef.current = true;

    try {
      const result = await requestMetadata({
        action: 'list_entities',
        refresh,
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'Metadata request failed');
      }

      const payload = (result.data ?? {}) as {
        generatedAt: string;
        entities: EntitySummary[];
      };

      setEntities(payload.entities);
      setMetadataLoadedAt(new Date(payload.generatedAt).toLocaleTimeString());
      setErrorMessage(null);
      appendEvent('Loaded entity registry', `${payload.entities.length} entities discovered`);

      setSelectedEntityName((current) => {
        if (current && payload.entities.some((entity) => entity.name === current)) {
          return current;
        }

        return getDefaultEntityName(payload.entities);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load metadata';
      setErrorMessage(message);
      appendEvent('Metadata load failed', message);
    } finally {
      metadataLoadInFlightRef.current = false;

      if (queuedMetadataReloadRef.current) {
        queuedMetadataReloadRef.current = false;
        void loadEntities(refresh);
      }
    }
  });

  const loadEntitySchema = useEffectEvent(async (entityTypeName: string, refresh = false) => {
    try {
      const result = await requestMetadata({
        action: 'get_entity_schema',
        entityTypeName,
        refresh,
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'Schema request failed');
      }

      const payload = result.data as EntitySchema;
      setSelectedEntitySchema(payload);
      setColumns(collectColumns(records, payload));
      setErrorMessage(null);
      appendEvent('Loaded entity schema', payload.displayName);
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load entity schema';
      setErrorMessage(message);
      appendEvent('Schema load failed', message);
      return null;
    }
  });

  const requestEntityRecords = useEffectEvent((reason: string) => {
    if (!selectedEntityName) {
      return;
    }

    setIsRecordsLoading(true);

    void requestCommand({
      command: 'GET_MANY',
      entityTypeName: selectedEntityName,
      options: {
        expansionLevel: 2,
      },
    })
      .then(() => {
        appendEvent(`Requested ${selectedEntityName} refresh`, reason);
      })
      .catch((error) => {
        setIsRecordsLoading(false);
        const message = error instanceof Error ? error.message : 'Failed to request entity records';
        setErrorMessage(message);
        appendEvent('Entity refresh request failed', message);
      });
  });

  const getSubscriptionsForCurrentScreen = useEffectEvent(() => {
    if (!selectedEntityName) {
      return [];
    }

    const subscriptions: Array<{ entityTypeName: string }> = [{ entityTypeName: selectedEntityName }];

    if (activeScreen === 'visualizer') {
      subscriptions.push(
        { entityTypeName: STREAM_PATH_INSTANCE_ENTITY },
        { entityTypeName: STREAM_PATH_HISTORY_ENTITY },
      );
    }

    return subscriptions;
  });

  const resubscribeForCurrentScreen = useEffectEvent(() => {
    const subscriptions = getSubscriptionsForCurrentScreen();

    sendMessage({ type: 'unsubscribe' });

    if (subscriptions.length > 0) {
      sendMessage({
        type: 'subscribe',
        subscriptions,
      });
    }
  });

  const handleSocketOpen = useEffectEvent(() => {
    setConnectionState('connected');
    setErrorMessage(null);
    appendEvent('WebSocket open');
    resolveSocketReadyWaiters();
    void loadEntities();

    if (selectedEntityName) {
      resubscribeForCurrentScreen();

      if (selectedEntitySchema?.name === selectedEntityName) {
        requestEntityRecords('Socket connected');
      }
    }
  });

  const handleSocketMessage = useEffectEvent((message: unknown) => {
    if (!isMessageWithType(message)) {
      appendEvent('Ignored message', 'Payload did not have a `type` field');
      return;
    }

    if (message.type === 'connected') {
      const payload = message as ConnectedMessage;
      appendEvent('Coordinator connected', payload.clientId);
      void loadEntities();
      return;
    }

    if (message.type === 'subscribed') {
      const payload = message as SubscribedMessage;
      appendEvent('Subscription confirmed', JSON.stringify(payload.subscriptions));
      return;
    }

    if (message.type === 'error') {
      const payload = message as ErrorMessage;
      setErrorMessage(payload.error);
      appendEvent('Coordinator error', payload.error);
      return;
    }

    if (message.type === 'metadata_result') {
      const payload = message as MetadataResultMessage;
      const pending = pendingMetadataRef.current.get(payload.correlationId);

      if (pending) {
        pendingMetadataRef.current.delete(payload.correlationId);
        pending.resolve(payload);
      }

      if (!payload.ok) {
        appendEvent('Metadata request failed', payload.error ?? 'Unknown metadata error');
      }
      return;
    }

    if (message.type === 'entity_change') {
      const payload = message as EntityChangeMessage;
      setLastEntityChange(payload);

      if (
        activeScreen === 'visualizer' &&
        (payload.entityTypeName === STREAM_PATH_INSTANCE_ENTITY ||
          payload.entityTypeName === STREAM_PATH_HISTORY_ENTITY)
      ) {
        appendEvent(
          `Visualizer realtime event (${payload.entityTypeName})`,
          `${payload.entityId} at ${new Date(payload.changedAt).toLocaleString()}`,
        );
      }

      if (payload.entityTypeName !== selectedEntityName) {
        return;
      }

      appendEvent(
        `Received ${payload.changeType ?? 'change'} invalidation`,
        `${payload.entityId} at ${new Date(payload.changedAt).toLocaleString()}`,
      );

      requestEntityRecords(`${payload.changeType ?? 'CHANGE'} invalidation for ${payload.entityId}`);
      return;
    }

    if (message.type === 'command_result') {
      const payload = message as CommandResultMessage;
      const pending = pendingCommandsRef.current.get(payload.correlationId);

      if (pending) {
        pendingCommandsRef.current.delete(payload.correlationId);

        if (payload.ok) {
          pending.resolve(payload);
        } else {
          pending.reject(new Error(payload.error ?? 'Unknown command error'));
        }
      }

      if (!payload.ok) {
        const error = payload.error ?? 'Unknown command error';
        setIsRecordsLoading(false);
        setErrorMessage(error);
        appendEvent(`Command failed: ${payload.command}`, error);
        return;
      }

      if (payload.command === 'GET_MANY') {
        if (payload.entityTypeName && payload.entityTypeName !== selectedEntityName) {
          return;
        }

        const result = extractRecords(payload.data);
        setRecords(result.items);
        setColumns(collectColumns(result.items, selectedEntitySchema));
        setTotalCount(result.totalCount);
        setIsRecordsLoading(false);
        setLastRefreshAt(new Date().toLocaleTimeString());
        setErrorMessage(null);
        appendEvent(
          `${selectedEntityName ?? 'Entity'} table refreshed`,
          `${result.items.length} rows loaded${typeof result.totalCount === 'number' ? ` (${result.totalCount} total)` : ''}`,
        );
        return;
      }

      if (!pending) {
        appendEvent(`Command succeeded: ${payload.command}`);
      }
    }
  });

  const handleSchemaResizeMove = useEffectEvent((event: PointerEvent) => {
    const session = resizeSessionRef.current;
    const container = splitContainerRef.current;

    if (!session || !container) {
      return;
    }

    const availableWidth = container.getBoundingClientRect().width;
    const maxWidth = clampNumber(availableWidth - 380, SCHEMA_MIN_WIDTH, SCHEMA_MAX_WIDTH);
    const nextWidth = clampNumber(
      session.startWidth + (event.clientX - session.startX),
      SCHEMA_MIN_WIDTH,
      maxWidth,
    );

    setSchemaPaneWidth(nextWidth);
  });

  const handleSchemaResizeEnd = useEffectEvent(() => {
    resizeSessionRef.current = null;
    setIsResizingSchema(false);
  });

  useEffect(() => {
    void loadEntities();
  }, []);

  useEffect(() => {
    if (metadataLoadedAt) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadEntities();
    }, METADATA_RETRY_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [metadataLoadedAt]);

  useEffect(() => {
    if (!selectedEntityName) {
      return;
    }

    let isCancelled = false;

    setSelectedEntitySchema(null);
    setRecords([]);
    setColumns([]);
    setTotalCount(undefined);
    setIsRecordsLoading(true);
    setLastRefreshAt(null);

    const syncSelectedEntity = async () => {
      const schema = await loadEntitySchema(selectedEntityName);

      if (isCancelled || !schema || socketRef.current?.readyState !== WebSocket.OPEN) {
        return;
      }

      resubscribeForCurrentScreen();
      requestEntityRecords('Entity selection changed');
    };

    void syncSelectedEntity();

    return () => {
      isCancelled = true;
    };
  }, [selectedEntityName]);

  useEffect(() => {
    if (socketRef.current?.readyState !== WebSocket.OPEN || !selectedEntityName) {
      return;
    }

    resubscribeForCurrentScreen();
  }, [activeScreen, selectedEntityName]);

  useEffect(() => {
    shuttingDownRef.current = false;

    const connect = () => {
      setConnectionState('connecting');
      appendEvent('Opening WebSocket', getCoordinatorWsUrl());

      const socket = new WebSocket(getCoordinatorWsUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        handleSocketOpen();
      };

      socket.onmessage = (event) => {
        try {
          handleSocketMessage(JSON.parse(event.data));
        } catch {
          appendEvent('Ignored invalid JSON message');
        }
      };

      socket.onerror = () => {
        setErrorMessage('WebSocket reported an error');
        appendEvent('WebSocket error');
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        rejectPendingRequests('WebSocket connection closed');
        setConnectionState('disconnected');
        appendEvent('WebSocket closed');

        if (!shuttingDownRef.current) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connect();
          }, RECONNECT_DELAY_MS);
        }
      };
    };

    connect();

    return () => {
      shuttingDownRef.current = true;

      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      rejectPendingRequests('WebSocket connection closed');

      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isResizingSchema) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      handleSchemaResizeMove(event);
    };

    const onPointerUp = () => {
      handleSchemaResizeEnd();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSchema]);

  useEffect(() => {
    if (
      (activeScreen === 'workflow' || activeScreen === 'visualizer') &&
      !selectedEntitySchema?.capabilities.statusFlow
    ) {
      setActiveScreen('explorer');
    }
  }, [activeScreen, selectedEntitySchema]);

  useEffect(() => {
    if (!selectedEntitySchema || selectedEntitySchema.name !== selectedEntityName) {
      return;
    }

    setColumns(collectColumns(records, selectedEntitySchema));
  }, [records, selectedEntityName, selectedEntitySchema]);

  const selectedEntity = entities.find((entity) => entity.name === selectedEntityName) ?? null;
  const availableColumns = columns.length > 0 ? columns : (selectedEntitySchema?.fields.map((field) => field.name) ?? []);
  const selectedVisibleColumns = selectedEntityName
    ? visibleColumnsByEntity[selectedEntityName]
    : undefined;
  const defaultVisibleColumns = getDefaultVisibleColumns(availableColumns, selectedEntitySchema);
  const displayedColumns = availableColumns.filter((column) =>
    selectedVisibleColumns && selectedVisibleColumns.length > 0
      ? selectedVisibleColumns.includes(column)
      : defaultVisibleColumns.includes(column),
  );
  const fieldsByName = new Map(selectedEntitySchema?.fields.map((field) => [field.name, field]) ?? []);
  const columnMenuOpen = Boolean(columnMenuAnchorEl);
  const workspaceBodyHeight = errorMessage ? 'calc(100vh - 95px)' : 'calc(100vh - 94px)';

  useEffect(() => {
    if (
      !selectedEntityName ||
      !selectedEntitySchema ||
      selectedEntitySchema.name !== selectedEntityName ||
      availableColumns.length === 0
    ) {
      return;
    }

    setVisibleColumnsByEntity((current) => {
      const existing = current[selectedEntityName];
      const next =
        existing && existing.length > 0
          ? existing.filter((column) => availableColumns.includes(column))
          : defaultVisibleColumns;

      const normalizedNext = next.length > 0 ? next : availableColumns;

      if (
        existing &&
        existing.length === normalizedNext.length &&
        existing.every((column, index) => column === normalizedNext[index])
      ) {
        return current;
      }

      return {
        ...current,
        [selectedEntityName]: normalizedNext,
      };
    });
  }, [selectedEntityName, availableColumns, defaultVisibleColumns]);

  const toggleColumnVisibility = (column: string) => {
    if (!selectedEntityName) {
      return;
    }

    setVisibleColumnsByEntity((current) => {
      const existing = current[selectedEntityName] ?? availableColumns;
      const isVisible = existing.includes(column);

      if (isVisible && existing.length === 1) {
        return current;
      }

      return {
        ...current,
        [selectedEntityName]: isVisible
          ? existing.filter((candidate) => candidate !== column)
          : availableColumns.filter((candidate) => candidate === column || existing.includes(candidate)),
      };
    });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'var(--sp-bottom-bg)' }}>
      <Box
        sx={{
          height: 52,
          px: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'var(--sp-chrome-bg)',
          borderBottom: '1px solid var(--sp-border)',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: 0.75,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 0.25,
            }}
          >
            {Array.from({ length: 9 }).map((_, index) => (
              <Box
                key={index}
                sx={{
                  bgcolor: index % 3 === 0 ? 'var(--sp-logo-orange)' : 'var(--sp-text)',
                  opacity: index % 3 === 0 ? 1 : 0.9,
                }}
              />
            ))}
          </Box>
          <Typography sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>UiPath StreamPath</Typography>
          <Typography color="text.secondary">|</Typography>
          <Typography color="text.secondary">Data Fabric Explorer</Typography>
          <Typography color="text.secondary">›</Typography>
          <Typography sx={{ color: 'var(--sp-active-blue)' }}>
            {selectedEntitySchema?.displayName ?? selectedEntity?.displayName ?? 'Workspace'}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1}>
          <Chip size="small" color={getConnectionChipColor(connectionState)} label={connectionState} />
          <Chip size="small" variant="outlined" label={`Metadata ${metadataLoadedAt ?? 'loading'}`} />
        </Stack>
      </Box>

      <Box
        sx={{
          height: 42,
          px: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'var(--sp-chrome-bg)',
          borderBottom: '1px solid var(--sp-border)',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {activeScreen === 'workflow'
            ? 'Workflow Builder'
            : activeScreen === 'visualizer'
              ? 'Flow Visualizer'
              : 'Entity Explorer'}
        </Typography>

        <Box />
      </Box>

      {errorMessage ? (
        <Alert
          severity="warning"
          sx={{
            borderRadius: 0,
            borderBottom: '1px solid var(--sp-border)',
          }}
        >
          {errorMessage}
        </Alert>
      ) : null}

      <Box
        sx={{
          height: workspaceBodyHeight,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '184px 300px minmax(0, 1fr) 360px' },
          columnGap: 0,
        }}
      >
        <Paper
          square
          elevation={0}
          sx={{
            borderRadius: 0,
            borderLeft: 0,
            borderTop: 0,
            borderBottom: 0,
            bgcolor: 'var(--sp-rail-bg)',
            overflow: 'hidden',
            borderRight: '1px solid var(--sp-border)',
            height: '100%',
          }}
        >
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid var(--sp-border)' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Workspace
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Choose the current screen for the selected entity
            </Typography>
          </Box>

          <List dense disablePadding sx={{ p: 1 }}>
            <ListItemButton
              selected={activeScreen === 'explorer'}
              onClick={() => setActiveScreen('explorer')}
              sx={{
                borderRadius: 1,
                mb: 0.5,
                '&.Mui-selected': {
                  backgroundColor: 'var(--sp-selected-bg)',
                  borderLeft: '2px solid var(--sp-active-blue)',
                  pl: '14px',
                },
                '&.Mui-selected:hover': {
                  backgroundColor: 'var(--sp-selected-bg)',
                },
              }}
            >
              <ListItemText
                primary="Entity Explorer"
                secondary="Schema and records"
                primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
                secondaryTypographyProps={{ fontSize: 12 }}
              />
            </ListItemButton>

            <ListItemButton
              selected={activeScreen === 'workflow'}
              onClick={() => setActiveScreen('workflow')}
              disabled={!selectedEntitySchema?.capabilities.statusFlow}
              sx={{
                borderRadius: 1,
                mb: 0.5,
                '&.Mui-selected': {
                  backgroundColor: 'var(--sp-selected-bg)',
                  borderLeft: '2px solid var(--sp-active-blue)',
                  pl: '14px',
                },
                '&.Mui-selected:hover': {
                  backgroundColor: 'var(--sp-selected-bg)',
                },
              }}
            >
              <ListItemText
                primary="Workflow Builder"
                secondary={
                  selectedEntitySchema?.capabilities.statusFlow
                    ? 'Statuses and transitions'
                    : 'Unavailable for this entity'
                }
                primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
                secondaryTypographyProps={{ fontSize: 12 }}
              />
            </ListItemButton>

            <ListItemButton
              selected={activeScreen === 'visualizer'}
              onClick={() => setActiveScreen('visualizer')}
              disabled={!selectedEntitySchema?.capabilities.statusFlow}
              sx={{
                borderRadius: 1,
                mb: 0.5,
                '&.Mui-selected': {
                  backgroundColor: 'var(--sp-selected-bg)',
                  borderLeft: '2px solid var(--sp-active-blue)',
                  pl: '14px',
                },
                '&.Mui-selected:hover': {
                  backgroundColor: 'var(--sp-selected-bg)',
                },
              }}
            >
              <ListItemText
                primary="Flow Visualizer"
                secondary={
                  selectedEntitySchema?.capabilities.statusFlow
                    ? 'Read-only realtime state'
                    : 'Unavailable for this entity'
                }
                primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
                secondaryTypographyProps={{ fontSize: 12 }}
              />
            </ListItemButton>
          </List>
        </Paper>

        <Paper
          square
          elevation={0}
          sx={{
            borderRadius: 0,
            borderLeft: 0,
            borderTop: 0,
            borderBottom: 0,
            bgcolor: 'var(--sp-rail-bg)',
            overflow: 'hidden',
            borderRight: '1px solid var(--sp-border)',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid var(--sp-border)' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Data Manager
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {entities.length} entities discovered
            </Typography>
          </Box>

          <List dense disablePadding sx={{ p: 1, overflow: 'auto' }}>
            {entities.map((entity) => (
              <ListItemButton
                key={entity.id}
                selected={entity.name === selectedEntityName}
                onClick={() => setSelectedEntityName(entity.name)}
                sx={{
                  borderRadius: 1,
                  minHeight: 52,
                  mb: 0.5,
                  alignItems: 'flex-start',
                  '&.Mui-selected': {
                    backgroundColor: 'var(--sp-selected-bg)',
                    borderLeft: '2px solid var(--sp-active-blue)',
                    pl: '14px',
                  },
                  '&.Mui-selected:hover': {
                    backgroundColor: 'var(--sp-selected-bg)',
                  },
                }}
              >
                <ListItemText
                  primary={entity.displayName}
                  secondary={`${entity.name} · ${entity.entityType}`}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
                  secondaryTypographyProps={{ fontSize: 12 }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>

        <Box
          sx={{
            minWidth: 0,
            bgcolor: 'var(--sp-surface-bg)',
            borderRight: { lg: '1px solid var(--sp-border)' },
            height: '100%',
          }}
        >
          <Box sx={{ p: 3, height: '100%' }}>
            {activeScreen === 'explorer' ? (
              <Paper
                square
                sx={{
                  overflow: 'hidden',
                  bgcolor: 'var(--sp-panel-bg)',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  bgcolor: 'var(--sp-raised-bg)',
                  borderBottom: '1px solid var(--sp-border)',
                }}
              >
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {selectedEntitySchema?.displayName ?? 'Select an entity'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedEntitySchema?.name ?? 'No entity selected'}
                  </Typography>
                </Box>

                <Box />
              </Box>

              {selectedEntitySchema ? (
                <>
                  <Box
                    ref={splitContainerRef}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        xl: `${schemaPaneWidth}px ${SCHEMA_DIVIDER_WIDTH}px minmax(0, 1fr)`,
                      },
                      flex: 1,
                      minHeight: 0,
                    }}
                  >
                    <Box
                      sx={{
                        borderBottom: { xs: '1px solid var(--sp-border)', xl: 0 },
                        bgcolor: 'rgba(43, 52, 60, 0.55)',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                      }}
                    >
                      <Box
                        sx={{
                          px: 2,
                          py: 1.25,
                          borderBottom: '1px solid var(--sp-border)',
                          borderLeft: '2px solid var(--sp-logo-teal)',
                          background:
                            'linear-gradient(180deg, rgba(19, 160, 177, 0.12) 0%, rgba(19, 160, 177, 0) 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1,
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              Schema
                            </Typography>
                            <IconButton
                              size="small"
                              aria-label="Refresh schema"
                              onClick={() => selectedEntityName && void loadEntitySchema(selectedEntityName, true)}
                              disabled={!selectedEntityName}
                              sx={{
                                width: 24,
                                height: 24,
                                borderRadius: 1,
                                color: 'var(--sp-muted-text)',
                                backgroundColor: 'transparent',
                                transition: 'color 120ms ease, background-color 120ms ease, opacity 120ms ease',
                                '&:hover': {
                                  backgroundColor: 'transparent',
                                  color: 'var(--sp-active-blue)',
                                },
                                '&.Mui-disabled': {
                                  color: 'rgba(162, 175, 183, 0.32)',
                                },
                              }}
                            >
                              <RefreshIcon />
                            </IconButton>
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            Live field metadata from the coordinator
                          </Typography>
                        </Box>
                      </Box>

                      <TableContainer sx={{ flex: 1, minHeight: 0 }}>
                        <Table stickyHeader size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell
                                sx={{
                                  backgroundColor: 'rgba(19, 160, 177, 0.14)',
                                  fontWeight: 700,
                                }}
                              >
                                Field
                              </TableCell>
                              <TableCell
                                sx={{
                                  backgroundColor: 'rgba(19, 160, 177, 0.14)',
                                  fontWeight: 700,
                                }}
                              >
                                Type
                              </TableCell>
                              <TableCell
                                sx={{
                                  backgroundColor: 'rgba(19, 160, 177, 0.14)',
                                  fontWeight: 700,
                                }}
                              >
                                Flags
                              </TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {selectedEntitySchema.fields.map((field) => (
                              <TableRow
                                hover
                                key={field.name}
                                sx={{
                                  '&:nth-of-type(odd)': {
                                    backgroundColor: 'rgba(19, 160, 177, 0.03)',
                                  },
                                }}
                              >
                                <TableCell>
                                  <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
                                    {field.displayName}
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary">
                                    {field.name}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Typography sx={{ fontSize: 13 }}>{field.dataType}</Typography>
                                  {field.relationship ? (
                                    <Typography variant="body2" color="text.secondary">
                                      {field.relationship.entityTypeName}
                                    </Typography>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                                    {field.primaryKey ? <Chip size="small" label="PK" /> : null}
                                    {field.required ? <Chip size="small" label="Required" /> : null}
                                    {field.unique ? <Chip size="small" label="Unique" /> : null}
                                    {field.foreignKey ? <Chip size="small" label="FK" /> : null}
                                    {field.systemField ? <Chip size="small" label="System" /> : null}
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>

                    <Box
                      role="separator"
                      aria-orientation="vertical"
                      onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
                        event.preventDefault();
                        resizeSessionRef.current = {
                          startX: event.clientX,
                          startWidth: schemaPaneWidth,
                        };
                        setIsResizingSchema(true);
                      }}
                      sx={{
                        display: { xs: 'none', xl: 'flex' },
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'col-resize',
                        alignSelf: 'stretch',
                        bgcolor: 'rgba(30, 37, 43, 0.72)',
                        touchAction: 'none',
                        '&:hover > div': {
                          bgcolor: 'rgba(162, 175, 183, 0.22)',
                        },
                      }}
                    >
                      <Box
                        sx={{
                          width: 1,
                          height: '100%',
                          py: 2,
                          borderRadius: 999,
                          bgcolor: isResizingSchema
                            ? 'rgba(162, 175, 183, 0.22)'
                            : 'rgba(162, 175, 183, 0.14)',
                          boxShadow: isResizingSchema
                            ? '0 0 0 1px rgba(162, 175, 183, 0.08)'
                            : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Stack spacing={0.45} alignItems="center">
                          {Array.from({ length: 3 }).map((_, index) => (
                            <Box
                              key={index}
                              sx={{
                                width: 3,
                                height: 3,
                                borderRadius: '50%',
                                bgcolor: isResizingSchema
                                  ? 'rgba(248, 249, 250, 0.56)'
                                  : 'rgba(162, 175, 183, 0.58)',
                              }}
                            />
                          ))}
                        </Stack>
                      </Box>
                    </Box>

                    <Box
                      sx={{
                        minWidth: 0,
                        bgcolor: 'var(--sp-panel-bg)',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                      }}
                    >
                      <Box
                        sx={{
                          px: 2,
                          py: 1.25,
                          borderBottom: '1px solid var(--sp-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 2,
                        }}
                      >
                        <Box>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              Records
                            </Typography>
                            <IconButton
                              size="small"
                              aria-label="Refresh records"
                              onClick={() => requestEntityRecords('Manual refresh')}
                              disabled={!selectedEntityName}
                              sx={{
                                width: 24,
                                height: 24,
                                borderRadius: 1,
                                color: 'var(--sp-muted-text)',
                                backgroundColor: 'transparent',
                                transition: 'color 120ms ease, background-color 120ms ease, opacity 120ms ease',
                                '&:hover': {
                                  backgroundColor: 'transparent',
                                  color: 'var(--sp-active-blue)',
                                },
                                '&.Mui-disabled': {
                                  color: 'rgba(162, 175, 183, 0.32)',
                                },
                              }}
                            >
                              <RefreshIcon />
                            </IconButton>
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            Last updated: {lastRefreshAt ?? 'Loading'}
                          </Typography>
                        </Box>

                        <Button
                          size="small"
                          variant="outlined"
                          onClick={(event) => setColumnMenuAnchorEl(event.currentTarget)}
                          disabled={availableColumns.length === 0}
                        >
                          Columns
                        </Button>
                      </Box>

                      <Menu
                        anchorEl={columnMenuAnchorEl}
                        open={columnMenuOpen}
                        onClose={() => setColumnMenuAnchorEl(null)}
                        slotProps={{
                          paper: {
                            sx: {
                              mt: 1,
                              minWidth: 220,
                              bgcolor: 'var(--sp-panel-bg)',
                              border: '1px solid var(--sp-border)',
                              boxShadow: 'none',
                            },
                          },
                        }}
                      >
                        {availableColumns.map((column) => {
                          const field = fieldsByName.get(column);
                          const checked = displayedColumns.includes(column);

                          return (
                            <MenuItem
                              key={column}
                              dense
                              onClick={() => toggleColumnVisibility(column)}
                              sx={{
                                gap: 1,
                                alignItems: 'flex-start',
                              }}
                            >
                              <Checkbox
                                size="small"
                                checked={checked}
                                disableRipple
                                sx={{
                                  p: 0.5,
                                  color: 'var(--sp-muted-text)',
                                  '&.Mui-checked': {
                                    color: 'var(--sp-active-blue)',
                                  },
                                }}
                              />
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {field?.displayName ?? column}
                                </Typography>
                                {field?.displayName && field.displayName !== column ? (
                                  <Typography variant="caption" color="text.secondary">
                                    {column}
                                  </Typography>
                                ) : null}
                              </Box>
                            </MenuItem>
                          );
                        })}
                      </Menu>

                      <TableContainer sx={{ flex: 1, minHeight: 0 }}>
                        <Table stickyHeader size="small">
                          <TableHead>
                            <TableRow>
                              {displayedColumns.length > 0 ? (
                                displayedColumns.map((column) => (
                                  <TableCell
                                    key={column}
                                    sx={{
                                      backgroundColor: 'var(--sp-raised-bg)',
                                      fontWeight: 700,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {column}
                                  </TableCell>
                                ))
                              ) : (
                                <TableCell sx={{ backgroundColor: 'var(--sp-raised-bg)', fontWeight: 700 }}>
                                  No data yet
                                </TableCell>
                              )}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {isRecordsLoading ? (
                              Array.from({ length: 6 }).map((_, rowIndex) => (
                                <TableRow key={`skeleton-${rowIndex}`}>
                                  {(displayedColumns.length > 0 ? displayedColumns : ['loading']).map((column, columnIndex) => (
                                    <TableCell key={`${column}-${columnIndex}`}>
                                      <Skeleton
                                        variant="text"
                                        animation="wave"
                                        sx={{
                                          bgcolor: 'rgba(248, 249, 250, 0.08)',
                                          transform: 'none',
                                          borderRadius: 1,
                                        }}
                                      />
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))
                            ) : records.length > 0 ? (
                              records.map((record, index) => (
                                <TableRow hover key={getRowId(record, index)}>
                                  {displayedColumns.map((column) => (
                                    <TableCell
                                      key={column}
                                      sx={{
                                        maxWidth: 260,
                                        verticalAlign: 'top',
                                        fontFamily:
                                          column === 'Id' || column === 'id' ? '"IBM Plex Mono", monospace' : 'inherit',
                                        fontSize: 13,
                                        wordBreak: 'break-word',
                                      }}
                                    >
                                      {formatCellValue(record[column], fieldsByName.get(column))}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))
                            ) : (
                              <TableRow>
                                <TableCell colSpan={Math.max(displayedColumns.length, 1)}>
                                  <Typography color="text.secondary">
                                    No records to display yet.
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  </Box>
                </>
              ) : (
                <Box sx={{ p: 3 }}>
                  <Typography color="text.secondary">
                    Select an entity to load schema and records.
                  </Typography>
                </Box>
              )}
              </Paper>
            ) : activeScreen === 'workflow' && selectedEntitySchema?.capabilities.statusFlow ? (
              <StatusFlowBuilder entity={selectedEntitySchema} requestCommand={requestCommand} />
            ) : activeScreen === 'visualizer' && selectedEntitySchema?.capabilities.statusFlow ? (
              <StreamPathFlowVisualizer
                entity={selectedEntitySchema}
                requestCommand={requestCommand}
                lastEntityChange={lastEntityChange}
                appendEvent={appendEvent}
              />
            ) : (
              <Paper square sx={{ p: 3, height: '100%' }}>
                <Typography color="text.secondary">
                  Select a workflow-enabled entity to use the builder.
                </Typography>
              </Paper>
            )}
          </Box>
        </Box>

        <Paper
          square
          sx={{
            borderTop: 0,
            borderRight: 0,
            borderBottom: 0,
            bgcolor: 'var(--sp-rail-bg)',
            overflow: 'hidden',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid var(--sp-border)' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Event activity
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Recent socket, metadata, and refresh activity
            </Typography>
          </Box>

          <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid var(--sp-border)', borderBottom: '1px solid var(--sp-border)' }}>
            <Stack spacing={1}>
              <Chip size="small" variant="outlined" label={`Selected ${selectedEntitySchema?.displayName ?? selectedEntityName ?? 'none'}`} />
              <Chip
                size="small"
                variant="outlined"
                label={`Screen ${activeScreen === 'workflow' ? 'Workflow Builder' : activeScreen === 'visualizer' ? 'Flow Visualizer' : 'Entity Explorer'}`}
              />
              <Chip size="small" variant="outlined" label={`Last metadata ${metadataLoadedAt ?? 'loading'}`} />
            </Stack>
          </Box>

          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid var(--sp-border)' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Activity
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Recent socket, metadata, and refresh activity
            </Typography>
          </Box>

          <Stack spacing={1} sx={{ p: 1.5, overflow: 'auto' }}>
            {eventLog.length > 0 ? (
              eventLog.map((entry) => (
                <Box
                  key={entry.id}
                  sx={{
                    p: 1.5,
                    borderRadius: 1.5,
                    backgroundColor: 'var(--sp-panel-bg)',
                    border: '1px solid var(--sp-border)',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {entry.summary}
                  </Typography>
                  {entry.detail ? (
                    <Typography
                      variant="body2"
                      sx={{ mt: 0.5, color: 'text.secondary', wordBreak: 'break-word' }}
                    >
                      {entry.detail}
                    </Typography>
                  ) : null}
                  <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                    {entry.time}
                  </Typography>
                </Box>
              ))
            ) : (
              <Typography sx={{ px: 0.5 }} color="text.secondary">
                No events yet.
              </Typography>
            )}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
