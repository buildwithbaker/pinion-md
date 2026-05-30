# Pinion.md — Architecture Reference

Deep reference for how Pinion.md is built, how it runs, and how to extend it. Pairs with the root [`CLAUDE.md`](../../CLAUDE.md) (run/deploy/do-not-touch quick rules). Last updated 2026-05-29.

---

## 1. What it is

A clean, fast **markdown reader and writer** for the web. Point it at a `.md` file on your computer, read it rendered, or flip to edit mode and write. Lives in the browser as an installable PWA. No accounts, no upload, no clutter.

- **Live:** https://buildwithbaker.github.io/pinion-md/
- A [Build with Baker](https://github.com/buildwithbaker) product.

What it does:

- Open any local `.md` file via the **File System Access API**
- Three view modes: **Preview**, **Edit**, **Split** (live-updating preview)
- Save changes back to the original file; reload from disk to pick up external edits
- Full CommonMark + GFM (headings, lists, tables, task lists, fenced code, blockquotes, inline code, images, links)
- Syntax highlighting for fenced code via highlight.js
- Installable PWA, fully offline after first load

---

## 2. Tech stack

| Layer | Choice | Version |
|---|---|---|
| Architecture | Plain HTML / CSS / JS, **no framework, no build step** | — |
| Markdown parser | [marked](https://github.com/markedjs/marked) | 9.1.6 |
| Sanitizer | [DOMPurify](https://github.com/cure53/DOMPurify) | 3.1.6 |
| Syntax highlighting | [highlight.js](https://highlightjs.org/) | 11.10.0 |
| File access | File System Access API (Chromium) | — |
| PWA | `manifest.json` + `sw.js` (cache-first) | — |
| Hosting | GitHub Pages (project site) | — |

**All third-party libraries are vendored locally in `vendor/`** for offline support and supply-chain stability — nothing is loaded from a CDN at runtime.

---

## 3. Directory & file map

```
pinion-md/
  index.html              App shell: header, segmented view control, split panes, footer
  css/style.css           All styles; reader-surface tokens at :root, BwB tokens inherited
  js/app.js               ★ The whole app — FSAA, marked init, state, view toggle, shortcuts
  sw.js                   service worker — CACHE_NAME 'pinion-md-v5', ASSETS precache list
  manifest.json           PWA manifest (start_url/scope "./", theme #2B4A8B)
  .nojekyll               disables Jekyll on GitHub Pages

  icon.svg                Lucide Feather on indigo (source)
  icon-192.png            generated from icon.svg
  icon-512.png            generated from icon.svg
  icon-maskable-512.png   maskable variant for Android adaptive icons
  icon-maskable.svg

  vendor/                 vendored third-party libs (offline + supply-chain stability)
    marked.min.js
    highlight.min.js
    purify.min.js
    highlight-theme.css   syntax theme tuned for the indigo-only palette

  docs/internal/
    architecture.md       this file
```

`index.html` loads marked, highlight.js, and DOMPurify (from `vendor/`) **before** `js/app.js`, which depends on all three being present on `window`.

---

## 4. How it works (app.js)

`js/app.js` is a single IIFE (`'use strict'`) with no framework. Structure:

- **`state`** — the whole app model: `{ fileHandle, fileName, fileSize, content, lastSavedContent, view, isDirty }`. `view` is one of `'landing' | 'preview' | 'edit' | 'split'`.
- **`els`** — cached DOM refs (all `js-`-prefixed IDs) looked up once via `$(id)`.
- **Custom marked renderer** — overrides `renderer.code` to emit `<pre><code class="language-x hljs" data-lang="x">` so highlight.js can theme fenced blocks. `escapeHtml` / `escapeAttr` guard the lang label.
- **`renderPreview()`** — `marked.parse(content)` → **`DOMPurify.sanitize(...)`** → inject into the preview pane. Post-process: external links get safe attributes. **Sanitization is mandatory** — never inject raw `marked` output.
- **`updateStats()`** — line count, KB size, word count, read time (`ceil(words/200)`, min 1).
- **`setView(view)`** — swaps the active pane(s) and the segmented-control active state.
- **File ops** — `openFile()` (FSAA `showOpenFilePicker`), `openFileFallback()` (`<input type=file>` for non-FSAA browsers — read-only), `loadFromHandle()`, `saveFile()` (`createWritable()`), `reloadFile()` (re-reads from disk, confirms if dirty).
- **`onSourceInput()`** — edits update `state.content`, recompute dirty, re-render the live preview (Split/Edit).
- **`onKeyDown()`** — keyboard shortcuts (see below).
- **`init()`** — wires buttons and the segmented control, captures `beforeinstallprompt` for the in-app Install button.

**Browser support:** file picker + save-in-place works in Chromium (Chrome, Edge, Opera; desktop + Android). Firefox/Safari fall back to read-only (`openFileFallback`); save shows a "use a supported browser" prompt.

**Keyboard shortcuts:** `Ctrl+O` open · `Ctrl+E` toggle preview/edit · `Ctrl+S` save · `Ctrl+R` reload from disk.

---

## 5. How to add / change things

**Add a markdown feature** → configure `marked` (options or a renderer override) in `app.js`. If it introduces new HTML, make sure DOMPurify's allow-list still passes it through `renderPreview()`.

**Add a view mode or UI control** → add the element + a `js-` id in `index.html`, cache it in `els`, and branch in `setView()`.

**Add a keyboard shortcut** → extend `onKeyDown()` (it already normalizes `Ctrl`/`Cmd` via `mod`).

**Update a vendored library** → re-fetch from source, drop the new file into `vendor/`, then **bump `CACHE_NAME` in `sw.js`** (e.g. `pinion-md-v5 → v6`) so installed PWAs flush the old cache. If the asset URL changed, also update the `ASSETS` precache list.

**File-placement rule (root is locked):** root holds only `index.html`, `manifest.json`, `sw.js`, `.nojekyll`, icons, README, LICENSE, CLAUDE.md, dotfiles. New CSS → `css/`; new JS → `js/`; vendored lib → `vendor/`; planning/spec doc → `docs/internal/`.

---

## 6. Run & deploy

```bash
# Serve over HTTP — a service worker (and FSAA secure context) needs it.
python3 -m http.server 8000     # or: npx serve .
# open http://localhost:8000/   ( file:// will NOT register the SW or the file picker )
```

**Deploy:** static GitHub Pages **project** site (note `.nojekyll`). Push to main publishes the repo root as-is at `/pinion-md/`.

---

## 7. Conventions & formatting

- **`manifest.json` `start_url`/`scope` are `"./"`** (relative) so the Pages project-path (`/pinion-md/`) resolves correctly.
- Theme color **`#2B4A8B`** is the BwB indigo umbrella color; the reader surface and syntax theme are tuned for an **indigo-only palette** (`vendor/highlight-theme.css`).
- All DOM ids the app touches are `js-`-prefixed (`js-source`, `js-preview`, `js-seg`, etc.).

---

## 8. Gotchas / do-not-touch

- **`sw.js` MUST stay at the repo root** — moving it shrinks the service-worker scope and GitHub Pages can't send `Service-Worker-Allowed` to widen it.
- **When any asset URL changes, update the `ASSETS` precache list in `sw.js` AND bump `CACHE_NAME`** — otherwise installed PWAs keep the old cache and 404 the moved assets offline.
- **Icon files stay at the repo root** — their paths are referenced by both `manifest.json` (`icons`) and the `sw.js` precache list. Don't move/rename without updating both.
- **`manifest.json` start_url/scope must stay `"./"`** (relative) for the Pages project-path to work.
- **Never inject raw `marked` output** — always route through `DOMPurify.sanitize()` in `renderPreview()`.
- Vendored libs are pinned versions; updating them is a deliberate step (re-fetch + cache bump), not an `npm update`.
```
