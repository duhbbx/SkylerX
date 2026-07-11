# Scoped Connection Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scope-aware connection caching so each query tab owns its own driver/pool while navigation and shared callers stay isolated, with silent recovery from stale SSH tunnel endpoints.

**Architecture:** `ConnectionRef` gets an optional serializable `ConnectionScope`; renderer callers pass scopes through `DataClient`, preload, IPC, and `LocalTransport`. `LocalTransport` caches by `(connId, scopeId)`, can release a single scope, and can invalidate all scopes when SSH tunnel lifecycle reports a close. Query tabs generate a scope at tab creation; navigation uses a renderer-wide nav scope.

**Tech Stack:** TypeScript, Vue 3, Electron IPC, Vitest, `@db-tool/shared-types`, `@db-tool/core-driver`.

## Global Constraints

- Daily development stays on `dev`.
- Commit messages must be English.
- Do not touch untracked `.claude/` or `AGENTS.md`.
- Preserve existing unscoped callers by defaulting to the `shared` scope.
- Do not rewrite all dialect drivers to pin a single physical DB session in this iteration.
- Do not silently replay manual transaction sessions.

---

## File Structure

- `packages/shared-types/src/index.ts`: add `ConnectionScope`, extend `ConnectionRef`, and add optional scope parameters to `DataClient.connections`.
- `packages/core-driver/src/transport.ts`: add `releaseScope(connId, scope)` to `SqlTransport`.
- `packages/core-driver/src/transports/local.ts`: scope-aware connection/pending/session ownership and `ECONNREFUSED` stale reconnect.
- `packages/core-driver/src/transports/local.test.ts`: focused TDD coverage for scoped cache behavior and reconnect.
- `packages/core-driver/src/transports/agent-protocol.ts`: pass scope payloads and add `releaseScope` RPC.
- `packages/core-driver/src/transports/agent.ts`: forward `releaseScope` and scoped refs.
- `apps/desktop/src/main/ssh-tunnel.ts`: support tunnel-close listeners.
- `apps/desktop/src/main/transport.ts`: invalidate scoped drivers when a tunnel closes.
- `apps/desktop/src/main/ipc/connections.ts`: pass scopes into transport and expose `connections:releaseScope`.
- `apps/desktop/src/preload/index.ts`: expose optional scope args and `releaseScope`.
- `packages/ui/src/connectionScope.ts`: create renderer/window, nav, and query-tab scope helpers.
- `packages/ui/src/components/QueryTabs.vue`: attach query-tab scopes and pass them into `QueryPane`.
- `packages/ui/src/components/QueryPane.vue`: pass the query scope to all non-session connection calls and begin/cancel/release calls.
- `packages/ui/src/components/NavTree.vue`: use the navigation scope for metadata.

---

### Task 1: Shared Scope API And LocalTransport Tests

**Files:**
- Modify: `packages/shared-types/src/index.ts`
- Modify: `packages/core-driver/src/transport.ts`
- Modify: `packages/core-driver/src/transports/local.test.ts`
- Modify: `packages/core-driver/src/transports/local.ts`

**Interfaces:**
- Produces: `ConnectionScope { id: string; kind?: 'query-tab' | 'navigation' | 'dialog' | 'shared' }`
- Produces: `ConnectionRef.scope?: ConnectionScope`
- Produces: `SqlTransport.releaseScope(connId: string, scope?: ConnectionScope): Promise<void>`
- Produces: `LocalTransport` cache key derived from `conn.id` and `conn.scope?.id || 'shared'`

- [ ] **Step 1: Write failing LocalTransport tests**

Add tests in `packages/core-driver/src/transports/local.test.ts`:

```ts
const scopedRef = (id: string, scopeId?: string): ConnectionRef => ({
  id,
  scope: scopeId ? { id: scopeId, kind: 'query-tab' } : undefined,
  config: { id, name: id, dialect: DbDialect.MySQL } as ConnectionConfig,
})

it('caches different driver connections for different scopes of the same connId', async () => {
  const built = registerFlakyDriver([() => null, () => null])
  const t = new LocalTransport()

  await t.execute(scopedRef('s1', 'tab:a'), 'SELECT 1')
  await t.execute(scopedRef('s1', 'tab:b'), 'SELECT 1')
  await t.execute(scopedRef('s1', 'tab:a'), 'SELECT 1')

  expect(built).toHaveLength(2)
})

it('releaseScope closes only the matching scoped connection', async () => {
  const built = registerFlakyDriver([() => null, () => null])
  const t = new LocalTransport()

  await t.execute(scopedRef('s2', 'tab:a'), 'SELECT 1')
  await t.execute(scopedRef('s2', 'tab:b'), 'SELECT 1')
  await t.releaseScope('s2', { id: 'tab:a', kind: 'query-tab' })

  expect(built[0].closed).toBe(true)
  expect(built[1].closed).toBe(false)
})

it('disconnect closes all scoped connections for a connId', async () => {
  const built = registerFlakyDriver([() => null, () => null, () => null])
  const t = new LocalTransport()

  await t.execute(scopedRef('s3', 'tab:a'), 'SELECT 1')
  await t.execute(scopedRef('s3', 'tab:b'), 'SELECT 1')
  await t.execute(scopedRef('other', 'tab:a'), 'SELECT 1')
  await t.disconnect('s3')

  expect(built[0].closed).toBe(true)
  expect(built[1].closed).toBe(true)
  expect(built[2].closed).toBe(false)
})

it('reconnects once for ECONNREFUSED on a reused scoped connection', async () => {
  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:56503'), {
    code: 'ECONNREFUSED',
  })
  const built = registerFlakyDriver([(n) => (n === 2 ? refused : null), () => null])
  const t = new LocalTransport()

  await t.execute(scopedRef('s4', 'tab:a'), 'SELECT 1')
  const result = await t.execute(scopedRef('s4', 'tab:a'), 'SELECT 1')

  expect(result).toEqual(OK)
  expect(built).toHaveLength(2)
  expect(built[0].closed).toBe(true)
})

it('cancel targets only the scoped cached driver', async () => {
  class CancelConn extends FakeConn {
    canceled = false
    async cancelActive() {
      this.canceled = true
    }
  }
  const built: CancelConn[] = []
  registerDriver({
    dialect: DbDialect.ClickHouse,
    sql: {} as DatabaseDriver['sql'],
    async test() { return { ok: true } },
    async connect() {
      const c = new CancelConn(() => null)
      built.push(c)
      return c
    },
  })
  const t = new LocalTransport()
  const refA: ConnectionRef = { id: 's5', scope: { id: 'tab:a' }, config: { id: 's5', name: 's5', dialect: DbDialect.ClickHouse } as ConnectionConfig }
  const refB: ConnectionRef = { id: 's5', scope: { id: 'tab:b' }, config: { id: 's5', name: 's5', dialect: DbDialect.ClickHouse } as ConnectionConfig }

  await t.execute(refA, 'SELECT 1')
  await t.execute(refB, 'SELECT 1')
  await t.cancel(refB)

  expect(built[0].canceled).toBe(false)
  expect(built[1].canceled).toBe(true)
})
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run packages/core-driver/src/transports/local.test.ts`

Expected: fail with missing `scope`/`releaseScope` support and `ECONNREFUSED` not reconnecting.

- [ ] **Step 3: Implement shared types and transport interface**

Add `ConnectionScope` and extend `ConnectionRef` / `DataClient.connections` signatures in `packages/shared-types/src/index.ts`. Add `releaseScope` to `SqlTransport` in `packages/core-driver/src/transport.ts`.

- [ ] **Step 4: Implement scope-aware LocalTransport**

Change `connections`, `pending`, and reconnect logic in `packages/core-driver/src/transports/local.ts` so keys are computed by:

```ts
private scopedKey(conn: ConnectionRef): string {
  return `${conn.id}␟${conn.scope?.id || 'shared'}`
}
```

`disconnect(connId)` closes every key whose parsed `connId` matches. `releaseScope(connId, scope)` closes only the matching scoped key. `cancel(conn)` uses the scoped key. `isStaleConnError` includes `ECONNREFUSED`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm vitest run packages/core-driver/src/transports/local.test.ts
pnpm --filter @db-tool/core-driver typecheck
```

Expected: all pass.

Commit:

```bash
git add packages/shared-types/src/index.ts packages/core-driver/src/transport.ts packages/core-driver/src/transports/local.ts packages/core-driver/src/transports/local.test.ts
git commit -m "feat(transport): scope local connection caches"
```

---

### Task 2: IPC, Agent, And SSH Tunnel Invalidation

**Files:**
- Modify: `packages/core-driver/src/transports/agent-protocol.ts`
- Modify: `packages/core-driver/src/transports/agent.ts`
- Modify: `apps/desktop/src/main/ssh-tunnel.ts`
- Modify: `apps/desktop/src/main/transport.ts`
- Modify: `apps/desktop/src/main/ipc/connections.ts`
- Modify: `apps/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `ConnectionScope`, `ConnectionRef.scope`, `SqlTransport.releaseScope`.
- Produces: desktop API `connections.releaseScope(connId, scope?)`.
- Produces: `onTunnelClosed(listener)` unsubscribe helper.

- [ ] **Step 1: Add failing compile-level usage through IPC/preload**

Update type signatures first in preload and IPC call sites to accept `scope?: ConnectionScope`. Run typecheck before implementation.

Run: `pnpm --filter @db-tool/desktop typecheck`

Expected: fail because `SqlTransport.releaseScope` and scoped refs are not wired everywhere yet.

- [ ] **Step 2: Wire agent protocol and transport**

Add `releaseScope` to `AgentRpcMethod`, `AgentRpcPayloads`, `dispatchAgentRpc`, and `AgentTransport.releaseScope`.

- [ ] **Step 3: Wire desktop IPC and preload**

IPC handlers construct refs as `{ id: connId, scope }` for `execute`, `metadata`, `executeBatch`, `cancel`, `beginSession`, and `executeCommand`. Add `connections:releaseScope`.

Preload mirrors optional scope args and exposes `releaseScope`.

- [ ] **Step 4: Wire SSH tunnel close invalidation**

In `ssh-tunnel.ts`, add:

```ts
type TunnelCloseListener = (connId: string) => void
const closeListeners = new Set<TunnelCloseListener>()
export function onTunnelClosed(listener: TunnelCloseListener): () => void {
  closeListeners.add(listener)
  return () => closeListeners.delete(listener)
}
```

When the SSH client emits `close`, call listeners after removing the tunnel. In `transport.ts`, subscribe once and call `transport.disconnect(connId)` if the singleton exists.

- [ ] **Step 5: Run typechecks and commit**

Run:

```bash
pnpm --filter @db-tool/core-driver typecheck
pnpm --filter @db-tool/desktop typecheck
```

Expected: both pass.

Commit:

```bash
git add packages/core-driver/src/transports/agent-protocol.ts packages/core-driver/src/transports/agent.ts apps/desktop/src/main/ssh-tunnel.ts apps/desktop/src/main/transport.ts apps/desktop/src/main/ipc/connections.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): pass connection scopes through IPC"
```

---

### Task 3: Renderer Query And Navigation Scopes

**Files:**
- Create: `packages/ui/src/connectionScope.ts`
- Modify: `packages/ui/src/components/QueryTabs.vue`
- Modify: `packages/ui/src/components/QueryPane.vue`
- Modify: `packages/ui/src/components/NavTree.vue`

**Interfaces:**
- Consumes: optional `ConnectionScope` parameters on `DataClient.connections`.
- Produces: `navConnectionScope(): ConnectionScope`
- Produces: `queryTabConnectionScope(tabId: number): ConnectionScope`

- [ ] **Step 1: Create scope helper**

Create `packages/ui/src/connectionScope.ts`:

```ts
import type { ConnectionScope } from '@db-tool/shared-types'

const windowScopeId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `w${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function navConnectionScope(): ConnectionScope {
  return { id: `nav:${windowScopeId}`, kind: 'navigation' }
}

export function queryTabConnectionScope(tabId: number): ConnectionScope {
  return { id: `tab:${windowScopeId}:${tabId}`, kind: 'query-tab' }
}
```

- [ ] **Step 2: Pass scopes from QueryTabs to QueryPane**

Add `scope: ConnectionScope` to query tabs. In `push`, if `tab.kind === 'query'`, compute `scope: queryTabConnectionScope(id)`. Pass `:connection-scope="t.scope"` into `QueryPane`.

- [ ] **Step 3: Pass the query scope through QueryPane calls**

Add prop `connectionScope: ConnectionScope`. Use it as the last argument for every non-session `client.connections.execute`, `metadata`, `executeBatch`, `cancel`, and `beginSession` call inside `QueryPane.vue`. In `onBeforeUnmount`, call:

```ts
void client.connections.releaseScope(props.conn.id, props.connectionScope)
```

Session follow-up methods keep using `sessionId`; only `beginSession` needs the scope.

- [ ] **Step 4: Pass nav scope through NavTree metadata**

Import `navConnectionScope`, create one module/component-level `const navScope = navConnectionScope()`, and pass it into `client.connections.metadata(connId, scope, navScope)`.

- [ ] **Step 5: Run UI typecheck and commit**

Run: `pnpm --filter @db-tool/ui typecheck`

Expected: pass.

Commit:

```bash
git add packages/ui/src/connectionScope.ts packages/ui/src/components/QueryTabs.vue packages/ui/src/components/QueryPane.vue packages/ui/src/components/NavTree.vue
git commit -m "feat(ui): assign scopes to query tabs and navigation"
```

---

### Task 4: Full Verification And Fixups

**Files:**
- Modify only files from Tasks 1-3 if verification exposes issues.

**Interfaces:**
- Consumes: completed scoped connection implementation.
- Produces: verified branch ready for review.

- [ ] **Step 1: Run full tests**

Run:

```bash
pnpm test
pnpm --filter @db-tool/ui typecheck
pnpm --filter @db-tool/desktop typecheck
git diff --check 4560000..HEAD
```

Expected: all pass.

- [ ] **Step 2: Review changed call sites**

Run:

```bash
rg -n "connections\\.(execute|metadata|executeBatch|cancel|beginSession|releaseScope)" packages/ui/src/components/QueryPane.vue packages/ui/src/components/NavTree.vue apps/desktop/src/main/ipc/connections.ts apps/desktop/src/preload/index.ts
```

Confirm query/nav scoped calls are wired and existing shared callers are source-compatible.

- [ ] **Step 3: Commit any verification fixups**

If fixes were needed:

```bash
git add <fixed-files>
git commit -m "fix: complete scoped connection wiring"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: query scopes, nav scope, optional shared scope, releaseScope, SSH tunnel invalidation, stale ECONNREFUSED reconnect, and transaction non-replay are covered.
- Placeholder scan: no TBD/TODO/placeholder steps.
- Type consistency: `ConnectionScope`, `ConnectionRef.scope`, `releaseScope(connId, scope?)`, `navConnectionScope`, and `queryTabConnectionScope` are used consistently.
