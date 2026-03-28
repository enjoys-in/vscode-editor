import type { Plugin, PluginContext, Disposable } from '@core/types';

export interface LSPConnectionOptions {
  serverUrl: string;
  languageId: string;
  documentSelector: string[];
}

export function createLSPPlugin(options?: Partial<LSPConnectionOptions>): Plugin {
  const disposables: Disposable[] = [];

  return {
    id: 'builtin.lsp',
    name: 'Language Server Protocol',
    version: '1.0.0',

    async activate(ctx: PluginContext) {
      // Register LSP service for other plugins to connect language servers
      const connections = new Map<string, LSPConnectionOptions>();

      const lspService = {
        registerServer(opts: LSPConnectionOptions): Disposable {
          connections.set(opts.languageId, opts);
          connectToServer(opts);
          return {
            dispose() {
              connections.delete(opts.languageId);
            },
          };
        },
        getConnections: () => [...connections.values()],
      };

      ctx.services.register('lsp', lspService);

      // If default options provided, register immediately
      if (options?.serverUrl) {
        lspService.registerServer({
          serverUrl: options.serverUrl,
          languageId: options.languageId ?? 'typescript',
          documentSelector: options.documentSelector ?? ['typescript'],
        });
      }

      // Register command to show active LSP connections
      disposables.push(
        ctx.registerCommand('lsp.showConnections', () => {
          return lspService.getConnections();
        }),
      );

      // Native VSCode statusbar item
      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Right,
        100,
      );
      statusItem.text = '$(plug) LSP';
      statusItem.tooltip = 'Language Server Status';
      statusItem.show();
      disposables.push(statusItem);
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

async function connectToServer(options: LSPConnectionOptions): Promise<void> {
  // Lazy import — keeps the core bundle small when LSP is not used
  try {
    const { createWebSocketConnection } = await import('./ws-connection');
    await createWebSocketConnection(options);
  } catch (err) {
    console.warn(`[LSP] Failed to connect to ${options.serverUrl}:`, err);
  }
}
