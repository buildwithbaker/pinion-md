/* Pinion.md - app.js
 *
 * State + behavior for the markdown reader/writer. Plain JS, no framework.
 * Depends on marked, hljs, DOMPurify being loaded before this file (see index.html).
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  const state = {
    fileHandle: null,
    fileName: '',
    fileSize: 0,
    content: '',
    lastSavedContent: '',
    view: 'landing', // 'landing' | 'preview' | 'edit' | 'split'
    isDirty: false,
    tocOpen: false,
    lastModified: 0,    // mtime of the open file, for external-change detection (v1.3)
  };

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const els = {
    body:           $('js-body'),
    landing:        $('js-landing'),
    unsupported:    $('js-unsupported'),
    openTop:        $('js-open'),
    openLanding:    $('js-open-landing'),
    seg:            $('js-seg'),
    fileBadge:      $('js-file-badge'),
    fileName:       $('js-filename'),
    paneSource:     $('js-pane-source'),
    panePreview:    $('js-pane-preview'),
    source:         $('js-source'),
    copyAll:        $('js-copy-all'),
    preview:        $('js-preview'),
    lineCount:      $('js-line-count'),
    sizeKb:         $('js-size'),
    wordCount:      $('js-word-count'),
    readTime:       $('js-read-time'),
    liveDot:        $('js-live-dot'),
    footerStats:    $('js-footer-stats'),
    footerLanding:  $('js-footer-landing'),
    footWords:      $('js-foot-words'),
    footRead:       $('js-foot-read'),
    footStatusLabel:$('js-foot-status-label'),
    footStatus:     $('js-foot-status'),
    toast:          $('js-toast'),
    toastMsg:       $('js-toast-msg'),
    install:        $('js-install'),
    tocToggle:      $('js-toc-toggle'),
    toc:            $('js-toc'),
    exportBtn:      $('js-export'),
    searchBar:      $('js-search'),
    searchInput:    $('js-search-input'),
    searchCount:    $('js-search-count'),
    searchPrev:     $('js-search-prev'),
    searchNext:     $('js-search-next'),
    searchClose:    $('js-search-close'),
    dropOverlay:    $('js-drop-overlay'),
    recent:         $('js-recent'),
    recentList:     $('js-recent-list'),
    recentClear:    $('js-recent-clear'),
    changedBar:     $('js-changed-bar'),
    changedReload:  $('js-changed-reload'),
    changedDismiss: $('js-changed-dismiss'),
    lightbox:       $('js-lightbox'),
    lightboxImg:    $('js-lightbox-img'),
    lightboxClose:  $('js-lightbox-close'),
    presentBtn:     $('js-present-btn'),
    present:        $('js-present'),
    presentStage:   $('js-present-stage'),
    presentCounter: $('js-present-counter'),
    presentPrev:    $('js-present-prev'),
    presentNext:    $('js-present-next'),
    presentClose:   $('js-present-close'),
    themeBtn:       $('js-theme-btn'),
    themeIco:       $('js-theme-ico'),
    themeColorMeta: $('js-theme-color'),
  };

  // The element that actually scrolls inside the preview pane. TOC links and
  // search jumps scroll *this*, never the window.
  const previewScroll = els.panePreview
    ? els.panePreview.querySelector('.pane-scroll')
    : null;

  // In-document search state.
  const search = {
    open: false,
    query: '',
    hits: [],
    active: -1,
  };

  // Whether the current document has enough headings to warrant a TOC.
  let hasToc = false;

  // Mermaid diagram render state (Feature 1, v1.2).
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MMD_STYLE_ATTR = 'data-mmd-style';  // parking spot for deferred inline CSS
  let mermaidReady = false;   // initialize() has been called
  let mermaidSheet = null;    // constructed stylesheet holding diagram CSS (CSP-safe)
  let mermaidCss = [];        // CSS lifted from each diagram this render (reused by export)
  let mermaidSeq = 0;         // monotonic id source for mermaid.render()
  let renderToken = 0;        // bumped per render; invalidates stale async passes
  let mermaidTimer = null;    // debounce handle for the async pass

  // Split-view sync-scroll re-entrancy guard (Feature 3, v1.2).
  let isSyncing = false;

  // Drag-and-drop enter/leave depth counter (Feature 2, v1.2).
  let dragDepth = 0;

  // Auto-reload-on-disk-change polling state (v1.3).
  let pollTimer = null;     // setInterval handle
  let pollInFlight = false; // guard against overlapping getFile() reads
  const POLL_MS = 2500;

  // Image lightbox (v1.4): element that opened it, for focus return.
  let lightboxTrigger = null;

  // Presentation mode (v1.5): a transient fullscreen overlay, NOT a state.view
  // value — the underlying preview/edit/split view is untouched and restored on
  // exit. Slides are built from the already-sanitized preview DOM on enter.
  let presenting = false;
  let slides = [];
  let slideIdx = 0;

  // Scroll-position memory (v1.4): debounce handle + restore guard.
  let scrollSaveTimer = null;
  let restoringScroll = false;

  // PWA install prompt - captured from beforeinstallprompt and replayed when
  // the user clicks the in-app Install button. Chromium fires this event on
  // engagement once the manifest + service worker meet install criteria. iOS
  // Safari and Firefox do NOT fire beforeinstallprompt, so the button stays
  // hidden on those browsers (correct: tapping it would do nothing). iOS
  // users install via the Share menu's "Add to Home Screen" affordance,
  // which we deliberately do not surface in this v1.1 patch to keep scope
  // minimal.
  let deferredInstallPrompt = null;

  // ---------------------------------------------------------------------
  // Markdown engine setup
  // ---------------------------------------------------------------------

  // Configure marked with highlight.js for fenced code blocks.
  if (window.marked) {
    marked.setOptions({
      gfm: true,
      breaks: false,
      pedantic: false,
    });

    // Custom renderer: add data-lang attribute to <pre> for the language pill
    // and let highlight.js do the token classes.
    const renderer = new marked.Renderer();
    renderer.code = function (code, infostring, escaped) {
      const lang = (infostring || '').match(/\S*/)[0];
      // Mermaid fenced blocks are claimed by the renderMermaid() post-render
      // pass. Emit a clean, un-highlighted carrier so code.textContent is the
      // exact diagram source (no stray hljs spans to strip back out).
      if (lang === 'mermaid') {
        return '<pre data-lang="mermaid"><code class="language-mermaid">' +
          escapeHtml(code) + '</code></pre>\n';
      }
      let highlighted = '';
      if (lang && window.hljs && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        } catch (e) {
          highlighted = escapeHtml(code);
        }
      } else if (window.hljs) {
        try {
          highlighted = hljs.highlightAuto(code).value;
        } catch (e) {
          highlighted = escapeHtml(code);
        }
      } else {
        highlighted = escapeHtml(code);
      }
      const langAttr = lang ? ` data-lang="${escapeAttr(lang)}"` : '';
      const langClass = lang ? ` class="language-${escapeAttr(lang)} hljs"` : ' class="hljs"';
      return `<pre${langAttr}><code${langClass}>${highlighted}</code></pre>\n`;
    };

    // Footnotes (GFM-style): [^label] references + [^label]: definitions.
    // The extensions only TAG refs/defs in the HTML; numbering, the bottom
    // footnotes section, and back-references are assembled deterministically in
    // the processFootnotes() post-render pass — so DOMPurify never has to accept
    // ids, and all the ordering logic lives in one place.
    const footnoteDefExt = {
      name: 'footnoteDef',
      level: 'block',
      start(src) { const m = src.match(/^\[\^[^\]\s]+\]:/m); return m ? m.index : undefined; },
      tokenizer(src) {
        const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*)/.exec(src);
        if (m) {
          const text = (m[2] || '').trim();
          return {
            type: 'footnoteDef',
            raw: m[0],
            label: m[1],
            tokens: this.lexer.inlineTokens(text),
          };
        }
      },
      renderer(token) {
        return '<div class="fn-def" data-fn="' + escapeAttr(token.label) + '">' +
          this.parser.parseInline(token.tokens) + '</div>';
      },
    };
    const footnoteRefExt = {
      name: 'footnoteRef',
      level: 'inline',
      start(src) { const i = src.indexOf('[^'); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^\[\^([^\]\s]+)\]/.exec(src);
        if (m) return { type: 'footnoteRef', raw: m[0], label: m[1] };
      },
      renderer(token) {
        return '<sup class="fn-ref" data-fn="' + escapeAttr(token.label) + '">' +
          escapeHtml(token.label) + '</sup>';
      },
    };

    marked.use({ renderer });
    marked.use({ extensions: [footnoteDefExt, footnoteRefExt] });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // Self-contained stylesheet for HTML export. Mirrors the indigo preview look
  // (css/style.css) plus a compact highlight.js token palette, so the
  // downloaded file renders standalone. Inlined into the Blob only — never
  // loaded inside the app origin, so the page CSP does not apply to it.
  const EXPORT_CSS = [
    ':root{--accent:#2B4A8B;--accent-hover:#243F76;--ink:#0F1A2E;--ink2:#445063;',
    '--muted:#5E6678;--surface:#E5E7EB;--card:#EEF0F3;--input:#F5F6F8;--border:#E1E6EE;}',
    '*{box-sizing:border-box;}',
    "body{margin:0;background:#fff;color:var(--ink);line-height:1.6;font-size:16px;",
    "font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;",
    '-webkit-font-smoothing:antialiased;}',
    '.markdown-body{max-width:760px;margin:0 auto;padding:48px clamp(16px,5vw,32px) 72px;}',
    '.markdown-body>*+*{margin-top:18px;}',
    '.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,',
    '.markdown-body h5,.markdown-body h6{line-height:1.25;letter-spacing:-0.015em;}',
    '.markdown-body h1{color:var(--accent);font-size:2em;font-weight:700;',
    'padding-bottom:.3em;border-bottom:2px solid var(--accent);}',
    '.markdown-body h2{color:var(--accent);font-size:1.4em;font-weight:600;margin-top:1.6em;',
    'padding-left:.5em;border-left:3px solid var(--accent);}',
    '.markdown-body h3{color:var(--accent-hover);font-size:1.1em;font-weight:600;margin-top:1.4em;',
    'text-transform:uppercase;letter-spacing:.04em;}',
    '.markdown-body h4,.markdown-body h5,.markdown-body h6{color:var(--ink2);font-weight:600;}',
    '.markdown-body a{color:var(--accent);text-decoration:underline;text-underline-offset:3px;}',
    '.markdown-body strong{font-weight:700;}.markdown-body em{font-style:italic;}',
    ".markdown-body code{font-family:ui-monospace,'SFMono-Regular','Consolas',monospace;",
    'font-size:.88em;background:var(--input);color:var(--accent);padding:2px 6px;',
    'border-radius:4px;border:1px solid var(--accent);}',
    '.markdown-body pre{position:relative;background:var(--input);border:1px solid var(--accent);',
    'border-radius:8px;padding:16px 18px;overflow:auto;}',
    '.markdown-body pre code{background:none;border:0;padding:0;color:var(--ink);',
    'font-size:.85em;display:block;}',
    '.markdown-body blockquote{margin:0;padding:14px 18px;border-left:4px solid var(--accent);',
    'background:var(--surface);color:var(--ink2);font-style:italic;',
    'border-radius:0 4px 4px 0;}',
    '.markdown-body ul,.markdown-body ol{padding-left:1.4em;}',
    '.markdown-body li{margin-top:4px;}',
    '.markdown-body li::marker{color:var(--accent);}',
    '.markdown-body table{width:100%;border-collapse:collapse;font-size:.95em;',
    'border:1px solid var(--border);}',
    '.markdown-body thead{background:var(--surface);border-bottom:2px solid var(--accent);}',
    '.markdown-body th,.markdown-body td{text-align:left;padding:9px 12px;',
    'border-bottom:1px solid var(--border);}',
    '.markdown-body th{color:var(--accent);font-weight:600;font-size:.85em;',
    'text-transform:uppercase;letter-spacing:.05em;}',
    '.markdown-body img{max-width:100%;height:auto;border-radius:4px;}',
    '.markdown-body hr{border:0;border-top:2px solid var(--accent);margin:2em 0;opacity:.4;}',
    '.fm-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;',
    'padding:14px 16px;}',
    '.fm-list{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0;}',
    '.fm-key{color:var(--accent);font-weight:600;font-size:.85em;margin:0;}',
    '.fm-val{margin:0;color:var(--ink);}',
    '.fm-raw{grid-column:1/-1;color:var(--muted);font-family:ui-monospace,monospace;font-size:.85em;}',
    '.fm-tag{display:inline-block;background:var(--input);border:1px solid var(--border);',
    'border-radius:999px;padding:1px 9px;margin:0 4px 4px 0;font-size:.82em;}',
    // highlight.js compact palette
    '.hljs{color:#0F1A2E;}',
    '.hljs-comment,.hljs-quote{color:#5E6678;font-style:italic;}',
    '.hljs-keyword,.hljs-selector-tag,.hljs-built_in,.hljs-name,.hljs-tag{color:#2B4A8B;}',
    '.hljs-string,.hljs-attr,.hljs-template-tag,.hljs-addition{color:#0A7D4F;}',
    '.hljs-number,.hljs-literal,.hljs-variable,.hljs-type{color:#B5530F;}',
    '.hljs-title,.hljs-section{color:#5A3FB5;font-weight:600;}',
    '.hljs-attribute,.hljs-symbol,.hljs-bullet,.hljs-meta{color:#9A3412;}',
    '.hljs-emphasis{font-style:italic;}.hljs-strong{font-weight:700;}',
    '.hljs-deletion{color:#B82F2F;}',
  ].join('');

  // v1.2 export additions: Mermaid diagram container + footnotes. (Mermaid's
  // own per-diagram CSS is appended separately from mermaidCss at export time.)
  const EXPORT_CSS_V12 = [
    '.mermaid-diagram{margin:1.2em 0;text-align:center;}',
    '.mermaid-diagram svg{max-width:100%;height:auto;}',
    '.footnotes{margin-top:2.4em;}',
    '.footnotes-title{color:#2B4A8B;font-weight:600;font-size:.8em;text-transform:uppercase;',
    'letter-spacing:.08em;border-top:2px solid #2B4A8B;padding-top:.8em;margin-bottom:.4em;}',
    '.footnotes-list{padding-left:1.4em;color:#445063;font-size:.92em;}',
    '.footnotes-list li{margin-top:.5em;}',
    '.footnotes-list li::marker{color:#2B4A8B;}',
    '.footnote-backref{color:#2B4A8B;text-decoration:none;margin-left:4px;}',
    'sup.fn-ref a,.fn-ref-link{color:#2B4A8B;text-decoration:none;font-weight:600;}',
  ].join('');

  // ---------------------------------------------------------------------
  // Browser capability detection
  // ---------------------------------------------------------------------

  const hasFSAccess = typeof window.showOpenFilePicker === 'function';

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function renderPreview() {
    if (!window.marked || !window.DOMPurify) {
      els.preview.textContent = state.content;
      return;
    }
    // Strip a leading YAML frontmatter block before marked sees it, so it no
    // longer renders as a stray table; the parsed data becomes a metadata card.
    let md = state.content || '';
    const fm = extractFrontmatter(md);
    if (fm) md = fm.body;

    const rawHtml = marked.parse(md);
    // Guardrail: all markdown-derived HTML flows through DOMPurify.
    const clean = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['target', 'rel'],
    });
    els.preview.innerHTML = clean;

    // Frontmatter card sits above the document body (built via DOM, not markup).
    if (fm) renderFrontmatterCard(fm.entries);

    // External-looking links open in a new tab safely.
    const links = els.preview.querySelectorAll('a[href]');
    links.forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });

    // Emoji shortcodes (v1.4): replace :code: in body text nodes with Unicode,
    // skipping code/pre so colon-bearing code samples are untouched. Runs before
    // search highlighting so the replaced text is what gets searched/highlighted.
    renderEmoji();

    // Post-render passes over the sanitized DOM (never over raw markup).
    decorateCodeBlocks();
    processFootnotes();
    decorateHeadings();
    decorateHeadingAnchors();  // v1.4: per-heading deep-link affordance
    decorateImages();          // v1.4: click-to-zoom lightbox on body images
    buildToc();

    // Keep live search highlights in sync while editing in Split.
    if (search.open) runSearch(search.query, true);

    updateStats();

    // Async diagram pass (Mermaid). Debounced + render-token guarded so live
    // typing in Split never thrashes or injects stale diagrams.
    scheduleMermaid();
  }

  function updateStats() {
    // Source stats
    const lines = state.content ? state.content.split('\n').length : 0;
    const kb = state.fileSize ? (state.fileSize / 1024).toFixed(1) : '0';
    if (els.lineCount) els.lineCount.textContent = String(lines);
    if (els.sizeKb) els.sizeKb.textContent = kb;

    // Preview stats - word count from rendered text
    const txt = (els.preview.textContent || '').trim();
    const words = txt ? txt.split(/\s+/).filter(Boolean).length : 0;
    const minutes = Math.max(1, Math.ceil(words / 200));
    if (els.wordCount) els.wordCount.textContent = String(words);
    if (els.readTime) els.readTime.textContent = '~' + minutes;
    if (els.footWords) els.footWords.textContent = String(words);
    if (els.footRead) els.footRead.textContent = '~' + minutes + ' min';
  }

  // ---------------------------------------------------------------------
  // Code-block copy buttons
  // ---------------------------------------------------------------------

  // Inline SVGs (no sprite sheet in this app — buttons carry their own markup).
  const ICON_COPY =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const ICON_CHECK =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="20 6 9 17 4 12"/></svg>';

  // Add a copy button + language pill toolbar to each <pre>. The CSS-generated
  // ::before pill is suppressed (.has-tools) so the JS pill can sit beside the
  // button. Built with DOM APIs and textContent — never injected as markup.
  function decorateCodeBlocks() {
    const pres = els.preview.querySelectorAll('pre');
    pres.forEach(function (pre) {
      // Mermaid carriers are replaced wholesale by renderMermaid(); no chrome.
      if (pre.getAttribute('data-lang') === 'mermaid') return;
      if (pre.querySelector('.pre-tools')) return;
      const code = pre.querySelector('code');
      if (!code) return;

      pre.classList.add('has-tools');

      const tools = document.createElement('div');
      tools.className = 'pre-tools';
      tools.setAttribute('data-chrome', 'code');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.setAttribute('aria-label', 'Copy code');
      btn.innerHTML = ICON_COPY + '<span class="code-copy-label">Copy</span>';
      btn.addEventListener('click', function () { copyCode(code, btn); });
      tools.appendChild(btn);

      const lang = pre.getAttribute('data-lang') || '';
      if (lang) {
        const pill = document.createElement('span');
        pill.className = 'lang-pill';
        pill.textContent = lang;
        tools.appendChild(pill);
      }

      pre.appendChild(tools);
    });
  }

  function copyCode(code, btn) {
    const text = code.textContent || '';
    const done = function () { flashCopied(btn); };
    const fail = function () { toast('Could not copy code', 'danger'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {
        fail();
      }
    }
  }

  function flashCopied(btn) {
    const label = btn.querySelector('.code-copy-label');
    btn.innerHTML = ICON_CHECK + '<span class="code-copy-label">Copied</span>';
    btn.classList.add('copied');
    if (btn._copyTimer) clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(function () {
      btn.innerHTML = ICON_COPY + '<span class="code-copy-label">Copy</span>';
      btn.classList.remove('copied');
    }, 1300);
  }

  // Copy the entire markdown source to the clipboard.
  function copyAllSource() {
    const btn = els.copyAll;
    const text = (els.source && els.source.value) || '';
    if (!text) {
      toast('Nothing to copy - open a file first.', 'warning');
      return;
    }
    const done = function () { flashCopyAll(btn); toast('Copied document', 'success'); };
    const fail = function () { toast('Could not copy document', 'danger'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {
        fail();
      }
    }
  }

  // Brief "Copied" flash on the Copy-all button.
  function flashCopyAll(btn) {
    if (!btn) return;
    const label = btn.querySelector('.ph-copy-label');
    if (!label) return;
    const original = label.textContent;
    label.textContent = 'Copied';
    btn.classList.add('copied');
    if (btn._copyTimer) clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(function () {
      label.textContent = original;
      btn.classList.remove('copied');
    }, 1300);
  }

  // ---------------------------------------------------------------------
  // Mermaid diagrams (async post-render pass, Feature 1)
  // ---------------------------------------------------------------------

  // Indigo-only Mermaid theme variables, computed per effective appearance.
  // Mermaid's theme is JS-set (CSS tokens can't reach it), so dark mode needs an
  // explicit variable swap + re-init + re-render (see applyTheme). Light keeps
  // the original v1.2 palette; dark uses the dark ramp + lifted indigo #7FA0E8.
  function mermaidThemeVars() {
    if (isDark()) {
      return {
        primaryColor: '#171C26',        // ~ dark --reader-card
        primaryBorderColor: '#7FA0E8',  // lifted indigo accent
        primaryTextColor: '#E7EBF2',    // dark --bwb-text-primary
        lineColor: '#7FA0E8',
        secondaryColor: '#11151C',      // ~ dark --reader-surface
        tertiaryColor: '#1F2632',       // ~ dark --reader-card-input
        secondaryBorderColor: '#7FA0E8',
        tertiaryBorderColor: '#9DB6EF',
        noteBkgColor: '#21304A',        // ~ dark --accent-soft
        noteBorderColor: '#7FA0E8',
        noteTextColor: '#E7EBF2',
        fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
      };
    }
    return {
      primaryColor: '#EEF0F3',        // ~ --reader-card
      primaryBorderColor: '#2B4A8B',  // ~ --accent
      primaryTextColor: '#0F1A2E',    // ~ --bwb-text-primary
      lineColor: '#5C7EC5',           // indigo-light
      secondaryColor: '#E5E7EB',      // ~ --reader-surface
      tertiaryColor: '#F5F6F8',       // ~ --reader-card-input
      secondaryBorderColor: '#2B4A8B',
      tertiaryBorderColor: '#5C7EC5',
      noteBkgColor: '#E8EDF7',        // ~ --accent-soft
      noteBorderColor: '#2B4A8B',
      noteTextColor: '#0F1A2E',
      fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    };
  }

  // ----- CSP-safe inline styling -------------------------------------------
  // Mermaid styles the SVG it builds with inline style attributes plus one
  // inline <style> element. index.html sets style-src without 'unsafe-inline',
  // so Chromium refuses every one of them - including the svg's own
  // "max-width: <intrinsic>px", the declaration that keeps a diagram at its
  // natural size. Loosening the CSP for one library is the wrong trade, so we
  // keep Mermaid's CSS away from the HTML parser instead: during a render pass
  // style attributes are diverted to data-mmd-style, the <style> element's text
  // is captured, and any markup Mermaid re-parses is rewritten the same way.
  // Everything is then re-applied through the CSSOM, which CSP does not police.

  // Rename style attributes to MMD_STYLE_ATTR, inside tags only so identical
  // text inside a diagram label is never touched.
  function deferInlineStyles(markup) {
    return String(markup).replace(/<[a-zA-Z][^<>]*>/g, function (tag) {
      return tag.replace(/(\s)style\s*=\s*("[^"]*"|'[^']*')/gi,
        '$1' + MMD_STYLE_ATTR + '=$2');
    });
  }

  // Deferred CSS skips Mermaid's own DOMPurify pass, and it comes from whatever
  // document the user opened, so keep url() to same-document fragments (how
  // Mermaid points an edge at its arrowhead). Anything else becomes an invalid
  // declaration the browser drops.
  function safeCssText(css) {
    return String(css).replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
  }

  // Move every parked declaration into the element's CSSOM style and clear the
  // attribute, so the diagram ends up styled exactly as Mermaid intended.
  function applyDeferredStyles(root) {
    const parked = [].slice.call(root.querySelectorAll('[' + MMD_STYLE_ATTR + ']'));
    parked.forEach(function (el) {
      const css = el.getAttribute(MMD_STYLE_ATTR);
      el.removeAttribute(MMD_STYLE_ATTR);
      if (!css) return;
      try { el.style.cssText = safeCssText(css); } catch (e) { /* skip bad CSS */ }
    });
  }

  // Run fn with the three DOM entry points Mermaid uses for inline CSS diverted.
  // Resolves to { svg, css }; the originals are restored even if fn throws.
  async function renderWithDeferredStyles(fn) {
    const proto = Element.prototype;
    const nativeSetAttribute = proto.setAttribute;
    const nativeGetAttribute = proto.getAttribute;
    const nativeCreateElement = document.createElement;
    const nativeParseFromString = DOMParser.prototype.parseFromString;
    const css = [];

    proto.setAttribute = function (name, value) {
      if (name === 'style') {
        return nativeSetAttribute.call(this, MMD_STYLE_ATTR,
          value == null ? '' : String(value));
      }
      return nativeSetAttribute.call(this, name, value);
    };
    // Keep reads consistent with writes for code that sets a style and reads it
    // back (Mermaid's own DOMPurify pass does exactly that).
    proto.getAttribute = function (name) {
      if (name === 'style') {
        const parked = nativeGetAttribute.call(this, MMD_STYLE_ATTR);
        if (parked !== null) return parked;
      }
      return nativeGetAttribute.call(this, name);
    };
    document.createElement = function (tag, options) {
      if (String(tag).toLowerCase() !== 'style') {
        return nativeCreateElement.call(document, tag, options);
      }
      // A <style> element is refused whether or not it carries content, so hand
      // Mermaid a non-rendering stand-in and keep the CSS it writes.
      const standIn = document.createElementNS(SVG_NS, 'desc');
      const trap = {
        configurable: true,
        get: function () { return ''; },
        set: function (value) { css.push(value == null ? '' : String(value)); },
      };
      Object.defineProperty(standIn, 'innerHTML', trap);
      Object.defineProperty(standIn, 'textContent', trap);
      return standIn;
    };
    // Mermaid re-parses its finished SVG to sanitize it, and its arrowhead
    // markup carries literal style attributes; rename those before the parse.
    DOMParser.prototype.parseFromString = function (markup, type) {
      return nativeParseFromString.call(this, deferInlineStyles(markup), type);
    };

    try {
      const out = await fn();
      return { svg: out && out.svg ? out.svg : '', css: css };
    } finally {
      proto.setAttribute = nativeSetAttribute;
      proto.getAttribute = nativeGetAttribute;
      document.createElement = nativeCreateElement;
      DOMParser.prototype.parseFromString = nativeParseFromString;
    }
  }

  function initMermaid() {
    if (mermaidReady || !window.mermaid) return;
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        // 'strict' makes Mermaid sanitize its own SVG and disable click-script
        // handlers — this is why the SVG may bypass the main DOMPurify pass.
        securityLevel: 'strict',
        theme: 'base',
        htmlLabels: false,                                  // avoid foreignObject
        flowchart: { htmlLabels: false, useMaxWidth: true },
        themeVariables: mermaidThemeVars(),
      });
      mermaidReady = true;
    } catch (e) {
      // On init failure diagrams simply remain as code blocks.
    }
  }

  // Re-initialize Mermaid with the current appearance's variables. Used on theme
  // switch; flips mermaidReady so the next render re-inits with fresh colors.
  function reinitMermaid() {
    if (!window.mermaid) return;
    mermaidReady = false;
    initMermaid();
  }

  // Debounced trigger. Always bumps renderToken so a stale in-flight pass can
  // detect it was superseded; only schedules real work if mermaid blocks exist.
  function scheduleMermaid() {
    renderToken += 1;
    const token = renderToken;
    if (!window.mermaid) return;
    if (!els.preview.querySelector('pre[data-lang="mermaid"]')) return;
    if (mermaidTimer) clearTimeout(mermaidTimer);
    mermaidTimer = setTimeout(function () {
      renderMermaid(token).catch(function () { /* never reject into the void */ });
    }, 160);
  }

  async function renderMermaid(token) {
    if (!window.mermaid) return;
    initMermaid();
    if (!mermaidReady) return;
    const pres = [].slice.call(els.preview.querySelectorAll('pre[data-lang="mermaid"]'));
    if (!pres.length) return;

    mermaidCss = [];  // rebuilt fresh each pass; export reads this afterwards
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i];
      const codeEl = pre.querySelector('code');
      const src = (codeEl ? codeEl.textContent : pre.textContent) || '';
      const id = 'mmd-' + (++mermaidSeq);
      let svg = '';
      let diagramCss = [];
      try {
        const out = await renderWithDeferredStyles(function () {
          return window.mermaid.render(id, src);
        });
        svg = out.svg;
        diagramCss = out.css;
      } catch (e) {
        if (token !== renderToken) return;  // superseded mid-flight
        const note = document.createElement('div');
        note.className = 'mermaid-error';
        note.textContent = 'Diagram error: ' + (e && e.message ? e.message : 'could not render');
        pre.parentNode.insertBefore(note, pre.nextSibling);
        continue;  // leave the original code block in place
      }
      if (token !== renderToken) return;  // a newer render started; abandon this one

      const wrap = document.createElement('div');
      wrap.className = 'mermaid-diagram';
      // Mermaid hardened this SVG under securityLevel:'strict'. Any style
      // attribute that reached the string is renamed before the parser sees it.
      wrap.innerHTML = deferInlineStyles(svg);
      applyDeferredStyles(wrap);

      // CSP-safe styling: the diagram's own CSS goes into a constructed
      // stylesheet (CSSOM rules are exempt from the inline-style CSP
      // restriction) rather than an inline <style>. The diagram id on the SVG
      // scopes those rules, so styling survives. Older render paths that still
      // emit a <style> element are lifted the same way.
      diagramCss.forEach(function (text) { mermaidCss.push(text); });
      const styleEl = wrap.querySelector('style');
      if (styleEl) {
        mermaidCss.push(styleEl.textContent || '');
        styleEl.remove();
      }
      pre.replaceWith(wrap);
    }
    applyMermaidSheet();
  }

  // Push the collected diagram CSS into a single constructed stylesheet adopted
  // by the document. No <style> element, no inline styles => CSP stays strict.
  function applyMermaidSheet() {
    const cssText = mermaidCss.join('\n');
    if (!mermaidSheet && typeof window.CSSStyleSheet === 'function') {
      try {
        mermaidSheet = new CSSStyleSheet();
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat(mermaidSheet);
      } catch (e) {
        mermaidSheet = null;
      }
    }
    if (mermaidSheet) {
      try { mermaidSheet.replaceSync(cssText); } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------
  // Footnotes (post-render assembly, Feature 4)
  // ---------------------------------------------------------------------

  // Refs (sup.fn-ref) and defs (.fn-def) are tagged by the marked extensions.
  // Here we number footnotes in reference order, move definition content into a
  // single footnotes section at the bottom, and wire jump + back-reference
  // links. ids are assigned here (after sanitize), like decorateHeadings does.
  function processFootnotes() {
    const defEls = [].slice.call(els.preview.querySelectorAll('.fn-def'));
    const defByLabel = {};
    defEls.forEach(function (d) {
      const label = d.getAttribute('data-fn');
      if (label && !(label in defByLabel)) {
        // Move the (already-sanitized) nodes out, rather than re-parsing HTML.
        const frag = document.createDocumentFragment();
        while (d.firstChild) frag.appendChild(d.firstChild);
        defByLabel[label] = frag;
      }
      d.remove();  // duplicate defs (and unreferenced ones) leave no stray markup
    });

    const refEls = [].slice.call(els.preview.querySelectorAll('sup.fn-ref'));
    if (!refEls.length) return;  // defs with no refs render nothing (GitHub parity)

    const num = {};
    const refIdsByLabel = {};
    let counter = 0;
    refEls.forEach(function (sup) {
      const label = sup.getAttribute('data-fn');
      if (!label || !(label in defByLabel)) {
        // Reference with no matching definition: degrade to plain text.
        sup.replaceWith(document.createTextNode('[^' + (label || '') + ']'));
        return;
      }
      if (!(label in num)) { num[label] = ++counter; refIdsByLabel[label] = []; }
      const n = num[label];
      const k = refIdsByLabel[label].length + 1;
      const refId = 'fnref-' + n + (k > 1 ? '-' + k : '');
      refIdsByLabel[label].push(refId);
      sup.id = refId;
      sup.textContent = '';
      const a = document.createElement('a');
      a.className = 'fn-ref-link';
      a.href = '#fn-' + n;
      a.setAttribute('aria-label', 'Footnote ' + n);
      a.textContent = String(n);
      sup.appendChild(a);
    });
    if (!counter) return;  // every reference was an orphan

    const section = document.createElement('section');
    section.className = 'footnotes';
    // Deliberately NOT a heading element, so it does not pollute the TOC.
    const title = document.createElement('div');
    title.className = 'footnotes-title';
    title.textContent = 'Footnotes';
    section.appendChild(title);

    const ol = document.createElement('ol');
    ol.className = 'footnotes-list';
    const labelsByNum = [];
    Object.keys(num).forEach(function (l) { labelsByNum[num[l] - 1] = l; });
    labelsByNum.forEach(function (label) {
      const n = num[label];
      const li = document.createElement('li');
      li.className = 'footnote-item';
      li.id = 'fn-' + n;
      const content = document.createElement('span');
      content.className = 'footnote-content';
      content.appendChild(defByLabel[label]);
      li.appendChild(content);
      const ids = refIdsByLabel[label];
      ids.forEach(function (refId, idx) {
        const back = document.createElement('a');
        back.className = 'footnote-backref';
        back.href = '#' + refId;
        back.setAttribute('aria-label', 'Back to content');
        back.appendChild(document.createTextNode(' ↩'));
        if (ids.length > 1) {
          const s = document.createElement('sup');
          s.textContent = String(idx + 1);
          back.appendChild(s);
        }
        li.appendChild(back);
      });
      ol.appendChild(li);
    });
    section.appendChild(ol);
    els.preview.appendChild(section);
  }

  // In-pane navigation for footnote jump / back-reference links (mirrors the
  // TOC behavior: scroll the preview container, not the window/URL hash).
  function onPreviewAnchorClick(e) {
    const a = e.target.closest && e.target.closest('a.fn-ref-link, a.footnote-backref');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.charAt(0) !== '#') return;
    const target = els.preview.querySelector('#' + cssEscape(href.slice(1)));
    if (target) { e.preventDefault(); scrollPreviewTo(target); }
  }

  // ---------------------------------------------------------------------
  // Headings + Table of Contents
  // ---------------------------------------------------------------------

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Assign GitHub-style slug ids to headings AFTER sanitize, so DOMPurify's
  // config never has to accept ids from the markdown input.
  function decorateHeadings() {
    const heads = els.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const seen = Object.create(null);
    heads.forEach(function (h) {
      const base = slugify(h.textContent) || 'section';
      let slug = base;
      if (base in seen) {
        seen[base] += 1;
        slug = base + '-' + seen[base];
      } else {
        seen[base] = 0;
      }
      h.id = slug;
    });
  }

  // Rebuild the nested TOC every render so it tracks edits in Split.
  function buildToc() {
    if (!els.toc) return;
    els.toc.textContent = '';

    const heads = els.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    hasToc = heads.length >= 2;
    if (!hasToc) {
      refreshTocControls();
      return;
    }

    const label = document.createElement('div');
    label.className = 'toc-label';
    label.textContent = 'Contents';
    els.toc.appendChild(label);

    const root = document.createElement('ul');
    root.className = 'toc-list';
    const stack = [{ level: 0, ul: root }];

    heads.forEach(function (h) {
      const level = Number(h.tagName.slice(1));
      const li = document.createElement('li');
      li.className = 'toc-item';
      const a = document.createElement('a');
      a.className = 'toc-link';
      a.href = '#' + h.id;
      a.textContent = h.textContent || '';
      a.setAttribute('data-target', h.id);
      li.appendChild(a);

      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      stack[stack.length - 1].ul.appendChild(li);

      const sub = document.createElement('ul');
      sub.className = 'toc-sublist';
      li.appendChild(sub);
      stack.push({ level: level, ul: sub });
    });

    els.toc.appendChild(root);
    refreshTocControls();
  }

  function previewVisible() {
    return state.view === 'preview' || state.view === 'split';
  }

  // The Contents toggle only makes sense when the preview is on screen and the
  // document has 2+ headings.
  function refreshTocControls() {
    if (!els.tocToggle) return;
    const allow = hasToc && previewVisible();
    els.tocToggle.hidden = !allow;
    if (!allow) setTocOpen(false);
  }

  function setTocOpen(open) {
    const want = !!open && hasToc && previewVisible();
    state.tocOpen = want;
    if (els.panePreview) els.panePreview.classList.toggle('toc-open', want);
    if (els.toc) els.toc.hidden = !want;
    if (els.tocToggle) {
      els.tocToggle.classList.toggle('active', want);
      els.tocToggle.setAttribute('aria-pressed', want ? 'true' : 'false');
    }
  }

  function toggleToc() {
    setTocOpen(!state.tocOpen);
  }

  function onTocClick(e) {
    const a = e.target.closest && e.target.closest('a[data-target]');
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('data-target');
    const target = id && els.preview.querySelector('#' + cssEscape(id));
    if (target) scrollPreviewTo(target);
    if (window.matchMedia('(max-width: 720px)').matches) setTocOpen(false);
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^\w-]/g, '\\$&');
  }

  // Smooth-scroll within the preview scroll container (never the window).
  function scrollPreviewTo(el) {
    if (!previewScroll || !el) return;
    const cRect = previewScroll.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const top = previewScroll.scrollTop + (eRect.top - cRect.top) - 12;
    previewScroll.scrollTo({ top: top, behavior: 'smooth' });
  }

  // Scrollspy: mark the TOC link for the heading nearest the top.
  function updateScrollspy() {
    if (!state.tocOpen || !previewScroll) return;
    const heads = els.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (!heads.length) return;
    const cTop = previewScroll.getBoundingClientRect().top;
    let activeId = heads[0].id;
    for (let i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top - cTop <= 24) activeId = heads[i].id;
      else break;
    }
    const links = els.toc.querySelectorAll('.toc-link');
    links.forEach(function (l) {
      l.classList.toggle('active', l.getAttribute('data-target') === activeId);
    });
  }

  // ---------------------------------------------------------------------
  // Heading anchor links (v1.4)
  // ---------------------------------------------------------------------

  // Lucide "link" icon, carried inline (no sprite sheet in this app).
  const ICON_LINK =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
    '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  // Add a hover-revealed deep-link affordance to each heading (ids already set
  // by decorateHeadings). Built with DOM APIs; it is chrome, stripped on export.
  function decorateHeadingAnchors() {
    const heads = els.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    heads.forEach(function (h) {
      if (!h.id || h.querySelector('.heading-anchor')) return;
      h.classList.add('has-anchor');
      const a = document.createElement('a');
      a.className = 'heading-anchor';
      a.href = '#' + h.id;
      a.setAttribute('data-anchor', h.id);
      a.setAttribute('aria-label', 'Link to section: ' + (h.textContent || h.id));
      a.innerHTML = ICON_LINK;
      a.addEventListener('click', onHeadingAnchorClick);
      h.appendChild(a);
    });
  }

  function onHeadingAnchorClick(e) {
    e.preventDefault();
    const a = e.currentTarget;
    const id = a.getAttribute('data-anchor');
    const target = id && els.preview.querySelector('#' + cssEscape(id));
    if (target) scrollPreviewTo(target);
    // Copy a clean deep link (current URL minus any existing hash, plus #slug).
    const base = location.href.replace(/#.*$/, '');
    const deepLink = base + '#' + id;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(deepLink).then(
        function () { toast('Link copied'); },
        function () { toast('Could not copy link', 'warning'); }
      );
    } else {
      toast('Could not copy link', 'warning');
    }
  }

  // ---------------------------------------------------------------------
  // Image lightbox (v1.4)
  // ---------------------------------------------------------------------

  // Make body <img>s click-to-zoom. Excludes frontmatter-card images and
  // Mermaid (SVG, not <img>). The lightbox lives outside the preview, so it is
  // never part of HTML export / search / copy output.
  function decorateImages() {
    const imgs = els.preview.querySelectorAll('img');
    imgs.forEach(function (img) {
      if (img.closest('.fm-card')) return;
      if (img.classList.contains('zoomable')) return;
      img.classList.add('zoomable');
      // Make it a real control: keyboard-reachable, so focus can return here on
      // close (images are not focusable by default). Enter/Space also open it.
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'Zoom image' + (img.alt ? ': ' + img.alt : ''));
      img.addEventListener('click', function () { openLightbox(img); });
      img.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(img); }
      });
    });
  }

  function openLightbox(img) {
    if (!els.lightbox || !els.lightboxImg) return;
    lightboxTrigger = img;
    els.lightboxImg.src = img.currentSrc || img.src;
    els.lightboxImg.alt = img.alt || '';
    els.lightbox.hidden = false;
    if (els.lightboxClose) els.lightboxClose.focus();
  }

  function closeLightbox() {
    if (!els.lightbox || els.lightbox.hidden) return;
    els.lightbox.hidden = true;
    els.lightboxImg.removeAttribute('src');
    if (lightboxTrigger && typeof lightboxTrigger.focus === 'function') {
      lightboxTrigger.focus();
    }
    lightboxTrigger = null;
  }

  function onLightboxClick(e) {
    // Click on the dimmed backdrop (not the image itself) closes.
    if (e.target === els.lightbox) closeLightbox();
  }

  // ---------------------------------------------------------------------
  // Emoji shortcodes (v1.4) — static map, no library
  // ---------------------------------------------------------------------

  const EMOJI = {
    // faces / smileys
    smile: '😄', smiley: '😃', grin: '😁', laughing: '😆', joy: '😂',
    rofl: '🤣', wink: '😉', blush: '😊', slightly_smiling_face: '🙂',
    upside_down_face: '🙃', sweat_smile: '😅', heart_eyes: '😍',
    kissing_heart: '😘', thinking: '🤔', neutral_face: '😐',
    expressionless: '😑', unamused: '😒', roll_eyes: '🙄', smirk: '😏',
    grimacing: '😬', relieved: '😌', pensive: '😔', confused: '😕',
    worried: '😟', cry: '😢', sob: '😭', frowning: '😦', anguished: '😧',
    fearful: '😨', weary: '😩', tired_face: '😫', triumph: '😤',
    angry: '😠', rage: '😡', sunglasses: '😎', nerd_face: '🤓',
    sleeping: '😴', dizzy_face: '😵', astonished: '😲', scream: '😱',
    flushed: '😳', zany_face: '🤪', star_struck: '🤩', partying_face: '🥳',
    // hands / gestures / people
    thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', ok_hand: '👌',
    clap: '👏', wave: '👋', raised_hands: '🙌', pray: '🙏', muscle: '💪',
    point_up: '☝️', point_down: '👇', point_left: '👈', point_right: '👉',
    fist: '✊', facepunch: '👊', v: '✌️', crossed_fingers: '🤞',
    handshake: '🤝', writing_hand: '✍️', eyes: '👀', brain: '🧠',
    // symbols / status
    white_check_mark: '✅', heavy_check_mark: '✔️', check: '✅',
    x: '❌', negative_squared_cross_mark: '❎', warning: '⚠️',
    exclamation: '❗', question: '❓', heavy_exclamation_mark: '❗',
    bangbang: '‼️', star: '⭐', star2: '🌟', sparkles: '✨',
    heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚',
    blue_heart: '💙', purple_heart: '💜', broken_heart: '💔', fire: '🔥',
    boom: '💥', zap: '⚡', dizzy: '💫', anger: '💢', sweat_drops: '💦',
    100: '💯', tada: '🎉', confetti_ball: '🎊', balloon: '🎈',
    gift: '🎁', trophy: '🏆', medal: '🏅', dart: '🎯', rocket: '🚀',
    // objects / dev
    bulb: '💡', memo: '📝', pencil: '✏️', pencil2: '✏️', pushpin: '📌',
    paperclip: '📎', link: '🔗', lock: '🔒', unlock: '🔓', key: '🔑',
    mag: '🔍', bell: '🔔', hammer: '🔨', wrench: '🔧', gear: '⚙️',
    package: '📦', book: '📖', books: '📚', bookmark: '🔖', clipboard: '📋',
    calendar: '📅', chart_with_upwards_trend: '📈',
    chart_with_downwards_trend: '📉', bar_chart: '📊', email: '📧',
    inbox_tray: '📥', outbox_tray: '📤', phone: '📞', computer: '💻',
    keyboard: '⌨️', floppy_disk: '💾', bug: '🐛', sparkle: '❇️',
    construction: '🚧', recycle: '♻️', hourglass: '⏳', alarm_clock: '⏰',
    watch: '⌚', clock: '🕐', coffee: '☕', beer: '🍺', pizza: '🍕',
    // arrows
    arrow_right: '➡️', arrow_left: '⬅️', arrow_up: '⬆️', arrow_down: '⬇️',
    arrow_upper_right: '↗️', arrow_lower_right: '↘️', arrow_forward: '▶️',
    back: '🔙', soon: '🔜', repeat: '🔁',
    // nature / misc
    sunny: '☀️', cloud: '☁️', snowflake: '❄️', umbrella: '☔',
    rainbow: '🌈', moon: '🌙', earth_americas: '🌎', seedling: '🌱',
    deciduous_tree: '🌳', four_leaf_clover: '🍀', rose: '🌹',
    sun_with_face: '🌞', dog: '🐶', cat: '🐱', unicorn: '🦄',
    snake: '🐍', whale: '🐳', bird: '🐦', ghost: '👻', alien: '👽',
    robot: '🤖', skull: '💀', poop: '💩', wave_emoji: '🌊',
  };

  // Replace :shortcode: with the mapped emoji across body text nodes. Skips
  // <code>/<pre> (so colon-bearing code is untouched) and rendered Mermaid SVG.
  // Replacing with a plain Unicode character keeps it sanitize-/export-safe and
  // invisible to the search highlighter's later text walk.
  function renderEmoji() {
    if (!els.preview) return;
    const walker = document.createTreeWalker(els.preview, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.indexOf(':') === -1) {
          return NodeFilter.FILTER_REJECT;
        }
        const p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('code, pre, .mermaid-diagram, .pre-tools')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    targets.forEach(function (tn) {
      const replaced = tn.nodeValue.replace(/:([a-z0-9_+-]+):/gi, function (m, code) {
        const key = code.toLowerCase();
        return Object.prototype.hasOwnProperty.call(EMOJI, key) ? EMOJI[key] : m;
      });
      if (replaced !== tn.nodeValue) tn.nodeValue = replaced;
    });
  }

  // ---------------------------------------------------------------------
  // Scroll-position memory, per file (v1.4) — reuses the v1.3 IndexedDB store
  // ---------------------------------------------------------------------

  const SCROLL_KEY = 'scroll';
  const SCROLL_MAX = 40;
  const scrollSupported = typeof window.indexedDB !== 'undefined';

  // Stable per-file identity. Reuses name+size (same shape the recent list keys
  // on) so the position follows the document, not the tab.
  function fileKey() {
    if (!state.fileName) return null;
    return state.fileName + '::' + (state.fileSize || 0);
  }

  function scheduleSaveScroll() {
    if (restoringScroll || !scrollSupported || !state.fileName) return;
    if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(saveScrollNow, 400);
  }

  async function saveScrollNow() {
    const key = fileKey();
    if (!key) return;
    const p = previewScroll ? previewScroll.scrollTop : 0;
    const s = els.source ? els.source.scrollTop : 0;
    try {
      let list = await idbGet(SCROLL_KEY);
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (e) { return e && e.key !== key; });
      list.unshift({ key: key, p: p, s: s });
      if (list.length > SCROLL_MAX) list = list.slice(0, SCROLL_MAX);
      await idbSet(SCROLL_KEY, list);
    } catch (err) { /* best-effort */ }
  }

  // Restore the saved offsets for the current file (or top if none). Clamped to
  // each pane's max so a now-shorter document doesn't overscroll. Guarded with
  // restoringScroll + isSyncing so it doesn't trip save or sync-scroll.
  async function restoreScroll() {
    if (!scrollSupported) return;
    const key = fileKey();
    if (!key) return;
    let saved = null;
    try {
      const list = await idbGet(SCROLL_KEY);
      if (Array.isArray(list)) {
        saved = list.find(function (e) { return e && e.key === key; });
      }
    } catch (err) { return; }
    restoringScroll = true;
    isSyncing = true;
    const p = saved ? (saved.p || 0) : 0;
    const s = saved ? (saved.s || 0) : 0;
    if (previewScroll) {
      const max = Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
      previewScroll.scrollTop = Math.min(p, max);
    }
    if (els.source) {
      const max = Math.max(0, els.source.scrollHeight - els.source.clientHeight);
      els.source.scrollTop = Math.min(s, max);
    }
    requestAnimationFrame(function () {
      isSyncing = false;
      restoringScroll = false;
    });
  }

  // ---------------------------------------------------------------------
  // YAML frontmatter (dependency-free, common-case parser)
  // ---------------------------------------------------------------------

  // Returns { entries, body } when the document opens with a --- block,
  // otherwise null. Only a leading block counts; a later --- (horizontal rule)
  // is never treated as the closing fence.
  function extractFrontmatter(md) {
    const text = md || '';
    const lines = text.split('\n');
    if (lines.length < 2) return null;
    if (stripCr(lines[0]).trim() !== '---') return null;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (stripCr(lines[i]).trim() === '---') { end = i; break; }
    }
    if (end === -1) return null;
    const block = lines.slice(1, end).map(stripCr).join('\n');
    const body = lines.slice(end + 1).join('\n');
    return { entries: parseYaml(block), body: body };
  }

  function stripCr(s) { return String(s).replace(/\r$/, ''); }

  // Parses a frontmatter block into ordered entries. Handles key: value,
  // quoted strings, numbers/booleans, inline [a, b] lists and `- item` block
  // lists. Unparseable lines are preserved verbatim (key === null).
  function parseYaml(block) {
    const lines = block.split('\n');
    const entries = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^([A-Za-z0-9_.\-][A-Za-z0-9_.\- ]*):\s*(.*)$/);
      if (!m) {
        entries.push({ key: null, value: null, raw: line });
        continue;
      }
      const key = m[1].trim();
      const rest = m[2].trim();
      if (rest === '') {
        // Possible block list on the following indented `- item` lines.
        const items = [];
        let j = i + 1;
        while (j < lines.length) {
          const mm = lines[j].match(/^\s*-\s+(.*)$/);
          if (mm) { items.push(parseScalar(mm[1].trim())); j++; }
          else break;
        }
        if (items.length) { entries.push({ key: key, value: items }); i = j - 1; }
        else entries.push({ key: key, value: '' });
      } else if (/^\[.*\]$/.test(rest)) {
        const inner = rest.slice(1, -1).trim();
        const items = inner
          ? inner.split(',').map(function (s) { return parseScalar(s.trim()); })
          : [];
        entries.push({ key: key, value: items });
      } else {
        entries.push({ key: key, value: parseScalar(rest) });
      }
    }
    return entries;
  }

  function parseScalar(s) {
    if (s === '') return '';
    const q = s.match(/^"([\s\S]*)"$/) || s.match(/^'([\s\S]*)'$/);
    if (q) return q[1];
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }

  // Render parsed frontmatter as a compact metadata card at the top of the
  // preview. Built with DOM APIs + textContent, so no sanitize needed.
  function renderFrontmatterCard(entries) {
    if (!entries || !entries.length) return;
    const card = document.createElement('div');
    card.className = 'fm-card';
    const list = document.createElement('dl');
    list.className = 'fm-list';

    entries.forEach(function (e) {
      if (e.key === null) {
        const raw = document.createElement('div');
        raw.className = 'fm-raw';
        raw.textContent = e.raw;
        list.appendChild(raw);
        return;
      }
      const dt = document.createElement('dt');
      dt.className = 'fm-key';
      dt.textContent = e.key;
      const dd = document.createElement('dd');
      dd.className = 'fm-val';
      if (Array.isArray(e.value)) {
        if (!e.value.length) {
          dd.classList.add('fm-empty');
          dd.textContent = '—';
        }
        e.value.forEach(function (v) {
          const tag = document.createElement('span');
          tag.className = 'fm-tag';
          tag.textContent = String(v);
          dd.appendChild(tag);
        });
      } else {
        const str = String(e.value);
        dd.textContent = str === '' ? '—' : str;
        if (str === '') dd.classList.add('fm-empty');
      }
      list.appendChild(dt);
      list.appendChild(dd);
    });

    card.appendChild(list);
    els.preview.insertBefore(card, els.preview.firstChild);
  }

  // ---------------------------------------------------------------------
  // In-document search
  // ---------------------------------------------------------------------

  function openSearch() {
    if (!els.searchBar) return;
    search.open = true;
    els.searchBar.hidden = false;
    if (els.searchInput) {
      els.searchInput.focus();
      els.searchInput.select();
      if (els.searchInput.value) runSearch(els.searchInput.value, false);
      else updateSearchCount();
    }
  }

  function closeSearch() {
    search.open = false;
    if (els.searchBar) els.searchBar.hidden = true;
    clearHighlights();
    updateSearchCount();
  }

  function clearHighlights() {
    if (!els.preview) return;
    const marks = els.preview.querySelectorAll('mark.search-hit');
    marks.forEach(function (m) {
      const t = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(t, m);
    });
    if (marks.length) els.preview.normalize();
    search.hits = [];
    search.active = -1;
  }

  // Wrap every match in <mark> via a text-node walk (never innerHTML, which
  // would drop handlers and re-run sanitize). keepActive preserves the current
  // match index across a live re-render.
  function runSearch(query, keepActive) {
    const prevActive = keepActive ? search.active : 0;
    clearHighlights();
    search.query = query || '';
    if (!search.query) { updateSearchCount(); return; }

    const q = search.query.toLowerCase();
    const walker = document.createTreeWalker(els.preview, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE') return NodeFilter.FILTER_REJECT;
        // Skip injected chrome (copy buttons, language pills) and rendered SVG.
        if (p.closest && (p.closest('.pre-tools') || p.closest('.mermaid-diagram'))) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    const hits = [];
    textNodes.forEach(function (tn) {
      const text = tn.nodeValue;
      const lower = text.toLowerCase();
      if (lower.indexOf(q) === -1) return;
      const frag = document.createDocumentFragment();
      let last = 0;
      let idx = lower.indexOf(q);
      while (idx !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        hits.push(mark);
        last = idx + q.length;
        idx = lower.indexOf(q, last);
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    });

    search.hits = hits;
    if (!hits.length) {
      search.active = -1;
      updateSearchCount();
      return;
    }
    let start = prevActive;
    if (start < 0 || start >= hits.length) start = 0;
    setActiveHit(start, !keepActive);
  }

  function setActiveHit(i, doScroll) {
    if (!search.hits.length) return;
    if (i < 0) i = search.hits.length - 1;
    if (i >= search.hits.length) i = 0;
    search.hits.forEach(function (h) { h.classList.remove('active'); });
    search.active = i;
    const h = search.hits[i];
    h.classList.add('active');
    if (doScroll !== false) scrollPreviewTo(h);
    updateSearchCount();
  }

  function nextHit() { if (search.hits.length) setActiveHit(search.active + 1, true); }
  function prevHit() { if (search.hits.length) setActiveHit(search.active - 1, true); }

  function updateSearchCount() {
    if (!els.searchCount) return;
    if (!search.query) { els.searchCount.textContent = ''; return; }
    if (!search.hits.length) { els.searchCount.textContent = 'No matches'; return; }
    els.searchCount.textContent = (search.active + 1) + ' of ' + search.hits.length;
  }

  function onSearchInput() {
    runSearch(els.searchInput.value, false);
  }

  function onSearchKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) prevHit();
      else nextHit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  }

  // ---------------------------------------------------------------------
  // HTML export (self-contained, chrome-free)
  // ---------------------------------------------------------------------

  function canExport() {
    return state.view !== 'landing' && !!(state.content && state.content.length);
  }

  function exportHtml() {
    if (!canExport()) {
      toast('Open a file before exporting.', 'warning');
      return;
    }
    const clone = els.preview.cloneNode(true);
    // Strip app chrome: copy buttons / pills, search highlights, error notes,
    // heading anchor affordances (v1.4). The lightbox lives outside the preview,
    // so it is never in this clone; emoji are Unicode text and stay (content).
    clone.querySelectorAll('.pre-tools').forEach(function (node) { node.remove(); });
    clone.querySelectorAll('.mermaid-error').forEach(function (node) { node.remove(); });
    clone.querySelectorAll('.heading-anchor').forEach(function (node) { node.remove(); });
    clone.querySelectorAll('mark.search-hit').forEach(function (m) {
      m.replaceWith(document.createTextNode(m.textContent));
    });
    clone.normalize();

    // Mermaid diagram styles live in a constructed stylesheet (CSSOM), so they
    // are NOT inline in the clone — inline the collected CSS into the export so
    // diagrams render correctly in the standalone file.
    const mermaidStyle = mermaidCss.length ? '\n' + mermaidCss.join('\n') : '';

    const title = baseName(state.fileName || 'document');
    const docHtml =
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml(title) + '</title>\n' +
      '<style>\n' + EXPORT_CSS + '\n' + EXPORT_CSS_V12 + mermaidStyle + '\n</style>\n' +
      '</head>\n<body>\n' +
      '<article class="markdown-body">\n' + clone.innerHTML + '\n</article>\n' +
      '</body>\n</html>\n';

    const blob = new Blob([docHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Exported ' + title + '.html', 'success');
  }

  function baseName(name) {
    return String(name).replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') || 'document';
  }

  // ---------------------------------------------------------------------
  // Presentation mode (v1.5) — transient fullscreen overlay
  // ---------------------------------------------------------------------

  function canPresent() {
    return state.view !== 'landing' && !!(state.content && state.content.length);
  }

  // Make sure any pending Mermaid diagrams in the source preview are rendered to
  // SVG BEFORE we clone the DOM into slides — otherwise a diagram that lands on
  // a later slide would clone as a bare code block. Mermaid CSS lives in the
  // document-wide adopted stylesheet, so the cloned SVGs are styled in the deck.
  async function ensureMermaidRendered() {
    if (!window.mermaid) return;
    if (!els.preview.querySelector('pre[data-lang="mermaid"]')) return;
    renderToken += 1;
    try { await renderMermaid(renderToken); } catch (e) { /* leave as code block */ }
  }

  // Build slides by walking the already-sanitized preview DOM and splitting at
  // top-level <hr> separators. Frontmatter '---' is already stripped before
  // render, so there is no phantom leading slide. Nested <hr> (inside a list or
  // blockquote) is not a direct child here, so it never splits.
  function buildSlides() {
    const clone = els.preview.cloneNode(true);
    // Strip chrome that must never appear on slides.
    clone.querySelectorAll('.pre-tools').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('.heading-anchor').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('.mermaid-error').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('mark.search-hit').forEach(function (m) {
      m.replaceWith(document.createTextNode(m.textContent));
    });

    const result = [];
    let content = null;
    const startSlide = function () {
      const slide = document.createElement('div');
      slide.className = 'slide';
      content = document.createElement('div');
      content.className = 'slide-content preview-content';
      slide.appendChild(content);
      result.push(slide);
    };
    startSlide();

    const nodes = [].slice.call(clone.childNodes);
    nodes.forEach(function (node) {
      if (node.nodeType === 1 && node.tagName === 'HR') {
        startSlide();  // top-level separator -> begin a new slide
      } else {
        content.appendChild(node);
      }
    });

    // Drop empty slides (e.g. consecutive separators) but keep media-only ones.
    return result.filter(function (s) {
      const c = s.firstChild;
      if (!c) return false;
      return (c.textContent && c.textContent.trim() !== '') ||
        c.querySelector('img, svg, pre, table');
    });
  }

  async function enterPresent() {
    if (presenting || !canPresent() || !els.present) return;
    // Presenting is its own modal surface — close the other overlays/chrome.
    closeSearch();
    setTocOpen(false);
    closeLightbox();

    await ensureMermaidRendered();

    slides = buildSlides();
    if (!slides.length) {
      const blank = document.createElement('div');
      blank.className = 'slide';
      blank.appendChild(document.createElement('div')).className = 'slide-content preview-content';
      slides = [blank];
    }

    els.presentStage.textContent = '';
    slides.forEach(function (s) { els.presentStage.appendChild(s); });

    presenting = true;
    els.present.hidden = false;
    showSlide(0);

    // Standard Fullscreen API; gracefully fall back to the maximized in-page
    // overlay (already full-viewport via CSS) if it rejects or is unsupported.
    if (els.present.requestFullscreen) {
      els.present.requestFullscreen().catch(function () { /* in-page overlay */ });
    }
    if (els.presentClose) els.presentClose.focus();
  }

  function exitPresent() {
    if (!presenting) return;
    presenting = false;
    els.present.hidden = true;
    els.presentStage.textContent = '';
    slides = [];
    slideIdx = 0;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () { /* ignore */ });
    }
    // Return focus to the Present button in the prior (still-intact) view.
    if (els.presentBtn && !els.presentBtn.hidden) els.presentBtn.focus();
  }

  function showSlide(i) {
    if (!slides.length) return;
    if (i < 0) i = 0;
    if (i >= slides.length) i = slides.length - 1;  // clamp at ends (no wrap)
    slideIdx = i;
    slides.forEach(function (s, idx) { s.classList.toggle('active', idx === i); });
    if (els.presentCounter) {
      els.presentCounter.textContent = (i + 1) + ' / ' + slides.length;
    }
    slides[i].scrollTop = 0;
  }

  function nextSlide() { showSlide(slideIdx + 1); }
  function prevSlide() { showSlide(slideIdx - 1); }

  function onPresentKey(e) {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); exitPresent(); }
    else if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' ||
             k === 'Spacebar' || k === 'PageDown') { e.preventDefault(); nextSlide(); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); prevSlide(); }
    else if (k === 'Home') { e.preventDefault(); showSlide(0); }
    else if (k === 'End') { e.preventDefault(); showSlide(slides.length - 1); }
  }

  // Click anywhere on the slide stage advances — but not on links or controls.
  function onStageClick(e) {
    if (e.target.closest && e.target.closest('a, button')) return;
    nextSlide();
  }

  // Leaving fullscreen via the browser's own Esc / F11 must also exit cleanly.
  function onFullscreenChange() {
    if (presenting && !document.fullscreenElement) exitPresent();
  }

  // ---------------------------------------------------------------------
  // View mode
  // ---------------------------------------------------------------------

  function setView(view) {
    state.view = view;
    els.body.setAttribute('data-view', view);

    if (view === 'landing') {
      els.paneSource.hidden = true;
      els.panePreview.hidden = true;
      els.seg.hidden = true;
      els.fileBadge.hidden = true;
      if (els.exportBtn) els.exportBtn.hidden = true;
      if (els.presentBtn) els.presentBtn.hidden = true;
      if (els.tocToggle) els.tocToggle.hidden = true;
      closeSearch();
      setTocOpen(false);
      if (els.footerLanding) els.footerLanding.hidden = false;
      if (els.footerStats) els.footerStats.hidden = true;
      return;
    }

    els.seg.hidden = false;
    els.fileBadge.hidden = false;
    if (els.exportBtn) els.exportBtn.hidden = false;
    if (els.presentBtn) els.presentBtn.hidden = false;
    // The Contents toggle and live search only apply when the preview shows.
    refreshTocControls();
    if (!previewVisible()) closeSearch();
    if (els.footerLanding) els.footerLanding.hidden = true;
    if (els.footerStats) els.footerStats.hidden = false;

    if (view === 'preview') {
      els.paneSource.hidden = true;
      els.panePreview.hidden = false;
    } else if (view === 'edit') {
      els.paneSource.hidden = false;
      els.panePreview.hidden = true;
    } else {
      // split
      els.paneSource.hidden = false;
      els.panePreview.hidden = false;
    }

    // Update segmented control
    const buttons = els.seg.querySelectorAll('button[data-view]');
    buttons.forEach((b) => {
      const isActive = b.getAttribute('data-view') === view;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', String(isActive));
    });
  }

  // ---------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------

  async function openFile() {
    if (!hasFSAccess) {
      openFileFallback();
      return;
    }

    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Markdown files',
            accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'] },
          },
        ],
        excludeAcceptAllOption: false,
        multiple: false,
      });
      state.fileHandle = handle;
      await loadFromHandle();
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user cancelled
      toast('Could not open file: ' + (err.message || err), 'danger');
    }
  }

  function openFileFallback() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.mkd,text/markdown';
    input.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      state.fileHandle = null; // no handle in fallback - read-only
      state.fileName = f.name;
      state.fileSize = f.size;
      state.lastModified = f.lastModified || 0;
      stopPolling(); // no handle to watch in the fallback path
      const text = await f.text();
      onContentLoaded(text);
      toast('Read-only mode: file open works, save needs a Chromium browser.', 'warning');
    });
    input.click();
  }

  async function loadFromHandle() {
    if (!state.fileHandle) return;
    try {
      const file = await state.fileHandle.getFile();
      state.fileName = file.name;
      state.fileSize = file.size;
      state.lastModified = file.lastModified || 0;
      const text = await file.text();
      onContentLoaded(text);
      // Remember this file for the landing "Recent" list (FSAA handles only).
      addRecent(state.fileHandle, state.fileName);
      // Begin watching the handle for external changes.
      startPolling();
    } catch (err) {
      toast('Could not read file: ' + (err.message || err), 'danger');
    }
  }

  function onContentLoaded(text) {
    state.content = text;
    state.lastSavedContent = text;
    state.isDirty = false;
    els.source.value = text;
    els.fileName.textContent = state.fileName || 'untitled.md';
    els.fileBadge.classList.remove('dirty');
    hideChangedBar();
    renderPreview();
    setStatus('Loaded', 'just now');
    if (state.view === 'landing') setView('split');
    // Restore the per-file scroll position after layout settles (v1.4).
    setTimeout(restoreScroll, 60);
  }

  async function saveFile() {
    if (!state.fileHandle) {
      if (!hasFSAccess) {
        toast('Save needs the File System Access API. Try Chrome, Edge, or Opera.', 'warning');
      } else {
        toast('Open a file first.', 'warning');
      }
      return;
    }
    try {
      const writable = await state.fileHandle.createWritable();
      await writable.write(state.content);
      await writable.close();
      state.lastSavedContent = state.content;
      state.isDirty = false;
      els.fileBadge.classList.remove('dirty');
      // Refresh size + mtime after save so our own write is not mistaken for
      // an external change by the auto-reload poller.
      try {
        const f = await state.fileHandle.getFile();
        state.fileSize = f.size;
        state.lastModified = f.lastModified || state.lastModified;
        updateStats();
      } catch (e) { /* ignore */ }
      hideChangedBar();
      setStatus('Saved', 'just now');
      toast('Saved', 'success');
    } catch (err) {
      toast('Could not save: ' + (err.message || err), 'danger');
    }
  }

  async function reloadFile() {
    if (!state.fileHandle) {
      toast('Nothing to reload - open a file first.', 'warning');
      return;
    }
    if (state.isDirty) {
      const ok = confirm('You have unsaved changes. Reload from disk and lose them?');
      if (!ok) return;
    }
    await loadFromHandle();
    toast('Reloaded from disk', 'success');
  }

  // ---------------------------------------------------------------------
  // Recent files (FileSystemFileHandle persistence via IndexedDB, v1.3)
  // ---------------------------------------------------------------------
  //
  // FileSystemFileHandle objects are structured-cloneable, so we can stash
  // them in IndexedDB and re-open the file on a later visit (after a one-tap
  // permission re-grant — the browser will not silently re-grant disk access).
  // localStorage cannot hold handles (string-only), which is why this uses IDB.

  const DB_NAME = 'pinion-md';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const RECENT_KEY = 'recent';
  const RECENT_MAX = 8;

  // Recent files only work where we get a real handle (Chromium FSAA).
  const recentSupported = hasFSAccess && typeof window.indexedDB !== 'undefined';

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      let req;
      try {
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function recentLoad() {
    if (!recentSupported) return Promise.resolve([]);
    return idbGet(RECENT_KEY).then(function (list) {
      return Array.isArray(list) ? list : [];
    }).catch(function () { return []; });
  }

  // Add (or bump to front) a handle in the recent list, de-duped by identity.
  async function addRecent(handle, name) {
    if (!recentSupported || !handle) return;
    try {
      const list = await recentLoad();
      const kept = [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        let same = false;
        try {
          if (e.handle && handle.isSameEntry) same = await handle.isSameEntry(e.handle);
        } catch (err) { same = false; }
        if (!same) kept.push(e);
      }
      kept.unshift({ handle: handle, name: name || 'untitled.md', ts: nowTs() });
      const trimmed = kept.slice(0, RECENT_MAX);
      await idbSet(RECENT_KEY, trimmed);
      renderRecent(trimmed);
    } catch (err) {
      /* recent list is best-effort; never block file loading */
    }
  }

  async function clearRecent() {
    if (!recentSupported) return;
    try { await idbSet(RECENT_KEY, []); } catch (err) { /* ignore */ }
    // Forgetting recent files also drops their saved scroll positions (v1.4),
    // so the scroll store can't outlive the file list it shadows.
    try { await idbSet(SCROLL_KEY, []); } catch (err) { /* ignore */ }
    renderRecent([]);
  }

  // A monotonic-ish timestamp without Date.now() (kept ordering-only).
  let tsCounter = 0;
  function nowTs() { tsCounter += 1; return tsCounter; }

  function renderRecent(list) {
    if (!els.recent || !els.recentList) return;
    const items = list || [];
    els.recentList.textContent = '';
    if (!recentSupported || !items.length) {
      els.recent.hidden = true;
      return;
    }
    items.forEach(function (entry) {
      const li = document.createElement('li');
      li.className = 'recent-item';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'recent-open';
      open.innerHTML =
        '<svg class="recent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/></svg>';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'recent-name';
      nameSpan.textContent = entry.name || 'untitled.md';
      open.appendChild(nameSpan);
      open.addEventListener('click', function () { openFromRecent(entry); });
      li.appendChild(open);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'recent-remove';
      remove.setAttribute('aria-label', 'Remove ' + (entry.name || 'file') + ' from recent');
      remove.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      remove.addEventListener('click', function (ev) {
        ev.stopPropagation();
        removeRecent(entry);
      });
      li.appendChild(remove);

      els.recentList.appendChild(li);
    });
    els.recent.hidden = false;
  }

  async function removeRecent(entry) {
    if (!recentSupported) return;
    try {
      const list = await recentLoad();
      const kept = [];
      for (let i = 0; i < list.length; i++) {
        let same = false;
        try {
          if (entry.handle && list[i].handle && entry.handle.isSameEntry) {
            same = await entry.handle.isSameEntry(list[i].handle);
          }
        } catch (err) { same = false; }
        if (!same) kept.push(list[i]);
      }
      await idbSet(RECENT_KEY, kept);
      renderRecent(kept);
    } catch (err) { /* ignore */ }
  }

  // Re-grant disk permission (requires the click gesture) and open the file.
  async function openFromRecent(entry) {
    if (!entry || !entry.handle) return;
    const handle = entry.handle;
    if (state.isDirty) {
      const ok = confirm('You have unsaved changes. Open "' +
        (entry.name || 'this file') + '" and lose them?');
      if (!ok) return;
    }
    try {
      const granted = await ensureReadPermission(handle);
      if (!granted) {
        toast('Permission denied for "' + (entry.name || 'file') + '".', 'warning');
        return;
      }
      state.fileHandle = handle;
      await loadFromHandle();   // refreshes recency, starts polling
    } catch (err) {
      if (err && err.name === 'NotFoundError') {
        toast('That file could not be found — it may have moved or been deleted.', 'danger');
        removeRecent(entry);
      } else {
        toast('Could not open file: ' + (err.message || err), 'danger');
      }
    }
  }

  async function ensureReadPermission(handle) {
    if (!handle || !handle.queryPermission) return true; // older impls: assume ok
    const opts = { mode: 'read' };
    try {
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      if ((await handle.requestPermission(opts)) === 'granted') return true;
    } catch (err) { /* fall through */ }
    return false;
  }

  // ---------------------------------------------------------------------
  // Auto-reload on external file change (poll the handle, v1.3)
  // ---------------------------------------------------------------------

  function startPolling() {
    stopPolling();
    if (!state.fileHandle) return;
    pollTimer = setInterval(pollTick, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function pollTick() {
    if (!state.fileHandle || pollInFlight) return;
    if (typeof document.hidden === 'boolean' && document.hidden) return; // pause when tab hidden
    pollInFlight = true;
    try {
      const file = await state.fileHandle.getFile();
      const mtime = file.lastModified || 0;
      if (mtime && mtime !== state.lastModified) {
        if (!state.isDirty) {
          // Clean buffer: pull the new content in silently.
          await loadFromHandle();
          toast('Reloaded — file changed on disk', 'info');
        } else {
          // Dirty buffer: never clobber. Advance mtime so we alert once per
          // distinct external change, and surface a non-blocking choice.
          state.lastModified = mtime;
          showChangedBar();
        }
      }
    } catch (err) {
      // Permission revoked or file removed mid-session: stop polling quietly.
      stopPolling();
    } finally {
      pollInFlight = false;
    }
  }

  function showChangedBar() {
    if (els.changedBar) els.changedBar.hidden = false;
  }
  function hideChangedBar() {
    if (els.changedBar) els.changedBar.hidden = true;
  }

  async function reloadDiscard() {
    hideChangedBar();
    await loadFromHandle();
    toast('Reloaded from disk', 'success');
  }

  // ---------------------------------------------------------------------
  // Footer status
  // ---------------------------------------------------------------------

  function setStatus(label, value) {
    if (els.footStatusLabel) els.footStatusLabel.textContent = label;
    if (els.footStatus) els.footStatus.textContent = value;
  }

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------

  let toastTimer = null;
  function toast(msg, kind) {
    els.toastMsg.textContent = msg;
    els.toast.setAttribute('data-kind', kind || 'info');
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3500);
  }

  // ---------------------------------------------------------------------
  // Edit-mode wiring (debounced preview update)
  // ---------------------------------------------------------------------

  let renderTimer = null;
  function onSourceInput() {
    state.content = els.source.value;
    state.isDirty = (state.content !== state.lastSavedContent);
    els.fileBadge.classList.toggle('dirty', state.isDirty);
    if (state.isDirty) setStatus('Unsaved', 'edited');

    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      if (state.view === 'split' || state.view === 'preview') {
        renderPreview();
      } else {
        updateStats();
      }
    }, 100);
  }

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------

  function onKeyDown(e) {
    // While presenting, the deck owns the keyboard (arrows/Space/Home/End/Esc).
    if (presenting) { onPresentKey(e); return; }

    const mod = e.ctrlKey || e.metaKey;
    if (!mod) {
      if (e.key === 'Escape') {
        // Lightbox takes precedence over the find bar when both could be open.
        if (els.lightbox && !els.lightbox.hidden) {
          e.preventDefault();
          closeLightbox();
        } else if (search.open) {
          e.preventDefault();
          closeSearch();
        }
      }
      return;
    }
    const key = e.key.toLowerCase();

    if (key === 'p') {
      // Ctrl/Cmd+P enters presentation mode (overrides browser print), only
      // when a file is open. Esc / the close button exit back to the prior view.
      if (!canPresent()) return;
      e.preventDefault();
      enterPresent();
    } else if (key === 'f') {
      // In-app find, only when there is a rendered document to search.
      if (state.view === 'landing') return;
      e.preventDefault();
      openSearch();
    } else if (key === 'o') {
      e.preventDefault();
      openFile();
    } else if (key === 's') {
      e.preventDefault();
      saveFile();
    } else if (key === 'r') {
      // Only intercept if a file is open; otherwise let the browser reload.
      if (state.fileHandle) {
        e.preventDefault();
        reloadFile();
      }
    } else if (key === 'e') {
      e.preventDefault();
      if (state.view === 'landing') return;
      if (state.view === 'preview') setView('edit');
      else setView('preview'); // 'edit' or 'split' -> preview
    }
  }

  // ---------------------------------------------------------------------
  // Drag-and-drop open (Feature 2, v1.2)
  // ---------------------------------------------------------------------

  function isMarkdownName(name) {
    return /\.(md|markdown|mdown|mkd)$/i.test(name || '');
  }

  function dtHasFiles(dt) {
    if (!dt || !dt.types) return false;
    for (let i = 0; i < dt.types.length; i++) {
      if (dt.types[i] === 'Files') return true;
    }
    return false;
  }

  function showDropOverlay() { if (els.dropOverlay) els.dropOverlay.hidden = false; }
  function hideDropOverlay() { if (els.dropOverlay) els.dropOverlay.hidden = true; }

  function onDragEnter(e) {
    if (!dtHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth += 1;
    showDropOverlay();
  }
  function onDragOver(e) {
    if (!dtHasFiles(e.dataTransfer)) return;
    e.preventDefault();  // required so the 'drop' event fires
    try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { /* ignore */ }
  }
  function onDragLeave(e) {
    if (!dtHasFiles(e.dataTransfer)) return;
    dragDepth -= 1;
    if (dragDepth <= 0) { dragDepth = 0; hideDropOverlay(); }
  }

  async function onDrop(e) {
    e.preventDefault();
    dragDepth = 0;
    hideDropOverlay();
    const dt = e.dataTransfer;
    if (!dt) return;

    // Snapshot synchronously — DataTransfer is only live during the event.
    const files = dt.files ? [].slice.call(dt.files) : [];
    const items = dt.items
      ? [].slice.call(dt.items).filter(function (it) { return it.kind === 'file'; })
      : [];
    const mdFiles = files.filter(function (f) { return isMarkdownName(f.name); });

    if (!files.length && !items.length) return;
    if (!mdFiles.length) {
      toast('Only markdown files (.md, .markdown, .mdown, .mkd) can be opened.', 'warning');
      return;
    }
    if (state.isDirty) {
      const ok = confirm('You have unsaved changes. Open the dropped file and lose them?');
      if (!ok) return;
    }

    const firstName = mdFiles[0].name;
    let opened = false;

    // Preferred path: get a FileSystemFileHandle so save-in-place still works.
    // getAsFile()/getAsFileSystemHandle() are called before any await so the
    // DataTransferItem is still live.
    if (hasFSAccess && items.length && typeof items[0].getAsFileSystemHandle === 'function') {
      for (let i = 0; i < items.length; i++) {
        const f = items[i].getAsFile && items[i].getAsFile();
        if (!f || !isMarkdownName(f.name)) continue;
        const handlePromise = items[i].getAsFileSystemHandle();
        try {
          const handle = await handlePromise;
          if (handle && handle.kind === 'file') {
            state.fileHandle = handle;
            await loadFromHandle();
            opened = true;
          }
        } catch (err) {
          /* fall through to read-only path */
        }
        break;
      }
    }

    if (!opened) {
      const f = mdFiles[0];
      state.fileHandle = null;
      state.fileName = f.name;
      state.fileSize = f.size;
      try {
        const text = await f.text();
        onContentLoaded(text);
        if (!hasFSAccess) {
          toast('Read-only mode: file open works, save needs a Chromium browser.', 'warning');
        }
      } catch (err) {
        toast('Could not read dropped file: ' + (err.message || err), 'danger');
        return;
      }
    }

    if (mdFiles.length > 1 || files.length > 1) {
      toast('Opened "' + firstName + '" — one file opens at a time.', 'info');
    }
  }

  // ---------------------------------------------------------------------
  // Split-view sync scroll (Feature 3, v1.2)
  // ---------------------------------------------------------------------

  // Scroll-percentage mapping with a re-entrancy guard so a programmatic scroll
  // on one pane does not bounce back through the other pane's handler.
  function syncScroll(srcEl, dstEl) {
    if (state.view !== 'split') return;  // no-op outside Split
    if (isSyncing || !srcEl || !dstEl) return;
    isSyncing = true;
    const sMax = srcEl.scrollHeight - srcEl.clientHeight;
    const ratio = sMax > 0 ? (srcEl.scrollTop / sMax) : 0;
    const dMax = dstEl.scrollHeight - dstEl.clientHeight;
    dstEl.scrollTop = ratio * dMax;
    requestAnimationFrame(function () { isSyncing = false; });
  }

  // ---------------------------------------------------------------------
  // Theme: Light / Dark / System (v1.6)
  // ---------------------------------------------------------------------
  //
  // Preference is one of 'light' | 'dark' | 'system', persisted in localStorage
  // (a synchronous one-key read — right tool for a scalar even though recent
  // files use IndexedDB; avoids an async flash on load). The RESOLVED appearance
  // is written to <html data-theme="light|dark"> so CSS remaps the tokens.
  //
  // FOUC/CSP tradeoff: strict CSP forbids the usual inline head-script that would
  // set the theme before first paint. Mitigation — the CSS @media block gives
  // system-preference users the correct theme with zero JS (no flash); only a
  // user who picked an explicit override *differing* from their OS may see a
  // brief flash before app.js runs. Accepted rather than weakening CSP.

  const THEME_KEY = 'pinion-theme';
  let themePref = 'system';
  const darkMql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function systemPrefersDark() { return !!(darkMql && darkMql.matches); }

  function isDark() {
    if (themePref === 'dark') return true;
    if (themePref === 'light') return false;
    return systemPrefersDark();
  }

  function loadThemePref() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') themePref = v;
    } catch (e) { /* storage blocked — default 'system' */ }
  }

  function saveThemePref() {
    try { localStorage.setItem(THEME_KEY, themePref); } catch (e) { /* ignore */ }
  }

  // Resolve and apply: set data-theme to the concrete appearance so both the
  // forced selector and (for system) a consistent attribute are in play, refresh
  // the toggle UI, sync the mobile theme-color meta, and re-theme Mermaid.
  function applyTheme(rerenderDiagrams) {
    const dark = isDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    updateThemeButton();
    updateThemeColorMeta(dark);
    if (window.mermaid) {
      reinitMermaid();
      // Rebuild the preview so existing diagrams re-render with new colors.
      if (rerenderDiagrams && state.view !== 'landing' && els.preview &&
          els.preview.querySelector('.mermaid-diagram, pre[data-lang="mermaid"]')) {
        renderPreview();
      }
    }
  }

  const ICON_SUN =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const ICON_MOON =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const ICON_MONITOR =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';

  function updateThemeButton() {
    if (!els.themeBtn) return;
    let ico, label;
    if (themePref === 'light') { ico = ICON_SUN; label = 'Theme: Light'; }
    else if (themePref === 'dark') { ico = ICON_MOON; label = 'Theme: Dark'; }
    else { ico = ICON_MONITOR; label = 'Theme: System'; }
    if (els.themeIco) els.themeIco.innerHTML = ico;
    els.themeBtn.setAttribute('aria-label', label);
    els.themeBtn.setAttribute('title', label);
  }

  // Mobile browser UI / PWA title-bar color tracks the active chrome surface.
  function updateThemeColorMeta(dark) {
    if (!els.themeColorMeta) return;
    els.themeColorMeta.setAttribute('content', dark ? '#11151C' : '#2B4A8B');
  }

  // Cycle Light -> Dark -> System -> Light.
  function cycleTheme() {
    themePref = themePref === 'light' ? 'dark'
              : themePref === 'dark' ? 'system'
              : 'light';
    saveThemePref();
    applyTheme(true);
    const word = themePref.charAt(0).toUpperCase() + themePref.slice(1);
    toast('Theme: ' + word, 'info');
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function init() {
    // Apply the saved theme as early as possible to minimize FOUC (v1.6).
    loadThemePref();
    applyTheme(false);
    if (els.themeBtn) els.themeBtn.addEventListener('click', cycleTheme);
    // Follow the OS live while in 'system' mode.
    if (darkMql) {
      const onSysChange = function () { if (themePref === 'system') applyTheme(true); };
      if (darkMql.addEventListener) darkMql.addEventListener('change', onSysChange);
      else if (darkMql.addListener) darkMql.addListener(onSysChange);
    }

    if (!hasFSAccess) {
      els.unsupported.hidden = false;
    }

    els.openTop.addEventListener('click', openFile);
    els.openLanding.addEventListener('click', openFile);

    els.seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (!btn) return;
      const v = btn.getAttribute('data-view');
      if (v) setView(v);
    });

    els.source.addEventListener('input', onSourceInput);
    if (els.copyAll) els.copyAll.addEventListener('click', copyAllSource);

    if (els.tocToggle) els.tocToggle.addEventListener('click', toggleToc);
    if (els.toc) els.toc.addEventListener('click', onTocClick);
    if (els.exportBtn) els.exportBtn.addEventListener('click', exportHtml);

    if (els.searchInput) {
      els.searchInput.addEventListener('input', onSearchInput);
      els.searchInput.addEventListener('keydown', onSearchKeyDown);
    }
    if (els.searchNext) els.searchNext.addEventListener('click', nextHit);
    if (els.searchPrev) els.searchPrev.addEventListener('click', prevHit);
    if (els.searchClose) els.searchClose.addEventListener('click', closeSearch);

    if (previewScroll) {
      let spyTick = false;
      previewScroll.addEventListener('scroll', function () {
        scheduleSaveScroll();  // v1.4: remember scroll position per file
        if (spyTick) return;
        spyTick = true;
        requestAnimationFrame(function () { spyTick = false; updateScrollspy(); });
      });
    }

    // In-pane navigation for footnote jump / back-reference links.
    if (els.preview) els.preview.addEventListener('click', onPreviewAnchorClick);

    // Split-view sync scroll: each pane drives the other (guarded re-entrancy).
    if (els.source && previewScroll) {
      els.source.addEventListener('scroll', function () {
        scheduleSaveScroll();  // v1.4
        syncScroll(els.source, previewScroll);
      });
      previewScroll.addEventListener('scroll', function () { syncScroll(previewScroll, els.source); });
    }

    // Image lightbox (v1.4): close on backdrop click or the close button.
    if (els.lightbox) els.lightbox.addEventListener('click', onLightboxClick);
    if (els.lightboxClose) els.lightboxClose.addEventListener('click', closeLightbox);

    // Presentation mode (v1.5): enter button + deck navigation/exit.
    if (els.presentBtn) els.presentBtn.addEventListener('click', enterPresent);
    if (els.presentNext) els.presentNext.addEventListener('click', nextSlide);
    if (els.presentPrev) els.presentPrev.addEventListener('click', prevSlide);
    if (els.presentClose) els.presentClose.addEventListener('click', exitPresent);
    if (els.presentStage) els.presentStage.addEventListener('click', onStageClick);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    // Drag-and-drop open (additive to the Open File button).
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    // Recent files (v1.3): populate the landing list and wire Clear.
    if (els.recentClear) els.recentClear.addEventListener('click', clearRecent);
    if (recentSupported) {
      recentLoad().then(renderRecent).catch(function () { /* ignore */ });
    }

    // Auto-reload banner buttons (v1.3).
    if (els.changedReload) els.changedReload.addEventListener('click', reloadDiscard);
    if (els.changedDismiss) els.changedDismiss.addEventListener('click', hideChangedBar);

    // When the tab regains focus, check the file immediately (polling pauses
    // while hidden) so a change made elsewhere is picked up without delay.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) pollTick();
    });

    document.addEventListener('keydown', onKeyDown);

    // PWA install affordance. The button starts hidden; it reveals only after
    // beforeinstallprompt fires, which Chromium does once install criteria
    // are met. On browsers that never fire the event (iOS Safari, Firefox)
    // the button stays hidden, which is the correct degraded behavior.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (els.install) els.install.hidden = false;
    });

    if (els.install) {
      els.install.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        els.install.hidden = true;
        deferredInstallPrompt.prompt();
        try {
          await deferredInstallPrompt.userChoice;
        } catch (err) {
          console.warn('Install prompt userChoice failed:', err);
        }
        // Spec: the prompt can be used at most once. Drop the reference;
        // Chromium will fire beforeinstallprompt again on a future visit if
        // the user dismissed without installing.
        deferredInstallPrompt = null;
      });
    }

    window.addEventListener('appinstalled', () => {
      if (els.install) els.install.hidden = true;
      deferredInstallPrompt = null;
    });

    setView('landing');

    // Register service worker for PWA offline support.
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
          console.warn('Service worker registration failed:', err);
        });
      });
    }

    // PWA file handling: when launched from the OS "Open with" handler for a
    // markdown file, route the launched handle through the existing load path
    // (so polling, Recent list, and save-back all work).
    if ('launchQueue' in window && 'LaunchParams' in window && 'files' in LaunchParams.prototype) {
      window.launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams || !launchParams.files || !launchParams.files.length) return;
        try {
          state.fileHandle = launchParams.files[0];   // FileSystemFileHandle — writable, so Save works
          await loadFromHandle();
        } catch (err) {
          toast('Could not open launched file: ' + (err.message || err), 'danger');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
