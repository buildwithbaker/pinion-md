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
- Static GitHub Pages project site (note the `.nojekyll` file). Pushing to main
  publishes the repo root as-is.

## File organization (root is locked)
Do not add files to the repo root unless required (index.html, manifest.json,
sw.js, .nojekyll, icons, README, LICENSE, CLAUDE.md, dotfiles). Before adding a
file: identify its folder, create it if missing, add it there.
- New CSS -> css/; new JS -> js/; vendored third-party lib -> vendor/;
  planning/spec doc -> docs/internal/.

## Do not touch
- sw.js MUST stay at the repo root - moving it shrinks the service-worker scope
  and GitHub Pages cannot send Service-Worker-Allowed to widen it.
- When you change any asset URL, update the `ASSETS` precache list in sw.js AND
  bump `CACHE_NAME` (e.g. pinion-md-v5 -> v6), or installed PWAs keep the old
  cache and 404 the moved assets offline.
- Icon files stay at the repo root - their paths are referenced by both
  manifest.json ("icons") and the sw.js precache list. Don't move or rename them
  without updating both.
- manifest.json start_url/scope are "./" - keep them relative for the Pages
  project-path to work.
