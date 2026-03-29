# Webview Development Guide

Terminus plugins can render custom HTML inside editor panels or sidebar views.

---

## Webview Panel (Editor Area)

Opens an HTML panel as a tab in the editor area (like VS Code's Markdown Preview):

```ts
import { definePlugin } from '@core/define-plugin';

export default definePlugin({
  id: 'my-preview',
  name: 'My Preview',

  commands: [
    {
      id: 'myPreview.open',
      title: 'Open Preview',
      category: 'Preview',
      handler(ctx) {
        // This command is auto-created by definePlugin
        ctx.vscode.commands.executeCommand('my-preview.openWebview.my-preview-panel');
      },
    },
  ],

  webviewPanels: [
    {
      viewType: 'my-preview-panel',       // Unique ID
      title: 'My Preview',                // Tab title
      column: 2,                           // 1 = main, 2 = beside
      icon: 'globe',                       // Tab icon (codicon name)
      enableScripts: true,                 // Allow JS in webview
      retainContextWhenHidden: false,       // Keep state when tab not visible

      // HTML content — string or function
      html: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    button { padding: 8px 16px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>My Preview</h1>
  <p id="content">Waiting for data...</p>
  <button onclick="sendMessage()">Send to Extension</button>

  <script>
    const vscode = acquireVsCodeApi();

    // Receive messages from extension
    window.addEventListener('message', (e) => {
      if (e.data.type === 'update') {
        document.getElementById('content').textContent = e.data.text;
      }
    });

    // Send messages to extension
    function sendMessage() {
      vscode.postMessage({ type: 'buttonClicked', value: 'hello' });
    }
  </script>
</body>
</html>`,

      // Handle messages FROM webview
      onMessage(ctx, message) {
        if (message.type === 'buttonClicked') {
          ctx.vscode.window.showInformationMessage(`Received: ${message.value}`);
        }
      },
    },
  ],

  // Send messages TO webview
  activate(ctx) {
    // After the webview is opened, you can send data to it:
    setTimeout(() => {
      const svc = ctx.services.get<any>('webviewPanel:my-preview-panel');
      svc?.postMessage({ type: 'update', text: 'Hello from the extension!' });
    }, 1000);
  },
});
```

### Webview Panel Service API

After a panel is opened, access it via services:

```ts
const svc = ctx.services.get<any>('webviewPanel:my-preview-panel');

// Send data to webview
svc.postMessage({ type: 'update', data: myData });

// Replace HTML entirely
svc.setHtml('<html>...</html>');

// Access the raw vscode.WebviewPanel
svc.panel;
```

---

## Webview Sidebar (Activity Bar Panel)

Render HTML inside a sidebar view instead of a tree:

```ts
export default definePlugin({
  id: 'my-sidebar-webview',
  name: 'My Sidebar Webview',

  sidebar: {
    id: 'my-webview-container',
    title: 'My App',
    icon: '$(browser)',
    views: [],  // Empty — webview views are declared in webviewSidebar
  },

  webviewSidebar: [
    {
      viewId: 'my-app-view',
      enableScripts: true,
      retainContextWhenHidden: true,

      html(ctx) {
        // Dynamic HTML — can use ctx for building content
        return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { padding: 16px; font-family: sans-serif; color: var(--vscode-foreground); }
    .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; margin: 8px 0; }
  </style>
</head>
<body>
  <h3>My App</h3>
  <div class="card">Card content here</div>
  <script>
    const vscode = acquireVsCodeApi();
    // ... your app logic
  </script>
</body>
</html>`;
      },

      onMessage(ctx, msg) {
        console.log('Message from sidebar webview:', msg);
      },
    },
  ],
});
```

### Sidebar Webview Service API

```ts
const svc = ctx.services.get<any>('webviewSidebar:my-app-view');
svc.postMessage({ type: 'refresh', data: newData });
svc.setHtml(newHtml);
```

---

## VS Code Theme Variables in Webviews

Webviews automatically inherit VS Code theme colors as CSS variables:

```css
body {
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 6px 14px;
  border-radius: 2px;
  cursor: pointer;
}

.button:hover {
  background: var(--vscode-button-hoverBackground);
}

.input {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  padding: 4px 8px;
}

.border {
  border-color: var(--vscode-panel-border);
}
```

### Common theme variables

| Variable | Description |
|----------|-------------|
| `--vscode-foreground` | Default text color |
| `--vscode-editor-background` | Editor background |
| `--vscode-button-background` | Button background |
| `--vscode-button-foreground` | Button text |
| `--vscode-input-background` | Input field background |
| `--vscode-input-foreground` | Input field text |
| `--vscode-panel-border` | Panel borders |
| `--vscode-list-activeSelectionBackground` | Selected item in lists |
| `--vscode-errorForeground` | Error text color |
| `--vscode-descriptionForeground` | Secondary text |

---

## Message Protocol Pattern

Use a consistent message format between webview and extension:

```ts
// Extension → Webview
svc.postMessage({ type: 'command', payload: { action: 'refresh', data: items } });

// Webview → Extension (in <script>)
vscode.postMessage({ type: 'event', payload: { action: 'save', content: text } });
```

Handle in extension:

```ts
onMessage(ctx, msg) {
  switch (msg.type) {
    case 'event':
      if (msg.payload.action === 'save') {
        // save logic
      }
      break;
  }
}
```

Handle in webview:

```js
window.addEventListener('message', (e) => {
  const { type, payload } = e.data;
  switch (type) {
    case 'command':
      if (payload.action === 'refresh') {
        renderItems(payload.data);
      }
      break;
  }
});
```

---

## Full Example: Live HTML Preview

See [src/plugins/examples/html-preview.ts](../src/plugins/examples/html-preview.ts) for a complete working example that:
- Opens a side-by-side webview panel
- Sends editor content to the webview on every keystroke
- Handles messages from webview back to extension
- Adds a right-click context menu entry
