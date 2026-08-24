# Pinion.md

A clean, fast markdown reader and writer for the web. Point it at a `.md` file on your computer, read it rendered, or flip to edit mode to write. Lives in your browser as an installable PWA. No accounts, no clutter, no upload.

**Live:** https://pinion.buildwithbaker.io/

## What it does

- Open any local `.md` file via the File System Access API
- Three view modes: Preview, Edit, Split (with live-updating preview)
- Save changes back to the original file
- Reload from disk to pick up external edits
- Full CommonMark + GFM: headings, lists, tables, task lists, fenced code blocks, blockquotes, inline code, images, links
- Syntax highlighting for fenced code blocks via highlight.js
- Table of contents panel that navigates long documents (auto-built from headings)
- One-click copy button on every code block
- In-document find (`Ctrl + F`) with match count and next/previous cycling
- YAML frontmatter rendered as a clean metadata card instead of a stray table
- Export the rendered document to a self-contained `.html` file
- Presentation mode: split on `---` into a fullscreen slide deck (`Ctrl + P`)
- Dark mode with a Light / Dark / System theme toggle (System follows your OS)
- Installable PWA. Works offline after first load.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open file | `Ctrl + O` |
| Find in document | `Ctrl + F` |
| Toggle preview / edit | `Ctrl + E` |
| Save changes | `Ctrl + S` |
| Reload from disk | `Ctrl + R` |
| Present (slide deck) | `Ctrl + P` |

In presentation mode: `→` / `↓` / `Space` / `PageDown` / click next slide · `←` / `↑` / `PageUp` previous · `Home` / `End` first / last · `Esc` exit.

Inside the find bar: `Enter` next match, `Shift + Enter` previous match, `Esc` close.

## Tech stack

| Layer | Choice |
|---|---|
| Architecture | Plain HTML / CSS / JS, no framework, no build step |
| Markdown parser | [marked](https://github.com/markedjs/marked) 9.1.6 |
| Sanitizer | [DOMPurify](https://github.com/cure53/DOMPurify) 3.1.6 |
| Syntax highlighting | [highlight.js](https://highlightjs.org/) 11.10.0 |
| Diagrams | [Mermaid](https://mermaid.js.org/) 10.9.3 |
| File access | File System Access API (Chromium browsers) |
| PWA | manifest.json + service worker (cache-first, fully offline after install) |
| Hosting | GitHub Pages |

All third-party libraries are vendored locally in `vendor/` for offline support and supply-chain stability, and so are both typefaces - Inter and JetBrains Mono, latin subset, SIL Open Font License 1.1. Nothing is loaded from a CDN or any other origin at runtime: the page's CSP holds `style-src`, `font-src` and `connect-src` at `'self'`.

## Browser support

- File picker plus save-in-place: Chrome, Edge, Opera (any Chromium-based browser, desktop and Android)
- Read-only fallback: Firefox, Safari (file input opens the picker; save shows a "use a supported browser" prompt)

## Local development

No build step. Clone, serve, open.

```bash
git clone https://github.com/buildwithbaker/pinion-md.git
cd pinion-md
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. The File System Access API needs a secure context, so `file://` will not work for the file picker. `http://localhost` counts as secure.

## File layout

```
pinion-md/
  index.html              # App shell, header, split view, footer
  css/style.css           # All styles; reader-surface tokens at :root, BwB tokens inherited
  js/app.js               # File System Access API, marked init, state, view toggle, shortcuts
  sw.js                   # Service worker, cache-first for app shell
  manifest.json           # PWA manifest
  icons/                  # app icons (no loose images at root, per BwB Repo Structure Standard v2.0)
    icon.svg              # Lucide Feather on indigo (source SVG)
    icon-180.png          # apple-touch-icon, downscaled from icon-512.png
    icon-192.png          # Generated from icon.svg
    icon-512.png          # Generated from icon.svg
    icon-maskable-512.png # Maskable variant for Android adaptive icons
    icon-maskable.svg     # Maskable source SVG
  assets/img/
    og-image.png          # 1200x630 social card (og:image / twitter:image)
  vendor/                 # third-party code and fonts, served from this origin
    marked.min.js
    highlight.min.js
    purify.min.js
    mermaid.min.js        # Mermaid 10.9.3 classic UMD build (~3.2 MB)
    highlight-theme.css   # Syntax theme tuned for indigo-only palette
    fonts.css             # @font-face rules for the self-hosted typefaces
    fonts/                # Inter latin woff2 400/500/600/700, JetBrains Mono 400/600/700,
                          #   plus the OFL licence for each
  docs/internal/
    architecture.md       # Deep architecture reference
  .github/workflows/
    ci.yml                # Root-hygiene + local link check
  CNAME                   # pinion.buildwithbaker.io
  robots.txt              # Allow-all + sitemap reference
  sitemap.xml             # Single-URL sitemap (site root)
  CHANGELOG.md
  CLAUDE.md
  LICENSE
  README.md
  .editorconfig
  .gitignore
  .nojekyll
```

## Updating vendored libraries

Re-fetch from the source URLs, drop into `vendor/`, then bump `CACHE_NAME` in `sw.js` (e.g. `pinion-md-v1` to `pinion-md-v2`) so installed PWAs flush their old cache.

## Release history

See [CHANGELOG.md](CHANGELOG.md) for what shipped in each version.

> **Internals:** see [docs/internal/architecture.md](docs/internal/architecture.md) for the full architecture reference - app.js structure, render/sanitize flow, extension points, vendor updates, and gotchas.

## License

MIT. See [LICENSE](LICENSE).

## Credits

A [Build with Baker](https://github.com/buildwithbaker) product.
