// ---------------------------------------------------------------------------
// Setup — matches demo/src/setup.common.ts + demo/src/setup.workbench.ts
// ---------------------------------------------------------------------------

import {
  IEditorOverrideServices,
  IWorkbenchConstructionOptions,
  LogLevel,
  initialize as initializeMonacoService,
} from '@codingame/monaco-vscode-api';
import { EnvironmentOverride } from '@codingame/monaco-vscode-api/workbench';
import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions';
import getConfigurationServiceOverride, {
  IStoredWorkspace,
  initUserConfiguration,
} from '@codingame/monaco-vscode-configuration-service-override';
import getKeybindingsServiceOverride, {
  initUserKeybindings,
} from '@codingame/monaco-vscode-keybindings-service-override';
import getFilesServiceOverride, {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
  createIndexedDBProviders,
} from '@codingame/monaco-vscode-files-service-override';
import * as monaco from 'monaco-editor';
import * as vscode from 'vscode';

// Service overrides (matching demo/src/setup.common.ts)
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override';
import getNotificationsServiceOverride from '@codingame/monaco-vscode-notifications-service-override';
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';
import getSecretStorageServiceOverride from '@codingame/monaco-vscode-secret-storage-service-override';
import getAuthenticationServiceOverride from '@codingame/monaco-vscode-authentication-service-override';
import getBannerServiceOverride from '@codingame/monaco-vscode-view-banner-service-override';
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override';
import getTitleBarServiceOverride from '@codingame/monaco-vscode-view-title-bar-service-override';
import getPreferencesServiceOverride from '@codingame/monaco-vscode-preferences-service-override';
import getSnippetServiceOverride from '@codingame/monaco-vscode-snippets-service-override';
import getOutputServiceOverride from '@codingame/monaco-vscode-output-service-override';
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override';
import getMarkersServiceOverride from '@codingame/monaco-vscode-markers-service-override';
import getAccessibilityServiceOverride from '@codingame/monaco-vscode-accessibility-service-override';
import getLanguageDetectionWorkerServiceOverride from '@codingame/monaco-vscode-language-detection-worker-service-override';
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override';
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import getRemoteAgentServiceOverride from '@codingame/monaco-vscode-remote-agent-service-override';
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getWorkspaceTrustOverride from '@codingame/monaco-vscode-workspace-trust-service-override';
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override';
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override';
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override';
import getOutlineServiceOverride from '@codingame/monaco-vscode-outline-service-override';
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override';
import getExtensionGalleryServiceOverride from '@codingame/monaco-vscode-extension-gallery-service-override';
import getTerminalServiceOverride from '@codingame/monaco-vscode-terminal-service-override';
// import getViewsServiceOverride from '@codingame/monaco-vscode-views-service-override';
import getChatServiceOverride from '@codingame/monaco-vscode-chat-service-override';
import getAiServiceOverride from '@codingame/monaco-vscode-ai-service-override';

// Default extensions — only themes + icons + UI extensions loaded eagerly
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import '@codingame/monaco-vscode-theme-seti-default-extension';
import '@codingame/monaco-vscode-references-view-default-extension';

// User defaults (imported as raw strings)
import defaultConfiguration from './user/configuration.json?raw';
import defaultKeybindings from './user/keybindings.json?raw';

let initialized = false;

// ---------------------------------------------------------------------------
// Lazy language loader
//
// Grammars + language features are loaded on demand when a file of that
// language is first opened. This keeps the initial bundle small.
// ---------------------------------------------------------------------------

type Loader = () => Promise<unknown>;

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

  // --- Other ---
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
  'search-result': [() => import('@codingame/monaco-vscode-search-result-default-extension')],
};

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
  '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php',
  '.swift': 'swift', '.dart': 'dart',
  '.sh': 'shellscript', '.bash': 'shellscript', '.zsh': 'shellscript',
  '.ps1': 'powershell', '.psm1': 'powershell',
  '.bat': 'bat', '.cmd': 'bat',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml', '.svg': 'xml', '.xsl': 'xml',
  '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
  '.sql': 'sql', '.r': 'r', '.jl': 'julia', '.lua': 'lua',
  '.tex': 'latex', '.bib': 'latex',
  '.pug': 'pug', '.jade': 'jade',
  '.hbs': 'handlebars', '.cshtml': 'razor',
  '.rst': 'restructuredtext',
  '.pl': 'perl', '.pm': 'perl',
  '.clj': 'clojure', '.cljs': 'clojure',
  '.coffee': 'coffeescript',
  '.fs': 'fsharp', '.fsx': 'fsharp',
  '.groovy': 'groovy', '.gradle': 'groovy',
  '.hlsl': 'hlsl', '.shader': 'shaderlab',
  '.m': 'objective-c', '.mm': 'objective-cpp',
  '.vb': 'vb',
  '.diff': 'diff', '.patch': 'diff',
  '.log': 'log',
  '.dockerfile': 'dockerfile',
  '.makefile': 'makefile', '.mk': 'makefile',
};

const loadedLangs = new Set<string>();
const loadingLangs = new Map<string, Promise<void>>();

async function loadLanguage(langId: string): Promise<void> {
  if (loadedLangs.has(langId)) return;
  if (loadingLangs.has(langId)) return loadingLangs.get(langId);

  const loaders = grammarLoaders[langId];
  if (!loaders) return;

  const p = Promise.all(loaders.map((fn) => fn().catch((e) => {
    console.warn(`[LazyLoad] Failed to load ${langId}:`, e);
  }))).then(() => {
    loadedLangs.add(langId);
    loadingLangs.delete(langId);
    console.log(`[LazyLoad] Loaded: ${langId}`);
  });

  loadingLangs.set(langId, p);
  return p;
}

/** Call after Monaco is initialized to start listening for editor opens */
function setupLazyLanguageFeatures() {
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

  vscode.workspace.onDidOpenTextDocument(handleDocument);

  // Load grammars for already-open documents
  for (const doc of vscode.workspace.textDocuments) {
    handleDocument(doc);
  }
}

// ---------------------------------------------------------------------------
// Fake Worker helper — captures URLs for MonacoEnvironment (matches demo)
// ---------------------------------------------------------------------------

class FakeWorker {
  constructor(
    public url: string | URL,
    public options?: WorkerOptions,
  ) {}
}

const workers: Record<string, FakeWorker> = {
  editorWorkerService: new FakeWorker(
    new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
    { type: 'module' },
  ),
  extensionHostWorkerMain: new FakeWorker(
    new URL('@codingame/monaco-vscode-api/workers/extensionHost.worker', import.meta.url),
    { type: 'module' },
  ),
  TextMateWorker: new FakeWorker(
    new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url),
    { type: 'module' },
  ),
  OutputLinkDetectionWorker: new FakeWorker(
    new URL('@codingame/monaco-vscode-output-service-override/worker', import.meta.url),
    { type: 'module' },
  ),
  LanguageDetectionWorker: new FakeWorker(
    new URL(
      '@codingame/monaco-vscode-language-detection-worker-service-override/worker',
      import.meta.url,
    ),
    { type: 'module' },
  ),
  LocalFileSearchWorker: new FakeWorker(
    new URL('@codingame/monaco-vscode-search-service-override/worker', import.meta.url),
    { type: 'module' },
  ),
};

window.MonacoEnvironment = {
  getWorkerUrl(_workerId: string, label: string) {
    return workers[label]?.url.toString() ?? '';
  },
  getWorkerOptions(_workerId: string, label: string) {
    return workers[label]?.options;
  },
};

// ---------------------------------------------------------------------------
// Virtual file system
// ---------------------------------------------------------------------------

const workspaceFile = monaco.Uri.file('/workspace.code-workspace');

function setupFileSystem() {
  const fileSystemProvider = new RegisteredFileSystemProvider(false);

  fileSystemProvider.registerFile(
    new RegisteredMemoryFile(
      vscode.Uri.file('/workspace/welcome.ts'),
      `// Welcome to WebTerminal Editor
// A plugin-based code editor powered by Monaco + VSCode API
//
// Features:
//   - Full VSCode workbench UI (explorer, search, panels, statusbar)
//   - Plugin system for custom extensions
//   - LSP ready, AI completion ready

interface Plugin {
  id: string;
  name: string;
  activate(ctx: PluginContext): void;
}

function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));
`,
    ),
  );

  fileSystemProvider.registerFile(
    new RegisteredMemoryFile(
      workspaceFile,
      JSON.stringify(
        { folders: [{ path: '/workspace' }] } satisfies IStoredWorkspace,
        null,
        2,
      ),
    ),
  );

  registerFileSystemOverlay(1, fileSystemProvider);
  return fileSystemProvider;
}

// ---------------------------------------------------------------------------
// Service collection (matches demo/src/setup.common.ts → commonServices)
// ---------------------------------------------------------------------------

const commonServices: IEditorOverrideServices = {
  ...getLogServiceOverride(),
  ...getFilesServiceOverride(),
  ...getExtensionServiceOverride({ enableWorkerExtensionHost: true }),
  ...getModelServiceOverride(),
  ...getNotificationsServiceOverride(),
  ...getDialogsServiceOverride(),
  ...getConfigurationServiceOverride(),
  ...getKeybindingsServiceOverride(),
  ...getTextmateServiceOverride(),
  ...getThemeServiceOverride(),
  ...getLanguagesServiceOverride(),
  ...getPreferencesServiceOverride(),
  ...getOutlineServiceOverride(),
  ...getBannerServiceOverride(),
  ...getStatusBarServiceOverride(),
  ...getTitleBarServiceOverride(),
  ...getSnippetServiceOverride(),
  ...getOutputServiceOverride(),
  ...getSearchServiceOverride(),
  ...getMarkersServiceOverride(),
  ...getAccessibilityServiceOverride(),
  ...getLanguageDetectionWorkerServiceOverride(),
  ...getStorageServiceOverride({
    fallbackOverride: {
      'workbench.activity.showAccounts': false,
    },
  }),
  ...getRemoteAgentServiceOverride({ scanRemoteExtensions: false }),
  ...getLifecycleServiceOverride(),
  ...getEnvironmentServiceOverride(),
  ...getWorkspaceTrustOverride(),
  ...getWorkingCopyServiceOverride(),
  ...getSecretStorageServiceOverride(),
  ...getAuthenticationServiceOverride(),
  ...getExplorerServiceOverride(),
  ...getExtensionGalleryServiceOverride({ webOnly: false }),
  ...getTerminalServiceOverride(),
  // ...getViewsServiceOverride(),
  ...getChatServiceOverride(),
  ...getAiServiceOverride(),
};

// ---------------------------------------------------------------------------
// Construction options (matches demo)
// ---------------------------------------------------------------------------

const constructOptions: IWorkbenchConstructionOptions = {
  enableWorkspaceTrust: true,
  windowIndicator: {
    label: 'Terminus Editor',
    tooltip: 'Powered by Enjoys',
    command: '',
  },
  workspaceProvider: {
    trusted: true,
    async open() {
      return false;
    },
    workspace: {
      workspaceUri: workspaceFile,
    },
  },
  developmentOptions: {
    logLevel: LogLevel.Info,
  },
  configurationDefaults: {
    'window.title':
      'Terminus Editor${separator}${dirty}${activeEditorShort}',
  },
  defaultLayout: {
    editors: [
      {
        uri: monaco.Uri.file('/workspace/welcome.ts'),
        viewColumn: 1,
      },
    ],
  },
  productConfiguration: {
    nameShort: 'Terminus',
    nameLong: 'Terminus Editor',
    extensionsGallery: {
      serviceUrl: 'https://open-vsx.org/vscode/gallery',
      resourceUrlTemplate:
        'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
      extensionUrlTemplate:
        'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
      controlUrl: '',
      nlsBaseUrl: '',
    },
  },
};

const envOptions: EnvironmentOverride = {
  userHome: vscode.Uri.file('/'),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EditorSetupOptions {
  container: HTMLElement;
  userConfiguration?: string;
  userKeybindings?: string;
}

export async function initializeMonaco(
  options: EditorSetupOptions,
): Promise<void> {
  if (initialized) return;

  // Apply config BEFORE initialize — prevents theme flicker (demo pattern)
  await Promise.all([
    initUserConfiguration(options.userConfiguration ?? defaultConfiguration),
    initUserKeybindings(options.userKeybindings ?? defaultKeybindings),
  ]);

  // Setup virtual filesystem
  setupFileSystem();

  // Indexed DB for persistent user data
  await createIndexedDBProviders();

  // Combine common services + workbench + quickaccess (demo/setup.workbench.ts)
  const services: IEditorOverrideServices = {
    ...commonServices,
    ...getWorkbenchServiceOverride(),
    ...getQuickAccessServiceOverride({
      isKeybindingConfigurationVisible: () => true,
      shouldUseGlobalPicker: () => true,
    }),
  };

  // Initialize full workbench (container = 2nd arg, envOptions = 4th)
  await initializeMonacoService(
    services,
    options.container,
    constructOptions,
    envOptions,
  );

  // Register as default extension API (demo/setup.workbench.ts pattern)
  await registerExtension(
    {
      name: 'webterminal-editor',
      publisher: 'webterminal',
      version: '1.0.0',
      engines: { vscode: '*' },
    },
    ExtensionHostKind.LocalProcess,
  ).setAsDefaultApi();

  // Start lazy-loading language features when files are opened
  setupLazyLanguageFeatures();

  initialized = true;
}

export { RegisteredFileSystemProvider, RegisteredMemoryFile, registerFileSystemOverlay };
