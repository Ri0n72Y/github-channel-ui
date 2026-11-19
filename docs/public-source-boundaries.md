# Public source entry points and migration safety

The repository exposes browser plugins at `plugins/public-entries/client.ts`, pure domain implementations at `plugins/public-entries/domain.mjs`, and Node-only implementation modules under `plugins/*/server/`. The public `api/_*.mjs` files are thin compatibility re-exports so the original public runtime and deployment routes continue to work before a separately approved cutover.

The standalone fixture Playground uses `apps/playground/src/single-plugin-runtime.ts`, selected using `?plugin=...`. Without that parameter the original combined runtime remains in use for production compatibility. Do not consume the Playground as the hosted application entry.

Private consumers must checkout one full public commit SHA into a stable local workspace; avoid floating branch/tag dependencies. Use explicit client-only resolution for React/Vite, a server-only alias for Node ESM adapters, and one resolved React/ReactDOM/ReactRouter/Cordis installation from the hosting workspace. Do not ship secrets or Node built-ins in the browser asset graph.

The source package is not a published npm artifact. Preserve AGPL license and all necessary Corresponding Source and rights information; independent legal/rights review is required for combined hosted deployments.
