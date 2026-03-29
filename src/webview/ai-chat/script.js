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
let attachedFiles = [];   // {path, uri, content?, language?}
let ddActiveIdx = -1;
let ddVisible = false;

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
    // Hide loader, show welcome content
    const loader = document.getElementById('loader');
    const welcomeContent = document.getElementById('welcome-content');
    if (loader) loader.style.display = 'none';
    if (welcomeContent) welcomeContent.style.display = 'flex';
  }
  if (msg.type === 'editorContext') {
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
  // --- Extension host: add file as context chip ---
  if (msg.type === 'addFileContext') {
    const d = msg.data;
    if (!attachedFiles.find(f => f.path === d.path)) {
      attachedFiles.push({ path: d.path, uri: d.uri, content: d.content, language: d.language });
      renderChips();
    }
  }
  // --- Extension host: inline chat (Ctrl+I) — prefill question and auto-send ---
  if (msg.type === 'inlineChat') {
    const d = msg.data;
    welcomeEl.style.display = 'none';
    const question = d.question;
    history.push({ role: 'user', content: question });
    appendMessage('user', esc(question), false, true);
    saveState();
    streamResponse(question, { language: d.language, fileName: d.fileName, selection: d.selection, context: d.context }, []);
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
  // Only match if @ is at start or preceded by whitespace
  if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return null;
  const query = before.slice(atIdx + 1);
  // Abort if query contains whitespace (user moved on)
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
    '<span class="dd-icon">\u{1F4C4}</span><span class="dd-path">' + esc(f.path) + '</span></div>'
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

  // Replace @query with empty (file goes to chip)
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
  // Request file content
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
  // Dropdown navigation
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
  // Normal send
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); requestSend(); }
});

function updateDdActive(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === ddActiveIdx));
  if (items[ddActiveIdx]) items[ddActiveIdx].scrollIntoView({ block: 'nearest' });
}

// =====================================================================
// Chat logic
// =====================================================================
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

  // Build display: show user message with context badges
  let userHtml = esc(question);
  if (files.length) {
    userHtml += '<div class="context-badge">\u{1F4CE} ';
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
  sendIcon.textContent = '\u25A0';
  sendLabel.textContent = 'Stop';
  sendBtn.classList.add('stop');

  abortController = new AbortController();
  const el = appendMessage('assistant', '', true);
  const contentEl = el.querySelector('.content');
  let full = '';

  // Build file context payload
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
  sendIcon.textContent = '\u25B6';
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
    ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 13c0-2.8 2.2-5 5-5h2c2.8 0 5 2.2 5 5v1H2v-1z"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.8 3.6L14 5.4l-3 2.9.7 4.1L8 10.5 4.3 12.4l.7-4.1-3-2.9 4.2-.8z"/></svg>';
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
    '<div class="avatar">\u26A0</div>' +
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
      const codeEscaped = escAttr(code.trim());
      return '<div class="code-block" data-lang="' + escAttr(l) + '" data-code="' + codeEscaped + '">' +
        '<div class="code-bar"><span class="code-lang">' + esc(l) + '</span>' +
        '<div class="code-actions">' +
        '<button class="act-apply" title="Apply to editor">\u2713 Apply</button>' +
        '<button class="act-insert" title="Insert at cursor">\u2193 Insert</button>' +
        '<button class="act-copy" title="Copy to clipboard">\u2398 Copy</button>' +
        '<button class="act-newfile" title="Open in new file">\u{1F4C4} New File</button>' +
        '<button class="act-dismiss" title="Dismiss">\u2717</button>' +
        '</div></div>' +
        '<pre><code>' + escHtml(code.trim()) + '</code></pre></div>';
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
  block.classList.add(cls);
  setTimeout(() => block.classList.remove(cls), 800);
}

function bindCodeBlockActions(container) {
  container.querySelectorAll('.code-block').forEach(block => {
    // Apply
    block.querySelector('.act-apply')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      vscode.postMessage({ type: 'applyCode', code });
      flashBlock(block, 'applied');
    });
    // Insert
    block.querySelector('.act-insert')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      vscode.postMessage({ type: 'insertCode', code });
      flashBlock(block, 'applied');
    });
    // Copy
    block.querySelector('.act-copy')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      navigator.clipboard.writeText(code).then(() => {
        const btn = block.querySelector('.act-copy');
        btn.textContent = '\u2713 Copied!';
        setTimeout(() => btn.textContent = '\u2398 Copy', 1500);
      });
    });
    // New file
    block.querySelector('.act-newfile')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      const lang = block.dataset.lang || 'plaintext';
      vscode.postMessage({ type: 'newFileWithCode', code, language: lang });
      flashBlock(block, 'applied');
    });
    // Dismiss
    block.querySelector('.act-dismiss')?.addEventListener('click', () => {
      flashBlock(block, 'rejected');
      setTimeout(() => {
        block.style.opacity = '0.4';
        block.style.pointerEvents = 'none';
      }, 600);
    });
  });
}
