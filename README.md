# Markdown Mate

A lightweight Progressive Web App for reading `.md` files. Open a markdown file from your computer and see it rendered instantly - no editor, no accounts, no clutter.

**Live:** https://buildwithbaker.github.io/markdown-mate/

## What it does

- Point it at any `.md` file on your computer
- Renders the markdown in a clean, readable layout
- Files stay on your machine - nothing is uploaded anywhere
- Installs as a desktop PWA in Chrome/Edge
- Works fully offline after first load

## How to use

1. Visit the [live site](https://buildwithbaker.github.io/markdown-mate/) or open the installed PWA
2. Click **Open file**
3. Pick any `.md` or `.markdown` file
4. Read

To open a different file, click **Open file** again from the toolbar.

## Install as a desktop app (Chrome / Edge)

1. Visit the live site
2. Look for the install icon in the address bar (or `chrome://apps`)
3. Click install - it lives in your Start menu / Applications folder
4. Works offline from then on

## Browser support

- ✅ Chrome (desktop and Android)
- ✅ Edge
- ❌ Firefox - no File System Access API support
- ❌ Safari - no File System Access API support

Browsers without the File System Access API show a friendly notice on load.

## What it renders

- Headings, paragraphs, bold, italic, strikethrough
- Inline code and fenced code blocks with syntax highlighting (highlight.js)
- Blockquotes
- Ordered, unordered, and task lists
- Tables (GitHub Flavored Markdown)
- Links (external links open in a new tab)
- Images (only inline / data URLs render - no external image fetches)

Markdown is parsed with [marked](https://github.com/markedjs/marked) and sanitized with [DOMPurify](https://github.com/cure53/DOMPurify) before injection.

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

## Local development

No build step. Clone, serve, open.

```bash
git clone https://github.com/buildwithbaker/markdown-mate.git
cd markdown-mate
python3 -m http.server 8000
# or: npx serve
# then open http://localhost:8000
```

The File System Access API requires HTTPS or `localhost`, so a plain file:// open will not work for the file picker.

## File layout

```
markdown-mate/
  index.html          # App shell, toolbar, landing state, reader view
  style.css           # All styles; teal accent token at :root
  app.js              # File picker, render pipeline, state
  sw.js               # Service worker (cache-first)
  manifest.json       # PWA manifest
  icon.svg            # App icon (teal mark on rounded square)
  vendor/             # Vendored third-party libraries
    marked.min.js
    highlight.min.js
    purify.min.js
    github.min.css
    github-dark.min.css
  LICENSE
  README.md
```

## Updating vendored libraries

Re-fetch from the same source URLs documented in the comment at the bottom of `index.html`, drop into `vendor/`, then bump `CACHE_NAME` in `sw.js` (e.g. `markdown-mate-v2` to `markdown-mate-v3`) so installed PWAs flush their old cache.

## Scope 2 (planned)

Edit mode is architected for but not built. The current code stores `FileSystemFileHandle` references so write-back, reload, and recent-files can be added without restructuring.

## License

MIT. See [LICENSE](LICENSE).

## Credits

Built by Adam Baker - part of the [Build with Baker](https://github.com/buildwithbaker) tool family.
