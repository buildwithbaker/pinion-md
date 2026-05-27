# Pinion.md

A clean, fast markdown reader and writer for the web. Point it at a `.md` file on your computer, read it rendered, or flip to edit mode to write. Lives in your browser as an installable PWA. No accounts, no clutter, no upload.

**Live:** https://buildwithbaker.github.io/pinion-md/

## What it does

- Open any local `.md` file via the File System Access API
- Three view modes: Preview, Edit, Split (with live-updating preview)
- Save changes back to the original file
- Reload from disk to pick up external edits
- Full CommonMark + GFM: headings, lists, tables, task lists, fenced code blocks, blockquotes, inline code, images, links
- Syntax highlighting for fenced code blocks via highlight.js
- Installable PWA. Works offline after first load.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open file | `Ctrl + O` |
| Toggle preview / edit | `Ctrl + E` |
| Save changes | `Ctrl + S` |
| Reload from disk | `Ctrl + R` |

## Tech stack

| Layer | Choice |
|---|---|
| Architecture | Plain HTML / CSS / JS, no framework, no build step |
| Markdown parser | [marked](https://github.com/markedjs/marked) 9.1.6 |
| Sanitizer | [DOMPurify](https://github.com/cure53/DOMPurify) 3.1.6 |
| Syntax highlighting | [highlight.js](https://highlightjs.org/) 11.10.0 |
| File access | File System Access API (Chromium browsers) |
| PWA | manifest.json + service worker (cache-first, fully offline after install) |
| Hosting | GitHub Pages |

All third-party libraries are vendored locally in `vendor/` for offline support and supply-chain stability.

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
  style.css               # All styles; reader-surface tokens at :root, BwB tokens inherited
  app.js                  # File System Access API, marked init, state, view toggle, shortcuts
  sw.js                   # Service worker, cache-first for app shell
  manifest.json           # PWA manifest
  icon.svg                # Lucide Feather on indigo (source SVG)
  icon-192.png            # Generated from icon.svg
  icon-512.png            # Generated from icon.svg
  icon-maskable-512.png   # Maskable variant for Android adaptive icons
  vendor/
    marked.min.js
    highlight.min.js
    purify.min.js
    highlight-theme.css   # Syntax theme tuned for indigo-only palette
  LICENSE
  README.md
  .gitignore
  .nojekyll
```

## Updating vendored libraries

Re-fetch from the source URLs, drop into `vendor/`, then bump `CACHE_NAME` in `sw.js` (e.g. `pinion-md-v1` to `pinion-md-v2`) so installed PWAs flush their old cache.

## License

MIT. See [LICENSE](LICENSE).

## Credits

A [Build with Baker](https://github.com/buildwithbaker) product.
