import { App } from './app';

// Built-in plugins (prebuilt, ready to use)
import { createThemePlugin } from '@plugins/theme';
import { createLSPPlugin } from '@plugins/lsp';
import { createAICompletionPlugin } from '@plugins/ai-completion';
import { createKeybindingsPlugin } from '@plugins/keybindings';
import { createWorkspacePlugin } from '@plugins/workspace';
import { createAccountPlugin } from '@plugins/account';

async function main() {
  // ---- Create the app ----
  const app = new App({
    container: '#workbench',
    // Optionally override user config / keybindings at boot time:
    // userConfiguration: JSON.stringify({ 'workbench.colorTheme': 'Default Light Modern' }),
    // userKeybindings: JSON.stringify([{ key: 'ctrl+k', command: 'editor.action.quickOpen' }]),
  });

  // ---- Register built-in plugins ----
  // Theme manager — runtime theme/config changes via services
  app.registerPlugin(createThemePlugin());

  // LSP — connect language servers via WebSocket
  app.registerPlugin(createLSPPlugin());

  // AI completion — inline suggestions from OpenAI-compatible APIs
  app.registerPlugin(
    createAICompletionPlugin({
      // endpoint: 'https://api.openai.com/v1/chat/completions',
      // apiKey: 'YOUR_KEY',
    }),
  );

  // Default keybindings
  app.registerPlugin(createKeybindingsPlugin());

  // Workspace — open local folders, upload files, SFTP
  app.registerPlugin(createWorkspacePlugin());

  // Account — login/register + saved SFTP connection profiles
  app.registerPlugin(createAccountPlugin());

  // ---- Example: user-created plugin ----
  // This shows how easy it is for a user to create a plugin using the full
  // vscode + monaco APIs. Everything VSCode extensions can do, plugins can do.
  app.registerPlugin({
    id: 'user.hello',
    name: 'Hello Plugin',
    version: '1.0.0',
    activate(ctx) {
      // Create a native VSCode statusbar item
      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Right,
        100,
      );
      statusItem.text = '$(sparkle) Plugins Ready';
      statusItem.tooltip = 'WebTerminal Editor plugins loaded';
      statusItem.show();

      // Register a command (callable from command palette or keybindings)
      ctx.registerCommand('hello.greet', () => {
        ctx.vscode.window.showInformationMessage(
          'Hello from WebTerminal Editor!',
        );
      });

      // Example: register a completion provider via monaco API
      ctx.monaco.languages.registerCompletionItemProvider('typescript', {
        provideCompletionItems() {
          return {
            suggestions: [
              {
                label: 'webterminal-snippet',
                kind: ctx.monaco.languages.CompletionItemKind.Snippet,
                insertText: 'console.log("Hello from WebTerminal!");',
                detail: 'WebTerminal Editor snippet',
                range: undefined!,
              },
            ],
          };
        },
      });

      // Example: use the event bus
      ctx.events.on('editor:ready', () => {
        console.log('[HelloPlugin] Editor is ready!');
      });

      // Example: register a service other plugins can use
      ctx.services.register('hello', {
        greet: (name: string) => `Hello, ${name}!`,
      });
    },
  });

  // ---- Boot ----
  await app.boot();

  // Expose for console debugging
  (window as any).app = app;
}

main().catch(console.error);
