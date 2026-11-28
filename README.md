# GitHub Channel UI — Public Plugin Source

Reusable Cordis/React plugins for public GitHub repositories, Issues, channels, configuration, discussions and Topic discovery.

## Development

Node 22 is the current CI runtime. Install with `npm install --no-audit --no-fund`, then run `npm run dev` for the local development server or `npm run build` for TypeScript checking and the Vite build.

The real root `/` accepts exact GitHub repository, Issue, Issue-list, new-Issue and supported main-branch configuration-file URLs. Resource routes use real APIs. The formal Topic route is `/topic/:owner/:repo`; it reads a public source repository's activity configuration and project declarations. See [source boundaries and Topic contract](docs/public-source-boundaries.md).

`/playground` lists six explicit Fixture entries; `/playground/:slug` and linked fixture routes use controlled mock services. Fixture routes do not demonstrate production OAuth, real writes or serverless deployment.

The reusable renderer has no global product Header or Navigator; theme and session controls can be placed through its public exports.

## Source and verification

- Browser-only: `plugins/public-entries/client.ts`.
- Pure business rules: `plugins/public-entries/domain.mjs`.
- Node-only handlers: `plugins/public-entries/server.mjs`.
- `api/_*.mjs` are compatibility adapters on the server. The 11 Function entry points and 16 rewrites define this application's HTTP dispatch.
- The source is consumed by commit, not as published npm packages.

Run the build and relevant tests as described in [testing](docs/testing.md). The repository does not track a dependency lockfile or declare a release version; a commit alone does not establish reproducible dependency resolution. See [build and release evidence](docs/public-source-boundaries.md#build-and-release-evidence).

## License and rights

Original code remains under [GNU AGPL-3.0-only](LICENSE). Preserve authorship, Git history and applicable attribution. Review actual dependency licenses, contributor rights and Corresponding Source obligations before distribution or network deployment.
