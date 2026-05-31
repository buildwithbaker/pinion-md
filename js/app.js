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

    // Post-render passes over the sanitized DOM (never over raw markup).
    decorateCodeBlocks();
    processFootnotes();
    decorateHeadings();
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

  // ---------------------------------------------------------------------
  // Mermaid diagrams (async post-render pass, Feature 1)
  // ---------------------------------------------------------------------

  // Indigo-only theme variables — no bright default Mermaid colors.
  const MERMAID_THEME_VARS = {
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
        themeVariables: MERMAID_THEME_VARS,
      });
      mermaidReady = true;
    } catch (e) {
      // On init failure diagrams simply remain as code blocks.
    }
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
      try {
        const out = await window.mermaid.render(id, src);
        svg = out && out.svg ? out.svg : '';
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
      // Mermaid hardened this SVG under securityLevel:'strict'.
      wrap.innerHTML = svg;

      // CSP-safe styling: lift the SVG's <style> into a constructed stylesheet
      // (CSSOM rules are exempt from the inline-style CSP restriction), then
      // drop the now-redundant inline <style> from the SVG. The diagram id on
      // the SVG scopes those rules, so styling survives.
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
    // Strip app chrome: copy buttons / pills, search highlights, error notes.
    clone.querySelectorAll('.pre-tools').forEach(function (node) { node.remove(); });
    clone.querySelectorAll('.mermaid-error').forEach(function (node) { node.remove(); });
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
      const text = await file.text();
      onContentLoaded(text);
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
    renderPreview();
    setStatus('Loaded', 'just now');
    if (state.view === 'landing') setView('split');
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
      // Refresh size after save
      try {
        const f = await state.fileHandle.getFile();
        state.fileSize = f.size;
        updateStats();
      } catch (e) { /* ignore */ }
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
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) {
      if (e.key === 'Escape' && search.open) {
        e.preventDefault();
        closeSearch();
      }
      return;
    }
    const key = e.key.toLowerCase();

    if (key === 'f') {
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
  // Init
  // ---------------------------------------------------------------------

  function init() {
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
        if (spyTick) return;
        spyTick = true;
        requestAnimationFrame(function () { spyTick = false; updateScrollspy(); });
      });
    }

    // In-pane navigation for footnote jump / back-reference links.
    if (els.preview) els.preview.addEventListener('click', onPreviewAnchorClick);

    // Split-view sync scroll: each pane drives the other (guarded re-entrancy).
    if (els.source && previewScroll) {
      els.source.addEventListener('scroll', function () { syncScroll(els.source, previewScroll); });
      previewScroll.addEventListener('scroll', function () { syncScroll(previewScroll, els.source); });
    }

    // Drag-and-drop open (additive to the Open File button).
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
