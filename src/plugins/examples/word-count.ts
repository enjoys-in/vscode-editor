// ---------------------------------------------------------------------------
// Example: Word Count Plugin
//
// Demonstrates all plugin features:
//   - Command palette command
//   - Right-click context menu
//   - Status bar item (live word count)
//   - Keybinding
// ---------------------------------------------------------------------------

import { definePlugin } from '@core/define-plugin';

export default definePlugin({
  id: 'example.word-count',
  name: 'Word Count',

  // --- Commands (auto-registered in command palette) ---
  commands: [
    {
      id: 'wordCount.show',
      title: 'Show Word Count',
      category: 'Word Count',
      keybinding: 'ctrl+shift+w',
      when: 'editorTextFocus',
      handler(ctx) {
        const editor = ctx.vscode.window.activeTextEditor;
        if (!editor) return;
        const text = editor.document.getText();
        const words = text.split(/\s+/).filter(Boolean).length;
        ctx.vscode.window.showInformationMessage(`Word count: ${words}`);
      },
    },
  ],

  // --- Right-click context menu ---
  contextMenu: [
    { command: 'wordCount.show', group: 'navigation' },
  ],

  // --- Status bar ---
  statusBar: [
    {
      id: 'wordCount.status',
      text: '$(pencil) 0 words',
      tooltip: 'Click to show word count',
      command: 'wordCount.show',
      alignment: 'right',
      priority: 50,
    },
  ],

  // --- Extra logic: update status bar on editor change ---
  activate(ctx) {
    const statusUpdater = ctx.services.get<any>('statusBar:wordCount.status');

    function updateCount() {
      const editor = ctx.vscode.window.activeTextEditor;
      if (!editor) return;
      const words = editor.document.getText().split(/\s+/).filter(Boolean).length;
      statusUpdater?.update({ text: `$(pencil) ${words} words` });
    }

    ctx.vscode.window.onDidChangeActiveTextEditor(updateCount);
    ctx.vscode.workspace.onDidChangeTextDocument(updateCount);
    updateCount();
  },
});
