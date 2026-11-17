# GitHub Channel UI — Public Plugin Source

Reusable Cordis/React plugins for public GitHub repository discovery, Issues, channels, configuration and discussions.

## Development

`npm install --no-audit --no-fund && npm run build` builds the public Playground. `npm run dev` serves it locally. Select a standalone plugin with `?plugin=repo-home`, `repo-config`, `issue-detail`, `channel`, `topic-page` or `repo-panel`. The standalone fixture modes are for controlled UI verification.

The former combined Playground entry and public Vercel routes remain available on this migration branch for compatibility. They must not be removed or repointed until the deployment cutover is independently approved.

## Source boundaries

- Browser-only entry: `plugins/public-entries/client.ts`.
- Pure JS domain entry: `plugins/public-entries/domain.mjs`.
- Node-only handlers: each plugin's `server/*.mjs`; direct imports must remain on the server.
- `api/_*.mjs` files are backward-compatible server adapters, not client dependencies.
- CSS Modules and public tests remain with the owning plugin.

These are source entry points, not published npm packages. A downstream build must pin an independently reviewed full commit SHA and use a single React/Cordis dependency instance. See [source boundaries](docs/public-source-boundaries.md).

## License and rights

Original code remains under [GNU AGPL-3.0-only](LICENSE); review copyright, third-party dependencies and Corresponding Source obligations before distribution or network deployment. Git history and applicable attribution remain part of the audit trail.
