import type { Plugin, PluginContext, Disposable } from '@core/types';
import { registerExtension } from '@codingame/monaco-vscode-api/extensions';
import { ExtensionHostKind } from '@codingame/monaco-vscode-extensions-service-override';
import { StandaloneServices } from '@codingame/monaco-vscode-api/services';
import { API_CONFIG, apiUrl } from '../../minimal/config';
import chatStyles from '../../webview/ai-chat/styles.css?raw';
import chatBody from '../../webview/ai-chat/chat.html?raw';
import chatScript from '../../webview/ai-chat/script.js?raw';

// ---------------------------------------------------------------------------
// AI Chat Plugin — sidebar webview with streaming chat
//
// Fetches providers from backend, streams SSE responses, renders markdown.
// Activity bar icon opens a Copilot-style chat panel.
// ---------------------------------------------------------------------------

export interface AIChatOptions {
  /** Override the base URL. Falls back to API_CONFIG.baseUrl */
  apiBase?: string;
}

interface AIProvider {
  id: string;
  name: string;
  icon: string;
  available: boolean;
  models: AIModel[];
}

interface AIModel {
  id: string;
  name: string;
  maxTokens: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function createAIChatPlugin(options?: AIChatOptions): Plugin {
  const disposables: Disposable[] = [];

  return {
    id: 'builtin.ai-chat',
    name: 'AI Chat',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      const { getApi } = registerExtension(
        {
          name: 'ai-chat',
          publisher: 'webterminal',
          version: '1.0.0',
          engines: { vscode: '*' },
          contributes: {
            viewsContainers: {
              activitybar: [
                {
                  id: 'ai-chat-sidebar',
                  title: 'AI Chat',
                  icon: '$(comment-discussion)',
                },
              ],
            },
            views: {
              'ai-chat-sidebar': [
                {
                  id: 'ai-chat-view',
                  name: 'Chat',
                  type: 'webview',
                },
              ],
            },
            commands: [
              { command: 'aiChat.addFileToChat', title: 'Add File to Chat', icon: '$(comment-discussion)' },
              { command: 'aiChat.inlineChat', title: 'AI Inline Chat', icon: '$(sparkle)' },
              { command: 'fileOps.renameFile', title: 'Rename File', icon: '$(edit)' },
              { command: 'fileOps.deleteFile', title: 'Delete File', icon: '$(trash)' },
            ],
            menus: {
              'explorer/context': [
                { command: 'aiChat.addFileToChat', group: 'navigation@100' },
                { command: 'fileOps.renameFile', group: '7_modification@1' },
                { command: 'fileOps.deleteFile', group: '7_modification@2' },
              ],
              'editor/context': [
                { command: 'aiChat.addFileToChat', group: 'navigation@100' },
                { command: 'aiChat.inlineChat', group: 'navigation@101' },
              ],
              'editor/title/context': [
                { command: 'aiChat.addFileToChat', group: 'navigation@100' },
              ],
            },
            keybindings: [
              { command: 'aiChat.inlineChat', key: 'ctrl+i', when: 'editorTextFocus' },
            ],
          },
        } as any,
        ExtensionHostKind.LocalProcess,
      );

      void getApi().then(async (vscodeApi) => {
        let webviewView: any = null;
        vscodeApi.window.registerWebviewViewProvider('ai-chat-view', {
          resolveWebviewView(view) {
            webviewView = view;
            webviewView.webview.options = {
              enableScripts: true,
            };
            webviewView.webview.html = getChatHtml(apiUrl('aiChat'));

            // Handle messages from webview
            webviewView.webview.onDidReceiveMessage(async (msg: any) => {
              if (msg.type === 'getProviders') {
                try {
                  const res = await fetch(apiUrl('aiProviders'));
                  const data = await res.json();
                  if (data.success) {
                    webviewView.webview.postMessage({
                      type: 'providers',
                      data: data.data,
                    });
                  }
                } catch (err: any) {
                  webviewView.webview.postMessage({
                    type: 'error',
                    message: `Failed to fetch providers: ${err.message}`,
                  });
                }
              }

              if (msg.type === 'getEditorContext') {
                const editor = vscodeApi.window.activeTextEditor;
                const selection = editor?.selection;
                const doc = editor?.document;
                webviewView.webview.postMessage({
                  type: 'editorContext',
                  data: {
                    language: doc?.languageId ?? 'plaintext',
                    fileName: doc?.fileName ?? '',
                    selection: selection && !selection.isEmpty
                      ? doc?.getText(selection) ?? ''
                      : '',
                    context: doc?.getText() ?? '',
                  },
                });
              }

              // --- @file autocomplete: list workspace files ---
              if (msg.type === 'getWorkspaceFiles') {
                try {
                  const files = await vscodeApi.workspace.findFiles('**/*', '**/node_modules/**', 500);
                  const items = files.map((f: any) => {
                    const rel = vscodeApi.workspace.asRelativePath(f);
                    return { path: rel, uri: f.toString() };
                  });
                  webviewView.webview.postMessage({ type: 'workspaceFiles', data: items });
                } catch {
                  webviewView.webview.postMessage({ type: 'workspaceFiles', data: [] });
                }
              }

              // --- @file: read a specific file's content ---
              if (msg.type === 'getFileContent') {
                try {
                  const uri = vscodeApi.Uri.parse(msg.uri);
                  const doc = await vscodeApi.workspace.openTextDocument(uri);
                  webviewView.webview.postMessage({
                    type: 'fileContent',
                    data: { path: msg.path, content: doc.getText(), language: doc.languageId },
                  });
                } catch (err: any) {
                  webviewView.webview.postMessage({
                    type: 'error',
                    message: `Cannot read ${msg.path}: ${err.message}`,
                  });
                }
              }

              // --- Accept: smart apply (whole file or selection) + format ---
              if (msg.type === 'applyCode') {
                const editor = vscodeApi.window.activeTextEditor;
                if (!editor) {
                  vscodeApi.window.showWarningMessage('No active editor to apply code to.');
                  webviewView.webview.postMessage({ type: 'applyResult', applyId: msg.applyId, success: false });
                  return;
                }
                try {
                  const doc = editor.document;
                  if (msg.mode === 'wholeFile') {
                    // Replace entire file content
                    const fullRange = new vscodeApi.Range(
                      doc.positionAt(0),
                      doc.positionAt(doc.getText().length),
                    );
                    await editor.edit((eb: any) => {
                      eb.replace(fullRange, msg.code);
                    });
                  } else {
                    // Replace selection or insert at cursor
                    await editor.edit((eb: any) => {
                      if (editor.selection && !editor.selection.isEmpty) {
                        eb.replace(editor.selection, msg.code);
                      } else {
                        eb.insert(editor.selection.active, msg.code);
                      }
                    });
                  }
                  // Format document after apply if requested
                  if (msg.format) {
                    await vscodeApi.commands.executeCommand('editor.action.formatDocument');
                  }
                  webviewView.webview.postMessage({ type: 'applyResult', applyId: msg.applyId, success: true });
                } catch (err: any) {
                  vscodeApi.window.showErrorMessage(`Apply failed: ${err.message}`);
                  webviewView.webview.postMessage({ type: 'applyResult', applyId: msg.applyId, success: false });
                }
              }

              // --- Undo: revert last edit ---
              if (msg.type === 'undoApply') {
                await vscodeApi.commands.executeCommand('undo');
              }

              // --- Insert: insert at cursor position ---
              if (msg.type === 'insertCode') {
                const editor = vscodeApi.window.activeTextEditor;
                if (!editor) {
                  vscodeApi.window.showWarningMessage('No active editor.');
                  return;
                }
                await editor.edit((eb: any) => {
                  eb.insert(editor.selection.active, msg.code);
                });
              }

              // --- Copy to new untitled file ---
              if (msg.type === 'newFileWithCode') {
                const doc = await vscodeApi.workspace.openTextDocument({
                  content: msg.code,
                  language: msg.language || 'plaintext',
                });
                await vscodeApi.window.showTextDocument(doc);
              }
            });
          },
        });

        // ----- Commands: Add File to Chat -----

        /** Strip virtual FS prefix (e.g. /workspace/) to get clean display path */
        function cleanPath(p: string): string {
          return p.replace(/^\/workspace\//, '').replace(/^workspace\//, '');
        }

        disposables.push(
          vscodeApi.commands.registerCommand('aiChat.addFileToChat', async (uri?: any) => {
            // Resolve the file URI — from explorer context or active editor
            let fileUri = uri;
            if (!fileUri) {
              fileUri = vscodeApi.window.activeTextEditor?.document.uri;
            }
            if (!fileUri) {
              vscodeApi.window.showWarningMessage('No file selected.');
              return;
            }
            try {
              // Check if this is a directory by trying to find files under it
              const dirPattern = new vscodeApi.RelativePattern(fileUri, '**/*');
              const filesInDir = await vscodeApi.workspace.findFiles(dirPattern, '**/node_modules/**', 50);

              if (filesInDir.length > 0) {
                // It's a directory — add all files under it
                let added = 0;
                for (const fUri of filesInDir) {
                  try {
                    const doc = await vscodeApi.workspace.openTextDocument(fUri);
                    const fRel = cleanPath(vscodeApi.workspace.asRelativePath(fUri));
                    webviewView?.webview.postMessage({
                      type: 'addFileContext',
                      data: { path: fRel, uri: fUri.toString(), content: doc.getText(), language: doc.languageId },
                    });
                    added++;
                  } catch { /* skip binary/unreadable files */ }
                }
                if (added > 0) {
                  await vscodeApi.commands.executeCommand('ai-chat-view.focus');
                } else {
                  vscodeApi.window.showWarningMessage('No readable files found in directory.');
                }
                return;
              }

              // Single file
              const doc = await vscodeApi.workspace.openTextDocument(fileUri);
              const rel = cleanPath(vscodeApi.workspace.asRelativePath(fileUri));
              webviewView?.webview.postMessage({
                type: 'addFileContext',
                data: { path: rel, uri: fileUri.toString(), content: doc.getText(), language: doc.languageId },
              });
              await vscodeApi.commands.executeCommand('ai-chat-view.focus');
            } catch (err: any) {
              vscodeApi.window.showErrorMessage(`Cannot read file: ${err.message}`);
            }
          }),
        );

        // ----- Command: Inline Chat (Ctrl+I) -----
        disposables.push(
          vscodeApi.commands.registerCommand('aiChat.inlineChat', async () => {
            const editor = vscodeApi.window.activeTextEditor;
            if (!editor) {
              vscodeApi.window.showWarningMessage('No active editor.');
              return;
            }
            const question = await vscodeApi.window.showInputBox({
              prompt: 'Ask AI about this code',
              placeHolder: 'Explain, refactor, fix...',
            });
            if (!question) return;

            const sel = editor.selection;
            const doc = editor.document;
            const selection = sel && !sel.isEmpty ? doc.getText(sel) : '';
            const context = doc.getText();

            // Send to chat webview as pre-filled question
            webviewView?.webview.postMessage({
              type: 'inlineChat',
              data: { question, language: doc.languageId, fileName: doc.fileName, selection, context },
            });
            await vscodeApi.commands.executeCommand('ai-chat-view.focus');
          }),
        );

        // ----- Command: Rename File -----
        disposables.push(
          vscodeApi.commands.registerCommand('fileOps.renameFile', async (uri?: any) => {
            let fileUri = uri;
            if (!fileUri) {
              fileUri = vscodeApi.window.activeTextEditor?.document.uri;
            }
            if (!fileUri) {
              vscodeApi.window.showWarningMessage('No file selected to rename.');
              return;
            }
            const oldPath = fileUri.path || fileUri.fsPath;
            const oldName = oldPath.split('/').pop() || oldPath.split('\\').pop() || '';
            const newName = await vscodeApi.window.showInputBox({
              prompt: 'New file name',
              value: oldName,
            });
            if (!newName || newName === oldName) return;

            const newUri = vscodeApi.Uri.joinPath(fileUri, '..', newName);
            try {
              const wsEdit = new vscodeApi.WorkspaceEdit();
              wsEdit.renameFile(fileUri, newUri);
              await vscodeApi.workspace.applyEdit(wsEdit);
              vscodeApi.window.showInformationMessage(`Renamed to ${newName}`);
            } catch (err: any) {
              vscodeApi.window.showErrorMessage(`Rename failed: ${err.message}`);
            }
          }),
        );

        // ----- Command: Delete File -----
        disposables.push(
          vscodeApi.commands.registerCommand('fileOps.deleteFile', async (uri?: any) => {
            let fileUri = uri;
            if (!fileUri) {
              fileUri = vscodeApi.window.activeTextEditor?.document.uri;
            }
            if (!fileUri) {
              vscodeApi.window.showWarningMessage('No file selected to delete.');
              return;
            }
            const fileName = (fileUri.path || fileUri.fsPath).split('/').pop() || 'this file';
            const confirm = await vscodeApi.window.showWarningMessage(
              `Delete "${fileName}"?`,
              { modal: true },
              'Delete',
            );
            if (confirm !== 'Delete') return;

            try {
              const wsEdit = new vscodeApi.WorkspaceEdit();
              wsEdit.deleteFile(fileUri, { recursive: true });
              await vscodeApi.workspace.applyEdit(wsEdit);
              vscodeApi.window.showInformationMessage(`Deleted ${fileName}`);
            } catch (err: any) {
              vscodeApi.window.showErrorMessage(`Delete failed: ${err.message}`);
            }
          }),
        );

        // Status bar item
        const statusItem = vscodeApi.window.createStatusBarItem(
          vscodeApi.StatusBarAlignment.Right,
          100,
        );
        statusItem.text = '$(comment-discussion) AI Chat';
        statusItem.tooltip = 'Open AI Chat';
        statusItem.command = 'ai-chat-view.focus';
        statusItem.show();
        disposables.push(statusItem);

        // Move the chat view to the auxiliary bar (right sidebar) like Copilot
        // Uses the internal service identifier string 'viewDescriptorService'
        // and ViewContainerLocation.AuxiliaryBar = 2
        setTimeout(() => {
          try {
            const serviceId: any = function _viewDescriptorService() {};
            serviceId.id = 'viewDescriptorService';
            const svc = StandaloneServices.get(serviceId) as any;
            const container = svc.getViewContainerById('workbench.view.extension.ai-chat-sidebar');
            if (container) {
              svc.moveViewContainerToLocation(container, /* AuxiliaryBar */ 2);
            }
          } catch (e) {
            console.warn('[AI Chat] Could not move to auxiliary bar:', e);
          }
        }, 500);
      });
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

// ---------------------------------------------------------------------------
// Webview HTML — composed from extracted files
// ---------------------------------------------------------------------------

function getChatHtml(chatEndpoint: string): string {
  // Extract origin for CSP connect-src
  const apiOrigin = new URL(chatEndpoint).origin;
  // Replace the placeholder in the script with the actual endpoint
  const script = chatScript.replace('__CHAT_ENDPOINT__', JSON.stringify(chatEndpoint));
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src ${apiOrigin} ws: wss:;">
<style>
${chatStyles}
</style>
</head>
<body>
${chatBody}
<script>
${script}
</script>
</body>
</html>`;
}
