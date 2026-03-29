import { MinimalApp } from './app';

import { createWorkspacePlugin } from '@plugins/workspace';
import { createAICompletionPlugin } from '@plugins/ai-completion';
import { createAccountPlugin } from '@plugins/account';

async function main() {
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

  await app.boot();

  (window as any).app = app;
}

main().catch(console.error);
