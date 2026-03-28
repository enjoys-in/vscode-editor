import type { Plugin, PluginContext, Disposable } from '@core/types';

export function createKeybindingsPlugin(): Plugin {
  const disposables: Disposable[] = [];

  return {
    id: 'builtin.keybindings',
    name: 'Keybindings',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      // Default keybindings
      const defaults = [
        { command: 'editor.action.quickCommand', key: 'ctrl+shift+p' },
        { command: 'editor.action.quickOpen', key: 'ctrl+p' },
        { command: 'ai.triggerCompletion', key: 'ctrl+shift+space' },
        { command: 'lsp.showConnections', key: 'ctrl+shift+l' },
      ];

      for (const kb of defaults) {
        disposables.push(ctx.registerKeybinding(kb));
      }
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
