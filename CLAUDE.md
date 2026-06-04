# CLAUDE.md - pinion-md

See @README.md for what this project is.
See @docs/internal/architecture.md for the deep architecture reference (app.js structure, render/sanitize flow, extension points, vendor updates, gotchas).

Pinion.md is a hand-authored, build-free PWA: a markdown reader/writer using the
File System Access API. Third-party libs are vendored in `vendor/` for true
offline support.

## Run / test
- Serve over HTTP (a service worker needs it): `npx serve .` then open the URL.
- Opening `index.html` via `file://` will not register the service worker.
- No build step and no test runner; CI runs a root-hygiene + link check only.

## Deploy
- Static GitHub Pages project site (note the `.nojekyll` file). Merging a PR into
  main publishes the repo root as-is.

## Branching (main is protected)
`main` is protected - direct pushes are rejected. Branch, commit, push, open a
PR, then squash-merge once CI is green. Never run `git push origin main`.

## File organization (root is locked)
Do not add files to the repo root unless required (index.html, manifest.json,
sw.js, .nojekyll, icons, README, LICENSE, CLAUDE.md, dotfiles). Before adding a
file: identify its folder, create it if missing, add it there.
- New CSS -> css/; new JS -> js/; new icon -> icons/; new image -> assets/img/;
  vendored third-party lib -> vendor/; planning/spec doc -> docs/internal/.

## Do not touch
- sw.js MUST stay at the repo root - moving it shrinks the service-worker scope
  and GitHub Pages cannot send Service-Worker-Allowed to widen it.
- When you change any asset URL, update the `ASSETS` precache list in sw.js AND
  bump `CACHE_NAME` (e.g. pinion-md-v5 -> v6), or installed PWAs keep the old
  cache and 404 the moved assets offline.
- Icons live in `icons/` and the OG image in `assets/img/` (Build with Baker Repo
  Structure Standard v2.0 - no loose images at root). Their paths are referenced by
  manifest.json ("icons"), the sw.js `ASSETS` precache list, and index.html (favicon
  + apple-touch-icon + og:image/twitter:image). Moving or renaming any of them means
  updating manifest.json, the sw.js ASSETS list (and bumping `CACHE_NAME`), and
  index.html together.
- manifest.json start_url/scope are absolute `https://pinion.buildwithbaker.io/`
  (set when the app moved to its own custom domain, served from the domain root -
  not the old `/pinion-md/` project subpath). A relative `./` would also resolve at
  root; if the custom domain ever changes, update these and `CNAME` together.
