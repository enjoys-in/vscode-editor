import { MinimalApp } from './app';
import { createWorkspacePlugin } from '@plugins/workspace';
import { createAICompletionPlugin } from '@plugins/ai-completion';
import { createAccountPlugin } from '@plugins/account';
import { createAIChatPlugin } from '@plugins/ai-chat';
import { createApiFileReaderPlugin } from './api-file-reader';
import { enableVsixDragAndDrop } from './extension-loader';

async function main() {
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

  // Drag-and-drop .vsix to install extensions
  enableVsixDragAndDrop(document.body);

  (window as any).app = app;
}

main().catch((err) => {
  console.error('[Minimal] Boot failed:', err);
});
