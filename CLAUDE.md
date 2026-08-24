# CLAUDE.md - pinion-md

See @README.md for what this project is.
See @docs/internal/architecture.md for the deep architecture reference (app.js structure, render/sanitize flow, extension points, vendor updates, gotchas).

Pinion.md is a hand-authored, build-free PWA: a markdown reader/writer using the
File System Access API. Third-party libs and both typefaces (Inter, JetBrains
Mono) are vendored in `vendor/` for true offline support - nothing is fetched
from another origin at runtime, and the CSP in index.html holds style-src,
font-src and connect-src at 'self' with no host allowances. A new remote asset
would mean widening that CSP; vendor it instead.

## Run / test
- Serve over HTTP (a service worker needs it): `npx serve .` then open the URL.
- Opening `index.html` via `file://` will not register the service worker.
- No build step and no test runner; CI runs a root-hygiene + link check only.

## Deploy
- Static GitHub Pages site on a custom domain (`CNAME` -> pinion.buildwithbaker.io;
  note the `.nojekyll` file). Merging a PR into main publishes the repo root as-is.

## Branching (main is protected - PR only)

`main` is protected: direct pushes are rejected. **Never run `git push origin main`.**

1. `git checkout main && git pull origin main` - start from an up-to-date main
2. `git checkout -b <type>/<slug>` - branch BEFORE staging, so local `main` never diverges
3. edit, then `git add -- <explicit paths>` - never `git add -A`
4. `git commit -m "<message>"`
5. `git push -u origin <branch>`
6. `gh pr create --base main --fill`
7. `gh pr checks <branch> --watch` - wait for the required checks
8. `gh pr merge <branch> --squash --delete-branch`
9. `git checkout main && git pull origin main`

Never merge while a required check is failing or pending, and never disable a check to
force a merge through - stop and report instead.

Required check: `hygiene` (root-hygiene + link check; PR-only).

Shortcut: `..\pinion-md-tools\ship.ps1 -Message "..." -Files icon.svg` runs steps 1-9.
Note: that script currently merges with `--merge`, not `--squash`; the squash flow above
is the standard.

## File organization (root is locked)
Do not add files to the repo root unless required (index.html, manifest.json,
sw.js, .nojekyll, icons, README, CHANGELOG, LICENSE, CLAUDE.md, dotfiles). The
permitted-root list is enforced by the `hygiene` CI job, so a genuinely new root
file must also be added to the allowlist in `.github/workflows/ci.yml`. Before
adding a file: identify its folder, create it if missing, add it there.
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
