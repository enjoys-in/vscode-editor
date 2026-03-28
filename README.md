# WebTerminal Editor

A plugin-based code editor powered by [Monaco](https://microsoft.github.io/monaco-editor/) and [monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api). Ships the full VS Code workbench UI (explorer, search, extensions, panels, statusbar) in the browser with a simple plugin/module system on top.

## Quick Start

```bash
# Clone
git clone https://github.com/enjoys-in/vscode-editor.git
cd vscode-editor

# Install (bun recommended, npm/pnpm also work)
bun install

# Dev server (port 5174)
bun run dev

# Production build
bun run build

# Preview production build
bun run preview
```

Open `http://localhost:5174` in the browser. You'll see the full VS Code workbench with explorer, editor, statusbar, extensions sidebar, and more.

## Project Structure

```
src/
├── main.ts                  # Entry point — registers plugins, boots app
├── app.ts                   # App class — orchestrates boot, plugins, modules
├── core/
│   ├── types.ts             # Plugin, Module, PluginContext, events
│   ├── plugin-registry.ts   # Plugin lifecycle management
│   ├── module-registry.ts   # Module lifecycle management
│   ├── event-bus.ts         # Typed pub/sub event system
│   ├── service-container.ts # Simple DI container for inter-plugin services
│   ├── command-registry.ts  # Command & keybinding registry
│   └── index.ts             # Re-exports
├── editor/
│   ├── setup.ts             # Monaco + VS Code workbench initialization
│   ├── user/
│   │   ├── configuration.json  # Default editor settings
│   │   └── keybindings.json    # Default keybindings
│   └── index.ts
├── plugins/
│   ├── theme/               # Runtime theme/config management
│   ├── lsp/                 # Language Server Protocol (WebSocket)
│   ├── ai-completion/       # AI inline completions (OpenAI-compatible)
│   └── keybindings/         # Default keybinding mappings
└── ui/
    └── styles.css           # Minimal reset (workbench owns layout)
```

## Architecture

```
┌─────────────────────────────────────────┐
│                  App                     │
│  ┌──────────┐  ┌──────────┐             │
│  │ Plugins  │  │ Modules  │             │
│  └────┬─────┘  └────┬─────┘             │
│       │              │                   │
│  ┌────▼──────────────▼─────┐             │
│  │     PluginContext        │             │
│  │  • vscode API           │             │
│  │  • monaco API           │             │
│  │  • services (DI)        │             │
│  │  • events (pub/sub)     │             │
│  │  • registerCommand()    │             │
│  │  • registerKeybinding() │             │
│  └─────────────────────────┘             │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  Monaco + VS Code Workbench      │    │
│  │  (explorer, editor, panels, etc) │    │
│  └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**Boot sequence:**

1. `App` resolves the workbench container element
2. `initializeMonaco()` loads user config/keybindings, sets up the virtual filesystem, initializes all VS Code service overrides, and renders the full workbench
3. Modules are initialized (low-level services)
4. Plugins are activated (receive `PluginContext`)
5. `editor:ready` event is emitted

## Creating a Plugin

A plugin is an object with `id`, `name`, `version`, and an `activate` function:

```typescript
import { App } from './app';

const app = new App({ container: '#workbench' });

app.registerPlugin({
  id: 'my.plugin',
  name: 'My Plugin',
  version: '1.0.0',

  activate(ctx) {
    // --- VS Code API (full extension API) ---
    const statusItem = ctx.vscode.window.createStatusBarItem(
      ctx.vscode.StatusBarAlignment.Right, 100
    );
    statusItem.text = '$(heart) My Plugin';
    statusItem.show();

    ctx.vscode.window.showInformationMessage('My plugin activated!');

    // --- Monaco API (editor-level API) ---
    ctx.monaco.languages.registerCompletionItemProvider('typescript', {
      provideCompletionItems() {
        return {
          suggestions: [{
            label: 'mySnippet',
            kind: ctx.monaco.languages.CompletionItemKind.Snippet,
            insertText: 'console.log("hello");',
            range: undefined!,
          }],
        };
      },
    });

    // --- Commands ---
    ctx.registerCommand('my.sayHello', () => {
      ctx.vscode.window.showInformationMessage('Hello!');
    });

    // --- Keybindings ---
    ctx.registerKeybinding({
      command: 'my.sayHello',
      key: 'ctrl+shift+h',
    });

    // --- Events ---
    ctx.events.on('editor:ready', () => {
      console.log('Editor is ready');
    });

    // --- Expose a service for other plugins ---
    ctx.services.register('my-service', {
      greet: (name: string) => `Hello, ${name}!`,
    });
  },

  deactivate() {
    // Cleanup (optional)
  },
});

await app.boot();
```

### Plugin Context (`ctx`)

| Property | Type | Description |
|----------|------|-------------|
| `ctx.vscode` | `typeof vscode` | Full VS Code extension API |
| `ctx.monaco` | `typeof monaco` | Full Monaco editor API |
| `ctx.services` | `ServiceContainer` | DI container for inter-plugin communication |
| `ctx.events` | `EventBus` | Typed pub/sub event bus |
| `ctx.registerCommand(id, handler)` | `Disposable` | Register a command |
| `ctx.registerKeybinding(kb)` | `Disposable` | Register a keybinding |

### Service Container

Plugins can expose and consume services through the shared container:

```typescript
// Plugin A: expose a service
ctx.services.register('analytics', {
  track: (event: string) => { /* ... */ },
});

// Plugin B: consume it
const analytics = ctx.services.get<{ track(e: string): void }>('analytics');
analytics.track('file-opened');
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `editor:ready` | `undefined` | Workbench fully loaded |
| `editor:model-changed` | `{ uri: string }` | Active editor model changed |
| `plugin:activated` | `{ id: string }` | Plugin activated |
| `plugin:deactivated` | `{ id: string }` | Plugin deactivated |
| `module:initialized` | `{ id: string }` | Module initialized |
| `command:execute` | `{ id: string, args: unknown[] }` | Command executed |

## Built-in Plugins

### Theme Manager

```typescript
import { createThemePlugin } from '@plugins/theme';

app.registerPlugin(createThemePlugin({
  defaultTheme: 'Default Dark+',        // optional override
  userConfig: { 'editor.fontSize': 16 }, // optional config overrides
}));

// Runtime usage from another plugin:
const theme = ctx.services.get<any>('theme');
theme.setTheme('Default Light Modern');
theme.updateConfig({ 'editor.minimap.enabled': false });
```

### LSP (Language Server Protocol)

```typescript
import { createLSPPlugin } from '@plugins/lsp';

// Auto-connect to a language server:
app.registerPlugin(createLSPPlugin({
  serverUrl: 'ws://localhost:3000',
  languageId: 'typescript',
  documentSelector: ['typescript', 'javascript'],
}));

// Or connect later from another plugin:
const lsp = ctx.services.get<any>('lsp');
lsp.registerServer({
  serverUrl: 'ws://localhost:4000',
  languageId: 'python',
  documentSelector: ['python'],
});
```

### AI Completion

```typescript
import { createAICompletionPlugin } from '@plugins/ai-completion';

app.registerPlugin(createAICompletionPlugin({
  endpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-...',
  model: 'gpt-4',       // default: 'gpt-4'
  maxTokens: 256,        // default: 256
  debounceMs: 300,       // default: 300
}));
```

Works with any OpenAI-compatible API. Provides ghost-text inline completions. Trigger manually with `Ctrl+Shift+Space`.

### Keybindings

```typescript
import { createKeybindingsPlugin } from '@plugins/keybindings';

app.registerPlugin(createKeybindingsPlugin());
```

Default keybindings:

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+P` | Quick Open |
| `Ctrl+Shift+Space` | Trigger AI Completion |
| `Ctrl+Shift+L` | Show LSP Connections |

## Creating a Module

Modules are lower-level services that initialize before plugins:

```typescript
app.registerModule({
  id: 'my.module',
  name: 'My Module',

  init(ctx) {
    // ctx.services and ctx.events are available
    ctx.services.register('database', {
      query: (sql: string) => { /* ... */ },
    });
  },

  dispose() {
    // Cleanup (optional)
  },
});
```

## Configuration

### Default Editor Settings

Edit `src/editor/user/configuration.json` to change defaults:

```json
{
  "workbench.colorTheme": "Default Dark+",
  "workbench.iconTheme": "vs-seti",
  "editor.fontSize": 14,
  "editor.fontFamily": "'Fira Code', 'Cascadia Code', Consolas, monospace",
  "editor.fontLigatures": true,
  "editor.tabSize": 2,
  "editor.minimap.enabled": true
}
```

### Default Keybindings

Edit `src/editor/user/keybindings.json`:

```json
[
  {
    "key": "ctrl+d",
    "command": "editor.action.deleteLines",
    "when": "editorTextFocus"
  }
]
```

### Runtime Override

Pass custom config/keybindings at boot:

```typescript
const app = new App({
  container: '#workbench',
  userConfiguration: JSON.stringify({
    'workbench.colorTheme': 'Default Light Modern',
    'editor.fontSize': 16,
  }),
  userKeybindings: JSON.stringify([
    { key: 'ctrl+k', command: 'editor.action.quickOpen' }
  ]),
});
```

## Extensions Marketplace

The Extensions sidebar is connected to [Open VSX](https://open-vsx.org/) — you can browse and install extensions directly from the UI the same way you would in VS Code.

## What's Included

**VS Code Services:** Explorer, Search, Extensions, SCM, Debug, Output, Problems, Terminal (requires backend), Preferences, Outline, Testing, Notifications, Dialogs, Quick Access, Status Bar, Title Bar, Banner, Authentication, Secret Storage, Workspace Trust

**Language Support (syntax):** TypeScript, JavaScript, JSON, CSS, HTML, Markdown, Python, Shell, YAML, XML

**Themes:** Default Dark+, Default Dark Modern, Default Light Modern, Default Light+, High Contrast Dark, High Contrast Light

## Path Aliases

Available in both TypeScript and Vite:

| Alias | Path |
|-------|------|
| `@core/*` | `src/core/*` |
| `@editor/*` | `src/editor/*` |
| `@plugins/*` | `src/plugins/*` |
| `@modules/*` | `src/modules/*` |
| `@ui/*` | `src/ui/*` |

## License

MIT
