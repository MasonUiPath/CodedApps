import { z } from 'zod';

export const subscriptionFilterSchema = z
  .object({
    entityTypeName: z.string().min(1).optional(),
    entityId: z.string().min(1).optional(),
  })
  .strict();

export const httpEntityChangeEventSchema = z
  .object({
    entityId: z.string().min(1),
    entityTypeName: z.string().min(1),
    changedAt: z
      .string()
      .min(1)
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: 'changedAt must be a valid date string',
      }),
    correlationId: z.string().min(1).optional(),
    changeType: z.enum(['CREATED', 'UPDATED', 'DELETED']).optional(),
    source: z.string().min(1).optional(),
    payload: z.unknown().optional(),
  })
  .strict();

export const statusTransitionRequestSchema = z
  .object({
    recordId: z.string().min(1).optional(),
    targetNodeId: z.string().min(1).optional(),
    RecordId: z.string().min(1).optional(),
    NewStatusId: z.string().min(1).optional(),
    entityName: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const recordId = value.recordId ?? value.RecordId;
    const targetNodeId = value.targetNodeId ?? value.NewStatusId;

    if (!recordId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recordId'],
        message: 'recordId (or RecordId) is required',
      });
    }

    if (!targetNodeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetNodeId'],
        message: 'targetNodeId (or NewStatusId) is required',
      });
    }
  })
  .strict();

export const normalizedEntityChangeEventSchema = z
  .object({
    eventId: z.string().min(1),
    entityId: z.string().min(1),
    entityTypeName: z.string().min(1),
    changedAt: z.string().min(1),
    correlationId: z.string().min(1).optional(),
    changeType: z.enum(['CREATED', 'UPDATED', 'DELETED']).optional(),
    source: z.string().min(1),
    reason: z.literal('entity_invalidated'),
    payload: z.unknown().optional(),
  })
  .strict();

export const relayCommandSchema = z
  .object({
    type: z.literal('command'),
    correlationId: z.string().min(1).optional(),
    command: z.enum(['GET', 'GET_MANY', 'CREATE', 'UPDATE', 'DELETE']),
    entityId: z.string().min(1).optional(),
    entityTypeName: z.string().min(1).optional(),
    recordId: z.string().min(1).optional(),
    recordIds: z.array(z.string().min(1)).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Boolean(value.entityId || value.entityTypeName), {
    message: 'command requires `entityId` or `entityTypeName`',
    path: ['entityId'],
  })
  .strict();

export const metadataRequestSchema = z
  .object({
    type: z.literal('metadata_request'),
    correlationId: z.string().min(1).optional(),
    action: z.enum(['list_entities', 'get_entity_schema']),
    entityTypeName: z.string().min(1).optional(),
    refresh: z.boolean().optional(),
  })
  .refine(
    (value) => {
      if (value.action === 'get_entity_schema') {
        return Boolean(value.entityTypeName);
      }

      return true;
    },
    {
      message: 'get_entity_schema requires `entityTypeName`',
      path: ['entityTypeName'],
    },
  )
  .strict();

export const eventRequestSchema = z
  .object({
    type: z.literal('event_request'),
    correlationId: z.string().min(1).optional(),
    event: httpEntityChangeEventSchema,
  })
  .strict();

export const statusTransitionWsRequestSchema = z
  .object({
    type: z.literal('status_transition_request'),
    correlationId: z.string().min(1).optional(),
    request: statusTransitionRequestSchema,
  })
  .strict();

export const flowSnapshotRequestSchema = z
  .object({
    type: z.literal('flow_snapshot_request'),
    correlationId: z.string().min(1).optional(),
    recordId: z.string().min(1),
    entityTypeName: z.string().min(1).optional(),
  })
  .strict();

export const agentTaskSnapshotRequestSchema = z
  .object({
    type: z.literal('agent_task_snapshot_request'),
    correlationId: z.string().min(1).optional(),
    loanRecordId: z.string().min(1),
  })
  .strict();

export const subscribeMessageSchema = z
  .object({
    type: z.literal('subscribe'),
    subscriptions: z.array(subscriptionFilterSchema).min(1),
  })
  .strict();

export const unsubscribeMessageSchema = z
  .object({
    type: z.literal('unsubscribe'),
    subscriptions: z.array(subscriptionFilterSchema).optional(),
  })
  .strict();

export const pingMessageSchema = z
  .object({
    type: z.literal('ping'),
  })
  .strict();

export const wsClientMessageSchema = z.union([
  subscribeMessageSchema,
  unsubscribeMessageSchema,
  relayCommandSchema,
  metadataRequestSchema,
  eventRequestSchema,
  statusTransitionWsRequestSchema,
  flowSnapshotRequestSchema,
  agentTaskSnapshotRequestSchema,
  pingMessageSchema,
]);

export type SubscriptionFilter = z.infer<typeof subscriptionFilterSchema>;
export type HttpEntityChangeEvent = z.infer<typeof httpEntityChangeEventSchema>;
export type StatusTransitionRequest = z.infer<typeof statusTransitionRequestSchema>;
export type NormalizedEntityChangeEvent = z.infer<typeof normalizedEntityChangeEventSchema>;
export type RelayCommand = z.infer<typeof relayCommandSchema>;
export type MetadataRequest = z.infer<typeof metadataRequestSchema>;
export type EventRequest = z.infer<typeof eventRequestSchema>;
export type StatusTransitionWsRequest = z.infer<typeof statusTransitionWsRequestSchema>;
export type FlowSnapshotRequest = z.infer<typeof flowSnapshotRequestSchema>;
export type AgentTaskSnapshotRequest = z.infer<typeof agentTaskSnapshotRequestSchema>;
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
