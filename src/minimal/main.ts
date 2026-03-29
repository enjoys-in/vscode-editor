import { MinimalApp } from './app';
import { createWorkspacePlugin } from '@plugins/workspace';
import { createAICompletionPlugin } from '@plugins/ai-completion';
import { createAccountPlugin } from '@plugins/account';
import { createAIChatPlugin } from '@plugins/ai-chat';
import { createApiFileReaderPlugin } from './api-file-reader';
import { enableVsixDragAndDrop } from './extension-loader';
import { initLanguageLoader } from './language-loader';

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

  // API File Reader — loads files from POST /api/file/read
  // Uses URL query params: ?path=/remote/dir&tabId=sftp_xxx
  app.registerPlugin(createApiFileReaderPlugin());

  // AI Chat — right sidebar webview with streaming responses
  app.registerPlugin(createAIChatPlugin());

  await app.boot();
  console.log('[Minimal] Boot complete, all plugins activated');

  // Show vscode modal dialog if required query params are missing — no way to dismiss
  if (missingParams.length > 0) {
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
      'Version 1.0.0',
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

  // Drag-and-drop .vsix to install extensions
  enableVsixDragAndDrop(document.body);

  (window as any).app = app;
}

main().catch((err) => {
  console.error('[Minimal] Boot failed:', err);
});
