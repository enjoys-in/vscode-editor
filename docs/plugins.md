# Plugin Development Guide

Terminus uses a declarative plugin system. You define what you need and the framework wires it up.

---

## Basic Plugin (Command + Status Bar)

Create a file in `src/plugins/my-plugin/index.ts`:

```ts
import { definePlugin } from '@core/define-plugin';

export default definePlugin({
  id: 'my-plugin',
  name: 'My Plugin',

  // Registers in Command Palette (Ctrl+Shift+P)
  commands: [
    {
      id: 'myPlugin.hello',
      title: 'Say Hello',
      category: 'My Plugin',        // Shown as "My Plugin: Say Hello"
      keybinding: 'ctrl+shift+h',   // Optional keyboard shortcut
      when: 'editorTextFocus',       // Optional activation context
      handler(ctx) {
        ctx.vscode.window.showInformationMessage('Hello from My Plugin!');
      },
    },
  ],

  // Status bar item (bottom bar)
  statusBar: [
    {
      id: 'myPlugin.status',
      text: '$(rocket) My Plugin',
      tooltip: 'Click to say hello',
      command: 'myPlugin.hello',
      alignment: 'right',   // 'left' or 'right'
      priority: 100,         // Higher = further left
    },
  ],
});
```

### Register the plugin

In `src/full/main.ts` or `src/minimal/main.ts`:

```ts
import myPlugin from '@plugins/my-plugin';

app.registerPlugin(myPlugin);
```

---

## Right-Click Context Menu

Add entries to the editor's right-click menu:

```ts
export default definePlugin({
  id: 'my-formatter',
  name: 'My Formatter',

  commands: [
    {
      id: 'myFormatter.format',
      title: 'Format with My Formatter',
      category: 'Formatter',
      handler(ctx) {
        const editor = ctx.vscode.window.activeTextEditor;
        if (!editor) return;
        // ... format logic
      },
    },
  ],

  // This adds "Format with My Formatter" to the right-click menu
  contextMenu: [
    {
      command: 'myFormatter.format',
      group: 'navigation',           // Top section of menu
      when: 'editorTextFocus',        // Only when editor has focus
    },
  ],
});
```

### Context menu groups (top to bottom)

| Group | Position |
|-------|----------|
| `navigation` | Top |
| `1_modification` | After navigation |
| `9_cutcopypaste` | Cut/Copy/Paste section |

---

## Sidebar Panel (Activity Bar + Tree View)

Add an icon to the activity bar with a tree view:

```ts
import { definePlugin } from '@core/define-plugin';
import type { PluginContext } from '@core/types';

interface MyItem {
  label: string;
  icon: string;
}

const items: MyItem[] = [
  { label: 'Item 1', icon: 'file' },
  { label: 'Item 2', icon: 'folder' },
];

function createTreeProvider(ctx: PluginContext) {
  const emitter = new ctx.vscode.EventEmitter();

  return {
    onDidChangeTreeData: emitter.event,

    getTreeItem(item: MyItem) {
      const treeItem = new ctx.vscode.TreeItem(item.label);
      treeItem.iconPath = new ctx.vscode.ThemeIcon(item.icon);
      treeItem.command = {
        command: 'mySidebar.selectItem',
        title: 'Select',
        arguments: [item],
      };
      return treeItem;
    },

    getChildren() {
      return items;
    },

    // Call emitter.fire(undefined) to refresh the tree
    refresh: () => emitter.fire(undefined),
  };
}

export default definePlugin({
  id: 'my-sidebar',
  name: 'My Sidebar',

  commands: [
    {
      id: 'mySidebar.selectItem',
      title: 'Select Item',
      handler(ctx, item?: unknown) {
        const myItem = item as MyItem;
        ctx.vscode.window.showInformationMessage(`Selected: ${myItem?.label}`);
      },
    },
  ],

  sidebar: {
    id: 'my-sidebar-panel',
    title: 'My Panel',
    icon: '$(list-unordered)',    // Codicon icon name
    views: [
      {
        id: 'my-sidebar-tree',
        name: 'Items',
        treeDataProvider: createTreeProvider,
      },
    ],
  },
});
```

### Finding icons

Use any [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) name:
`$(file)`, `$(folder)`, `$(rocket)`, `$(server)`, `$(gear)`, etc.

---

## Updating Status Bar at Runtime

Status bar items are registered as services. Update them from `activate()`:

```ts
export default definePlugin({
  id: 'my-counter',
  name: 'Counter',

  statusBar: [
    {
      id: 'counter.display',
      text: '$(pulse) Count: 0',
      tooltip: 'Click to increment',
      command: 'counter.increment',
    },
  ],

  commands: [
    {
      id: 'counter.increment',
      title: 'Increment Counter',
      handler(ctx) {
        count++;
        // Update the status bar item
        const svc = ctx.services.get<any>('statusBar:counter.display');
        svc?.update({ text: `$(pulse) Count: ${count}` });
      },
    },
  ],

  activate(ctx) {
    // Can also update from activate()
  },
});

let count = 0;
```

---

## PluginContext API Reference

Every plugin's `handler` and `activate` receive a `PluginContext`:

```ts
interface PluginContext {
  vscode: typeof import('vscode');     // Full VS Code extension API
  monaco: typeof import('monaco-editor'); // Full Monaco editor API
  services: ServiceContainer;           // Inter-plugin service registry
  events: EventBus;                     // Pub/sub event bus
  registerCommand(id, handler): Disposable;
  registerKeybinding(kb): Disposable;
}
```

### Key `ctx.vscode` APIs

| API | What it does |
|-----|-------------|
| `ctx.vscode.window.showInformationMessage()` | Info dialog |
| `ctx.vscode.window.showErrorMessage()` | Error dialog |
| `ctx.vscode.window.showQuickPick()` | Quick pick dropdown |
| `ctx.vscode.window.showInputBox()` | Text input dialog |
| `ctx.vscode.window.createStatusBarItem()` | Status bar (manual) |
| `ctx.vscode.window.activeTextEditor` | Current editor |
| `ctx.vscode.workspace.openTextDocument()` | Open a file |
| `ctx.vscode.commands.executeCommand()` | Run any command |
| `ctx.vscode.window.withProgress()` | Progress notification |

### Key `ctx.monaco` APIs

| API | What it does |
|-----|-------------|
| `ctx.monaco.languages.registerCompletionItemProvider()` | Autocomplete |
| `ctx.monaco.languages.registerHoverProvider()` | Hover tooltips |
| `ctx.monaco.languages.registerInlineCompletionsProvider()` | Ghost text |
| `ctx.monaco.editor.getModels()` | All open editor models |

---

## Services (Inter-Plugin Communication)

Register a service in one plugin:

```ts
activate(ctx) {
  ctx.services.register('myService', {
    getData: () => [1, 2, 3],
    doSomething: (x: string) => console.log(x),
  });
}
```

Use it from another plugin:

```ts
activate(ctx) {
  const myService = ctx.services.get<any>('myService');
  const data = myService?.getData();
}
```
