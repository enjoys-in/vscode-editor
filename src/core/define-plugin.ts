// ---------------------------------------------------------------------------
// definePlugin — Developer-friendly plugin builder
//
// Usage:
//   import { definePlugin } from '@core/define-plugin';
//
//   export default definePlugin({
//     id: 'my-plugin',
//     name: 'My Plugin',
//
//     commands: [
//       { id: 'myPlugin.hello', title: 'Say Hello', handler: (ctx) => ... },
//     ],
//
//     contextMenu: [
//       { command: 'myPlugin.hello', group: 'navigation', when: 'editorTextFocus' },
//     ],
//
//     statusBar: [
//       { id: 'myPlugin.status', text: '$(rocket) Ready', tooltip: 'My Plugin', command: 'myPlugin.hello', alignment: 'right' },
//     ],
//
//     sidebar: {
//       id: 'my-sidebar',
//       title: 'My Panel',
//       icon: '$(symbol-misc)',
//       views: [{ id: 'my-tree', name: 'Items', treeDataProvider: (ctx) => ... }],
//     },
//
//     activate(ctx) { ... },
//     deactivate() { ... },
//   });
// ---------------------------------------------------------------------------

import type { Plugin, PluginContext, Disposable } from './types';
import { registerExtension } from '@codingame/monaco-vscode-api/extensions';
import { ExtensionHostKind } from '@codingame/monaco-vscode-extensions-service-override';
import {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CommandDef {
  /** Unique command ID, e.g. 'myPlugin.doSomething' */
  id: string;
  /** Human-readable title shown in command palette */
  title: string;
  /** Optional category prefix in command palette, e.g. 'My Plugin' */
  category?: string;
  /** The handler function. Receives PluginContext + any args */
  handler: (ctx: PluginContext, ...args: unknown[]) => unknown;
  /** Optional keybinding, e.g. 'ctrl+shift+h' */
  keybinding?: string;
  /** Optional when clause for keybinding */
  when?: string;
}

export interface ContextMenuEntry {
  /** Command ID to invoke (must be defined in commands[]) */
  command: string;
  /** Context menu group: 'navigation' (top), '1_modification', '9_cutcopypaste', etc. */
  group?: string;
  /** When clause, e.g. 'editorTextFocus', 'resourceScheme == file' */
  when?: string;
}

export interface StatusBarDef {
  /** Unique ID for the status bar item */
  id: string;
  /** Display text, supports ThemeIcon syntax: '$(icon-name) text' */
  text: string;
  /** Tooltip on hover */
  tooltip?: string;
  /** Command ID to run on click */
  command?: string;
  /** 'left' or 'right' (default: 'right') */
  alignment?: 'left' | 'right';
  /** Priority (higher = further left). Default: 100 */
  priority?: number;
  /** Optional color */
  color?: string;
}

export interface SidebarViewDef {
  /** View ID (must be unique) */
  id: string;
  /** Display name in the sidebar panel */
  name: string;
  /** Return a VS Code TreeDataProvider. Called after activation */
  treeDataProvider?: (ctx: PluginContext) => any;
}

export interface SidebarDef {
  /** Container ID */
  id: string;
  /** Title shown in the activity bar tooltip */
  title: string;
  /** Codicon icon, e.g. '$(rocket)' */
  icon: string;
  /** Views inside this sidebar panel */
  views: SidebarViewDef[];
}

// ---------------------------------------------------------------------------
// Webview types
// ---------------------------------------------------------------------------

export interface WebviewPanelDef {
  /** Unique view type ID */
  viewType: string;
  /** Panel title */
  title: string;
  /** Return the HTML content for the webview. Receives ctx for building URIs */
  html: string | ((ctx: PluginContext) => string);
  /** Column to show in (1 = main, 2 = beside). Default: 1 */
  column?: number;
  /** Allow scripts inside webview? Default: true */
  enableScripts?: boolean;
  /** Retain context when hidden? Default: false */
  retainContextWhenHidden?: boolean;
  /** Handle messages from webview → extension */
  onMessage?: (ctx: PluginContext, message: any) => void;
  /** Codicon icon for the tab, e.g. 'globe' */
  icon?: string;
}

export interface WebviewSidebarDef {
  /** View ID — must match a view registered in sidebar.views */
  viewId: string;
  /** Return HTML content */
  html: string | ((ctx: PluginContext) => string);
  /** Allow scripts inside webview? Default: true */
  enableScripts?: boolean;
  /** Retain context when hidden? Default: false */
  retainContextWhenHidden?: boolean;
  /** Handle messages from webview → extension */
  onMessage?: (ctx: PluginContext, message: any) => void;
}

// ---------------------------------------------------------------------------
// File system types
// ---------------------------------------------------------------------------

export interface VirtualFileDef {
  /** Virtual file path, e.g. '/myfs/readme.md' */
  path: string;
  /** File content (string or Uint8Array) */
  content: string | Uint8Array;
}

export interface FileSystemDef {
  /** Scheme for the virtual FS, e.g. 'htmlfs', 'memfs' */
  scheme?: string;
  /** Priority for overlay (higher overrides lower). Default: 2 */
  priority?: number;
  /** Whether the FS is read-only. Default: true */
  readOnly?: boolean;
  /** Initial files to register on the virtual FS */
  files?: VirtualFileDef[];
  /** Auto-open these file paths in editor tabs after registration */
  openFiles?: string[];
  /**
   * Advanced: return a custom FileSystemProvider.
   * If provided, `files` and `readOnly` are ignored.
   */
  provider?: (ctx: PluginContext) => any;
}

export interface PluginDef {
  id: string;
  name: string;
  version?: string;

  /** Commands — automatically registered in command palette */
  commands?: CommandDef[];

  /** Right-click context menu entries (must reference command IDs from commands[]) */
  contextMenu?: ContextMenuEntry[];

  /** Status bar items */
  statusBar?: StatusBarDef[];

  /** Sidebar panel with tree views */
  sidebar?: SidebarDef;

  /** Webview panels (open in editor area) */
  webviewPanels?: WebviewPanelDef[];

  /** Webview sidebar views (render HTML inside sidebar) */
  webviewSidebar?: WebviewSidebarDef[];

  /** Virtual file system — register files, open folder, custom FS */
  fileSystem?: FileSystemDef;

  /** Extra activation logic (runs after all declarative features are set up) */
  activate?: (ctx: PluginContext) => Promise<void> | void;

  /** Cleanup */
  deactivate?: () => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// definePlugin — builds a Plugin from a declarative definition
// ---------------------------------------------------------------------------

export function definePlugin(def: PluginDef): Plugin {
  const disposables: Disposable[] = [];

  return {
    id: def.id,
    name: def.name,
    version: def.version ?? '1.0.0',

    async activate(ctx: PluginContext) {
      // --- 1. Commands + Command Palette ---
      if (def.commands?.length) {
        const paletteCommands: Array<{ command: string; title: string; category?: string }> = [];

        for (const cmd of def.commands) {
          // Register the handler via vscode API so it works everywhere
          disposables.push(
            ctx.vscode.commands.registerCommand(cmd.id, (...args: unknown[]) =>
              cmd.handler(ctx, ...args),
            ),
          );

          // Collect for command palette contribution
          paletteCommands.push({
            command: cmd.id,
            title: cmd.title,
            category: cmd.category,
          });

          // Keybinding
          if (cmd.keybinding) {
            disposables.push(
              ctx.registerKeybinding({
                command: cmd.id,
                key: cmd.keybinding,
                when: cmd.when,
              }),
            );
          }
        }
      }

      // --- 2. Context Menu (editor/context) ---
      if (def.contextMenu?.length) {
        // Register an extension contribution for editor context menu
        const menuContrib: Record<string, Array<{ command: string; group?: string; when?: string }>> = {
          'editor/context': def.contextMenu.map((entry) => ({
            command: entry.command,
            group: entry.group ?? 'navigation',
            when: entry.when ?? '',
          })),
        };

        // Build commands contribution array for the extension manifest
        const commandsContrib = (def.commands ?? [])
          .filter((cmd) => def.contextMenu!.some((m) => m.command === cmd.id))
          .map((cmd) => ({
            command: cmd.id,
            title: cmd.title,
            category: cmd.category,
          }));

        const { getApi } = registerExtension(
          {
            name: `${def.id}-menus`,
            publisher: 'webterminal-plugin',
            version: '1.0.0',
            engines: { vscode: '*' },
            contributes: {
              commands: commandsContrib,
              menus: menuContrib,
            },
          } as any,
          ExtensionHostKind.LocalProcess,
        );

        // Re-register commands in the extension scope so they resolve
        void getApi().then((api) => {
          for (const cmd of def.commands ?? []) {
            if (def.contextMenu!.some((m) => m.command === cmd.id)) {
              disposables.push(
                api.commands.registerCommand(cmd.id, (...args: unknown[]) =>
                  cmd.handler(ctx, ...args),
                ),
              );
            }
          }
        });
      }

      // --- 3. Status Bar ---
      if (def.statusBar?.length) {
        for (const sb of def.statusBar) {
          const alignment =
            sb.alignment === 'left'
              ? ctx.vscode.StatusBarAlignment.Left
              : ctx.vscode.StatusBarAlignment.Right;
          const item = ctx.vscode.window.createStatusBarItem(alignment, sb.priority ?? 100);
          item.text = sb.text;
          if (sb.tooltip) item.tooltip = sb.tooltip;
          if (sb.command) item.command = sb.command;
          if (sb.color) item.color = sb.color;
          item.show();
          disposables.push(item);

          // Expose updater on services so plugin code can update it
          ctx.services.register(`statusBar:${sb.id}`, {
            update(patch: Partial<StatusBarDef>) {
              if (patch.text !== undefined) item.text = patch.text;
              if (patch.tooltip !== undefined) item.tooltip = patch.tooltip;
              if (patch.command !== undefined) item.command = patch.command;
              if (patch.color !== undefined) item.color = patch.color;
            },
          });
        }
      }

      // --- 4. Sidebar (activity bar + tree views) ---
      if (def.sidebar) {
        const sb = def.sidebar;

        const viewsContrib: Record<string, Array<{ id: string; name: string }>> = {
          [sb.id]: sb.views.map((v) => ({ id: v.id, name: v.name })),
        };

        const { getApi } = registerExtension(
          {
            name: `${def.id}-sidebar`,
            publisher: 'webterminal-plugin',
            version: '1.0.0',
            engines: { vscode: '*' },
            contributes: {
              viewsContainers: {
                activitybar: [
                  {
                    id: sb.id,
                    title: sb.title,
                    icon: sb.icon,
                  },
                ],
              },
              views: viewsContrib,
            },
          } as any,
          ExtensionHostKind.LocalProcess,
        );

        void getApi().then((api) => {
          for (const view of sb.views) {
            if (view.treeDataProvider) {
              const provider = view.treeDataProvider(ctx);
              api.window.registerTreeDataProvider(view.id, provider);
            }
          }
        });
      }

      // --- 5. Webview Panels (editor area) ---
      if (def.webviewPanels?.length) {
        for (const wp of def.webviewPanels) {
          // Register a command to open the panel
          const openCmd = `${def.id}.openWebview.${wp.viewType}`;
          disposables.push(
            ctx.vscode.commands.registerCommand(openCmd, () => {
              const column = wp.column === 2
                ? ctx.vscode.ViewColumn.Beside
                : ctx.vscode.ViewColumn.One;

              const panel = ctx.vscode.window.createWebviewPanel(
                wp.viewType,
                wp.title,
                column,
                {
                  enableScripts: wp.enableScripts !== false,
                  retainContextWhenHidden: wp.retainContextWhenHidden ?? false,
                },
              );

              if (wp.icon) {
                (panel as any).iconPath = new ctx.vscode.ThemeIcon(wp.icon);
              }

              panel.webview.html = typeof wp.html === 'function' ? wp.html(ctx) : wp.html;

              if (wp.onMessage) {
                panel.webview.onDidReceiveMessage((msg: any) => wp.onMessage!(ctx, msg));
              }

              // Expose panel on services for programmatic access
              ctx.services.register(`webviewPanel:${wp.viewType}`, {
                panel,
                postMessage: (msg: any) => panel.webview.postMessage(msg),
                setHtml: (html: string) => { panel.webview.html = html; },
              });
            }),
          );
        }
      }

      // --- 6. Webview Sidebar Views ---
      if (def.webviewSidebar?.length && def.sidebar) {
        const sb = def.sidebar;

        // Build list of webview view IDs for the extension contribution
        const webviewViewIds = def.webviewSidebar.map((wv) => wv.viewId);

        // We need to register WebviewViewProviders inside the sidebar extension's API scope
        // The sidebar extension was already registered above; get its API
        const { getApi: getSidebarApi } = registerExtension(
          {
            name: `${def.id}-webviews`,
            publisher: 'webterminal-plugin',
            version: '1.0.0',
            engines: { vscode: '*' },
            contributes: {
              views: {
                [sb.id]: def.webviewSidebar.map((wv) => ({
                  id: wv.viewId,
                  name: wv.viewId,
                  type: 'webview',
                })),
              },
            },
          } as any,
          ExtensionHostKind.LocalProcess,
        );

        void getSidebarApi().then((api) => {
          for (const wv of def.webviewSidebar!) {
            api.window.registerWebviewViewProvider(wv.viewId, {
              resolveWebviewView(webviewView: any) {
                webviewView.webview.options = {
                  enableScripts: wv.enableScripts !== false,
                };
                webviewView.webview.html =
                  typeof wv.html === 'function' ? wv.html(ctx) : wv.html;

                if (wv.onMessage) {
                  webviewView.webview.onDidReceiveMessage((msg: any) =>
                    wv.onMessage!(ctx, msg),
                  );
                }

                ctx.services.register(`webviewSidebar:${wv.viewId}`, {
                  webviewView,
                  postMessage: (msg: any) => webviewView.webview.postMessage(msg),
                  setHtml: (html: string) => { webviewView.webview.html = html; },
                });
              },
            });
          }
        });
      }

      // --- 7. Virtual File System ---
      if (def.fileSystem) {
        const fsDef = def.fileSystem;

        if (fsDef.provider) {
          // Advanced: user provides a custom provider
          const customProvider = fsDef.provider(ctx);
          const overlay = registerFileSystemOverlay(fsDef.priority ?? 2, customProvider);
          disposables.push(overlay);
        } else {
          // Simple: register files on a RegisteredFileSystemProvider
          const fsProvider = new RegisteredFileSystemProvider(fsDef.readOnly !== false);

          if (fsDef.files?.length) {
            for (const file of fsDef.files) {
              const uri = ctx.vscode.Uri.file(file.path);
              const content =
                typeof file.content === 'string'
                  ? file.content
                  : file.content;
              fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
            }
          }

          const overlay = registerFileSystemOverlay(fsDef.priority ?? 2, fsProvider);
          disposables.push(overlay);

          // Expose FS provider for dynamic file registration
          ctx.services.register(`fileSystem:${def.id}`, {
            provider: fsProvider,
            addFile(path: string, content: string | Uint8Array) {
              fsProvider.registerFile(
                new RegisteredMemoryFile(ctx.vscode.Uri.file(path), content),
              );
            },
          });
        }

        // Auto-open files
        if (fsDef.openFiles?.length) {
          for (const filePath of fsDef.openFiles) {
            const uri = ctx.vscode.Uri.file(filePath);
            ctx.vscode.window.showTextDocument(uri, { preview: false });
          }
        }
      }

      // --- 8. Custom activation logic ---
      if (def.activate) {
        await def.activate(ctx);
      }
    },

    async deactivate() {
      if (def.deactivate) {
        await def.deactivate();
      }
      for (const d of disposables.splice(0)) {
        d.dispose();
      }
    },
  };
}
