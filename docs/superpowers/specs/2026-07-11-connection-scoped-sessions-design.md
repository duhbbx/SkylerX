# Connection-Scoped Sessions Design

Date: 2026-07-11
Status: Approved direction, pending implementation plan

## Problem

SSH-backed connections can fail after idle time because the SSH tunnel closes while `LocalTransport` still keeps a cached `DriverConnection` that points at the old `127.0.0.1:<port>` forwarding endpoint. `connections.test` succeeds because it creates a fresh one-shot connection, but navigation metadata and query execution reuse the stale cached driver and fail with errors such as `ECONNREFUSED 127.0.0.1:<old-port>`.

The current cache key is only `conn.id`, so the navigation tree, query tabs, dialogs, and cancellation all share one driver/pool per saved connection. That prevents query tabs from owning independent execution state and makes a stale SSH endpoint affect unrelated UI areas.

## Goals

- Add an explicit execution scope so each query tab can own an independent cached driver/pool.
- Keep navigation metadata separate from query tabs.
- Support silent reconnect when a reused scoped connection fails because the underlying DB socket or SSH local forwarding endpoint is stale.
- Invalidate all cached scoped drivers for a connection when its SSH tunnel closes.
- Keep existing APIs source-compatible where possible by making scope optional and defaulting to shared behavior.
- Clean up scoped resources when a query tab closes, when a connection is updated/removed, and when the app exits.

## Non-Goals

- Do not rewrite every SQL dialect to pin a single physical DB session for all auto-commit statements in this iteration.
- Do not replay active manual transaction sessions after reconnect. Transaction state is not safely replayable.
- Do not change remote agent behavior beyond type/API compatibility needed for scoped connection refs.
- Do not add UI controls for scopes. Scope IDs are internal infrastructure.

## Scope Model

Introduce a serializable connection scope:

```ts
export interface ConnectionScope {
  id: string
  kind?: 'query-tab' | 'navigation' | 'dialog' | 'shared'
}
```

`ConnectionRef` gains optional `scope?: ConnectionScope`. The stable transport cache key becomes:

```ts
conn.id + '\u241f' + (conn.scope?.id || 'shared')
```

Initial scope IDs:

- Query tabs: `tab:<windowId>:<tabId>`
- Navigation tree: `nav:<windowId>`
- Dialogs and background utilities: omitted scope, meaning `shared`
- Manual transaction session calls: inherit the query tab scope through `beginSession`

The `windowId` only needs to be unique inside the renderer lifetime; it prevents two windows from generating the same local numeric tab IDs. A renderer-local UUID created on startup is enough.

## API Changes

Shared types:

- Add `ConnectionScope`.
- Add `ConnectionRef.scope?: ConnectionScope`.
- Add optional `scope?: ConnectionScope` parameters to `DataClient.connections.execute`, `metadata`, `executeBatch`, `cancel`, `beginSession`, and `executeCommand`.
- Add `releaseScope(connId, scope)` to let the renderer explicitly dispose a scoped driver/pool.

Desktop preload and IPC:

- Pass optional scope through IPC for the methods above.
- Add `connections:releaseScope`.
- On `webContents` destruction, release every scope registered by that renderer window.

Core transport:

- Keep `disconnect(connId)` as whole-connection cleanup.
- Add `releaseScope(connId, scope)` to `SqlTransport`.
- `LocalTransport` stores `connections` and `pending` by scoped key, while still supporting whole-connection disconnect.
- `cancel(conn)` cancels only the scoped cached driver, not all work for the saved connection.

Agent transport:

- Pass `ConnectionRef.scope` through the existing payloads.
- Add a `releaseScope` RPC method so agent-hosted `LocalTransport` instances can clean up scoped drivers too.

## Query Tab Lifecycle

`QueryTabs` already owns stable tab IDs. When creating a query tab, attach a generated scope ID to the tab model and pass it to `QueryPane`.

`QueryPane` uses the scope for:

- normal `execute`
- `executeBatch`
- `beginSession`
- non-session EXPLAIN calls
- cancel
- result pagination and edit-grid verification queries

On `QueryPane` unmount or tab close:

- End any manual transaction session using current behavior.
- Call `connections.releaseScope(connId, scope)`.

If a closed tab is reopened from the recent-closed stack, it receives a new scope. Reusing a dead scope would resurrect stale state.

Navigation metadata uses the navigation scope, so tree expansion never shares a driver with a query tab.

## SSH Tunnel Reconnect And Invalidation

`ssh-tunnel.ts` should emit or call back when a tunnel closes unexpectedly. The desktop transport layer will subscribe and invalidate all scoped drivers for that `connId`.

On the next scoped operation:

1. `LocalTransport.acquire` resolves config.
2. `ensureTunnel(connId, cfg)` creates a new local forwarding port.
3. The dialect driver connects to the new `127.0.0.1:<new-port>`.

`isStaleConnError` should include `ECONNREFUSED` for reused cached connections because it is the expected symptom when a cached driver points at an old local tunnel endpoint. Reconnect remains limited to reused connections and one retry.

For write safety:

- Auto-commit `execute` may retry once only for stale connection errors, matching existing behavior.
- `executeBatch` may retry only when the driver failed before the batch could be sent. The current implementation already treats connection-level stale errors as retryable; tests should lock this down.
- `executeInSession`, `commitSession`, and `rollbackSession` do not retry. They return an error and the UI keeps the user in control.

## Resource Cleanup

Cleanup triggers:

- Query tab close/unmount: release that query scope.
- Connection update/remove: disconnect all scopes for the connection and close the SSH tunnel.
- SSH tunnel close: disconnect all scopes for the connection so stale ports cannot remain cached.
- App shutdown: dispose transport and close all tunnels.
- Renderer/window destruction: release scopes registered by that renderer.

`releaseScope` is idempotent. Missing scopes are treated as already closed.

## Error Handling

The user should not see an error for the normal idle-tunnel recovery path. Metadata and query operations silently reconnect once when a reused scoped driver hits a stale connection error.

If reconnect fails, the original UI error path remains: navigation reports metadata failure; query tabs record an execution error and can still emit `connError`.

Manual transaction stale failures should not silently open a new transaction. The tab reports the error and leaves commit/rollback handling explicit.

## Testing

Focused tests:

- `LocalTransport` uses different cached drivers for the same `connId` with different scopes.
- `LocalTransport.releaseScope` closes only the matching scoped driver.
- `LocalTransport.disconnect(connId)` closes all scoped drivers for that connection.
- Reused scoped connection with `ECONNREFUSED` reconnects once and retries successfully.
- A stale error in one query scope does not replace another query scope's cached driver.
- `cancel` targets only the scoped driver.
- SSH tunnel close invalidates all scoped drivers for the connection.
- Query tab close calls `releaseScope`.

Regression checks:

- Existing unscoped callers still use the shared scope.
- Existing manual transaction flow still starts, executes, commits/rolls back, and ends sessions.
- Existing RAG and AI calls using connection metadata remain unaffected unless explicitly scoped.

## Implementation Order

1. Add shared type/API fields and desktop preload/IPC plumbing with optional scope.
2. Refactor `LocalTransport` cache keys and cleanup methods to be scope-aware.
3. Add SSH tunnel close invalidation from desktop transport.
4. Add renderer window/tab scope generation and pass scope through `QueryTabs`, `QueryPane`, and `NavTree`.
5. Add focused tests before implementation for each behavior above, then run full verification.
