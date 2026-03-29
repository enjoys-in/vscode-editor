// ---------------------------------------------------------------------------
// Example: HTML Preview Plugin (Webview)
//
// Demonstrates:
//   - Webview panel in editor area
//   - Message passing (editor → webview, webview → editor)
//   - Command to open the preview
// ---------------------------------------------------------------------------

import { definePlugin } from '@core/define-plugin';

export default definePlugin({
  id: 'example.html-preview',
  name: 'HTML Preview',

  commands: [
    {
      id: 'htmlPreview.open',
      title: 'Open HTML Preview',
      category: 'Preview',
      keybinding: 'ctrl+shift+v',
      when: 'editorLangId == html',
      handler(ctx) {
        // Open the webview panel
        ctx.vscode.commands.executeCommand('example.html-preview.openWebview.html-preview');

        // After a short delay, send the current HTML content
        setTimeout(() => {
          const editor = ctx.vscode.window.activeTextEditor;
          if (!editor) return;
          const svc = ctx.services.get<any>('webviewPanel:html-preview');
          svc?.postMessage({ type: 'update', html: editor.document.getText() });
        }, 500);
      },
    },
  ],

  contextMenu: [
    { command: 'htmlPreview.open', group: 'navigation', when: 'editorLangId == html' },
  ],

  webviewPanels: [
    {
      viewType: 'html-preview',
      title: 'HTML Preview',
      column: 2,
      icon: 'globe',
      enableScripts: true,
      html: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 16px; background: #fff; color: #000; font-family: sans-serif; }
    #preview { width: 100%; min-height: 100vh; }
    .placeholder { color: #999; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div id="preview"><p class="placeholder">Open an HTML file and run "Open HTML Preview"</p></div>
  <script>
    const vscode = acquireVsCodeApi();
    window.addEventListener('message', (e) => {
      if (e.data.type === 'update') {
        document.getElementById('preview').innerHTML = e.data.html;
      }
    });
  </script>
</body>
</html>`,
      onMessage(ctx, msg) {
        if (msg.type === 'linkClicked') {
          ctx.vscode.window.showInformationMessage(`Link clicked: ${msg.href}`);
        }
      },
    },
  ],

  // Live-update preview when editor content changes
  activate(ctx) {
    ctx.vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'html') {
        const svc = ctx.services.get<any>('webviewPanel:html-preview');
        svc?.postMessage({ type: 'update', html: e.document.getText() });
      }
    });
  },
});
