import type { Plugin, PluginContext, Disposable } from '@core/types';
import { registerExtension } from '@codingame/monaco-vscode-api/extensions';
import { ExtensionHostKind } from '@codingame/monaco-vscode-extensions-service-override';
import { ConnectionStorage, type ConnectionProfile } from './storage';

// ---------------------------------------------------------------------------
// SFTP Connections Plugin — sidebar panel with saved connection profiles
//
// Registers a VS Code sidebar view (activity bar icon) showing:
//   - Saved SFTP connection profiles (click to connect)
//   - Add / delete profiles
//   - Connection status
// ---------------------------------------------------------------------------

type TreeItemType =
  | 'connections-header'
  | 'profile'
  | 'add-profile'
  | 'connected-header'
  | 'disconnect-button'
  | 'load-folder-button'
  | 'no-profiles';

interface SftpTreeItem {
  type: TreeItemType;
  label: string;
  description?: string;
  profile?: ConnectionProfile;
}

export function createAccountPlugin(): Plugin {
  const disposables: Disposable[] = [];

  return {
    id: 'builtin.sftp-connections',
    name: 'SFTP Connections',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      const storage = new ConnectionStorage();
      let connectedProfile: string | null = null;

      // ---------------------------------------------------------------
      // Register the sidebar extension with activity bar icon + tree view
      // ---------------------------------------------------------------

      const { getApi } = registerExtension(
        {
          name: 'sftp-connections',
          publisher: 'webterminal',
          version: '1.0.0',
          engines: { vscode: '*' },
          contributes: {
            viewsContainers: {
              activitybar: [
                {
                  id: 'sftp-sidebar',
                  title: 'SFTP Connections',
                  icon: '$(remote-explorer)',
                },
              ],
            },
            views: {
              'sftp-sidebar': [
                {
                  id: 'sftp-connections-view',
                  name: 'Connections',
                },
              ],
            },
          },
        } as any,
        ExtensionHostKind.LocalProcess,
      );

      // ---------------------------------------------------------------
      // Tree data provider — builds the sidebar tree
      // ---------------------------------------------------------------

      let onDidChangeEmitter: any = null;

      function refreshTree() {
        onDidChangeEmitter?.fire(undefined);
      }

      void getApi().then(async (vscodeApi) => {
        onDidChangeEmitter = new vscodeApi.EventEmitter<SftpTreeItem | undefined>();

        disposables.push(vscodeApi.commands.registerCommand('sftp.addProfile', () => addProfileFlow()));
        disposables.push(vscodeApi.commands.registerCommand('sftp.deleteProfile', (p?: ConnectionProfile) => deleteProfileFlow(p)));
        disposables.push(vscodeApi.commands.registerCommand('sftp.connectProfile', (p: ConnectionProfile) => connectToProfile(p)));
        disposables.push(vscodeApi.commands.registerCommand('sftp.disconnect', () => {
          const workspace = ctx.services.get<any>('workspace');
          workspace?.sftpDisconnect();
          connectedProfile = null;
          updateStatus();
          refreshTree();
          ctx.vscode.window.showInformationMessage('SFTP disconnected.');
        }));
        disposables.push(vscodeApi.commands.registerCommand('sftp.loadRemoteFolder', async () => {
          const workspace = ctx.services.get<any>('workspace');
          if (!workspace?.sftpConnected) {
            ctx.vscode.window.showErrorMessage('Not connected to SFTP.');
            return;
          }
          const remotePath = await ctx.vscode.window.showInputBox({
            prompt: 'Remote folder path to load',
            placeHolder: '/home/user/project',
          });
          if (remotePath) {
            await workspace.sftpLoadFolder(remotePath);
          }
        }));
        disposables.push(vscodeApi.commands.registerCommand('sftp.menu', () => sftpMenu()));

        function getTreeItems(): SftpTreeItem[] {
          const items: SftpTreeItem[] = [];

          if (connectedProfile) {
            items.push({
              type: 'connected-header',
              label: connectedProfile,
              description: 'connected',
            });
            items.push({ type: 'load-folder-button', label: 'Load Remote Folder' });
            items.push({ type: 'disconnect-button', label: 'Disconnect' });
          }

          items.push({ type: 'connections-header', label: 'Saved Connections' });

          const profiles = storage.getProfiles();
          if (profiles.length === 0) {
            items.push({ type: 'no-profiles', label: 'No saved connections' });
          } else {
            for (const p of profiles) {
              items.push({
                type: 'profile',
                label: p.label,
                description: `${p.username}@${p.host}:${p.port}`,
                profile: p,
              });
            }
          }

          items.push({ type: 'add-profile', label: 'Add Connection...' });

          return items;
        }

        const treeDataProvider = {
          onDidChangeTreeData: onDidChangeEmitter.event,

          getTreeItem(element: SftpTreeItem) {
            const item = new vscodeApi.TreeItem(element.label);
            item.description = element.description;

            switch (element.type) {
              case 'connected-header':
                item.iconPath = new vscodeApi.ThemeIcon('vm-active');
                break;
              case 'disconnect-button':
                item.iconPath = new vscodeApi.ThemeIcon('debug-disconnect');
                item.command = { command: 'sftp.disconnect', title: 'Disconnect' };
                break;
              case 'load-folder-button':
                item.iconPath = new vscodeApi.ThemeIcon('folder-opened');
                item.command = { command: 'sftp.loadRemoteFolder', title: 'Load Folder' };
                break;
              case 'connections-header':
                item.iconPath = new vscodeApi.ThemeIcon('server-environment');
                break;
              case 'profile':
                item.iconPath = new vscodeApi.ThemeIcon('server');
                item.command = {
                  command: 'sftp.connectProfile',
                  title: 'Connect',
                  arguments: [element.profile],
                };
                item.tooltip = `${element.profile!.username}@${element.profile!.host}:${element.profile!.port}\nBridge: ${element.profile!.bridgeUrl}\nClick to connect`;
                break;
              case 'add-profile':
                item.iconPath = new vscodeApi.ThemeIcon('add');
                item.command = { command: 'sftp.addProfile', title: 'Add Connection' };
                break;
              case 'no-profiles':
                item.iconPath = new vscodeApi.ThemeIcon('info');
                break;
            }

            return item;
          },

          getChildren(): SftpTreeItem[] {
            return getTreeItems();
          },
        };

        vscodeApi.window.registerTreeDataProvider('sftp-connections-view', treeDataProvider);
      });

      // ---------------------------------------------------------------
      // Status bar
      // ---------------------------------------------------------------

      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Right,
        200,
      );
      updateStatus();
      statusItem.show();
      disposables.push(statusItem);

      function updateStatus() {
        if (connectedProfile) {
          statusItem.text = `$(vm-active) ${connectedProfile}`;
          statusItem.tooltip = 'Connected to SFTP';
          statusItem.command = 'sftp.menu';
        } else {
          statusItem.text = '$(remote-explorer) SFTP';
          statusItem.tooltip = 'Open SFTP connections';
          statusItem.command = 'sftp.menu';
        }
      }

      // ---------------------------------------------------------------
      // Quick-pick menu (from status bar)
      // ---------------------------------------------------------------

      async function sftpMenu(): Promise<void> {
        const items = ['$(remote-explorer) Open SFTP Panel', '$(add) Add Connection'];
        if (connectedProfile) {
          items.push('$(debug-disconnect) Disconnect');
        }
        const pick = await ctx.vscode.window.showQuickPick(items, {
          placeHolder: connectedProfile ? `Connected: ${connectedProfile}` : 'SFTP Connections',
        });
        if (!pick) return;

        if (pick.includes('SFTP Panel')) {
          ctx.vscode.commands.executeCommand('sftp-connections-view.focus');
        } else if (pick.includes('Add Connection')) {
          addProfileFlow();
        } else if (pick.includes('Disconnect')) {
          const workspace = ctx.services.get<any>('workspace');
          workspace?.sftpDisconnect();
          connectedProfile = null;
          refreshTree();
          updateStatus();
        }
      }

      // ---------------------------------------------------------------
      // Connect to a profile
      // ---------------------------------------------------------------

      async function connectToProfile(profile: ConnectionProfile): Promise<void> {
        const workspace = ctx.services.get<any>('workspace');
        if (!workspace) {
          ctx.vscode.window.showErrorMessage('Workspace plugin not loaded.');
          return;
        }

        try {
          if (profile.usePrivateKey) {
            const key = await ctx.vscode.window.showInputBox({
              prompt: 'Paste your private key',
              password: true,
            });
            if (key) {
              await workspace.sftpConnect({
                bridgeUrl: profile.bridgeUrl,
                host: profile.host,
                port: profile.port,
                username: profile.username,
                privateKey: key,
              });
              connectedProfile = profile.label;
              updateStatus();
              refreshTree();
              return;
            }
          }

          let password = profile.password;
          if (!password) {
            password = await ctx.vscode.window.showInputBox({
              prompt: `Password for ${profile.username}@${profile.host}`,
              password: true,
            });
          }
          if (!password) return;

          await workspace.sftpConnect({
            bridgeUrl: profile.bridgeUrl,
            host: profile.host,
            port: profile.port,
            username: profile.username,
            password,
          });

          connectedProfile = profile.label;
          updateStatus();
          refreshTree();

          const remotePath = await ctx.vscode.window.showInputBox({
            prompt: 'Remote folder to load (leave empty to skip)',
            placeHolder: '/home/user/project',
          });
          if (remotePath) {
            await workspace.sftpLoadFolder(remotePath);
          }
        } catch (err: any) {
          ctx.vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
        }
      }

      // ---------------------------------------------------------------
      // Add Profile flow
      // ---------------------------------------------------------------

      async function addProfileFlow(): Promise<void> {
        const label = await ctx.vscode.window.showInputBox({
          prompt: 'Connection name',
          placeHolder: 'My Server',
        });
        if (!label) return;

        const host = await ctx.vscode.window.showInputBox({
          prompt: 'SFTP Host',
          placeHolder: 'example.com',
        });
        if (!host) return;

        const portStr = await ctx.vscode.window.showInputBox({
          prompt: 'SSH Port',
          value: '22',
        });
        const port = parseInt(portStr || '22', 10);

        const username = await ctx.vscode.window.showInputBox({
          prompt: 'SSH Username',
          placeHolder: 'root',
        });
        if (!username) return;

        const authMethod = await ctx.vscode.window.showQuickPick(
          ['Password', 'Private Key (entered at connect time)'],
          { placeHolder: 'Authentication method' },
        );
        if (!authMethod) return;

        let password: string | undefined;
        if (authMethod === 'Password') {
          password = await ctx.vscode.window.showInputBox({
            prompt: 'SSH Password (saved locally)',
            password: true,
          });
        }

        const bridgeUrl = await ctx.vscode.window.showInputBox({
          prompt: 'SFTP Bridge WebSocket URL',
          placeHolder: 'ws://localhost:7145',
          value: 'ws://localhost:7145',
        });
        if (!bridgeUrl) return;

        storage.addProfile({
          label,
          bridgeUrl,
          host,
          port,
          username,
          password,
          usePrivateKey: authMethod.startsWith('Private'),
        });

        ctx.vscode.window.showInformationMessage(`Connection "${label}" saved.`);
        refreshTree();
      }

      // ---------------------------------------------------------------
      // Delete Profile flow
      // ---------------------------------------------------------------

      async function deleteProfileFlow(profileToDelete?: ConnectionProfile): Promise<void> {
        let profile = profileToDelete;
        if (!profile) {
          const profiles = storage.getProfiles();
          if (profiles.length === 0) {
            ctx.vscode.window.showInformationMessage('No saved connections.');
            return;
          }
          const items = profiles.map((p) => ({
            label: p.label,
            description: `${p.username}@${p.host}:${p.port}`,
            id: p.id,
          }));
          const pick = await ctx.vscode.window.showQuickPick(items, {
            placeHolder: 'Select a connection to delete',
          });
          if (!pick) return;
          profile = profiles.find((p) => p.id === (pick as any).id);
        }
        if (!profile) return;

        const confirm = await ctx.vscode.window.showQuickPick(['Yes, delete it', 'Cancel'], {
          placeHolder: `Delete "${profile.label}"?`,
        });
        if (confirm !== 'Yes, delete it') return;

        storage.deleteProfile(profile.id);
        ctx.vscode.window.showInformationMessage(`Connection "${profile.label}" deleted.`);
        refreshTree();
      }

      // ---------------------------------------------------------------
      // Register service
      // ---------------------------------------------------------------

      ctx.services.register('sftp-connections', {
        get connectedProfile() { return connectedProfile; },
        getProfiles: () => storage.getProfiles(),
        addProfile: (p: any) => storage.addProfile(p),
        deleteProfile: (id: string) => { storage.deleteProfile(id); refreshTree(); },
        connectProfile: (p: ConnectionProfile) => connectToProfile(p),
      });
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
