# Functional API and plugin lifecycle

- Browser code uses pure immutable request factories and state projections. An API factory may receive one explicit RequestFn; it does not mutate a global singleton or store per-request secrets.
- React Hook logic owns AbortSignal and stale-response guards. User-triggered writes require authorization and result reconciliation; unknown POST outcomes block blind retries.
- Cordis Context and its React Root are owned once per browser host. Plugins contribute pages via registerPage and release effects during disposal.
- Pure domain modules may be imported by browser or Node but must not import any framework state, network credentials, or Node-only handlers.
- Browser client exports come from plugins/public-entries/client.ts; Node handlers reside in plugins/*/server/*.mjs and are excluded from client bundles.
- API contracts and plugin CSS remain versioned with their implementation. Keep CSS Modules and accessible semantic controls.
- Public Playground fixtures do not validate production OAuth, GitHub writes, serverless tracing or deployment behavior.
