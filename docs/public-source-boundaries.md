# Public source entry points and host boundaries

- `client.ts`: browser-only Cordis plugins, ReactUIService, generic App({ui, children}), ThemeProvider/ThemeToggle, SessionMenu, resource helpers and repository access UI. App renders host-supplied children before registered routes; no HeaderBrand, initialPath or global Navigator.
- `domain.mjs`: pure domain exports, including githubResource.
- `server.mjs`: named Node-only business handlers, including OAuth/session/verification, repository and Issue reads/writes, config, channels and Topic. Never import this entry from client code. API endpoints dispatch to these handlers; the 11 Functions and 16 rewrites remain unchanged. Existing helper facades with consumers remain.

Plugins own resource paths: /:owner/:repo, /:owner/:repo/issues, /:owner/:repo/issues/:number, /:owner/:repo/issues/new, /:owner/:repo/config, /:owner/:repo/channels, /:owner/:repo/members, /:owner/:repo/members/register, /topic/:owner/:repo. Hosts own /. Real root URL input accepts exact repository/Issue/list/new Issue and the two main-branch config-file URLs. Reserved paths cannot masquerade as resource paths. No query-selected legacy runtime. /playground/:slug uses explicit mock services for linked pages; selected-plugin isolated test mounting remains supported.

Repository reads run first; structured repository denials produce a page-local access notice. Session check precedes the protected installation probe. Successful reads do not add a probe. Retry repeats the original read, never a write. Topic public discovery remains independent of Installation and login; write checks remain server-side.

Consumers use one reviewed full Public SHA, one React/ReactDOM/React Router/Cordis instance, explicit browser-only and Node-only source aliases. Own the product home/header/navigation and API endpoint composition in the host. Do not import the Playground runtime into a hosted product. No new dependencies, caching framework or global authorization store.

Source reorganization is not deployment approval. Keep AGPL-3.0-only, attribution and Corresponding Source obligations; independent rights review and joint same-version runtime validation remain required.
