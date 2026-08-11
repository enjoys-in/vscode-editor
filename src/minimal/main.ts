// Registers the local (main-thread) extension host — required for every
// ExtensionHostKind.LocalProcess extension (plugin menus/sidebars/webviews,
// setAsDefaultApi, and drag-dropped .vsix). Without it getApi() throws and the
// custom extensions are silently lost.
import 'vscode/localExtensionHost';

import { MinimalApp } from './app';
import { createWorkspacePlugin } from '@plugins/workspace';
import { createAICompletionPlugin } from '@plugins/ai-completion';
import { createAccountPlugin } from '@plugins/account';
import { createGithubAuthPlugin } from '@plugins/github-auth';
import { createAIChatPlugin } from '@plugins/ai-chat';
import { createApiFileReaderPlugin } from './api-file-reader';
import { enableVsixDragAndDrop } from './extension-loader';
import { initLanguageLoader } from './language-loader';
import { listSessions } from './terminal-history';
import { queueTerminalRestore } from './terminal-backend';
import { showWelcome, shouldShowOnStartup, AUTHOR_LINKS, showReleaseNotes, shouldShowReleaseNotes } from './welcome';
import { IS_DEV } from './config';

async function main() {
  // Validate required query params before booting
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('tabId') || params.get('sessionId');
  const remotePath = params.get('path');
  const missingParams: string[] = [];
  if (!sessionId) missingParams.push('tabId (or sessionId)');
  if (!remotePath) missingParams.push('path');

  console.log('[Minimal] Starting...', Date.now());
  const app = new MinimalApp({
    container: '#workbench',
  });

  // Workspace — file system, explorer, upload, SFTP
  app.registerPlugin(createWorkspacePlugin());

  // AI completion — inline suggestions (uses config.ts endpoint)
  app.registerPlugin(createAICompletionPlugin());

  // SFTP connections — sidebar panel + saved connection profiles
  app.registerPlugin(createAccountPlugin());

  // GitHub authentication — vscode.authentication provider ('github')
  app.registerPlugin(createGithubAuthPlugin());

  // API File Reader — loads files from POST /api/file/read
  // Uses URL query params: ?path=/remote/dir&tabId=sftp_xxx
  app.registerPlugin(createApiFileReaderPlugin());

  // AI Chat — right sidebar webview with streaming responses
  app.registerPlugin(createAIChatPlugin());

  await app.boot();
  console.log('[Minimal] Boot complete, all plugins activated');

  // Restore previously open terminal sessions (scrollback) from IndexedDB.
  try {
    const sessions = await listSessions();
    if (sessions.length > 0) {
      queueTerminalRestore(sessions);
      const vscodeApi = await import('vscode');
      for (const s of sessions) {
        vscodeApi.window.createTerminal({ name: s.title }).show(true);
      }
    }
  } catch (err) {
    console.warn('[Minimal] Terminal restore failed:', err);
  }

  // Block entry unless a valid session is present. Skipped in dev (VITE_APP_ENV=DEV);
  // production (default) requires an existing tabId/sessionId + path.
  if (!IS_DEV && missingParams.length > 0) {
    const vscode = await import('vscode');
    const msg = `Missing required URL parameters: ${missingParams.join(', ')}`;
    const detail = `The editor requires a valid session ID and remote path to load.\n\nExpected format:\n?tabId=SESSION_ID&path=/remote/path\n\nor\n?sessionId=SESSION_ID&path=/remote/path`;

    // Loop to prevent dismissal — re-show dialog if user closes it
    while (true) {
      await vscode.window.showErrorMessage(msg, { modal: true, detail });
    }
  }

  // Lazy-load language grammars when files are opened
  const vscode = await import('vscode');
  initLanguageLoader(vscode);

  // Register terminus.about command (triggered by clicking brand in status bar)
  const host = new URLSearchParams(window.location.search).get('host');
  vscode.commands.registerCommand('terminus.about', async () => {
    const detail = [
      'Terminus — Remote Code Editor',
      '',
      host ? `Connected to: ${host}` : 'Powered by Enjoys',
      'Version 1.1.0',
      'Last updated: August 11, 2026',
    ].join('\n');

    const choice = await vscode.window.showInformationMessage(
      'About Terminus',
      { modal: true, detail },
      'GitHub',
      'LinkedIn',
      'Portfolio',
    );

    const links: Record<string, string> = {
      GitHub: 'https://github.com/Mullayam',
      LinkedIn: 'https://linkedin.com/in/mullayam06',
      Portfolio: 'https://me.enjoys.in',
    };
    if (choice && links[choice]) {
      vscode.env.openExternal(vscode.Uri.parse(links[choice]));
    }
  });

  // GitHub link in the status bar
  vscode.commands.registerCommand('terminus.openGithub', () =>
    vscode.env.openExternal(vscode.Uri.parse(AUTHOR_LINKS.github)),
  );
  const githubItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    150,
  );
  githubItem.text = '$(github) GitHub';
  githubItem.tooltip = 'Mullayam on GitHub';
  githubItem.command = 'terminus.openGithub';
  githubItem.show();

  // Welcome tab (like VS Code) — opens on startup and via command
  vscode.commands.registerCommand('terminus.welcome', () => showWelcome(vscode));
  if (shouldShowOnStartup()) {
    showWelcome(vscode);
    vscode.window
      .showInformationMessage(
        'Welcome to Terminus — built by Mullayam.',
        'GitHub',
        'LinkedIn',
        'Portfolio',
      )
      .then((choice) => {
        const map: Record<string, string> = {
          GitHub: AUTHOR_LINKS.github,
          LinkedIn: AUTHOR_LINKS.linkedin,
          Portfolio: AUTHOR_LINKS.portfolio,
        };
        if (choice && map[choice]) {
          vscode.env.openExternal(vscode.Uri.parse(map[choice]));
        }
      });
  }

  // Release notes — open once per version, reopenable via command
  vscode.commands.registerCommand('terminus.releaseNotes', () => showReleaseNotes(vscode));
  if (shouldShowReleaseNotes()) {
    showReleaseNotes(vscode);
  }

  // Drag-and-drop .vsix to install extensions
  enableVsixDragAndDrop(document.body);

  (window as any).app = app;
}

main().catch((err) => {
  console.error('[Minimal] Boot failed:', err);
});
