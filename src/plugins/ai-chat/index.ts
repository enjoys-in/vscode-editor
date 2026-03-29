import type { Plugin, PluginContext, Disposable } from '@core/types';
import { registerExtension } from '@codingame/monaco-vscode-api/extensions';
import { ExtensionHostKind } from '@codingame/monaco-vscode-extensions-service-override';
import { StandaloneServices } from '@codingame/monaco-vscode-api/services';
import { API_CONFIG, apiUrl } from '../../minimal/config';

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

              // --- Accept: apply code to active editor (replace selection or insert) ---
              if (msg.type === 'applyCode') {
                const editor = vscodeApi.window.activeTextEditor;
                if (!editor) {
                  vscodeApi.window.showWarningMessage('No active editor to apply code to.');
                  return;
                }
                await editor.edit((eb: any) => {
                  if (editor.selection && !editor.selection.isEmpty) {
                    eb.replace(editor.selection, msg.code);
                  } else {
                    eb.insert(editor.selection.active, msg.code);
                  }
                });
                vscodeApi.window.showInformationMessage('Code applied to editor.');
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
// Webview HTML — self-contained chat UI
// ---------------------------------------------------------------------------

function getChatHtml(chatEndpoint: string): string {
  // Extract origin for CSP connect-src
  const apiOrigin = new URL(chatEndpoint).origin;
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src ${apiOrigin} ws: wss:;">
<style>
/* ===== Reset & Base (theme-aware) ===== */
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;overflow:hidden;}
body{
  background:var(--vscode-sideBar-background,#252526);
  color:var(--vscode-foreground,#cccccc);
  font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif);
  font-size:var(--vscode-font-size,13px);
  display:flex;flex-direction:column;
}

/* ===== Scrollbar (match VS Code) ===== */
::-webkit-scrollbar{width:6px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background,rgba(121,121,121,.4));border-radius:3px;}
::-webkit-scrollbar-thumb:hover{background:var(--vscode-scrollbarSlider-hoverBackground,rgba(100,100,100,.7));}

/* ===== Chat messages area ===== */
.messages{
  flex:1;overflow-y:auto;
  padding:0;
}

/* ===== Single message row ===== */
.msg{
  display:flex;gap:10px;
  padding:12px 16px;
}
.msg+.msg{border-top:1px solid var(--vscode-widget-border,transparent);}

/* Avatar */
.msg .avatar{
  flex-shrink:0;width:28px;height:28px;
  border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:14px;line-height:1;
  margin-top:1px;
}
.msg.user .avatar{
  background:var(--vscode-button-background,#0e639c);
  color:var(--vscode-button-foreground,#fff);
}
.msg.assistant .avatar{
  background:var(--vscode-activityBarBadge-background,#007acc);
  color:var(--vscode-activityBarBadge-foreground,#fff);
}

/* Body */
.msg .body{flex:1;min-width:0;}
.msg .name{
  font-size:12px;font-weight:600;
  margin-bottom:4px;
  color:var(--vscode-foreground,#ccc);
}
.msg .name span{
  font-weight:400;
  color:var(--vscode-descriptionForeground,#888);
  margin-left:6px;font-size:11px;
}

/* Content prose */
.msg .content{line-height:1.55;word-wrap:break-word;}
.msg .content p{margin:4px 0;}
.msg .content ul,.msg .content ol{margin:4px 0 4px 18px;}
.msg .content li{margin:2px 0;}
.msg .content a{color:var(--vscode-textLink-foreground,#3794ff);text-decoration:none;}
.msg .content a:hover{text-decoration:underline;}
.msg .content strong{color:var(--vscode-foreground,#ccc);}

/* Inline code */
.msg .content code{
  font-family:var(--vscode-editor-font-family,'Cascadia Code',Consolas,'Courier New',monospace);
  font-size:calc(var(--vscode-editor-font-size,13px) - 1px);
  background:var(--vscode-textCodeBlock-background,rgba(255,255,255,.06));
  padding:2px 5px;border-radius:3px;
}

/* ===== Code blocks ===== */
.code-block{
  margin:8px 0;
  border-radius:6px;
  overflow:hidden;
  border:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));
  background:var(--vscode-editor-background,#1e1e1e);
  transition:border-color .3s;
}
.code-block.applied{
  border-color:var(--vscode-testing-iconPassed,#73c991);
  animation:flash-green .6s ease;
}
.code-block.rejected{
  border-color:var(--vscode-errorForeground,#f14c4c);
  animation:flash-red .6s ease;
}
@keyframes flash-green{0%{background:rgba(115,201,145,.15);}100%{background:transparent;}}
@keyframes flash-red{0%{background:rgba(241,76,76,.12);}100%{background:transparent;}}

.code-block .code-bar{
  display:flex;align-items:center;justify-content:space-between;
  padding:4px 10px;
  background:var(--vscode-editorGroupHeader-tabsBackground,rgba(255,255,255,.04));
  border-bottom:1px solid var(--vscode-widget-border,rgba(255,255,255,.06));
}
.code-block .code-lang{
  font-size:11px;
  color:var(--vscode-descriptionForeground,#888);
  text-transform:uppercase;letter-spacing:.3px;
}
.code-block .code-actions{display:flex;gap:2px;}
.code-block .code-actions button{
  background:none;border:none;cursor:pointer;
  color:var(--vscode-descriptionForeground,#888);
  font-size:11px;padding:2px 7px;border-radius:3px;
  font-family:var(--vscode-font-family,sans-serif);
  display:flex;align-items:center;gap:3px;
  transition:all .12s;
}
.code-block .code-actions button:hover{
  background:var(--vscode-toolbar-hoverBackground,rgba(255,255,255,.12));
  color:var(--vscode-foreground,#ccc);
}
.code-block .code-actions .act-apply:hover{color:var(--vscode-testing-iconPassed,#73c991);}
.code-block .code-actions .act-insert:hover{color:var(--vscode-notificationsInfoIcon-foreground,#75beff);}
.code-block .code-actions .act-newfile:hover{color:var(--vscode-notificationsInfoIcon-foreground,#75beff);}
.code-block .code-actions .act-dismiss:hover{color:var(--vscode-errorForeground,#f14c4c);}

.code-block pre{
  margin:0;padding:10px 12px;
  overflow-x:auto;
  font-family:var(--vscode-editor-font-family,'Cascadia Code',Consolas,monospace);
  font-size:var(--vscode-editor-font-size,13px);
  line-height:1.45;
  background:transparent;
}
.code-block pre code{background:none;padding:0;font-size:inherit;}

/* Streaming cursor */
.cursor{
  display:inline-block;width:2px;height:1em;
  background:var(--vscode-editorCursor-foreground,#aeafad);
  animation:blink .8s step-end infinite;
  vertical-align:text-bottom;margin-left:1px;
}
@keyframes blink{50%{opacity:0;}}

/* ===== Welcome screen ===== */
.welcome{
  display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  height:100%;padding:24px 20px;
}
.welcome-icon{
  font-size:32px;
  color:var(--vscode-activityBarBadge-background,#007acc);
}
.welcome h3{
  font-size:15px;font-weight:600;
  color:var(--vscode-foreground,#ccc);
}
.welcome p{
  font-size:12px;text-align:center;
  color:var(--vscode-descriptionForeground,#888);
  max-width:280px;line-height:1.5;
}
.welcome .hints{
  display:flex;flex-direction:column;gap:6px;
  width:100%;max-width:280px;margin-top:4px;
}
.welcome .hint{
  padding:8px 12px;border-radius:6px;cursor:pointer;
  font-size:12px;text-align:left;
  background:var(--vscode-input-background,#3c3c3c);
  color:var(--vscode-foreground,#ccc);
  border:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));
  transition:background .15s;
}
.welcome .hint:hover{
  background:var(--vscode-list-hoverBackground,rgba(255,255,255,.06));
  border-color:var(--vscode-focusBorder,#007fd4);
}

/* ===== Context file chips ===== */
.context-chips{
  display:flex;flex-wrap:wrap;gap:4px;
  padding:6px 12px 0;
  max-height:80px;overflow-y:auto;
}
.context-chips:empty{display:none;padding:0;}
.file-chip{
  display:inline-flex;align-items:center;gap:3px;
  padding:2px 6px 2px 8px;
  border-radius:4px;
  font-size:11px;
  background:var(--vscode-badge-background,#4d4d4d);
  color:var(--vscode-badge-foreground,#fff);
  border:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));
  max-width:180px;
}
.file-chip .chip-name{
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.file-chip .chip-remove{
  cursor:pointer;
  font-size:12px;line-height:1;
  color:var(--vscode-descriptionForeground,#888);
  padding:0 2px;border-radius:2px;
  transition:color .12s;
}
.file-chip .chip-remove:hover{
  color:var(--vscode-errorForeground,#f14c4c);
}

/* ===== @file autocomplete dropdown ===== */
.file-dropdown{
  position:absolute;
  bottom:100%;left:0;right:0;
  max-height:200px;overflow-y:auto;
  background:var(--vscode-dropdown-background,#3c3c3c);
  border:1px solid var(--vscode-dropdown-border,rgba(255,255,255,.12));
  border-radius:6px;
  margin-bottom:4px;
  box-shadow:0 -4px 12px rgba(0,0,0,.35);
  display:none;
  z-index:100;
}
.file-dropdown.visible{display:block;}
.file-dropdown .dd-item{
  padding:6px 10px;
  font-size:12px;
  cursor:pointer;
  display:flex;align-items:center;gap:6px;
  color:var(--vscode-foreground,#ccc);
  transition:background .08s;
}
.file-dropdown .dd-item:hover,
.file-dropdown .dd-item.active{
  background:var(--vscode-list-activeSelectionBackground,rgba(4,57,94,.7));
  color:var(--vscode-list-activeSelectionForeground,#fff);
}
.file-dropdown .dd-item .dd-icon{
  color:var(--vscode-descriptionForeground,#888);
  font-size:14px;flex-shrink:0;
}
.file-dropdown .dd-item .dd-path{
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.file-dropdown .dd-empty{
  padding:10px;text-align:center;
  font-size:12px;
  color:var(--vscode-descriptionForeground,#888);
}

/* ===== Input area (Copilot style) ===== */
.input-wrap{
  flex-shrink:0;
  padding:0 12px 12px;
  position:relative;
}
.input-box{
  border:1px solid var(--vscode-input-border,rgba(255,255,255,.1));
  border-radius:8px;
  background:var(--vscode-input-background,#3c3c3c);
  overflow:hidden;
  transition:border-color .15s;
}
.input-box:focus-within{
  border-color:var(--vscode-focusBorder,#007fd4);
}
.input-box textarea{
  display:block;width:100%;
  resize:none;border:none;outline:none;
  background:transparent;
  color:var(--vscode-input-foreground,#ccc);
  font-family:var(--vscode-font-family,sans-serif);
  font-size:var(--vscode-font-size,13px);
  line-height:1.45;
  padding:10px 12px 4px;
  min-height:24px;max-height:150px;
}
.input-box textarea::placeholder{color:var(--vscode-input-placeholderForeground,#888);}

/* Toolbar row below textarea */
.input-toolbar{
  display:flex;align-items:center;
  justify-content:space-between;
  padding:4px 8px 6px;gap:4px;
}
.input-toolbar .left{display:flex;align-items:center;gap:2px;}
.input-toolbar .right{display:flex;align-items:center;gap:4px;}

/* Model selector chip */
.model-chip{
  display:flex;align-items:center;gap:4px;
  padding:2px 8px 2px 6px;border-radius:4px;cursor:pointer;
  font-size:11px;
  color:var(--vscode-descriptionForeground,#888);
  background:var(--vscode-toolbar-hoverBackground,rgba(255,255,255,.06));
  border:1px solid transparent;
  transition:all .12s;
}
.model-chip:hover{
  color:var(--vscode-foreground,#ccc);
  border-color:var(--vscode-widget-border,rgba(255,255,255,.12));
}
.model-chip select{
  appearance:none;-webkit-appearance:none;
  background:none;border:none;outline:none;
  color:inherit;font:inherit;cursor:pointer;
  padding:0;margin:0;
}
.model-chip select option{
  background:var(--vscode-dropdown-background,#3c3c3c);
  color:var(--vscode-dropdown-foreground,#ccc);
}

/* Action buttons */
.tool-btn{
  background:none;border:none;cursor:pointer;
  color:var(--vscode-descriptionForeground,#888);
  font-size:14px;padding:3px 5px;border-radius:4px;
  display:flex;align-items:center;justify-content:center;
}
.tool-btn:hover{
  background:var(--vscode-toolbar-hoverBackground,rgba(255,255,255,.1));
  color:var(--vscode-foreground,#ccc);
}

/* Send / Stop button */
.send-btn{
  background:var(--vscode-button-background,#0e639c);
  color:var(--vscode-button-foreground,#fff);
  border:none;border-radius:5px;
  padding:4px 10px;cursor:pointer;
  font-size:12px;font-weight:500;
  font-family:var(--vscode-font-family,sans-serif);
  display:flex;align-items:center;gap:4px;
  transition:background .12s;
}
.send-btn:hover{background:var(--vscode-button-hoverBackground,#1177bb);}
.send-btn.stop{
  background:var(--vscode-errorForeground,#f14c4c);
}
.send-btn.stop:hover{opacity:.85;}
.send-btn:disabled{opacity:.4;cursor:default;}

/* ===== Context badge on messages ===== */
.context-badge{
  display:inline-flex;align-items:center;gap:3px;
  font-size:10px;
  color:var(--vscode-descriptionForeground,#888);
  margin-top:2px;
}
.context-badge .cb-file{
  background:var(--vscode-textCodeBlock-background,rgba(255,255,255,.06));
  padding:1px 5px;border-radius:3px;
  font-family:var(--vscode-editor-font-family,monospace);
}

/* ===== Loader ===== */
.loader{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  height:100%;gap:12px;
  color:var(--vscode-descriptionForeground,#888);
  font-size:12px;
}
.spinner{
  width:28px;height:28px;
  border:3px solid var(--vscode-widget-border,rgba(255,255,255,.1));
  border-top-color:var(--vscode-activityBarBadge-background,#007acc);
  border-radius:50%;
  animation:spin .8s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg);}}
.welcome-content{
  display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  height:100%;gap:16px;
}

/* ===== Responsive ===== */
@media(max-width:360px){
  .msg{padding:10px 12px;gap:8px;}
  .msg .avatar{width:24px;height:24px;font-size:12px;}
}
</style>
</head>
<body>

<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <div class="loader" id="loader">
      <div class="spinner"></div>
      <span>Connecting to AI...</span>
    </div>
    <div class="welcome-content" id="welcome-content" style="display:none">
      <div class="welcome-icon">\u2728</div>
      <h3>AI Assistant</h3>
      <p>Ask me anything about your code. I can explain, refactor, debug, or write new code for you.</p>
      <div class="hints">
        <div class="hint" data-q="Explain the currently open file">Explain the current file</div>
        <div class="hint" data-q="Find potential bugs in this code">Find bugs in my code</div>
        <div class="hint" data-q="Suggest improvements and refactoring for this code">Suggest improvements</div>
      </div>
    </div>
  </div>
</div>

<div class="context-chips" id="context-chips"></div>

<div class="input-wrap">
  <div class="file-dropdown" id="file-dropdown"></div>
  <div class="input-box">
    <textarea id="input" rows="1" placeholder="Ask anything... (@ to attach file, Shift+Enter for newline)"></textarea>
    <div class="input-toolbar">
      <div class="left">
        <div class="model-chip" title="Select provider">
          <span>\u26A1</span>
          <select id="provider-select"><option>...</option></select>
        </div>
        <div class="model-chip" title="Select model">
          <span>\u{1F9E0}</span>
          <select id="model-select"><option>...</option></select>
        </div>
      </div>
      <div class="right">
        <button class="tool-btn" id="clear-btn" title="New chat">\u{1F5D1}</button>
        <button class="send-btn" id="send-btn">
          <span id="send-icon">\u25B6</span>
          <span id="send-label">Send</span>
        </button>
      </div>
    </div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
const CHAT_ENDPOINT = ${JSON.stringify(chatEndpoint)};

let providers = [];
let selectedProviderId = '';
let selectedModelId = '';
let history = [];
let abortController = null;
let isStreaming = false;

/* --- @file autocomplete state --- */
let workspaceFiles = [];
let attachedFiles = [];   // {path, uri, content?, language?}
let ddActiveIdx = -1;
let ddVisible = false;

const providerSelect = document.getElementById('provider-select');
const modelSelect = document.getElementById('model-select');
const messagesEl = document.getElementById('messages');
const welcomeEl = document.getElementById('welcome');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const sendIcon = document.getElementById('send-icon');
const sendLabel = document.getElementById('send-label');
const clearBtn = document.getElementById('clear-btn');
const chipsEl = document.getElementById('context-chips');
const dropdownEl = document.getElementById('file-dropdown');

// --- Init ---
vscode.postMessage({ type: 'getProviders' });
vscode.postMessage({ type: 'getWorkspaceFiles' });

// --- Hint clicks ---
document.querySelectorAll('.hint').forEach(h => {
  h.addEventListener('click', () => {
    inputEl.value = h.dataset.q;
    requestSend();
  });
});

// --- Message from extension host ---
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'providers') {
    providers = msg.data.filter(p => p.available);
    renderProviders();
    // Hide loader, show welcome content
    const loader = document.getElementById('loader');
    const welcomeContent = document.getElementById('welcome-content');
    if (loader) loader.style.display = 'none';
    if (welcomeContent) welcomeContent.style.display = 'flex';
  }
  if (msg.type === 'editorContext') {
    sendChat(msg.data);
  }
  if (msg.type === 'workspaceFiles') {
    workspaceFiles = msg.data || [];
  }
  if (msg.type === 'fileContent') {
    const af = attachedFiles.find(f => f.path === msg.data.path);
    if (af) { af.content = msg.data.content; af.language = msg.data.language; }
  }
  if (msg.type === 'error') {
    addSystemMessage(msg.message);
  }
  // --- Extension host: add file as context chip ---
  if (msg.type === 'addFileContext') {
    const d = msg.data;
    if (!attachedFiles.find(f => f.path === d.path)) {
      attachedFiles.push({ path: d.path, uri: d.uri, content: d.content, language: d.language });
      renderChips();
    }
  }
  // --- Extension host: inline chat (Ctrl+I) — prefill question and auto-send ---
  if (msg.type === 'inlineChat') {
    const d = msg.data;
    welcomeEl.style.display = 'none';
    const question = d.question;
    history.push({ role: 'user', content: question });
    appendMessage('user', esc(question), false, true);
    saveState();
    streamResponse(question, { language: d.language, fileName: d.fileName, selection: d.selection, context: d.context }, []);
  }
});

// --- Provider/Model selectors ---
function renderProviders() {
  providerSelect.innerHTML = providers.map(p =>
    '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'
  ).join('');
  const saved = getState();
  if (saved.providerId && providers.find(p => p.id === saved.providerId)) {
    providerSelect.value = saved.providerId;
  }
  selectedProviderId = providerSelect.value;
  renderModels();
}

function renderModels() {
  const provider = providers.find(p => p.id === selectedProviderId);
  if (!provider) return;
  modelSelect.innerHTML = provider.models.map(m =>
    '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'
  ).join('');
  const saved = getState();
  if (saved.modelId && provider.models.find(m => m.id === saved.modelId)) {
    modelSelect.value = saved.modelId;
  }
  selectedModelId = modelSelect.value;
  saveState();
}

providerSelect.addEventListener('change', () => { selectedProviderId = providerSelect.value; renderModels(); });
modelSelect.addEventListener('change', () => { selectedModelId = modelSelect.value; saveState(); });

// --- State ---
function getState() { return vscode.getState() || {}; }
function saveState() { vscode.setState({ providerId: selectedProviderId, modelId: selectedModelId, history }); }

// --- Restore ---
(function restore() {
  const s = getState();
  if (s.history && s.history.length) {
    history = s.history;
    welcomeEl.style.display = 'none';
    history.forEach(m => appendMessage(m.role, m.content, false));
    scrollToBottom();
  }
})();

// =====================================================================
// @file autocomplete
// =====================================================================
function getAtQuery() {
  const v = inputEl.value;
  const cur = inputEl.selectionStart;
  const before = v.slice(0, cur);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1) return null;
  // Only match if @ is at start or preceded by whitespace
  if (atIdx > 0 && !/\\s/.test(before[atIdx - 1])) return null;
  const query = before.slice(atIdx + 1);
  // Abort if query contains whitespace (user moved on)
  if (/\\s/.test(query)) return null;
  return { atIdx, query };
}

function filterFiles(query) {
  if (!query) return workspaceFiles.slice(0, 30);
  const q = query.toLowerCase();
  return workspaceFiles.filter(f => f.path.toLowerCase().includes(q)).slice(0, 30);
}

function showDropdown(items) {
  if (!items.length) {
    dropdownEl.innerHTML = '<div class="dd-empty">No matching files</div>';
    dropdownEl.classList.add('visible');
    ddVisible = true;
    ddActiveIdx = -1;
    return;
  }
  ddActiveIdx = 0;
  dropdownEl.innerHTML = items.map((f, i) =>
    '<div class="dd-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '" data-path="' + escAttr(f.path) + '" data-uri="' + escAttr(f.uri) + '">' +
    '<span class="dd-icon">\u{1F4C4}</span><span class="dd-path">' + esc(f.path) + '</span></div>'
  ).join('');
  dropdownEl.classList.add('visible');
  ddVisible = true;

  dropdownEl.querySelectorAll('.dd-item').forEach(el => {
    el.addEventListener('click', () => selectDropdownItem(el));
  });
}

function hideDropdown() {
  dropdownEl.classList.remove('visible');
  dropdownEl.innerHTML = '';
  ddVisible = false;
  ddActiveIdx = -1;
}

function selectDropdownItem(el) {
  const path = el.dataset.path;
  const uri = el.dataset.uri;
  if (!path) return;

  // Replace @query with empty (file goes to chip)
  const aq = getAtQuery();
  if (aq) {
    const before = inputEl.value.slice(0, aq.atIdx);
    const after = inputEl.value.slice(inputEl.selectionStart);
    inputEl.value = before + after;
    inputEl.selectionStart = inputEl.selectionEnd = before.length;
  }

  addFileChip(path, uri);
  hideDropdown();
  inputEl.focus();
}

function addFileChip(path, uri) {
  if (attachedFiles.find(f => f.path === path)) return;
  attachedFiles.push({ path, uri });
  renderChips();
  // Request file content
  vscode.postMessage({ type: 'getFileContent', path, uri });
}

function removeFileChip(path) {
  attachedFiles = attachedFiles.filter(f => f.path !== path);
  renderChips();
}

function renderChips() {
  chipsEl.innerHTML = attachedFiles.map(f =>
    '<span class="file-chip" data-path="' + escAttr(f.path) + '">' +
    '<span class="chip-name" title="' + escAttr(f.path) + '">' + esc(f.path.split('/').pop()) + '</span>' +
    '<span class="chip-remove" title="Remove">\u00D7</span></span>'
  ).join('');
  chipsEl.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFileChip(btn.parentElement.dataset.path);
    });
  });
}

inputEl.addEventListener('input', () => {
  autoResize();
  const aq = getAtQuery();
  if (aq) {
    const items = filterFiles(aq.query);
    showDropdown(items);
  } else {
    hideDropdown();
  }
});

inputEl.addEventListener('keydown', e => {
  // Dropdown navigation
  if (ddVisible) {
    const items = dropdownEl.querySelectorAll('.dd-item[data-path]');
    if (e.key === 'ArrowDown') { e.preventDefault(); ddActiveIdx = Math.min(ddActiveIdx + 1, items.length - 1); updateDdActive(items); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); ddActiveIdx = Math.max(ddActiveIdx - 1, 0); updateDdActive(items); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && items.length && ddActiveIdx >= 0) {
      e.preventDefault();
      selectDropdownItem(items[ddActiveIdx]);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); hideDropdown(); return; }
  }
  // Normal send
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); requestSend(); }
});

function updateDdActive(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === ddActiveIdx));
  if (items[ddActiveIdx]) items[ddActiveIdx].scrollIntoView({ block: 'nearest' });
}

// =====================================================================
// Chat logic
// =====================================================================
function requestSend() {
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;
  inputEl.value = '';
  autoResize();
  hideDropdown();
  window._pendingQuestion = text;
  window._pendingFiles = [...attachedFiles];
  attachedFiles = [];
  renderChips();
  vscode.postMessage({ type: 'getEditorContext' });
}

function sendChat(editorCtx) {
  const question = window._pendingQuestion || '';
  if (!question) return;
  const files = window._pendingFiles || [];
  window._pendingQuestion = null;
  window._pendingFiles = null;
  welcomeEl.style.display = 'none';

  // Build display: show user message with context badges
  let userHtml = esc(question);
  if (files.length) {
    userHtml += '<div class="context-badge">\u{1F4CE} ';
    userHtml += files.map(f => '<span class="cb-file">' + esc(f.path.split('/').pop()) + '</span>').join(' ');
    userHtml += '</div>';
  }

  history.push({ role: 'user', content: question });
  appendMessage('user', userHtml, false, true);
  saveState();
  streamResponse(question, editorCtx, files);
}

async function streamResponse(question, ctx, files) {
  isStreaming = true;
  sendIcon.textContent = '\u25A0';
  sendLabel.textContent = 'Stop';
  sendBtn.classList.add('stop');

  abortController = new AbortController();
  const el = appendMessage('assistant', '', true);
  const contentEl = el.querySelector('.content');
  let full = '';

  // Build file context payload
  const fileContext = files
    .filter(f => f.content)
    .map(f => ({ path: f.path, language: f.language || 'plaintext', content: f.content.slice(0, 8000) }));

  try {
    const res = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({
        question,
        language: ctx.language,
        fileName: ctx.fileName || '',
        context: ctx.context.slice(0, 4000),
        selection: ctx.selection.slice(0, 2000),
        fileContext,
        providerId: selectedProviderId,
        modelId: selectedModelId,
        history: history.slice(0, -1).slice(-20),
      }),
    });

    if (!res.ok) throw new Error((await res.text()) || 'HTTP ' + res.status);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6);
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          const tok = p.choices?.[0]?.delta?.content || p.content || p.text || p.token || '';
          if (tok) { full += tok; contentEl.innerHTML = renderMarkdown(full) + '<span class="cursor"></span>'; scrollToBottom(); }
        } catch {
          if (d && d !== '[DONE]') { full += d; contentEl.innerHTML = renderMarkdown(full) + '<span class="cursor"></span>'; scrollToBottom(); }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') full += '\\n\\n*\u2014 Stopped*';
    else full = '**Error:** ' + err.message;
  }

  contentEl.innerHTML = renderMarkdown(full);
  bindCodeBlockActions(contentEl);
  history.push({ role: 'assistant', content: full });
  saveState();
  isStreaming = false;
  abortController = null;
  sendIcon.textContent = '\u25B6';
  sendLabel.textContent = 'Send';
  sendBtn.classList.remove('stop');
  scrollToBottom();
}

// --- Buttons ---
sendBtn.addEventListener('click', () => {
  if (isStreaming && abortController) abortController.abort();
  else requestSend();
});

function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px';
}

clearBtn.addEventListener('click', () => {
  history = [];
  messagesEl.innerHTML = '';
  welcomeEl.style.display = 'flex';
  messagesEl.appendChild(welcomeEl);
  attachedFiles = [];
  renderChips();
  saveState();
});

// --- DOM helpers ---
function appendMessage(role, content, streaming, rawHtml) {
  const svg = role === 'user'
    ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2 13c0-2.8 2.2-5 5-5h2c2.8 0 5 2.2 5 5v1H2v-1z"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.8 3.6L14 5.4l-3 2.9.7 4.1L8 10.5 4.3 12.4l.7-4.1-3-2.9 4.2-.8z"/></svg>';
  const label = role === 'user' ? 'You' : 'Assistant';
  const div = document.createElement('div');
  div.className = 'msg ' + role;

  const rendered = rawHtml ? content : (content ? renderMarkdown(content) : '');
  div.innerHTML =
    '<div class="avatar">' + svg + '</div>' +
    '<div class="body"><div class="name">' + label + '</div>' +
    '<div class="content">' + rendered +
    (streaming ? '<span class="cursor"></span>' : '') + '</div></div>';
  messagesEl.appendChild(div);
  if (!streaming && !rawHtml) bindCodeBlockActions(div);
  scrollToBottom();
  return div;
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML =
    '<div class="avatar">\u26A0</div>' +
    '<div class="body"><div class="name">System</div>' +
    '<div class="content" style="color:var(--vscode-descriptionForeground,#888)">' + esc(text) + '</div></div>';
  messagesEl.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// --- Markdown ---
function renderMarkdown(text) {
  return text
    .replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
      const l = lang || 'code';
      const codeEscaped = escAttr(code.trim());
      return '<div class="code-block" data-lang="' + escAttr(l) + '" data-code="' + codeEscaped + '">' +
        '<div class="code-bar"><span class="code-lang">' + esc(l) + '</span>' +
        '<div class="code-actions">' +
        '<button class="act-apply" title="Apply to editor">\u2713 Apply</button>' +
        '<button class="act-insert" title="Insert at cursor">\u2193 Insert</button>' +
        '<button class="act-copy" title="Copy to clipboard">\u2398 Copy</button>' +
        '<button class="act-newfile" title="Open in new file">\u{1F4C4} New File</button>' +
        '<button class="act-dismiss" title="Dismiss">\u2717</button>' +
        '</div></div>' +
        '<pre><code>' + escHtml(code.trim()) + '</code></pre></div>';
    })
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>')
    .replace(/\\n/g, '<br>');
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// =====================================================================
// Code block action handlers
// =====================================================================
function getCodeFromBlock(block) {
  return (block.dataset.code || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function flashBlock(block, cls) {
  block.classList.add(cls);
  setTimeout(() => block.classList.remove(cls), 800);
}

function bindCodeBlockActions(container) {
  container.querySelectorAll('.code-block').forEach(block => {
    // Apply
    block.querySelector('.act-apply')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      vscode.postMessage({ type: 'applyCode', code });
      flashBlock(block, 'applied');
    });
    // Insert
    block.querySelector('.act-insert')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      vscode.postMessage({ type: 'insertCode', code });
      flashBlock(block, 'applied');
    });
    // Copy
    block.querySelector('.act-copy')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      navigator.clipboard.writeText(code).then(() => {
        const btn = block.querySelector('.act-copy');
        btn.textContent = '\u2713 Copied!';
        setTimeout(() => btn.textContent = '\u2398 Copy', 1500);
      });
    });
    // New file
    block.querySelector('.act-newfile')?.addEventListener('click', () => {
      const code = getCodeFromBlock(block);
      const lang = block.dataset.lang || 'plaintext';
      vscode.postMessage({ type: 'newFileWithCode', code, language: lang });
      flashBlock(block, 'applied');
    });
    // Dismiss
    block.querySelector('.act-dismiss')?.addEventListener('click', () => {
      flashBlock(block, 'rejected');
      setTimeout(() => {
        block.style.opacity = '0.4';
        block.style.pointerEvents = 'none';
      }, 600);
    });
  });
}
</script>
</body>
</html>`;
}
