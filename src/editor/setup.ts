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
import {
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
import getScmServiceOverride from '@codingame/monaco-vscode-scm-service-override';
import getBannerServiceOverride from '@codingame/monaco-vscode-view-banner-service-override';
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override';
import getTitleBarServiceOverride from '@codingame/monaco-vscode-view-title-bar-service-override';
import getDebugServiceOverride from '@codingame/monaco-vscode-debug-service-override';
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
import getTestingServiceOverride from '@codingame/monaco-vscode-testing-service-override';
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override';
import getOutlineServiceOverride from '@codingame/monaco-vscode-outline-service-override';
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override';

// Default extensions (side-effect imports — grammars, themes, icons)
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import '@codingame/monaco-vscode-theme-seti-default-extension';
import '@codingame/monaco-vscode-typescript-basics-default-extension';
import '@codingame/monaco-vscode-javascript-default-extension';
import '@codingame/monaco-vscode-json-default-extension';
import '@codingame/monaco-vscode-css-default-extension';
import '@codingame/monaco-vscode-html-default-extension';
import '@codingame/monaco-vscode-markdown-basics-default-extension';
import '@codingame/monaco-vscode-python-default-extension';
import '@codingame/monaco-vscode-shellscript-default-extension';
import '@codingame/monaco-vscode-yaml-default-extension';
import '@codingame/monaco-vscode-xml-default-extension';
import '@codingame/monaco-vscode-references-view-default-extension';
import '@codingame/monaco-vscode-search-result-default-extension';
import '@codingame/monaco-vscode-configuration-editing-default-extension';

// Required for vscode extension API usage in plugins
import 'vscode/localExtensionHost';

// User defaults (imported as raw strings)
import defaultConfiguration from './user/configuration.json?raw';
import defaultKeybindings from './user/keybindings.json?raw';

let initialized = false;

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
  ...getAuthenticationServiceOverride(),
  ...getLogServiceOverride(),
  ...getExtensionServiceOverride({ enableWorkerExtensionHost: true }),
  ...getModelServiceOverride(),
  ...getNotificationsServiceOverride(),
  ...getDialogsServiceOverride(),
  ...getConfigurationServiceOverride(),
  ...getKeybindingsServiceOverride(),
  ...getTextmateServiceOverride(),
  ...getThemeServiceOverride(),
  ...getLanguagesServiceOverride(),
  ...getDebugServiceOverride(),
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
  ...getScmServiceOverride(),
  ...getTestingServiceOverride(),
  ...getSecretStorageServiceOverride(),
  ...getExplorerServiceOverride(),
};

// ---------------------------------------------------------------------------
// Construction options (matches demo)
// ---------------------------------------------------------------------------

const constructOptions: IWorkbenchConstructionOptions = {
  enableWorkspaceTrust: true,
  windowIndicator: {
    label: 'WebTerminal Editor',
    tooltip: '',
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
      'WebTerminal Editor${separator}${dirty}${activeEditorShort}',
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
    nameShort: 'WebTerminal',
    nameLong: 'WebTerminal Editor',
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

  initialized = true;
}

export { RegisteredFileSystemProvider, RegisteredMemoryFile, registerFileSystemOverlay };
