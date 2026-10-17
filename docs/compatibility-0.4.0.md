# dsh-btw 0.4.0 — DSH 0.2.1-rc.2 upgrade evidence

## Scope and source

Validated on Windows with Node.js `24.16.0`, pnpm `11.21.0`, on 2026-10-17
(Asia/Shanghai). The target runtime is DeepSeek Harness `0.2.1-rc.2`, the same
version bundled by the current desktop application (`24.21.0` Node runtime,
Cordis `4.0.5`, Schemastery `3.18.5`).

`0.4.0` intentionally drops `0.1.5-rc.1` / `0.1.5-rc.2`. The host request and
client contracts changed between those releases, and keeping both branches
would make every request path conditional.

This is an API, packaging, and unit-level check. It is **not** full browser or
real-provider acceptance. No real user Profile, model credential, or paid model
request is used by the automated suite.

## Compatibility matrix

| DSH | Author declaration | Evidence |
| --- | --- | --- |
| `0.1.5-rc.1` | `unsupported` | `0.4.0` targets the 0.2.1 request/client contracts |
| `0.1.5-rc.2` | `unsupported` | same |
| `0.2.1-rc.2` | `compatible` | typecheck, 22 unit tests, build, dependency-graph check |

`compatible` is an author declaration within the evidence above. Real model
generation, complete Web UI interaction, live provider cache behavior, Node.js
22, macOS/Linux, and rollback remain unverified.

## API changes handled by 0.4.0

- **First-class tool results.** DSH 0.2.1 surfaces tool results as `role: 'tool'`
  messages carrying `toolCallId`, not as `tool-result` blocks inside user
  messages. `balancedMessagePrefix()` now tracks assistant `tool-call` ids and
  `role: 'tool'` results.
- **Tool history.** The 0.2.1 agent loop sends `toolHistory: session.toolHistory()`
  with every request; `LlmRuntime` uses it for `projectToolUpdates()`. The BTW
  snapshot now captures the same history and passes it through the one-shot
  request so developer tool additions/removals are projected exactly like the
  parent request.
- **pi-ai direct path projections.** The cache bridge still calls a per-call
  `PiAiAdapter` directly to install `onPayload`, but it now re-applies the
  runtime's pre-dispatch projections: `projectFilesToText`,
  `projectImagesForTextModel`, and `projectToolUpdates`. Replay-state filtering
  (`forAdapter`) is intentionally not reproduced: the per-call delegate belongs
  to the same provider family as the registered adapter, and filtering by
  delegate identity would strip valid replay state.
- **`CommandClaim.name`.** The 0.2.1 input-trigger contract requires the command
  catalog name (`btw`) in addition to the token and hint.
- **`MarkdownLabels.code.toolbarLabels`.** The 0.2.1 Markdown primitives add the
  code-card toolbar labels; the overlay now supplies `codeLabel`, `wrapLabel`,
  and `unwrapLabel` and keeps the old fallback safe.
- **Connection handler signature.** The host RPC handler type now carries a
  `PeerScope`; the plugin's exact Fetch route owns no peer scope, so it uses a
  local three-argument handler type and lets the shared carrier keep transport
  ownership.
- **Dependency graph.** DSH packages move to `0.2.1-rc.2`, Cordis to `4.0.5`,
  Schemastery to `3.18.5`. `pnpm-workspace.yaml` no longer references the
  removed `dsh-agent-presets`, `dsh-code-runtime`, or `dsh-invariants` packages,
  and uses `nodeLinker: hoisted` so this checkout resolves all transitive DSH
  packages on Windows junctions.

## Automated checks

Run from the plugin checkout:

```powershell
pnpm install --ignore-scripts
pnpm run typecheck
pnpm run build
pnpm test
```

Results for this revision:

- TypeScript source typecheck passed against the `0.2.1-rc.2` graph.
- 22 unit tests passed across 9 files, including context balancing with
  `role: 'tool'` results, `toolHistory` capture, cache boundaries, input
  interception with `CommandClaim.name`, the official prepared-call runtime,
  the pi-ai adapter bridge, RPC envelope validation, sidechain isolation, and
  client bundle loading.
- Host/client bundles and declarations rebuilt.
- Dependency graph resolves at `0.2.1-rc.2` (Cordis `4.0.5`, Schemastery
  `3.18.5`, React `18.3.1` supplied by the GUI).

A disposable `web` Profile was installed and started with the application's
bundled DSH `0.2.1-rc.2` CLI. All checks passed:

1. `dsh plugin --profile web add dist/dsh-btw-0.4.0.tgz --ignore-scripts`
   exited 0 and the package resolved as `dsh-btw 0.4.0`.
2. `--dump-config` contained the additive `id: btw` entry.
3. The Web profile started on a loopback port without opening a browser.
4. An unauthenticated `POST /api/dsh-btw/ask` returned HTTP 401.
5. With the startup cookie, a malformed envelope returned `bad-request`.
6. A nonexistent session returned `session-not-found` in the correlated
   envelope; uninstall removed `id: btw` from the composed configuration.
7. The GUI boot graph served for the same profile (`release 0.2.1-rc.2`,
   70 entries) contained a `dsh-btw` client row with the expected `inject`
   list; fetching its batch URL returned HTTP 200 and the bundle registered
   `window.__ModuleLoader__.load({ id: "dsh-btw", ... })`.

The packed `0.4.0` artifact was also installed into the application's
`desktop` profile (`dsh-btw` added to `dsh.profile.bundles`). The desktop
application must be fully restarted before the GUI loads the new bundle.

## Remaining acceptance work

- In the GUI, ask `/btw` while the main agent is busy and inspect rendering,
  keyboard dismissal, cancellation, and main-session history isolation.
- Validate Anthropic cache markers on an actual provider request and confirm
  other configured providers still generate normally.
- Validate Node.js 22, macOS/Linux, and rollback before claiming them.
