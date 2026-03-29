// ---------------------------------------------------------------------------
// Minimal Setup — stripped-down Monaco workbench
//
// Only loads services needed for: file system, explorer, webview, basic editor.
// No terminal, no search, no markers, no snippets, no output panel,
// no language detection, no extension gallery, no lazy language features.
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

// Core service overrides — only what's essential
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override';
import getNotificationsServiceOverride from '@codingame/monaco-vscode-notifications-service-override';
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';
import getBannerServiceOverride from '@codingame/monaco-vscode-view-banner-service-override';
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override';
import getTitleBarServiceOverride from '@codingame/monaco-vscode-view-title-bar-service-override';
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override';
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override';
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override';
import getSnippetServiceOverride from '@codingame/monaco-vscode-snippets-service-override';
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override';
import getLanguageDetectionWorkerServiceOverride from '@codingame/monaco-vscode-language-detection-worker-service-override';
import getRemoteAgentServiceOverride from '@codingame/monaco-vscode-remote-agent-service-override';
import getSecretStorageServiceOverride from '@codingame/monaco-vscode-secret-storage-service-override';
import getAuthenticationServiceOverride from '@codingame/monaco-vscode-authentication-service-override';
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override';
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override';
import getExtensionGalleryServiceOverride from '@codingame/monaco-vscode-extension-gallery-service-override';
// import getViewsServiceOverride from '@codingame/monaco-vscode-views-service-override';
 

// Minimal default extensions — just themes + icons
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import '@codingame/monaco-vscode-theme-seti-default-extension';

// Language grammars are loaded lazily on demand — see language-loader.ts

// Required for vscode extension API usage in plugins
// (imported in main.ts entry point to support extension host worker)

// Register SFTP sidebar view (must be before initializeMonacoService)
// import '@plugins/account/sftp-view';

// Minimal user defaults
import defaultConfiguration from './user/configuration.json?raw';
import defaultKeybindings from './user/keybindings.json?raw';

let initialized = false;

// ---------------------------------------------------------------------------
// Workers — real Worker instances via getWorker()
// ---------------------------------------------------------------------------

const workerUrls: Record<string, URL> = {
    editorWorkerService: new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
    extensionHostWorkerMain: new URL('@codingame/monaco-vscode-api/workers/extensionHost.worker', import.meta.url),
    TextMateWorker: new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url),
    LanguageDetectionWorker: new URL('@codingame/monaco-vscode-language-detection-worker-service-override/worker', import.meta.url),
    LocalFileSearchWorker: new URL('@codingame/monaco-vscode-search-service-override/worker', import.meta.url),
};

window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
        const url = workerUrls[label];
        if (!url) throw new Error(`Unknown worker: ${label}`);
        return new Worker(url, { type: 'module' });
    },
};

// ---------------------------------------------------------------------------
// Virtual file system
// ---------------------------------------------------------------------------

const workspaceFile = monaco.Uri.file('/workspace.code-workspace');

/** Derive a display-friendly folder name from the ?path= URL query param */
function getWorkspaceFolderName(): string {
    try {
        const remotePath = new URLSearchParams(window.location.search).get('path');
        if (remotePath) {
            const segments = remotePath.replace(/\/+$/, '').split('/').filter(Boolean);
            if (segments.length === 0) return 'workspace';
            const last = segments[segments.length - 1];
            // If path points to a file (has extension), use parent directory name
            if (last.includes('.') && !last.startsWith('.')) {
                return segments.length >= 2 ? segments[segments.length - 2] : 'workspace';
            }
            return last;
        }
    } catch { /* ignore */ }
    return 'workspace';
}

function getBrandName(): string {
    const host = new URLSearchParams(window.location.search).get('host')||new URLSearchParams(window.location.search).get('user');
    return host ? `Terminus — ${host}` : 'Terminus - Powered by Enjoys';
}

const workspaceFolderName = getWorkspaceFolderName();
const brandName = getBrandName();

/** Check if required query params are present for workspace loading */
function hasWorkspaceParams(): boolean {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('tabId') || params.get('sessionId');
    const remotePath = params.get('path');
    return !!(sessionId && remotePath);
}

function setupFileSystem() {
    const fileSystemProvider = new RegisteredFileSystemProvider(false);

    const folders = hasWorkspaceParams()
        ? [{ path: '/workspace', name: workspaceFolderName }]
        : [];

    fileSystemProvider.registerFile(
        new RegisteredMemoryFile(
            workspaceFile,
            JSON.stringify(
                { folders } satisfies IStoredWorkspace,
                null,
                2,
            ),
        ),
    );

    registerFileSystemOverlay(1, fileSystemProvider);
    return fileSystemProvider;
}

// ---------------------------------------------------------------------------
// Minimal service collection
// ---------------------------------------------------------------------------

const minimalServices: IEditorOverrideServices = {
    ...getLogServiceOverride(),
    ...getFilesServiceOverride(),
    ...getExtensionServiceOverride({ enableWorkerExtensionHost: false, }),
    ...getModelServiceOverride(),
    ...getNotificationsServiceOverride(),
    ...getDialogsServiceOverride(),
    ...getConfigurationServiceOverride(),
    ...getKeybindingsServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getThemeServiceOverride(),
    ...getLanguagesServiceOverride(),
    ...getBannerServiceOverride(),
    ...getStatusBarServiceOverride(),
    ...getTitleBarServiceOverride(),
    ...getStorageServiceOverride({
        fallbackOverride: {
            'workbench.activity.showAccounts': false,
        },
    }),
    ...getLifecycleServiceOverride(),
    ...getEnvironmentServiceOverride(),
    ...getWorkingCopyServiceOverride(),
    ...getExplorerServiceOverride(),
    ...getSnippetServiceOverride(),
    ...getSearchServiceOverride(),
    ...getLanguageDetectionWorkerServiceOverride(),
    ...getRemoteAgentServiceOverride({ scanRemoteExtensions: false }),
    ...getSecretStorageServiceOverride(),
    ...getAuthenticationServiceOverride(),
    ...getExtensionGalleryServiceOverride({ webOnly: false }),
    // ...getViewsServiceOverride(),

   
};

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

const constructOptions: IWorkbenchConstructionOptions = {
    enableWorkspaceTrust: false,
    windowIndicator: {
        label: brandName,
        tooltip: new URLSearchParams(window.location.search).get('host')
            ? `Connected to ${new URLSearchParams(window.location.search).get('host')}`
            : 'Powered by Enjoys',
        command: 'terminus.about',
    },
    productConfiguration: {
        nameShort: 'Terminus',
        nameLong: 'Terminus',
        version: '1.0.0',
        extensionsGallery: {
            serviceUrl: 'https://open-vsx.org/vscode/gallery',
            resourceUrlTemplate:
                'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
            extensionUrlTemplate:
                'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
            controlUrl: '',
            nlsBaseUrl: '',
            // VS Marketplace (uncomment to switch):
            // serviceUrl: 'https://marketplace.visualstudio.com/_apis/public/gallery',
            // resourceUrlTemplate: 'https://{publisher}.vscode-unpkg.net/{publisher}/{name}/{version}/{path}',
            // extensionUrlTemplate: 'https://marketplace.visualstudio.com/items?itemName={publisher}.{name}',
        },
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
        logLevel: LogLevel.Warning,
    },
    configurationDefaults: {
        'window.title':
            `${brandName}\${separator}${workspaceFolderName}\${separator}\${dirty}\${activeEditorShort}`,
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

    await Promise.all([
        initUserConfiguration(options.userConfiguration ?? defaultConfiguration),
        initUserKeybindings(options.userKeybindings ?? defaultKeybindings),
    ]);

    setupFileSystem();
    await createIndexedDBProviders();

    const services: IEditorOverrideServices = {
        ...minimalServices,
        ...getWorkbenchServiceOverride(),
        ...getQuickAccessServiceOverride({
            isKeybindingConfigurationVisible: () => true,
            shouldUseGlobalPicker: () => true,
        }),
    };

    console.log('[Minimal Setup] Calling initializeMonacoService...');
    await initializeMonacoService(
        services,
        options.container,
        constructOptions,
        envOptions,
    );
    console.log('[Minimal Setup] initializeMonacoService resolved');

    console.log('[Minimal Setup] Registering default extension...');
    await registerExtension(
        {
            name: 'webterminal-minimal',
            publisher: 'webterminal',
            version: '1.0.0',
            engines: { vscode: '*' },
        },
        ExtensionHostKind.LocalProcess,
    ).setAsDefaultApi();
    console.log('[Minimal Setup] Default extension registered');

    initialized = true;
}

export { RegisteredFileSystemProvider, RegisteredMemoryFile, registerFileSystemOverlay };
