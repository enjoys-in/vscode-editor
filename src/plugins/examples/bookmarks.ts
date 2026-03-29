// ---------------------------------------------------------------------------
// Example: Bookmarks sidebar plugin
//
// Demonstrates:
//   - Sidebar panel with activity bar icon + tree view
//   - Commands for add/remove bookmarks
//   - Context menu integration
// ---------------------------------------------------------------------------

import { definePlugin } from '@core/define-plugin';
import type { PluginContext } from '@core/types';

interface Bookmark {
  label: string;
  uri: string;
  line: number;
}

const bookmarks: Bookmark[] = [];
let refreshEmitter: any = null;

function createTreeProvider(ctx: PluginContext) {
  refreshEmitter = new ctx.vscode.EventEmitter();

  return {
    onDidChangeTreeData: refreshEmitter.event,

    getTreeItem(bookmark: Bookmark) {
      const item = new ctx.vscode.TreeItem(bookmark.label);
      item.description = `Line ${bookmark.line + 1}`;
      item.iconPath = new ctx.vscode.ThemeIcon('bookmark');
      item.command = {
        command: 'bookmarks.goto',
        title: 'Go to Bookmark',
        arguments: [bookmark],
      };
      return item;
    },

    getChildren() {
      return bookmarks;
    },
  };
}

export default definePlugin({
  id: 'example.bookmarks',
  name: 'Bookmarks',

  commands: [
    {
      id: 'bookmarks.toggle',
      title: 'Toggle Bookmark',
      category: 'Bookmarks',
      keybinding: 'ctrl+shift+b',
      when: 'editorTextFocus',
      handler(ctx) {
        const editor = ctx.vscode.window.activeTextEditor;
        if (!editor) return;

        const line = editor.selection.active.line;
        const uri = editor.document.uri.toString();

        const idx = bookmarks.findIndex((b) => b.uri === uri && b.line === line);
        if (idx >= 0) {
          bookmarks.splice(idx, 1);
        } else {
          const lineText = editor.document.lineAt(line).text.trim().slice(0, 40);
          bookmarks.push({
            label: lineText || `Line ${line + 1}`,
            uri,
            line,
          });
        }

        refreshEmitter?.fire(undefined);
      },
    },
    {
      id: 'bookmarks.goto',
      title: 'Go to Bookmark',
      category: 'Bookmarks',
      handler(ctx, bookmark?: unknown) {
        const bm = bookmark as Bookmark;
        if (!bm) return;
        const uri = ctx.vscode.Uri.parse(bm.uri);
        ctx.vscode.window.showTextDocument(uri, {
          selection: new ctx.vscode.Range(bm.line, 0, bm.line, 0),
        });
      },
    },
    {
      id: 'bookmarks.clear',
      title: 'Clear All Bookmarks',
      category: 'Bookmarks',
      handler() {
        bookmarks.length = 0;
        refreshEmitter?.fire(undefined);
      },
    },
  ],

  contextMenu: [
    { command: 'bookmarks.toggle', group: 'navigation', when: 'editorTextFocus' },
  ],

  sidebar: {
    id: 'bookmarks-panel',
    title: 'Bookmarks',
    icon: '$(bookmark)',
    views: [
      {
        id: 'bookmarks-tree',
        name: 'Bookmarks',
        treeDataProvider: createTreeProvider,
      },
    ],
  },
});
