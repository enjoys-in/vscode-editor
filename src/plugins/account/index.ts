import type { Plugin, PluginContext, Disposable } from '@core/types';
import { registerExtension } from '@codingame/monaco-vscode-api/extensions';
import { ExtensionHostKind } from '@codingame/monaco-vscode-extensions-service-override';
import { AccountStorage, type ConnectionProfile } from './storage';

// ---------------------------------------------------------------------------
// Account Plugin — sidebar panel with login + SFTP connection profiles
//
// Registers a VS Code sidebar view (activity bar icon) showing:
//   - Account status (sign in / sign out)
//   - Saved SFTP connection profiles (click to connect)
//   - Add / delete profiles
//   - Connection status
// ---------------------------------------------------------------------------

type TreeItemType =
  | 'account-header'
  | 'login-button'
  | 'logout-button'
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
    id: 'builtin.account',
    name: 'Account Manager',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      const storage = new AccountStorage();
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

        function getTreeItems(): SftpTreeItem[] {
          const items: SftpTreeItem[] = [];

          // Account section
          if (storage.isLoggedIn) {
            items.push({
              type: 'account-header',
              label: `Signed in as ${storage.currentUser}`,
            });
            items.push({ type: 'logout-button', label: 'Sign Out' });
          } else {
            items.push({ type: 'login-button', label: 'Sign In / Create Account' });
          }

          // Connection status
          if (connectedProfile) {
            items.push({
              type: 'connected-header',
              label: connectedProfile,
              description: 'connected',
            });
            items.push({ type: 'load-folder-button', label: 'Load Remote Folder' });
            items.push({ type: 'disconnect-button', label: 'Disconnect' });
          }

          // Saved profiles
          if (storage.isLoggedIn) {
            items.push({ type: 'connections-header', label: 'Saved Connections' });

            const profiles = storage.getUserProfiles();
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
          }

          return items;
        }

        const treeDataProvider = {
          onDidChangeTreeData: onDidChangeEmitter.event,

          getTreeItem(element: SftpTreeItem) {
            const item = new vscodeApi.TreeItem(element.label);
            item.description = element.description;

            switch (element.type) {
              case 'account-header':
                item.iconPath = new vscodeApi.ThemeIcon('account');
                break;
              case 'login-button':
                item.iconPath = new vscodeApi.ThemeIcon('sign-in');
                item.command = { command: 'account.login', title: 'Sign In' };
                break;
              case 'logout-button':
                item.iconPath = new vscodeApi.ThemeIcon('sign-out');
                item.command = { command: 'account.logout', title: 'Sign Out' };
                break;
              case 'connected-header':
                item.iconPath = new vscodeApi.ThemeIcon('vm-active');
                break;
              case 'disconnect-button':
                item.iconPath = new vscodeApi.ThemeIcon('debug-disconnect');
                item.command = { command: 'account.disconnect', title: 'Disconnect' };
                break;
              case 'load-folder-button':
                item.iconPath = new vscodeApi.ThemeIcon('folder-opened');
                item.command = { command: 'account.loadRemoteFolder', title: 'Load Folder' };
                break;
              case 'connections-header':
                item.iconPath = new vscodeApi.ThemeIcon('server-environment');
                break;
              case 'profile':
                item.iconPath = new vscodeApi.ThemeIcon('server');
                item.command = {
                  command: 'account.connectProfile',
                  title: 'Connect',
                  arguments: [element.profile],
                };
                item.tooltip = `${element.profile!.username}@${element.profile!.host}:${element.profile!.port}\nBridge: ${element.profile!.bridgeUrl}\nClick to connect`;
                break;
              case 'add-profile':
                item.iconPath = new vscodeApi.ThemeIcon('add');
                item.command = { command: 'account.addProfile', title: 'Add Connection' };
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
      // Status bar — shows login state (right side)
      // ---------------------------------------------------------------

      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Right,
        200,
      );
      updateStatus();
      statusItem.show();
      disposables.push(statusItem);

      function updateStatus() {
        if (storage.isLoggedIn) {
          statusItem.text = `$(account) ${storage.currentUser}`;
          statusItem.tooltip = 'Click to manage account';
          statusItem.command = 'account.menu';
        } else {
          statusItem.text = '$(sign-in) Sign In';
          statusItem.tooltip = 'Sign in to access SFTP connections';
          statusItem.command = 'account.login';
        }
      }

      // ---------------------------------------------------------------
      // Login / Register flow
      // ---------------------------------------------------------------

      async function loginFlow(): Promise<boolean> {
        const action = await ctx.vscode.window.showQuickPick(
          ['Sign In', 'Create Account'],
          { placeHolder: 'Choose an action' },
        );
        if (!action) return false;

        const username = await ctx.vscode.window.showInputBox({
          prompt: 'Username',
          placeHolder: 'Enter your username',
          validateInput(value) {
            if (!value || value.length < 2) return 'Username must be at least 2 characters';
            if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Only letters, numbers, _ and - allowed';
            return null;
          },
        });
        if (!username) return false;

        const password = await ctx.vscode.window.showInputBox({
          prompt: 'Password',
          password: true,
          validateInput(value) {
            if (!value || value.length < 4) return 'Password must be at least 4 characters';
            return null;
          },
        });
        if (!password) return false;

        if (action === 'Create Account') {
          const confirm = await ctx.vscode.window.showInputBox({
            prompt: 'Confirm password',
            password: true,
          });
          if (confirm !== password) {
            ctx.vscode.window.showErrorMessage('Passwords do not match.');
            return false;
          }
          const ok = await storage.register(username, password);
          if (!ok) {
            ctx.vscode.window.showErrorMessage(`Username "${username}" is already taken.`);
            return false;
          }
          await storage.login(username, password);
          ctx.vscode.window.showInformationMessage(`Account created. Welcome, ${username}!`);
        } else {
          const ok = await storage.login(username, password);
          if (!ok) {
            ctx.vscode.window.showErrorMessage('Invalid username or password.');
            return false;
          }
          ctx.vscode.window.showInformationMessage(`Welcome back, ${username}!`);
        }

        updateStatus();
        refreshTree();
        ctx.events.emit('account:login', { username: storage.currentUser });
        return true;
      }

      // ---------------------------------------------------------------
      // Account menu (from status bar)
      // ---------------------------------------------------------------

      async function accountMenu(): Promise<void> {
        const pick = await ctx.vscode.window.showQuickPick(
          ['$(remote-explorer) Open SFTP Panel', '$(sign-out) Sign Out'],
          { placeHolder: `Signed in as ${storage.currentUser}` },
        );
        if (!pick) return;

        if (pick.includes('SFTP')) {
          ctx.vscode.commands.executeCommand('sftp-connections-view.focus');
        } else if (pick.includes('Sign Out')) {
          doLogout();
        }
      }

      function doLogout() {
        connectedProfile = null;
        const workspace = ctx.services.get<any>('workspace');
        workspace?.sftpDisconnect();
        storage.logout();
        updateStatus();
        refreshTree();
        ctx.events.emit('account:logout');
        ctx.vscode.window.showInformationMessage('Signed out.');
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
          let password: string | undefined;
          if (profile.encryptedPassword) {
            password = await storage.getProfilePassword(profile);
          }
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
              refreshTree();
              return;
            }
          }

          await workspace.sftpConnect({
            bridgeUrl: profile.bridgeUrl,
            host: profile.host,
            port: profile.port,
            username: profile.username,
            password,
          });

          connectedProfile = profile.label;
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
        if (!storage.isLoggedIn) {
          const ok = await loginFlow();
          if (!ok) return;
        }

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
            prompt: 'SSH Password (will be encrypted)',
            password: true,
          });
        }

        const bridgeUrl = await ctx.vscode.window.showInputBox({
          prompt: 'SFTP Bridge WebSocket URL',
          placeHolder: 'ws://localhost:3100',
          value: 'ws://localhost:3100',
        });
        if (!bridgeUrl) return;

        const profile = await storage.addProfile({
          label,
          bridgeUrl,
          host,
          port,
          username,
          password,
          usePrivateKey: authMethod.startsWith('Private'),
        });

        if (profile) {
          ctx.vscode.window.showInformationMessage(`Connection "${label}" saved.`);
          refreshTree();
        } else {
          ctx.vscode.window.showErrorMessage('Failed to save. Are you logged in?');
        }
      }

      // ---------------------------------------------------------------
      // Delete Profile flow
      // ---------------------------------------------------------------

      async function deleteProfileFlow(profileToDelete?: ConnectionProfile): Promise<void> {
        let profile = profileToDelete;
        if (!profile) {
          const profiles = storage.getUserProfiles();
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
      // Register commands
      // ---------------------------------------------------------------

      disposables.push(ctx.registerCommand('account.login', () => loginFlow()));
      disposables.push(ctx.registerCommand('account.logout', () => doLogout()));
      disposables.push(ctx.registerCommand('account.menu', () => accountMenu()));
      disposables.push(ctx.registerCommand('account.addProfile', () => addProfileFlow()));
      disposables.push(ctx.registerCommand('account.deleteProfile', (p?: ConnectionProfile) => deleteProfileFlow(p)));
      disposables.push(ctx.registerCommand('account.connectProfile', (p: ConnectionProfile) => connectToProfile(p)));
      disposables.push(ctx.registerCommand('account.disconnect', () => {
        const workspace = ctx.services.get<any>('workspace');
        workspace?.sftpDisconnect();
        connectedProfile = null;
        refreshTree();
        ctx.vscode.window.showInformationMessage('SFTP disconnected.');
      }));
      disposables.push(ctx.registerCommand('account.loadRemoteFolder', async () => {
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

      // ---------------------------------------------------------------
      // Register service
      // ---------------------------------------------------------------

      ctx.services.register('account', {
        get isLoggedIn() { return storage.isLoggedIn; },
        get currentUser() { return storage.currentUser; },
        get connectedProfile() { return connectedProfile; },
        login: () => loginFlow(),
        logout: () => doLogout(),
        getProfiles: () => storage.getUserProfiles(),
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
