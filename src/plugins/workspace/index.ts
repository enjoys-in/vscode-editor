import type { Plugin, PluginContext, Disposable } from '@core/types';
import {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override';
import { SFTPClient, type SFTPConnectOptions, type SFTPEntry } from './sftp-client';

// ---------------------------------------------------------------------------
// Workspace Plugin — lets users load files from multiple sources
//
//   1. Open Local Folder   (File System Access API — no server needed)
//   2. Upload Files        (drag & drop / file picker)
//   3. SFTP                (WebSocket bridge to remote server)
//
// All methods register files into the virtual filesystem so the explorer,
// intellisense, search, etc. all work out of the box.
// ---------------------------------------------------------------------------

export interface WorkspacePluginOptions {
  /** Base path inside the virtual FS where files are mounted (default: /workspace) */
  basePath?: string;
}

export function createWorkspacePlugin(options?: WorkspacePluginOptions): Plugin {
  const disposables: Disposable[] = [];
  const basePath = options?.basePath ?? '/workspace';

  return {
    id: 'builtin.workspace',
    name: 'Workspace Manager',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      const fsProvider = new RegisteredFileSystemProvider(false);
      const overlay = registerFileSystemOverlay(2, fsProvider); // priority 2 = above default
      disposables.push(overlay);

      const sftp = new SFTPClient();

      // -------------------------------------------------------------------
      // Workspace service — exposed to other plugins via ctx.services
      // -------------------------------------------------------------------
      const workspaceService = {

        // ----- Open local folder (File System Access API) -----

        async openLocalFolder(): Promise<number> {
          if (!('showDirectoryPicker' in window)) {
            ctx.vscode.window.showErrorMessage(
              'Your browser does not support the File System Access API. Use Chrome or Edge.',
            );
            return 0;
          }
          try {
            const dirHandle = await (window as any).showDirectoryPicker({
              mode: 'readwrite',
            }) as FileSystemDirectoryHandle;
            return loadDirectoryHandle(dirHandle, basePath);
          } catch (err: any) {
            if (err.name !== 'AbortError') {
              ctx.vscode.window.showErrorMessage(`Failed to open folder: ${err.message}`);
            }
            return 0;
          }
        },

        // ----- Upload files (returns count of loaded files) -----

        async uploadFiles(): Promise<number> {
          return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.webkitdirectory = true;
            input.onchange = async () => {
              const files = input.files;
              if (!files || files.length === 0) {
                resolve(0);
                return;
              }
              let count = 0;
              for (const file of Array.from(files)) {
                const relativePath = (file as any).webkitRelativePath || file.name;
                const content = await file.text();
                const filePath = `${basePath}/${relativePath}`;
                const uri = ctx.vscode.Uri.file(filePath);
                try {
                  fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
                  count++;
                } catch {
                  // File might already exist, skip
                }
              }
              ctx.vscode.window.showInformationMessage(
                `Loaded ${count} file(s) into workspace`,
              );
              resolve(count);
            };
            input.click();
          });
        },

        // ----- Add single file to workspace -----

        addFile(relativePath: string, content: string): void {
          const uri = ctx.vscode.Uri.file(`${basePath}/${relativePath}`);
          fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
        },

        // ----- Add files in bulk -----

        addFiles(files: Array<{ path: string; content: string }>): number {
          let count = 0;
          for (const f of files) {
            try {
              const uri = ctx.vscode.Uri.file(`${basePath}/${f.path}`);
              fsProvider.registerFile(new RegisteredMemoryFile(uri, f.content));
              count++;
            } catch {
              // skip duplicates
            }
          }
          return count;
        },

        // ----- SFTP -----

        async sftpConnect(opts: SFTPConnectOptions): Promise<void> {
          await sftp.connect(opts);
          ctx.vscode.window.showInformationMessage(
            `Connected to ${opts.host} via SFTP`,
          );
        },

        async sftpLoadFolder(remotePath: string, localPrefix?: string): Promise<number> {
          if (!sftp.isConnected) {
            ctx.vscode.window.showErrorMessage('SFTP not connected. Call sftpConnect() first.');
            return 0;
          }
          const prefix = localPrefix ?? basePath;
          const count = await loadSFTPDirectory(sftp, remotePath, prefix);
          ctx.vscode.window.showInformationMessage(
            `Loaded ${count} file(s) from SFTP:${remotePath}`,
          );
          return count;
        },

        async sftpSaveFile(relativePath: string): Promise<void> {
          if (!sftp.isConnected) {
            ctx.vscode.window.showErrorMessage('SFTP not connected.');
            return;
          }
          const uri = ctx.vscode.Uri.file(`${basePath}/${relativePath}`);
          const doc = await ctx.vscode.workspace.openTextDocument(uri);
          const content = new TextEncoder().encode(doc.getText());
          await sftp.writeFile(relativePath, content);
          ctx.vscode.window.showInformationMessage(`Saved to SFTP: ${relativePath}`);
        },

        sftpDisconnect(): void {
          sftp.disconnect();
        },

        get sftpConnected(): boolean {
          return sftp.isConnected;
        },
      };

      ctx.services.register('workspace', workspaceService);

      // -------------------------------------------------------------------
      // Commands (accessible from command palette and status bar)
      // -------------------------------------------------------------------

      disposables.push(
        ctx.vscode.commands.registerCommand('workspace.openLocalFolder', () =>
          workspaceService.openLocalFolder(),
        ),
      );
      disposables.push(
        ctx.vscode.commands.registerCommand('workspace.uploadFiles', () =>
          workspaceService.uploadFiles(),
        ),
      );
      disposables.push(
        ctx.vscode.commands.registerCommand('workspace.sftpConnect', async () => {
          const host = await ctx.vscode.window.showInputBox({
            prompt: 'SFTP Host',
            placeHolder: 'example.com',
          });
          if (!host) return;

          const username = await ctx.vscode.window.showInputBox({
            prompt: 'Username',
            placeHolder: 'root',
          });
          if (!username) return;

          const password = await ctx.vscode.window.showInputBox({
            prompt: 'Password',
            password: true,
          });

          const bridgeUrl = await ctx.vscode.window.showInputBox({
            prompt: 'SFTP Bridge WebSocket URL',
            placeHolder: 'ws://localhost:3100',
            value: 'ws://localhost:3100',
          });
          if (!bridgeUrl) return;

          try {
            await workspaceService.sftpConnect({
              bridgeUrl,
              host,
              username,
              password: password ?? undefined,
            });
          } catch (err: any) {
            ctx.vscode.window.showErrorMessage(`SFTP connection failed: ${err.message}`);
          }
        }),
      );
      disposables.push(
        ctx.vscode.commands.registerCommand('workspace.sftpLoadFolder', async () => {
          const remotePath = await ctx.vscode.window.showInputBox({
            prompt: 'Remote folder path to load',
            placeHolder: '/home/user/project',
          });
          if (!remotePath) return;
          await workspaceService.sftpLoadFolder(remotePath);
        }),
      );

      // -------------------------------------------------------------------
      // Status bar
      // -------------------------------------------------------------------

      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Left,
        50,
      );
      statusItem.text = '$(folder) Open Folder';
      statusItem.tooltip = 'Open a local folder or connect via SFTP';
      statusItem.command = 'workspace.openLocalFolder';
      statusItem.show();
      disposables.push(statusItem);

      // -------------------------------------------------------------------
      // Helpers — local directory loading
      // -------------------------------------------------------------------

      async function loadDirectoryHandle(
        dirHandle: FileSystemDirectoryHandle,
        prefix: string,
      ): Promise<number> {
        let count = 0;
        for await (const entry of (dirHandle as any).values()) {
          const entryPath = `${prefix}/${entry.name}`;
          if (entry.kind === 'file') {
            try {
              const file: File = await entry.getFile();
              const content = await file.text();
              const uri = ctx.vscode.Uri.file(entryPath);
              fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
              count++;
            } catch {
              // Binary or unreadable file, skip
            }
          } else if (entry.kind === 'directory') {
            // Skip common heavy directories
            if (['node_modules', '.git', '__pycache__', '.next', 'dist'].includes(entry.name)) {
              continue;
            }
            count += await loadDirectoryHandle(entry, entryPath);
          }
        }
        return count;
      }

      // -------------------------------------------------------------------
      // Helpers — SFTP recursive load
      // -------------------------------------------------------------------

      async function loadSFTPDirectory(
        client: SFTPClient,
        remotePath: string,
        localPrefix: string,
      ): Promise<number> {
        let count = 0;
        const entries: SFTPEntry[] = await client.list(remotePath);

        for (const entry of entries) {
          if (entry.name === '.' || entry.name === '..') continue;
          const remote = `${remotePath}/${entry.name}`;
          const local = `${localPrefix}/${entry.name}`;

          if (entry.type === 'dir') {
            if (['node_modules', '.git', '__pycache__'].includes(entry.name)) continue;
            count += await loadSFTPDirectory(client, remote, local);
          } else {
            try {
              const data = await client.readFile(remote);
              const content = new TextDecoder().decode(data);
              const uri = ctx.vscode.Uri.file(local);
              fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
              count++;
            } catch {
              // Skip unreadable files
            }
          }
        }
        return count;
      }
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export { SFTPClient, type SFTPConnectOptions, type SFTPEntry };
