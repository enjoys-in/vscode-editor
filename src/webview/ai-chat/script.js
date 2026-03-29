const vscode = acquireVsCodeApi();
const CHAT_ENDPOINT = __CHAT_ENDPOINT__;

let providers = [];
let selectedProviderId = '';
let selectedModelId = '';
let history = [];
let abortController = null;
let isStreaming = false;

/* --- @file autocomplete state --- */
let workspaceFiles = [];
let attachedFiles = [];
let ddActiveIdx = -1;
let ddVisible = false;

/* --- Last editor context for smart apply --- */
let lastEditorContext = null;

const providerSelect = document.getElementById('provider-select');
const modelSelect = document.getElementById('model-select');
const messagesEl = document.getElementById('messages');
const welcomeEl = document.getElementById('welcome');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const sendIcon = document.getElementById('send-icon');
const sendLabel = document.getElementById('send-label');
const clearBtn = document.getElementById('clear-btn');
const chipsEl = document.getElementById('context-chips');
const dropdownEl = document.getElementById('file-dropdown');

// SVG icons
const ICON_SEND = '<svg viewBox="0 0 16 16"><path d="M1 1.5l14 6.5-14 6.5V9l10-1-10-1V1.5z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';

// --- Init ---
vscode.postMessage({ type: 'getProviders' });
vscode.postMessage({ type: 'getWorkspaceFiles' });

// --- Hint clicks ---
document.querySelectorAll('.hint').forEach(h => {
  h.addEventListener('click', () => {
    inputEl.value = h.dataset.q;
    requestSend();
  });
});

// --- Message from extension host ---
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'providers') {
    providers = msg.data.filter(p => p.available);
    renderProviders();
    const loader = document.getElementById('loader');
    const welcomeContent = document.getElementById('welcome-content');
    if (loader) loader.style.display = 'none';
    if (welcomeContent) welcomeContent.style.display = 'flex';
  }
  if (msg.type === 'editorContext') {
    lastEditorContext = msg.data;
    sendChat(msg.data);
  }
  if (msg.type === 'workspaceFiles') {
    workspaceFiles = msg.data || [];
  }
  if (msg.type === 'fileContent') {
    const af = attachedFiles.find(f => f.path === msg.data.path);
    if (af) { af.content = msg.data.content; af.language = msg.data.language; }
  }
  if (msg.type === 'error') {
    addSystemMessage(msg.message);
  }
  if (msg.type === 'addFileContext') {
    const d = msg.data;
    if (!attachedFiles.find(f => f.path === d.path)) {
      attachedFiles.push({ path: d.path, uri: d.uri, content: d.content, language: d.language });
      renderChips();
    }
  }
  if (msg.type === 'inlineChat') {
    const d = msg.data;
    lastEditorContext = { language: d.language, fileName: d.fileName, selection: d.selection, context: d.context };
    welcomeEl.style.display = 'none';
    const question = d.question;
    history.push({ role: 'user', content: question });
    appendMessage('user', esc(question), false, true);
    saveState();
    streamResponse(question, lastEditorContext, []);
  }
  if (msg.type === 'applyResult') {
    // Extension host confirms apply success — update block state
    const block = document.querySelector('.code-block[data-apply-id="' + msg.applyId + '"]');
    if (block) {
      if (msg.success) {
        flashBlock(block, 'applied');
      } else {
        flashBlock(block, 'rejected');
      }
    }
  }
});

// --- Provider/Model selectors ---
function renderProviders() {
  providerSelect.innerHTML = providers.map(p =>
    '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'
  ).join('');
  const saved = getState();
  if (saved.providerId && providers.find(p => p.id === saved.providerId)) {
    providerSelect.value = saved.providerId;
  }
  selectedProviderId = providerSelect.value;
  renderModels();
}

function renderModels() {
  const provider = providers.find(p => p.id === selectedProviderId);
  if (!provider) return;
  modelSelect.innerHTML = provider.models.map(m =>
    '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'
  ).join('');
  const saved = getState();
  if (saved.modelId && provider.models.find(m => m.id === saved.modelId)) {
    modelSelect.value = saved.modelId;
  }
  selectedModelId = modelSelect.value;
  saveState();
}

providerSelect.addEventListener('change', () => { selectedProviderId = providerSelect.value; renderModels(); });
modelSelect.addEventListener('change', () => { selectedModelId = modelSelect.value; saveState(); });

// --- State ---
function getState() { return vscode.getState() || {}; }
function saveState() { vscode.setState({ providerId: selectedProviderId, modelId: selectedModelId, history }); }

// --- Restore ---
(function restore() {
  const s = getState();
  if (s.history && s.history.length) {
    history = s.history;
    welcomeEl.style.display = 'none';
    history.forEach(m => appendMessage(m.role, m.content, false));
    scrollToBottom();
  }
})();

// =====================================================================
// @file autocomplete
// =====================================================================
function getAtQuery() {
  const v = inputEl.value;
  const cur = inputEl.selectionStart;
  const before = v.slice(0, cur);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1) return null;
  if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return null;
  const query = before.slice(atIdx + 1);
  if (/\s/.test(query)) return null;
  return { atIdx, query };
}

function filterFiles(query) {
  if (!query) return workspaceFiles.slice(0, 30);
  const q = query.toLowerCase();
  return workspaceFiles.filter(f => f.path.toLowerCase().includes(q)).slice(0, 30);
}

function showDropdown(items) {
  if (!items.length) {
    dropdownEl.innerHTML = '<div class="dd-empty">No matching files</div>';
    dropdownEl.classList.add('visible');
    ddVisible = true;
    ddActiveIdx = -1;
    return;
  }
  ddActiveIdx = 0;
  dropdownEl.innerHTML = items.map((f, i) =>
    '<div class="dd-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '" data-path="' + escAttr(f.path) + '" data-uri="' + escAttr(f.uri) + '">' +
    '<span class="dd-icon"><svg viewBox="0 0 16 16"><path d="M13.5 1H4L2 3v10.5A1.5 1.5 0 0 0 3.5 15h10a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1zM13 13H5V4h8v9z"/></svg></span><span class="dd-path">' + esc(f.path) + '</span></div>'
  ).join('');
  dropdownEl.classList.add('visible');
  ddVisible = true;
  dropdownEl.querySelectorAll('.dd-item').forEach(el => {
    el.addEventListener('click', () => selectDropdownItem(el));
  });
}

function hideDropdown() {
  dropdownEl.classList.remove('visible');
  dropdownEl.innerHTML = '';
  ddVisible = false;
  ddActiveIdx = -1;
}

function selectDropdownItem(el) {
  const path = el.dataset.path;
  const uri = el.dataset.uri;
  if (!path) return;
  const aq = getAtQuery();
  if (aq) {
    const before = inputEl.value.slice(0, aq.atIdx);
    const after = inputEl.value.slice(inputEl.selectionStart);
    inputEl.value = before + after;
    inputEl.selectionStart = inputEl.selectionEnd = before.length;
  }
  addFileChip(path, uri);
  hideDropdown();
  inputEl.focus();
}

function addFileChip(path, uri) {
  if (attachedFiles.find(f => f.path === path)) return;
  attachedFiles.push({ path, uri });
  renderChips();
  vscode.postMessage({ type: 'getFileContent', path, uri });
}

function removeFileChip(path) {
  attachedFiles = attachedFiles.filter(f => f.path !== path);
  renderChips();
}

function renderChips() {
  chipsEl.innerHTML = attachedFiles.map(f =>
    '<span class="file-chip" data-path="' + escAttr(f.path) + '">' +
    '<span class="chip-name" title="' + escAttr(f.path) + '">' + esc(f.path.split('/').pop()) + '</span>' +
    '<span class="chip-remove" title="Remove">\u00D7</span></span>'
  ).join('');
  chipsEl.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFileChip(btn.parentElement.dataset.path);
    });
  });
}

inputEl.addEventListener('input', () => {
  autoResize();
  const aq = getAtQuery();
  if (aq) {
    const items = filterFiles(aq.query);
    showDropdown(items);
  } else {
    hideDropdown();
  }
});

inputEl.addEventListener('keydown', e => {
  if (ddVisible) {
    const items = dropdownEl.querySelectorAll('.dd-item[data-path]');
    if (e.key === 'ArrowDown') { e.preventDefault(); ddActiveIdx = Math.min(ddActiveIdx + 1, items.length - 1); updateDdActive(items); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); ddActiveIdx = Math.max(ddActiveIdx - 1, 0); updateDdActive(items); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && items.length && ddActiveIdx >= 0) {
      e.preventDefault();
      selectDropdownItem(items[ddActiveIdx]);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); hideDropdown(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); requestSend(); }
});

function updateDdActive(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === ddActiveIdx));
  if (items[ddActiveIdx]) items[ddActiveIdx].scrollIntoView({ block: 'nearest' });
}

// =====================================================================
// Diff computation (simple line-based)
// =====================================================================
function computeDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Simple LCS-based diff
  const m = oldLines.length, n = newLines.length;
  // For large files, use a simplified approach
  if (m + n > 2000) {
    // Fallback: show all old as removed, all new as added
    const result = [];
    oldLines.forEach(l => result.push({ type: 'del', text: l }));
    newLines.forEach(l => result.push({ type: 'add', text: l }));
    return result;
  }

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'ctx', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', text: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'del', text: oldLines[i - 1] });
      i--;
    }
  }
  return result;
}

function renderDiffHtml(diffLines) {
  return '<div class="diff-view">' +
    diffLines.map(d =>
      '<div class="diff-line diff-' + d.type + '">' + escHtml(d.text) + '</div>'
    ).join('') +
    '</div>';
}

// =====================================================================
// Chat logic
// =====================================================================
let applyIdCounter = 0;

function requestSend() {
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;
  inputEl.value = '';
  autoResize();
  hideDropdown();
  window._pendingQuestion = text;
  window._pendingFiles = [...attachedFiles];
  attachedFiles = [];
  renderChips();
  vscode.postMessage({ type: 'getEditorContext' });
}

function sendChat(editorCtx) {
  const question = window._pendingQuestion || '';
  if (!question) return;
  const files = window._pendingFiles || [];
  window._pendingQuestion = null;
  window._pendingFiles = null;
  welcomeEl.style.display = 'none';

  let userHtml = esc(question);
  if (files.length) {
    userHtml += '<div class="context-badge"><svg style="width:10px;height:10px;fill:currentColor;vertical-align:middle" viewBox="0 0 16 16"><path d="M13.9 2.5L10.2 1 5.8 2.8 2 1.5v12l3.8 1.3L10.2 13l3.7 1.5V2.5z"/></svg> ';
    userHtml += files.map(f => '<span class="cb-file">' + esc(f.path.split('/').pop()) + '</span>').join(' ');
    userHtml += '</div>';
  }

  history.push({ role: 'user', content: question });
  appendMessage('user', userHtml, false, true);
  saveState();
  streamResponse(question, editorCtx, files);
}

async function streamResponse(question, ctx, files) {
  isStreaming = true;
  sendIcon.innerHTML = ICON_STOP;
  sendLabel.textContent = 'Stop';
  sendBtn.classList.add('stop');

  abortController = new AbortController();
  const el = appendMessage('assistant', '', true);
  const contentEl = el.querySelector('.content');
  let full = '';

  const fileContext = files
    .filter(f => f.content)
    .map(f => ({ path: f.path, language: f.language || 'plaintext', content: f.content.slice(0, 8000) }));

  try {
    const res = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        question,
        language: ctx.language,
        fileName: ctx.fileName || '',
        context: ctx.context.slice(0, 4000),
        selection: ctx.selection.slice(0, 2000),
        fileContext,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        history: history.slice(0, -1).slice(-20),
      }),
    });

    if (!res.ok) throw new Error((await res.text()) || 'HTTP ' + res.status);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6);
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          const tok = p.choices?.[0]?.delta?.content || p.content || p.text || p.token || '';
          if (tok) { full += tok; contentEl.innerHTML = renderMarkdown(full) + '<span class="cursor"></span>'; scrollToBottom(); }
        } catch {
          if (d && d !== '[DONE]') { full += d; contentEl.innerHTML = renderMarkdown(full) + '<span class="cursor"></span>'; scrollToBottom(); }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') full += '\n\n*\u2014 Stopped*';
    else full = '**Error:** ' + err.message;
  }

  contentEl.innerHTML = renderMarkdown(full);
  bindCodeBlockActions(contentEl);
  history.push({ role: 'assistant', content: full });
  saveState();
  isStreaming = false;
  abortController = null;
  sendIcon.innerHTML = ICON_SEND;
  sendLabel.textContent = 'Send';
  sendBtn.classList.remove('stop');
  scrollToBottom();
}

// --- Buttons ---
sendBtn.addEventListener('click', () => {
  if (isStreaming && abortController) abortController.abort();
  else requestSend();
});

function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px';
}

clearBtn.addEventListener('click', () => {
  history = [];
  messagesEl.innerHTML = '';
  welcomeEl.style.display = 'flex';
  messagesEl.appendChild(welcomeEl);
  attachedFiles = [];
  renderChips();
  saveState();
});

// --- DOM helpers ---
function appendMessage(role, content, streaming, rawHtml) {
  const svg = role === 'user'
    ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 13c0-2.8 2.2-5 5-5h2c2.8 0 5 2.2 5 5v1H2v-1z"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.8 3.6L14 5.4l-3 2.9.7 4.1L8 10.5 4.3 12.4l.7-4.1-3-2.9 4.2-.8z"/></svg>';
  const label = role === 'user' ? 'You' : 'Assistant';
  const div = document.createElement('div');
  div.className = 'msg ' + role;

  const rendered = rawHtml ? content : (content ? renderMarkdown(content) : '');
  div.innerHTML =
    '<div class="avatar">' + svg + '</div>' +
    '<div class="body"><div class="name">' + label + '</div>' +
    '<div class="content">' + rendered +
    (streaming ? '<span class="cursor"></span>' : '') + '</div></div>';
  messagesEl.appendChild(div);
  if (!streaming && !rawHtml) bindCodeBlockActions(div);
  scrollToBottom();
  return div;
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML =
    '<div class="avatar"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 8l7 7 7-7-7-7zm0 2.4L12.6 8 8 12.6 3.4 8 8 3.4z"/></svg></div>' +
    '<div class="body"><div class="name">System</div>' +
    '<div class="content" style="color:var(--vscode-descriptionForeground,#888)">' + esc(text) + '</div></div>';
  messagesEl.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// --- Markdown ---
function renderMarkdown(text) {
  return text
    .replace(/```(\w*)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const l = lang || 'code';
      const aid = ++applyIdCounter;
      const codeEscaped = escAttr(code.trim());

      // Compute diff if we have editor context
      let diffHtml = '';
      if (lastEditorContext) {
        const original = lastEditorContext.selection || lastEditorContext.context || '';
        if (original.trim()) {
          const diff = computeDiff(original, code.trim());
          const hasChanges = diff.some(d => d.type !== 'ctx');
          if (hasChanges) {
            diffHtml = renderDiffHtml(diff);
          }
        }
      }

      const diffAttr = diffHtml ? ' data-has-diff="1"' : '';
      return '<div class="code-block" data-lang="' + escAttr(l) + '" data-code="' + codeEscaped + '" data-apply-id="' + aid + '"' + diffAttr + '>' +
        '<div class="code-bar"><span class="code-lang">' + esc(l) + '</span>' +
        (diffHtml ? '<div class="view-toggle"><button class="tog-code active" title="Code">Code</button><button class="tog-diff" title="Diff">Diff</button></div>' : '') +
        '<div class="code-actions">' +
        '<button class="act-accept" title="Accept & format">\u2713 Accept</button>' +
        '<button class="act-undo" title="Undo apply">\u21A9 Undo</button>' +
        '<button class="act-insert" title="Insert at cursor">\u2193 Insert</button>' +
        '<button class="act-copy" title="Copy">\u2398 Copy</button>' +
        '<button class="act-newfile" title="New file">\u2B1A New</button>' +
        '<button class="act-dismiss" title="Dismiss">\u2717</button>' +
        '</div></div>' +
        '<div class="code-content">' +
        '<pre><code>' + escHtml(code.trim()) + '</code></pre>' +
        (diffHtml ? '<div class="diff-container" style="display:none">' + diffHtml + '</div>' : '') +
        '</div></div>';
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, '<br>');
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// =====================================================================
// Code block action handlers
// =====================================================================
function getCodeFromBlock(block) {
  return (block.dataset.code || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function flashBlock(block, cls) {
  block.classList.remove('applied', 'rejected', 'undone');
  block.classList.add(cls);
  setTimeout(() => {
    if (cls !== 'applied') block.classList.remove(cls);
  }, 800);
}

function bindCodeBlockActions(container) {
  container.querySelectorAll('.code-block').forEach(block => {
    // --- View toggle (Code / Diff) ---
    const togCode = block.querySelector('.tog-code');
    const togDiff = block.querySelector('.tog-diff');
    const preEl = block.querySelector('pre');
    const diffEl = block.querySelector('.diff-container');

    if (togCode && togDiff && preEl && diffEl) {
      togCode.addEventListener('click', () => {
        togCode.classList.add('active');
        togDiff.classList.remove('active');
        preEl.style.display = '';
        diffEl.style.display = 'none';
      });
      togDiff.addEventListener('click', () => {
        togDiff.classList.add('active');
        togCode.classList.remove('active');
        preEl.style.display = 'none';
        diffEl.style.display = '';
      });
    }

    // --- Accept: smart apply (whole file or selection) + format ---
    block.querySelector('.act-accept')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      const applyId = block.dataset.applyId;
      // Determine mode: if we had a selection, replace selection; otherwise replace whole file
      const mode = (lastEditorContext && lastEditorContext.selection && lastEditorContext.selection.trim())
        ? 'selection' : 'wholeFile';
      vscode.postMessage({ type: 'applyCode', code, applyId, mode, format: true });
      flashBlock(block, 'applied');
    });

    // --- Undo ---
    block.querySelector('.act-undo')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'undoApply' });
      flashBlock(block, 'undone');
    });

    // --- Insert at cursor ---
    block.querySelector('.act-insert')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      vscode.postMessage({ type: 'insertCode', code });
      flashBlock(block, 'applied');
    });

    // --- Copy ---
    block.querySelector('.act-copy')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      navigator.clipboard.writeText(code).then(() => {
        const btn = block.querySelector('.act-copy');
        const old = btn.textContent;
        btn.textContent = '\u2713 Copied!';
        setTimeout(() => btn.textContent = old, 1500);
      });
    });

    // --- New file ---
    block.querySelector('.act-newfile')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      const lang = block.dataset.lang || 'plaintext';
      vscode.postMessage({ type: 'newFileWithCode', code, language: lang });
      flashBlock(block, 'applied');
    });

    // --- Dismiss ---
    block.querySelector('.act-dismiss')?.addEventListener('click', () => {
      flashBlock(block, 'rejected');
      setTimeout(() => {
        block.style.opacity = '0.4';
        block.style.pointerEvents = 'none';
      }, 600);
    });
  });
}
