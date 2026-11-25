# GitHub Channel UI — Public Plugin Source

Reusable Cordis/React plugins for public GitHub repository discovery, Issues, channels, configuration and discussions.

## Development

`npm install --no-audit --no-fund && npm run build` builds the public Playground. `npm run dev` serves it locally. Open `/` to enter an exact GitHub repository, Issue, or supported configuration-file URL; direct resource paths load real APIs. `/playground` lists six explicit Fixture entries, `/playground/:slug`; linked fixture routes retain mock services.

Public has no global product Header or Navigator. The host places reusable theme and session controls. Legacy query-selected runtime is removed; current HTTP routes and Function budget are unchanged.

## Source boundaries

- Browser-only entry: `plugins/public-entries/client.ts`.
- Pure JS domain entry: `plugins/public-entries/domain.mjs`.
- Node-only handler entry: `plugins/public-entries/server.mjs`; direct imports must remain on the server.
- `api/_*.mjs` files are backward-compatible server adapters, not client dependencies.
- CSS Modules and public tests remain with the owning plugin.

These are source entry points, not published npm packages. A downstream build must pin an independently reviewed full commit SHA and use a single React/Cordis dependency instance. See [source boundaries](docs/public-source-boundaries.md).

## License and rights

Original code remains under [GNU AGPL-3.0-only](LICENSE); review copyright, third-party dependencies and Corresponding Source obligations before distribution or network deployment. Git history and applicable attribution remain part of the audit trail.
