import { MinimalApp } from './app';
import { createWorkspacePlugin } from '@plugins/workspace';
import { createAICompletionPlugin } from '@plugins/ai-completion';
import { createAccountPlugin } from '@plugins/account';
import { createApiFileReaderPlugin } from './api-file-reader';

async function main() {
  console.log('[Minimal] Starting...', Date.now());
  const app = new MinimalApp({
    container: '#workbench',
  });

  // Workspace — file system, explorer, upload, SFTP
  app.registerPlugin(createWorkspacePlugin());

  // AI completion — inline suggestions
  app.registerPlugin(
    createAICompletionPlugin({
        
      // endpoint: 'https://api.openai.com/v1/chat/completions',
      // apiKey: 'YOUR_KEY',
    }),
  );

  // Account — SFTP sidebar panel + saved connection profiles
  app.registerPlugin(createAccountPlugin());

  // API File Reader — loads files from POST /api/file/read
  // Uses URL query params: ?path=/remote/dir&tabId=sftp_xxx
  app.registerPlugin(createApiFileReaderPlugin({
    apiBase: 'http://localhost:7145',
  }));

  await app.boot();
  console.log('[Minimal] Boot complete, all plugins activated');

  (window as any).app = app;
}

main().catch((err) => {
  console.error('[Minimal] Boot failed:', err);
});
