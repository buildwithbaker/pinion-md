# Changelog

All notable changes to Pinion.md.

Entries are reconstructed from the repository itself - release commits on `main`,
the feature comments in `js/app.js`, and the per-version notes in
[`docs/internal/architecture.md`](docs/internal/architecture.md). Dates are the
commit dates of the change on `main`. Every release bumps `CACHE_NAME` in
`sw.js`, so installed PWAs flush their old cache; the cache version for each
release is listed with it.

## Unreleased

Changes that landed on `main` after v1.6 without a version number of their own.

- Mermaid diagrams render at their correct size again. The app's strict CSP has
  no `'unsafe-inline'` for `style-src`, so every inline style Mermaid wrote into
  its SVG was refused - including the `max-width` that holds a diagram at its
  natural size, which left flowcharts several times oversized and filled the
  console with violations. Mermaid's inline CSS is now kept away from the HTML
  parser during a render pass and re-applied through the CSSOM afterwards. The
  CSP itself is unchanged. Cache: `pinion-md-v18`.
- Inter is now self-hosted from `vendor/fonts/` instead of Google Fonts, and is
  precached by the service worker, so body type is right on first paint offline.
  JetBrains Mono is still fetched from Google Fonts; no local copy of it ships
  with this repo.
- Added this changelog. Corrected the README file layout, the cache version
  recorded in `docs/internal/architecture.md`, and the "nothing is loaded from a
  CDN at runtime" claim in both.
- 2026-07-27: documented the protected-`main` PR workflow in `CLAUDE.md`.
- 2026-06-24: manifest file-handler icons, so a `.md` association shows the
  Pinion feather rather than the generic Chrome document icon.
- 2026-06-12: **Copy all** button in the source pane header. Cache: `pinion-md-v17`.
- 2026-06-05: PWA file handling - Pinion registers as a `.md` handler
  (`file_handlers` in the manifest plus a `launchQueue` consumer). Cache:
  `pinion-md-v16`.
- 2026-06-04: moved to the custom domain `pinion.buildwithbaker.io` (absolute
  `start_url`/`scope`, `CNAME`), and moved the remaining root images into
  `icons/` and `assets/img/` per the Build with Baker repo structure standard.
  Cache: `pinion-md-v14` then `pinion-md-v15`.
- 2026-06-02: tidied the Feather icon - optically recentred, upsized, stroke
  weight matched.

## v1.6 - 2026-06-01

Dark mode: a Light / Dark / System theme toggle.

- Dark color values live once as `--dk-*` on `:root`; two triggers remap the live
  tokens - `html[data-theme="dark"]` for an explicit choice, and a
  `prefers-color-scheme` media rule for system users, so they get the right theme
  with no JavaScript and no flash.
- Indigo-only holds in the dark: the accent lifts to `#7FA0E8`, over a near-black
  indigo-tinted ramp, with no pure black or white.
- The preference is stored in `localStorage` under `pinion-theme`. The header
  button cycles Light, Dark, System; system mode follows OS changes live.
- Mermaid is themed in JavaScript rather than by CSS tokens, so switching theme
  re-initializes Mermaid and re-renders on-screen diagrams in the new palette.
- HTML export stays light whatever the app theme, so exported files are portable.
- Cache: `pinion-md-v13`.

## v1.5 - 2026-06-01

Presentation mode: a transient fullscreen slide deck.

- Opened from the header **Present** button or `Ctrl/Cmd + P`; it is an overlay,
  not a fourth view mode, so the previous Preview/Edit/Split view is restored
  intact on exit.
- Slides are cloned from the already-sanitized preview DOM (no second parse) and
  split at top-level `---` only, so a `---` nested in a list or blockquote never
  splits, and frontmatter never produces a phantom first slide.
- Pending Mermaid diagrams are awaited before cloning, so a diagram on a later
  slide arrives as a finished SVG.
- Navigation: arrows, `Space`, `PageUp`/`PageDown`, `Home`/`End`, clamped at both
  ends; `Esc` or leaving fullscreen exits cleanly.
- Cache: `pinion-md-v12`.

## v1.4 - 2026-05-31

Four polish features.

- **Heading anchor links**: a hover-revealed anchor per heading that scrolls the
  heading into view and copies a clean deep link.
- **Image lightbox**: body images become click-to-zoom, opening a reusable dialog
  that closes on `Esc`, backdrop click, or the close button, with focus returned
  to the image.
- **Emoji shortcodes**: a 177-entry static map replaces `:code:` in body text,
  skipping code and diagram blocks so colon-bearing code is untouched.
- **Per-file scroll memory**: both panes' scroll positions are remembered per
  file in the v1.3 IndexedDB store and restored on reopen, clamped to the
  document's current length.
- Cache: `pinion-md-v11`.

## v1.3 - 2026-05-31

Two file-lifecycle features.

- **Recent files**: file handles are persisted in IndexedDB (localStorage cannot
  hold them), listed on the landing page, newest first, capped at 8 and deduped.
  Reopening re-grants disk permission on click; a moved or deleted file is
  reported and dropped from the list.
- **Auto-reload on disk change**: while a file is open its modified time is
  polled every 2.5 seconds. A clean buffer reloads silently; a dirty buffer is
  never clobbered - a non-blocking bar offers Reload and discard or Keep editing.
  Polling pauses while the tab is hidden.
- Cache: `pinion-md-v10`.

## v1.2 - 2026-05-31

Four features extending the post-render pipeline.

- **Mermaid diagrams**: fenced ` ```mermaid ` blocks render as live
  indigo-themed diagrams. The pass is debounced and token-guarded so typing in
  Split never thrashes or injects a stale diagram, and a diagram that fails to
  parse leaves its code block in place with an inline note.
- **Drag-and-drop open**: drop a markdown file anywhere on the window. Where the
  File System Access API allows it, a file handle is obtained so save-in-place
  still works; otherwise the file opens read-only.
- **Sync scroll** in Split: each pane drives the other by scroll percentage.
- **Footnotes**: GFM `[^label]` references and definitions, numbered in reference
  order into a footnotes section with jump and back-reference links.
- Vendors Mermaid 10.9.3. Cache: `pinion-md-v9`.

## v1.1 - 2026-05-31

Five reader and writer features, all built from the sanitized DOM after render.

- **Table of contents**: a collapsible rail built from heading slugs, with smooth
  in-pane scrolling and scrollspy, hidden under two headings, a drawer on narrow
  screens.
- **Code copy**: a per-block toolbar with a copy button and language pill.
- **In-document find** (`Ctrl + F`): match count, `Enter` and `Shift + Enter` to
  cycle, `Esc` to close. Highlights never reach saved content or exports.
- **YAML frontmatter**: parsed by a dependency-free parser and rendered as a
  metadata card; the source pane and the saved file keep the raw block.
- **HTML export**: a self-contained `.html` file with the theme inlined and app
  chrome removed.
- Cache: `pinion-md-v8`.

Earlier in the same version, on 2026-05-27: an in-app **Install** button in the
header, driven by the real `beforeinstallprompt` event.

## v1.0 - 2026-05-27

First release under the name Pinion.md. The project started on 2026-05-24 as
Markdown Mate, a standalone PWA markdown reader.

- Three view modes: Preview, Edit, Split, with a live debounced preview.
- File System Access API: open, save in place, reload from disk.
- Keyboard shortcuts: `Ctrl + O`, `Ctrl + E`, `Ctrl + S`, `Ctrl + R`.
- Syntax highlighting with a highlight.js theme tuned to the indigo palette.
- Build with Baker indigo-only palette, plus three reader-surface tokens for
  extended viewing, and a Lucide Feather app icon.
- Vendored marked 9.1.6, highlight.js 11.10.0 and DOMPurify 3.1.6 - no CDN, no
  build step.
- Cache-first service worker for full offline support, a strict CSP with no
  inline scripts, WCAG 2.2 focus rings and full keyboard navigation.
