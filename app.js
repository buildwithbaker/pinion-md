/**
 * Markdown Mate - app.js
 * Scope 1: open a .md file, render it, read it.
 *
 * Dependencies (vendored, loaded via <script> tags in index.html):
 *   - marked       (window.marked)       - vendor/marked.min.js
 *   - DOMPurify    (window.DOMPurify)    - vendor/purify.min.js
 *   - highlight.js (window.hljs)         - vendor/highlight.min.js
 *
 * Scope 2 note: state.fileHandle is stored deliberately so reload
 * and write-back can be added without restructuring this file.
 */

'use strict';

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------
const state = {
  fileHandle: null,
  fileName: null,
};

// ----------------------------------------------------------------
// DOM references (cached at startup)
// ----------------------------------------------------------------
const els = {
  landing:      document.getElementById('js-landing'),
  reader:       document.getElementById('js-reader'),
  openLanding:  document.getElementById('js-open-landing'),
  openToolbar:  document.getElementById('js-open-toolbar'),
  fileBadge:    document.getElementById('js-file-badge'),
  filename:     document.getElementById('js-filename'),
  doc:          document.getElementById('js-doc'),
  unsupported:  document.getElementById('js-unsupported'),
  toast:        document.getElementById('js-toast'),
  toastMsg:     document.getElementById('js-toast-msg'),
};

// ----------------------------------------------------------------
// Check for File System Access API support
// ----------------------------------------------------------------
if (!('showOpenFilePicker' in window)) {
  els.unsupported.hidden = false;
  els.openLanding.disabled = true;
  els.openLanding.style.opacity = '0.4';
  els.openLanding.style.cursor = 'not-allowed';
}

// ----------------------------------------------------------------
// Configure marked
// ----------------------------------------------------------------
marked.use({
  gfm: true,       // GitHub Flavored Markdown (tables, task lists, strikethrough)
  breaks: false,   // Require two newlines for a paragraph break (standard markdown)
});

// ----------------------------------------------------------------
// Configure DOMPurify
// Sanitizes marked output before injecting into the DOM.
// Adds target="_blank" + rel="noopener noreferrer" to all links.
// (Security: per html-best-practices module-05 — never innerHTML
//  untrusted content without sanitisation.)
// ----------------------------------------------------------------
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') || '';
    const isExternal = href.startsWith('http://') || href.startsWith('https://');
    if (isExternal) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

const PURIFY_CONFIG = {
  ADD_ATTR: ['class', 'target', 'rel'],  // allow class for hljs, target/rel for links
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
};

// ----------------------------------------------------------------
// Core functions
// ----------------------------------------------------------------

/**
 * Open a file picker filtered to .md / .markdown files.
 * Stores the FileSystemFileHandle for scope 2 (reload, write-back).
 */
async function openFile() {
  if (!('showOpenFilePicker' in window)) return;

  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{
        description: 'Markdown files',
        accept: {
          'text/markdown': ['.md', '.markdown'],
          'text/plain':    ['.md', '.markdown', '.txt'],
        },
      }],
      excludeAcceptAllOption: true,
      multiple: false,
    });

    state.fileHandle = handle;
    state.fileName = handle.name;
    await loadAndRender();

  } catch (err) {
    if (err.name === 'AbortError') return;  // user cancelled — not an error
    console.error('Markdown Mate: file open failed', err);
    showToast('Could not open that file. Try a different one.');
  }
}

/**
 * Read the file from the stored handle and render it.
 * Scope 2: call this again from a Reload button.
 */
async function loadAndRender() {
  try {
    const file = await state.fileHandle.getFile();
    const text = await file.text();
    render(text);
  } catch (err) {
    console.error('Markdown Mate: file read failed', err);
    showToast('Could not read the file.');
  }
}

/**
 * Parse markdown -> sanitize HTML -> inject -> highlight code blocks.
 * @param {string} markdown
 */
function render(markdown) {
  const rawHtml   = marked.parse(markdown);
  const cleanHtml = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);

  els.doc.innerHTML = cleanHtml;

  // Syntax-highlight all fenced code blocks
  els.doc.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });

  // Update UI
  els.filename.textContent = state.fileName;
  els.fileBadge.hidden = false;
  els.landing.hidden = true;
  els.reader.hidden = false;

  // Scroll reader content to top
  els.doc.parentElement.scrollTo(0, 0);
  window.scrollTo(0, 0);
}

// ----------------------------------------------------------------
// Toast (lightweight error feedback)
// ----------------------------------------------------------------
let toastTimer = null;

function showToast(message, durationMs = 4000) {
  clearTimeout(toastTimer);
  els.toastMsg.textContent = message;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, durationMs);
}

// ----------------------------------------------------------------
// Event listeners
// ----------------------------------------------------------------
els.openLanding.addEventListener('click', openFile);
els.openToolbar.addEventListener('click', openFile);

// Handle link clicks inside the rendered doc
// (DOMPurify adds target/rel but this ensures the correct browser behaviour)
els.doc.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('#')) return;
  // External links already have target="_blank" from DOMPurify hook — let them open naturally.
  // Relative links (images, anchors) would resolve against the app URL, not the file.
  // For scope 1, relative links are just allowed through without special handling.
});

// ----------------------------------------------------------------
// Service worker registration
// ----------------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Markdown Mate: service worker registration failed', err);
    });
  });
}
