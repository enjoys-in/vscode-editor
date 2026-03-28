import type { Plugin, PluginContext, Disposable } from '@core/types';
import { AccountStorage, type ConnectionProfile } from './storage';

// ---------------------------------------------------------------------------
// Account Plugin — login / register + saved SFTP connection profiles
//
// Provides:
//   - account.login       — log in or register (command palette / statusbar)
//   - account.logout      — log out
//   - account.quickConnect — pick a saved profile, decrypt password, connect SFTP
//   - account.addProfile  — save a new SFTP connection profile
//   - account.deleteProfile — remove a saved profile
//
// The "account" service is registered so other plugins (workspace, etc.)
// can call ctx.services.get('account') to check login state.
// ---------------------------------------------------------------------------

export function createAccountPlugin(): Plugin {
  const disposables: Disposable[] = [];

  return {
    id: 'builtin.account',
    name: 'Account Manager',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      const storage = new AccountStorage();

      // ---------------------------------------------------------------
      // Status bar — shows login state
      // ---------------------------------------------------------------

      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Right,
        200,
      );
      updateStatus();
      statusItem.show();
      disposables.push(statusItem);

      // ---------------------------------------------------------------
      // Status bar — SFTP Quick Connect button (left side, next to Open Folder)
      // ---------------------------------------------------------------

      const sftpItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Left,
        49, // just right of the "Open Folder" button (priority 50)
      );
      sftpItem.text = '$(remote) SFTP';
      sftpItem.tooltip = 'Sign in to Quick Connect via SFTP';
      sftpItem.command = 'account.sftpMenu';
      sftpItem.show();
      disposables.push(sftpItem);

      let connectedProfile: string | null = null;

      function updateSftpStatus() {
        if (connectedProfile) {
          sftpItem.text = `$(remote) ${connectedProfile}`;
          sftpItem.tooltip = `Connected to ${connectedProfile} — click to manage`;
          sftpItem.backgroundColor = undefined;
        } else if (storage.isLoggedIn) {
          sftpItem.text = '$(remote) SFTP Connect';
          sftpItem.tooltip = 'Quick Connect to a saved SFTP server';
        } else {
          sftpItem.text = '$(remote) SFTP';
          sftpItem.tooltip = 'Sign in to use Quick Connect';
        }
      }

      function updateStatus() {
        if (storage.isLoggedIn) {
          statusItem.text = `$(account) ${storage.currentUser}`;
          statusItem.tooltip = 'Click to manage account';
          statusItem.command = 'account.menu';
        } else {
          statusItem.text = '$(sign-in) Sign In';
          statusItem.tooltip = 'Sign in to access saved connections';
          statusItem.command = 'account.login';
        }
        updateSftpStatus();
      }

      // ---------------------------------------------------------------
      // SFTP menu — shown when clicking the SFTP status bar button
      // ---------------------------------------------------------------

      async function sftpMenu(): Promise<void> {
        if (!storage.isLoggedIn) {
          const ok = await loginFlow();
          if (!ok) return;
        }

        const profiles = storage.getUserProfiles();
        const items: Array<{ label: string; description?: string; action: string }> = [];

        if (connectedProfile) {
          items.push({
            label: '$(debug-disconnect) Disconnect',
            description: connectedProfile,
            action: 'disconnect',
          });
          items.push({
            label: '$(folder-opened) Load Remote Folder',
            description: 'Browse remote files into workspace',
            action: 'loadFolder',
          });
          items.push({ label: '', description: '', action: 'separator' });
        }

        for (const p of profiles) {
          items.push({
            label: `$(server) ${p.label}`,
            description: `${p.username}@${p.host}:${p.port}`,
            action: `connect:${p.id}`,
          });
        }

        items.push({
          label: '$(add) Save New Connection',
          action: 'addProfile',
        });

        if (profiles.length > 0) {
          items.push({
            label: '$(trash) Delete Connection',
            action: 'deleteProfile',
          });
        }

        const pick = await ctx.vscode.window.showQuickPick(
          items.filter((i) => i.action !== 'separator'),
          { placeHolder: connectedProfile ? `Connected to ${connectedProfile}` : 'SFTP Connections' },
        );
        if (!pick) return;

        const action = (pick as any).action as string;

        if (action === 'disconnect') {
          const workspace = ctx.services.get<any>('workspace');
          workspace?.sftpDisconnect();
          connectedProfile = null;
          updateSftpStatus();
          ctx.vscode.window.showInformationMessage('SFTP disconnected.');
        } else if (action === 'loadFolder') {
          const workspace = ctx.services.get<any>('workspace');
          const remotePath = await ctx.vscode.window.showInputBox({
            prompt: 'Remote folder path to load',
            placeHolder: '/home/user/project',
          });
          if (remotePath && workspace) {
            await workspace.sftpLoadFolder(remotePath);
          }
        } else if (action === 'addProfile') {
          await addProfileFlow();
        } else if (action === 'deleteProfile') {
          await deleteProfileFlow();
        } else if (action.startsWith('connect:')) {
          const profileId = action.slice('connect:'.length);
          const profile = profiles.find((p) => p.id === profileId);
          if (profile) {
            await connectToProfile(profile);
          }
        }
      }

      // ---------------------------------------------------------------
      // Connect to a specific profile
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
              prompt: 'Paste your private key (or leave empty to use password)',
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
              updateSftpStatus();
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
          updateSftpStatus();

          // Ask if user wants to load a remote folder
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
      // Login / Register
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
          // Auto-login after registration
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
        ctx.events.emit('account:login', { username: storage.currentUser });
        return true;
      }

      // ---------------------------------------------------------------
      // Account menu (when logged in)
      // ---------------------------------------------------------------

      async function accountMenu(): Promise<void> {
        const items: string[] = [
          '$(plug) SFTP Connections',
          '$(sign-out) Sign Out',
        ];

        const pick = await ctx.vscode.window.showQuickPick(items, {
          placeHolder: `Signed in as ${storage.currentUser}`,
        });
        if (!pick) return;

        if (pick.includes('SFTP')) {
          await sftpMenu();
        } else if (pick.includes('Sign Out')) {
          connectedProfile = null;
          const workspace = ctx.services.get<any>('workspace');
          workspace?.sftpDisconnect();
          storage.logout();
          updateStatus();
          ctx.events.emit('account:logout');
          ctx.vscode.window.showInformationMessage('Signed out.');
        }
      }

      // ---------------------------------------------------------------
      // Add Profile
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
        } else {
          ctx.vscode.window.showErrorMessage('Failed to save connection. Are you logged in?');
        }
      }

      // ---------------------------------------------------------------
      // Delete Profile
      // ---------------------------------------------------------------

      async function deleteProfileFlow(): Promise<void> {
        const profiles = storage.getUserProfiles();
        if (profiles.length === 0) {
          ctx.vscode.window.showInformationMessage('No saved connections to delete.');
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

        const confirm = await ctx.vscode.window.showQuickPick(['Yes, delete it', 'Cancel'], {
          placeHolder: `Delete "${pick.label}"?`,
        });
        if (confirm !== 'Yes, delete it') return;

        storage.deleteProfile((pick as any).id);
        ctx.vscode.window.showInformationMessage(`Connection "${pick.label}" deleted.`);
      }

      // ---------------------------------------------------------------
      // Register commands
      // ---------------------------------------------------------------

      disposables.push(ctx.registerCommand('account.login', () => loginFlow()));
      disposables.push(ctx.registerCommand('account.logout', () => {
        connectedProfile = null;
        const workspace = ctx.services.get<any>('workspace');
        workspace?.sftpDisconnect();
        storage.logout();
        updateStatus();
        ctx.events.emit('account:logout');
        ctx.vscode.window.showInformationMessage('Signed out.');
      }));
      disposables.push(ctx.registerCommand('account.menu', () => accountMenu()));
      disposables.push(ctx.registerCommand('account.sftpMenu', () => sftpMenu()));
      disposables.push(ctx.registerCommand('account.quickConnect', () => sftpMenu()));
      disposables.push(ctx.registerCommand('account.addProfile', () => addProfileFlow()));
      disposables.push(ctx.registerCommand('account.deleteProfile', () => deleteProfileFlow()));

      // ---------------------------------------------------------------
      // Register service
      // ---------------------------------------------------------------

      ctx.services.register('account', {
        get isLoggedIn() { return storage.isLoggedIn; },
        get currentUser() { return storage.currentUser; },
        get connectedProfile() { return connectedProfile; },
        login: () => loginFlow(),
        logout: () => { connectedProfile = null; storage.logout(); updateStatus(); ctx.events.emit('account:logout'); },
        getProfiles: () => storage.getUserProfiles(),
        addProfile: (p: any) => storage.addProfile(p),
        deleteProfile: (id: string) => storage.deleteProfile(id),
        quickConnect: () => sftpMenu(),
        sftpMenu: () => sftpMenu(),
      });
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
