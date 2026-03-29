// ---------------------------------------------------------------------------
// Lazy Language Loader
//
// Dynamically imports grammar + language-feature extensions on demand when a
// file of the matching language is first opened. This keeps the initial bundle
// small — grammars are loaded as separate async chunks.
//
// Usage: call `initLanguageLoader(vscode)` after the workbench is initialised.
// ---------------------------------------------------------------------------

type Loader = () => Promise<unknown>;

// Map: VS Code languageId → dynamic import(s) for grammar + language features.
// Each entry is loaded at most once (guarded by `loaded` set).
const grammarLoaders: Record<string, Loader[]> = {
  // --- Web essentials (grammar + language features) ---
  typescript: [
    () => import('@codingame/monaco-vscode-typescript-basics-default-extension'),
    () => import('@codingame/monaco-vscode-typescript-language-features-default-extension'),
  ],
  typescriptreact: [
    () => import('@codingame/monaco-vscode-typescript-basics-default-extension'),
    () => import('@codingame/monaco-vscode-typescript-language-features-default-extension'),
  ],
  javascript: [
    () => import('@codingame/monaco-vscode-javascript-default-extension'),
    () => import('@codingame/monaco-vscode-typescript-language-features-default-extension'),
  ],
  javascriptreact: [
    () => import('@codingame/monaco-vscode-javascript-default-extension'),
    () => import('@codingame/monaco-vscode-typescript-language-features-default-extension'),
  ],
  json: [
    () => import('@codingame/monaco-vscode-json-default-extension'),
    () => import('@codingame/monaco-vscode-json-language-features-default-extension'),
  ],
  jsonc: [
    () => import('@codingame/monaco-vscode-json-default-extension'),
    () => import('@codingame/monaco-vscode-json-language-features-default-extension'),
    () => import('@codingame/monaco-vscode-configuration-editing-default-extension'),
  ],
  html: [
    () => import('@codingame/monaco-vscode-html-default-extension'),
    () => import('@codingame/monaco-vscode-html-language-features-default-extension'),
    () => import('@codingame/monaco-vscode-emmet-default-extension'),
  ],
  css: [
    () => import('@codingame/monaco-vscode-css-default-extension'),
    () => import('@codingame/monaco-vscode-css-language-features-default-extension'),
  ],
  scss: [
    () => import('@codingame/monaco-vscode-scss-default-extension'),
    () => import('@codingame/monaco-vscode-css-language-features-default-extension'),
  ],
  less: [
    () => import('@codingame/monaco-vscode-less-default-extension'),
    () => import('@codingame/monaco-vscode-css-language-features-default-extension'),
  ],
  markdown: [
    () => import('@codingame/monaco-vscode-markdown-basics-default-extension'),
    () => import('@codingame/monaco-vscode-markdown-language-features-default-extension'),
  ],

  // --- Popular languages (grammar only) ---
  python: [() => import('@codingame/monaco-vscode-python-default-extension')],
  java: [() => import('@codingame/monaco-vscode-java-default-extension')],
  csharp: [() => import('@codingame/monaco-vscode-csharp-default-extension')],
  cpp: [() => import('@codingame/monaco-vscode-cpp-default-extension')],
  c: [() => import('@codingame/monaco-vscode-cpp-default-extension')],
  go: [() => import('@codingame/monaco-vscode-go-default-extension')],
  rust: [() => import('@codingame/monaco-vscode-rust-default-extension')],
  ruby: [() => import('@codingame/monaco-vscode-ruby-default-extension')],
  php: [() => import('@codingame/monaco-vscode-php-default-extension')],
  swift: [() => import('@codingame/monaco-vscode-swift-default-extension')],
  dart: [() => import('@codingame/monaco-vscode-dart-default-extension')],
  kotlin: [() => import('@codingame/monaco-vscode-java-default-extension')],

  // --- Shell / DevOps ---
  shellscript: [() => import('@codingame/monaco-vscode-shellscript-default-extension')],
  powershell: [() => import('@codingame/monaco-vscode-powershell-default-extension')],
  bat: [() => import('@codingame/monaco-vscode-bat-default-extension')],
  dockerfile: [() => import('@codingame/monaco-vscode-docker-default-extension')],
  yaml: [() => import('@codingame/monaco-vscode-yaml-default-extension')],
  xml: [() => import('@codingame/monaco-vscode-xml-default-extension')],
  ini: [() => import('@codingame/monaco-vscode-ini-default-extension')],
  makefile: [() => import('@codingame/monaco-vscode-make-default-extension')],

  // --- Data / Query ---
  sql: [() => import('@codingame/monaco-vscode-sql-default-extension')],
  r: [() => import('@codingame/monaco-vscode-r-default-extension')],
  julia: [() => import('@codingame/monaco-vscode-julia-default-extension')],
  lua: [() => import('@codingame/monaco-vscode-lua-default-extension')],

  // --- Markup / Templates ---
  latex: [() => import('@codingame/monaco-vscode-latex-default-extension')],
  pug: [() => import('@codingame/monaco-vscode-pug-default-extension')],
  jade: [() => import('@codingame/monaco-vscode-pug-default-extension')],
  handlebars: [() => import('@codingame/monaco-vscode-handlebars-default-extension')],
  razor: [() => import('@codingame/monaco-vscode-razor-default-extension')],
  restructuredtext: [() => import('@codingame/monaco-vscode-restructuredtext-default-extension')],

  // --- Other languages ---
  perl: [() => import('@codingame/monaco-vscode-perl-default-extension')],
  clojure: [() => import('@codingame/monaco-vscode-clojure-default-extension')],
  coffeescript: [() => import('@codingame/monaco-vscode-coffeescript-default-extension')],
  fsharp: [() => import('@codingame/monaco-vscode-fsharp-default-extension')],
  groovy: [() => import('@codingame/monaco-vscode-groovy-default-extension')],
  hlsl: [() => import('@codingame/monaco-vscode-hlsl-default-extension')],
  shaderlab: [() => import('@codingame/monaco-vscode-shaderlab-default-extension')],
  'objective-c': [() => import('@codingame/monaco-vscode-objective-c-default-extension')],
  'objective-cpp': [() => import('@codingame/monaco-vscode-objective-c-default-extension')],
  vb: [() => import('@codingame/monaco-vscode-vb-default-extension')],
  diff: [() => import('@codingame/monaco-vscode-diff-default-extension')],
  log: [() => import('@codingame/monaco-vscode-log-default-extension')],
};

// File-extension fallback for when languageId is generic (e.g., "plaintext")
const extToLang: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact',
  '.js': 'javascript', '.jsx': 'javascriptreact',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.jsonc': 'jsonc',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.md': 'markdown', '.markdown': 'markdown',
  '.py': 'python', '.pyw': 'python',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.cs': 'csharp',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cxx': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.dart': 'dart',
  '.sh': 'shellscript', '.bash': 'shellscript', '.zsh': 'shellscript',
  '.ps1': 'powershell', '.psm1': 'powershell',
  '.bat': 'bat', '.cmd': 'bat',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml', '.svg': 'xml', '.xsl': 'xml',
  '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
  '.sql': 'sql',
  '.r': 'r',
  '.jl': 'julia',
  '.lua': 'lua',
  '.tex': 'latex', '.bib': 'latex',
  '.pug': 'pug', '.jade': 'jade',
  '.hbs': 'handlebars',
  '.cshtml': 'razor',
  '.rst': 'restructuredtext',
  '.pl': 'perl', '.pm': 'perl',
  '.clj': 'clojure', '.cljs': 'clojure',
  '.coffee': 'coffeescript',
  '.fs': 'fsharp', '.fsx': 'fsharp',
  '.groovy': 'groovy', '.gradle': 'groovy',
  '.hlsl': 'hlsl',
  '.shader': 'shaderlab',
  '.m': 'objective-c', '.mm': 'objective-cpp',
  '.vb': 'vb',
  '.diff': 'diff', '.patch': 'diff',
  '.log': 'log',
  '.dockerfile': 'dockerfile',
  '.makefile': 'makefile', '.mk': 'makefile',
};

const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

async function loadLanguage(langId: string): Promise<void> {
  if (loaded.has(langId)) return;
  if (loading.has(langId)) return loading.get(langId);

  const loaders = grammarLoaders[langId];
  if (!loaders) return;

  const p = Promise.all(loaders.map((fn) => fn().catch((e) => {
    console.warn(`[LanguageLoader] Failed to load ${langId}:`, e);
  }))).then(() => {
    loaded.add(langId);
    loading.delete(langId);
    console.log(`[LanguageLoader] Loaded: ${langId}`);
  });

  loading.set(langId, p);
  return p;
}

/**
 * Initialise the lazy language loader.
 * Call once after the Monaco workbench is ready.
 */
export function initLanguageLoader(vscodeApi: typeof import('vscode')): void {
  const handleDocument = (doc: { languageId: string; uri: { path: string } }) => {
    let langId = doc.languageId;

    // If plaintext, try to resolve from file extension
    if (langId === 'plaintext' || !grammarLoaders[langId]) {
      const ext = '.' + doc.uri.path.split('/').pop()?.split('.').pop()?.toLowerCase();
      const resolved = extToLang[ext];
      if (resolved) langId = resolved;
    }

    loadLanguage(langId);
  };

  // Watch for documents being opened
  vscodeApi.workspace.onDidOpenTextDocument(handleDocument);

  // Load grammars for already-open documents
  for (const doc of vscodeApi.workspace.textDocuments) {
    handleDocument(doc);
  }
}
