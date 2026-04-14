# StreamPathCoordinator

A TypeScript relay service that:

- Accepts inbound HTTP entity-change events.
- Pushes invalidation-style entity-change events to connected WebSocket clients based on client subscriptions.
- Accepts duplex WebSocket command messages (`GET`, `GET_MANY`, `CREATE`, `UPDATE`, `DELETE`) and relays them to UiPath Data Fabric Entities via the UiPath TypeScript SDK.

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

Server defaults to `http://localhost:8080` and WebSocket path `/ws`.

## Configuration

Required `.env` values:

- `UIPATH_ORG_NAME`
- `UIPATH_TENANT_NAME`
- Authentication:
  - PAT mode: `UIPATH_PAT` (or `UIPATH_SECRET`)
  - External app mode (no user auth flow): `UIPATH_CLIENT_ID` + `UIPATH_CLIENT_SECRET`

Optional values:

- `PORT` (default `8080`)
- `WS_PATH` (default `/ws`)
- `JSON_BODY_LIMIT` (default `1mb`)
- `UIPATH_BASE_URL` (default `https://cloud.uipath.com`)
- `UIPATH_AUTH_MODE` (`pat` or `external_app`; auto-selects `external_app` when client credentials are present)
- `UIPATH_SCOPE` (recommended for `external_app`)
- `UIPATH_TOKEN_URL` (default `${UIPATH_BASE_URL}/identity_/connect/token`)
- `UIPATH_SECRET` (legacy fallback; `UIPATH_PAT` is preferred)

## HTTP API

### `GET /health`

Returns service status and connected WebSocket client count.

### `POST /events`

Accepts entity-change events and broadcasts invalidation hints to matching subscribed clients. UiPath-originated events do not need a correlation ID.

When `changeType` is `CREATED`, the coordinator also attempts StreamPath auto-initialization:

- If a `StreamPathStatusFlowDefinition` exists for `entityTypeName`, it initializes a `StreamPathStatusInstance` at the start node for the created record.
- It creates an initial `StreamPathStatusHistory` row (`FromNode: null`, `ToNode: startNode`).
- It broadcasts invalidation events for both `StreamPathStatusInstance` and `StreamPathStatusHistory`.

For auto-init, include a record ID in payload (`recordId`, `RecordId`, `id`, `Id`, or `targetRecordId`).

Request body:

```json
{
  "entityId": "entity-uuid",
  "entityTypeName": "Invoice",
  "changedAt": "2026-03-28T19:00:00.000Z",
  "changeType": "UPDATED",
  "source": "uipath",
  "payload": {
    "recordId": "row-42"
  }
}
```

`correlationId`, `changeType`, `source`, and `payload` are optional.

### `POST /status/transition`

Transitions a StreamPath status instance using:

- `NewStatusId` (target status node Id)
- `RecordId` (business record Id)
- `entityName` (optional guard; should match target instance entity type)

What it does:

- Resolves the target node (`StreamPathStatusNode`) and its flow definition.
- Finds the matching `StreamPathStatusInstance` for that `recordId` in the same flow.
- Validates a legal transition from current node to target node (or reverse when bidirectional).
- Updates `StreamPathStatusInstance` (`CurrentNodeKey`, `CurrentStatusLabel`, `LastTransitionAt`, `IsClosed`).
- Inserts a `StreamPathStatusHistory` record so the visualizer can compute completed steps.
- Broadcasts `entity_change` events for `StreamPathStatusInstance` and `StreamPathStatusHistory`.

Request body:

```json
{
  "NewStatusId": "3E8BB82F-3A2D-F111-9A49-0022480B96F4",
  "RecordId": "435B70BF-2A2D-F111-9A49-0022480B96F4",
  "entityName": "DocFlowDocument"
}
```

Example:

```bash
curl -X POST http://localhost:8080/status/transition \
  -H "Content-Type: application/json" \
  -d '{
    "NewStatusId": "3E8BB82F-3A2D-F111-9A49-0022480B96F4",
    "RecordId": "435B70BF-2A2D-F111-9A49-0022480B96F4",
    "entityName": "DocFlowDocument"
  }'
```

Backwards compatibility:

- `recordId` and `targetNodeId` are still accepted.

## WebSocket Protocol

Connect clients to:

```text
ws://localhost:8080/ws
```

### Subscribe for entity changes

```json
{
  "type": "subscribe",
  "subscriptions": [
    { "entityTypeName": "Invoice" },
    { "entityId": "entity-uuid" }
  ]
}
```

Filter behavior per subscription item:

- `entityTypeName` only: all changes for that entity type.
- `entityId` only: all changes for that specific entity.
- both: only matching pair.
- `{}`: wildcard (all events).

The coordinator only applies these coarse filters. The frontend should still decide whether the active screen needs to refetch.

### Unsubscribe

```json
{
  "type": "unsubscribe",
  "subscriptions": [
    { "entityTypeName": "Invoice" }
  ]
}
```

If `subscriptions` is omitted, all subscriptions are removed.

### Relay command to UiPath

```json
{
  "type": "command",
  "correlationId": "cmd-123",
  "command": "GET_MANY",
  "entityId": "entity-uuid",
  "options": {
    "limit": 25,
    "offset": 0
  }
}
```

Supported commands:

- `GET`: `getRecordById` and requires `recordId`
- `GET_MANY`: `getAllRecords` for list or collection refreshes
- `CREATE`: `insertRecordById` (requires `data`)
- `UPDATE`: `updateRecordById` (requires `recordId` + `data`)
- `DELETE`: `deleteRecordsById` (requires `recordId` or `recordIds`)

Single-record fetch example:

```json
{
  "type": "command",
  "correlationId": "cmd-detail-123",
  "command": "GET",
  "entityId": "entity-uuid",
  "recordId": "row-42"
}
```

List refresh example:

```json
{
  "type": "command",
  "correlationId": "cmd-list-123",
  "command": "GET_MANY",
  "entityId": "entity-uuid",
  "options": {
    "limit": 25,
    "offset": 0
  }
}
```

Command result message:

```json
{
  "type": "command_result",
  "ok": true,
  "correlationId": "cmd-123",
  "command": "GET",
  "entityId": "entity-uuid",
  "data": {}
}
```

Broadcasted change message:

```json
{
  "type": "entity_change",
  "eventId": "b07744d9-bd80-41f0-a78c-532bb220f3af",
  "entityId": "entity-uuid",
  "entityTypeName": "Invoice",
  "changedAt": "2026-03-28T19:00:00.000Z",
  "changeType": "UPDATED",
  "source": "uipath",
  "reason": "entity_invalidated"
}
```

`entity_change` is an invalidation hint, not a full state payload. A typical frontend flow is:

- ignore the event if the current UI does not care about that entity type or ID
- request `GET` for a detail view or `GET_MANY` for a list view when the current screen needs fresh data
- mark list/detail views stale and refetch on demand

## Build and Run

```bash
npm run build
npm start
```

## Notes

- This relay currently targets UiPath **Entities** operations through `@uipath/uipath-typescript`.
- The UiPath SDK receives auth via the `secret` config field. In PAT mode this is your PAT; in external-app mode this is a cached bearer token fetched via client credentials.
- If you need additional UiPath services (Tasks, Processes, Queues, etc.), extend `src/uipathRelay.ts` with additional routing.
