# Public plugin source contribution rules

This repository provides reusable React/Cordis client plugins, pure domain modules, Node-only GitHub service handlers, single-plugin fixture Playground and tests.

- Keep source entry points explicit. Browser bundles must never depend on `plugins/*/server`, `api/`, Node built-ins, OAuth credentials or GitHub App secrets.
- Ordinary business APIs use immutable functional objects. Cordis Services are lifecycle adapters, with a single browser Context and React Root. Route contributions use `ctx.reactUI.registerPage`; cleanup belongs to Cordis disposal.
- Keep component-specific styles in CSS Modules. Maintain request AbortSignal, stale response rejection, authorization boundaries and unknown GitHub POST result protection.
- The legacy public Playground composition and Vercel routes remain compatible during migration; do not remove, merge or deploy a breaking cutover without separate approval.
- Run `npm run build` and relevant Node/DOM/route tests and document actual evidence. No real GitHub write tests without explicit authorization.
- Do not publish packages, embed credentials, or make production settings changes in source migration PRs.
- License: AGPL-3.0-only for original code. Preserve authorship, original Git history and third-party notices. Deployment of modified network services may trigger Corresponding Source obligations; review them before distribution or use.
