# Pinion.md — Architecture Reference

Deep reference for how Pinion.md is built, how it runs, and how to extend it. Pairs with the root [`CLAUDE.md`](../../CLAUDE.md) (run/deploy/do-not-touch quick rules). Last updated 2026-05-31 (v1.6).

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
- **Table of contents** rail (auto-built from headings, with scrollspy)
- **Copy button** on every code block
- **In-document find** (`Ctrl+F`) with match count + next/prev cycling
- **YAML frontmatter** rendered as a metadata card (stripped from the body)
- **HTML export** to a single self-contained `.html` file
- **Mermaid diagrams**, **footnotes**, **drag-and-drop open**, **Split sync-scroll** (v1.2)
- **Recent files** (IndexedDB handle persistence) + **auto-reload on disk change** (v1.3)
- **Heading anchor links**, **image lightbox**, **emoji shortcodes**, **per-file scroll memory** (v1.4)
- **Presentation mode** — `---`-split fullscreen slide deck with keyboard navigation (v1.5)
- **Dark mode** — Light / Dark / System token-driven theme toggle (v1.6)
- Installable PWA, fully offline after first load

---

## 2. Tech stack

| Layer | Choice | Version |
|---|---|---|
| Architecture | Plain HTML / CSS / JS, **no framework, no build step** | — |
| Markdown parser | [marked](https://github.com/markedjs/marked) | 9.1.6 |
| Sanitizer | [DOMPurify](https://github.com/cure53/DOMPurify) | 3.1.6 |
| Syntax highlighting | [highlight.js](https://highlightjs.org/) | 11.10.0 |
| Diagrams | [Mermaid](https://mermaid.js.org/) (classic UMD build) | 10.9.3 |
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
  sw.js                   service worker — CACHE_NAME 'pinion-md-v13', ASSETS precache list
  manifest.json           PWA manifest (start_url/scope "./", theme #2B4A8B)
  .nojekyll               disables Jekyll on GitHub Pages
  robots.txt              allow-all + sitemap reference
  sitemap.xml             single-URL sitemap (root)

  og-image.png            1200x630 social card (og:image / twitter:image)
  icon.svg                Lucide Feather on indigo (source)
  icon-180.png            apple-touch-icon (downscaled from icon-512.png)
  icon-192.png            generated from icon.svg
  icon-512.png            generated from icon.svg
  icon-maskable-512.png   maskable variant for Android adaptive icons
  icon-maskable.svg

  vendor/                 vendored third-party libs (offline + supply-chain stability)
    marked.min.js
    highlight.min.js
    purify.min.js
    mermaid.min.js        Mermaid 10.9.3 classic UMD build (~3.2 MB) — diagrams
    highlight-theme.css   syntax theme tuned for the indigo-only palette

  docs/internal/
    architecture.md       this file
```

`index.html` loads marked, highlight.js, DOMPurify, and Mermaid (from `vendor/`) **before** `js/app.js`, which depends on them being present on `window`. Mermaid is optional at runtime — if `window.mermaid` is absent the diagram pass simply no-ops and ` ```mermaid ` blocks stay as code.

**Vendored library provenance:**

| Lib | Version | Source URL |
|---|---|---|
| marked | 9.1.6 | `https://cdn.jsdelivr.net/npm/marked@9.1.6/marked.min.js` |
| DOMPurify | 3.1.6 | `https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js` |
| highlight.js | 11.10.0 | `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.10.0/highlight.min.js` |
| Mermaid | 10.9.3 | `https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js` (classic UMD; sets `window.mermaid`) |

---

## 4. How it works (app.js)

`js/app.js` is a single IIFE (`'use strict'`) with no framework. Structure:

- **`state`** — the whole app model: `{ fileHandle, fileName, fileSize, content, lastSavedContent, view, isDirty }`. `view` is one of `'landing' | 'preview' | 'edit' | 'split'`.
- **`els`** — cached DOM refs (all `js-`-prefixed IDs) looked up once via `$(id)`.
- **Custom marked renderer** — overrides `renderer.code` to emit `<pre><code class="language-x hljs" data-lang="x">` so highlight.js can theme fenced blocks. `escapeHtml` / `escapeAttr` guard the lang label.
- **`renderPreview()`** — strip leading YAML frontmatter (`extractFrontmatter`) → `marked.parse(content)` → **`DOMPurify.sanitize(...)`** → inject into the preview pane. **Sanitization is mandatory** — never inject raw `marked` output. Post-render passes run on the *sanitized DOM* (so DOMPurify config is untouched): frontmatter metadata card (`renderFrontmatterCard`), external-link attributes, code-block copy buttons + language pills (`decorateCodeBlocks`), GitHub-style heading slug ids (`decorateHeadings`), TOC build (`buildToc`), and a live re-highlight of the search term if the find bar is open.
- **v1.1 post-render features** — all are DOM-built (no markup injection), so they respect the strict CSP:
  - *TOC* (`buildToc`/`setTocOpen`): a nested rail inside the preview pane; toggled by the header **Contents** button (auto-hidden under 2 headings). Links smooth-scroll the `.pane-scroll` container; `updateScrollspy` highlights the active section. Narrow widths render it as an overlay drawer.
  - *Copy buttons* (`decorateCodeBlocks`): a `.pre-tools` toolbar per `<pre>` (copy button + JS language pill; the CSS `::before` pill is suppressed via `.has-tools`). Copies `code.textContent` via `navigator.clipboard`.
  - *Find* (`runSearch`/`clearHighlights`): `Ctrl+F` opens an overlay bar; matches are wrapped in `<mark class="search-hit">` via a **text-node walk** (never innerHTML), so handlers survive. `Enter`/`Shift+Enter` cycle, `Esc` closes. Highlights are stripped before save/export.
  - *Frontmatter* (`extractFrontmatter`/`parseYaml`): dependency-free parser for `key: value`, quoted strings, numbers/booleans, inline `[a, b]` and `- item` block lists; unparseable lines pass through verbatim. The **source pane and saved file keep the raw frontmatter**; only the preview strips + cards it.
  - *HTML export* (`exportHtml`): clones the preview, removes chrome (`.pre-tools`, `mark.search-hit`), and wraps it with the inline `EXPORT_CSS` (indigo theme + compact hljs palette) into a downloaded Blob. The inline `<style>` is allowed because the file is downloaded, never served from the app origin.
- **v1.2 post-render features** — also DOM-built; the two pipeline-order details that matter:
  - *Mermaid diagrams* (`renderMermaid`, async): `renderer.code` emits a clean ` <pre data-lang="mermaid"> ` carrier (no hljs spans, so `code.textContent` is the exact source). `decorateCodeBlocks` skips mermaid carriers; the async `renderMermaid()` pass (scheduled by `scheduleMermaid()` after the sync passes) calls `await mermaid.render()` per block and swaps each `<pre>` for a `<div class="mermaid-diagram">`. It is **debounced (160 ms)** and guarded by a monotonic `renderToken` so live typing in Split never thrashes or injects a stale diagram; on a render error the original code block is left in place with an inline `.mermaid-error` note (never throws, never blanks the preview). `mermaid.initialize({ securityLevel:'strict', theme:'base', htmlLabels:false, themeVariables:{…indigo…} })` runs once — strict mode makes Mermaid sanitize its own SVG, which is why that SVG may bypass the main DOMPurify pass.
  - *Footnotes* (`processFootnotes`): two small inline marked extensions tag `[^x]` refs as `<sup class="fn-ref" data-fn>` and `[^x]:` defs as `<div class="fn-def" data-fn>` — no ids in the markup, so DOMPurify is untouched. The post-render `processFootnotes()` numbers footnotes in reference order, moves the (already-sanitized) definition nodes into a bottom `<section class="footnotes">` (a `div` title, **not** a heading, so it stays out of the TOC), and wires jump + back-reference (`↩`) links with ids assigned here (like `decorateHeadings`). Multiple refs to one note share its number and get numbered back-refs; an orphan ref degrades to plain `[^label]` text; unreferenced/duplicate defs leave no stray markup.
- **Drag-and-drop open** (`onDrop` + `dragenter`/`dragover`/`dragleave`): window-level listeners show an indigo dashed `#js-drop-overlay` while a file hovers (depth-counted so nested dragleave doesn't flicker). On drop, the `DataTransfer` is snapshotted synchronously (it goes dead after the first `await`); if FSAA + `getAsFileSystemHandle()` are available it obtains a `FileSystemFileHandle` so save-in-place still works, else it falls back to `dataTransfer.files[0]` (read-only). Only markdown extensions are accepted; non-markdown is toasted and ignored; multiple files open the first and toast; unsaved changes prompt first.
  - *Sync scroll* (`syncScroll`): in Split only, each pane's `scroll` drives the other by scroll-percentage (`scrollTop / (scrollHeight - clientHeight)`), guarded by an `isSyncing` flag (cleared on the next animation frame) so the programmatic scroll doesn't feed back.
- **v1.3 features** — file-lifecycle, not render-pipeline:
  - *Recent files* (`addRecent`/`renderRecent`/`openFromRecent`): `FileSystemFileHandle`s are structured-cloneable, so they are persisted in **IndexedDB** (`pinion-md` db, `kv` store, key `recent`; localStorage can't hold handles). `loadFromHandle()` records each opened handle (deduped by `handle.isSameEntry`, capped at 8, most-recent-first). The landing page shows the list; clicking re-grants disk permission via `ensureReadPermission()` (`queryPermission` → `requestPermission`, which needs the click gesture) then routes through `loadFromHandle()`. A missing file (`NotFoundError`) is toasted and dropped from the list. Recent files are FSAA-only (`recentSupported`); the read-only fallback path stores nothing.
  - *Auto-reload on disk change* (`startPolling`/`pollTick`): while a handle is open, an interval (`POLL_MS` = 2500) re-reads `getFile().lastModified` and compares to `state.lastModified`. Polling **pauses when the tab is hidden** (and runs once immediately on `visibilitychange` back to visible); overlapping reads are guarded by `pollInFlight`. On a detected change: a **clean** buffer reloads silently (toast), a **dirty** buffer never clobbers — it advances `state.lastModified` (so it alerts once per distinct change) and shows the non-blocking `#js-changed-bar` (Reload & discard / Keep editing). `saveFile()` refreshes `state.lastModified` after its own write so it isn't mistaken for an external change; permission loss / file removal mid-session stops polling quietly.
- **v1.4 features** — small polish, all CSP-safe (DOM-built, no inline markup/styles):
  - *Emoji shortcodes* (`renderEmoji`): the **first** post-render pass (before code/heading/image passes and before search highlighting). A static `EMOJI` map (no library) drives a text-node walk that replaces `:code:` with the Unicode character, **skipping `code`/`pre`/`.mermaid-diagram`/`.pre-tools`** so colon-bearing code is untouched. Unknown codes are left verbatim. Emoji are plain text → automatically sanitize-safe, export-safe (content), and invisible to the later search walk.
  - *Heading anchor links* (`decorateHeadingAnchors`, runs right after `decorateHeadings`): appends a hover-revealed `<a class="heading-anchor">` (Lucide link icon) to each slugged heading; the heading gets `.has-anchor` (relative) and the anchor is absolutely positioned in the left gutter so revealing it never shifts layout. Click → `scrollPreviewTo` the heading **and** copy a clean deep link (`location.href` minus any hash, plus `#slug`) via `navigator.clipboard` with a `toast`. It is chrome: `exportHtml` strips `.heading-anchor`; it carries no text so TOC/search/copy are unaffected (slugs are computed in the earlier `decorateHeadings` pass, before the anchor exists).
  - *Image lightbox* (`decorateImages`, runs after the heading passes): tags each body `<img>` (excluding `.fm-card` images; Mermaid is SVG, not `<img>`) with `.zoomable` (zoom-in cursor) and a click handler. The single reusable `#js-lightbox` overlay (`role="dialog" aria-modal="true"`, in `index.html`, outside the preview) shows the image on a dimmed indigo backdrop; opens with focus on the close button, closes on backdrop click / `×` / `Esc` (handled in `onKeyDown` ahead of the find bar) and returns focus to the triggering image. Because it lives outside `#js-preview` it is never in the export clone / search / copy output.
  - *Per-file scroll memory* (`scheduleSaveScroll`/`saveScrollNow`/`restoreScroll`): reuses the **v1.3 IndexedDB store** (`kv` store, key `scroll`) — an array of `{key, p, s}` (preview + source `scrollTop`), most-recent-first, deduped by `key` and capped at `SCROLL_MAX` = 40. `key` is `fileName::fileSize`. Saves are **debounced 400 ms** on either pane's scroll; `restoreScroll()` runs ~60 ms after `onContentLoaded` → `renderPreview`, clamps each offset to the pane's current max (handles a now-shorter doc), defaults to top when unseen, and is guarded by `restoringScroll` + `isSyncing` so it fights neither the save debounce nor Split sync-scroll. `clearRecent()` also empties the scroll store so it can't outlive the recent list.
- **v1.5 — presentation mode** (`enterPresent`/`exitPresent`/`buildSlides`/`showSlide`): a **transient fullscreen overlay**, NOT a `state.view` value — the underlying preview/edit/split view and the segmented control are untouched and simply revealed again on exit. Entered via the header **Present** button (shown/hidden with the same lifecycle as Export) or **`Ctrl/Cmd+P`** (overrides browser print; only when a file is open). On enter: closes search/TOC/lightbox, `await`s `ensureMermaidRendered()` so any pending `pre[data-lang="mermaid"]` becomes an SVG **before** cloning, then `buildSlides()` clones the already-sanitized `#js-preview` DOM (no second parse), strips chrome (`.pre-tools`/`.heading-anchor`/`.mermaid-error`/search `<mark>`), and splits at **top-level `<hr>`** only (direct children of the clone — nested `<hr>` in a list/blockquote never splits; leading frontmatter `---` is already stripped pre-render, so there is no phantom first slide). Each slide is a `.slide > .slide-content.preview-content` so all the indigo markdown + Mermaid styling is reused; empty slides (consecutive separators) are dropped unless media-only. The `#js-present` overlay (`role="dialog" aria-modal="true"`, in `index.html`) requests fullscreen via the standard **Fullscreen API** (graceful fallback to the full-viewport in-page overlay if it rejects). Navigation (handled by `onPresentKey`, which `onKeyDown` delegates to while `presenting`): `→`/`↓`/`Space`/`PageDown`/stage-click = next, `←`/`↑`/`PageUp` = prev, `Home`/`End` = first/last, `Esc` = exit; ends **clamp** (no wrap). A `fullscreenchange` listener exits present mode cleanly if the user leaves fullscreen via F11/browser-Esc. Present mode is chrome: never in HTML export; Mermaid diagram CSS comes from the document-wide adopted stylesheet so cloned SVGs stay styled in the deck.
- **v1.6 — dark mode** (Light / Dark / System): the app is fully token-driven, so dark mode is mostly a CSS-token remap. **CSS** — the dark color VALUES live once as `--dk-*` custom properties on `:root`; two triggers remap the live tokens (`--accent`, `--reader-*`, `--bwb-*`) to those `--dk-*` values: `html[data-theme="dark"]` (explicit/JS-resolved) and `@media (prefers-color-scheme: dark){ html:not([data-theme="light"]):not([data-theme="dark"]) }` (system users pre-JS). `vendor/highlight-theme.css` already references only tokens, so code blocks re-theme automatically — **do not edit it**. Indigo-only holds: dark accent lifts to **#7FA0E8** (hover #9DB6EF); near-black indigo-tinted ramp (surface #11151C / card #171C26 / input #1F2632), no pure black/white. **JS** (`themePref` ∈ `light|dark|system`, persisted in **localStorage** key `pinion-theme` — a sync scalar read, deliberately *not* the IndexedDB layer): `applyTheme()` resolves `isDark()` → sets `<html data-theme="light|dark">`, updates the cycle button (sun/moon/monitor) + `aria-label`, syncs the `<meta name="theme-color">` (#2B4A8B light / #11151C dark), and re-themes Mermaid. The header `#js-theme-btn` cycles Light→Dark→System; a `matchMedia('(prefers-color-scheme: dark)')` change listener re-applies live while in `system`. **FOUC/CSP tradeoff:** strict CSP forbids the usual inline head-script that sets the theme before first paint; mitigation — the CSS `@media` rule gives system-preference users the correct theme with zero JS (no flash), so only a user who picked an explicit override *differing* from their OS may see a brief flash before `app.js` runs. Accepted rather than weakening CSP. **Mermaid** (the one piece tokens can't reach — its theme is JS-set): `mermaidThemeVars()` returns light or dark indigo variables by `isDark()`; on theme switch `reinitMermaid()` flips `mermaidReady` and `applyTheme(true)` re-runs `renderPreview()` so on-screen diagrams re-render in the new theme (still `securityLevel:'strict'` + CSSOM style handling). **HTML export stays LIGHT regardless of app theme:** `EXPORT_CSS`/`EXPORT_CSS_V12` are hard-coded light hex (not tokens), so exported docs are portable. (Caveat: a Mermaid SVG bakes its colors at render time, so a diagram exported *while the app is in dark mode* carries dark diagram colors on the otherwise-light page — acceptable edge; re-export in light mode for a fully-light file.)
- **`updateStats()`** — line count, KB size, word count, read time (`ceil(words/200)`, min 1).
- **`setView(view)`** — swaps the active pane(s) and the segmented-control active state.
- **File ops** — `openFile()` (FSAA `showOpenFilePicker`), `openFileFallback()` (`<input type=file>` for non-FSAA browsers — read-only), `loadFromHandle()`, `saveFile()` (`createWritable()`), `reloadFile()` (re-reads from disk, confirms if dirty).
- **`onSourceInput()`** — edits update `state.content`, recompute dirty, re-render the live preview (Split/Edit).
- **`onKeyDown()`** — keyboard shortcuts (see below).
- **`init()`** — wires buttons and the segmented control, captures `beforeinstallprompt` for the in-app Install button.

**Browser support:** file picker + save-in-place works in Chromium (Chrome, Edge, Opera; desktop + Android). Firefox/Safari fall back to read-only (`openFileFallback`); save shows a "use a supported browser" prompt.

**Keyboard shortcuts:** `Ctrl+O` open · `Ctrl+F` find in document · `Ctrl+E` toggle preview/edit · `Ctrl+S` save · `Ctrl+R` reload from disk · `Ctrl+P` present. In the find bar: `Enter`/`Shift+Enter` next/prev, `Esc` close. In present mode: arrows/`Space`/`PageUp`/`PageDown`/`Home`/`End` navigate, `Esc` exits.

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
