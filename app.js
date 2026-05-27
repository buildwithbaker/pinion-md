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
  };

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
    marked.use({ renderer });
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
    const rawHtml = marked.parse(state.content || '');
    const clean = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['target', 'rel'],
    });
    els.preview.innerHTML = clean;

    // External-looking links open in a new tab safely.
    const links = els.preview.querySelectorAll('a[href]');
    links.forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });

    updateStats();
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
      if (els.footerLanding) els.footerLanding.hidden = false;
      if (els.footerStats) els.footerStats.hidden = true;
      return;
    }

    els.seg.hidden = false;
    els.fileBadge.hidden = false;
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
    if (!mod) return;
    const key = e.key.toLowerCase();

    if (key === 'o') {
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
