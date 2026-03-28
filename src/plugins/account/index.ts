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
        const profiles = storage.getUserProfiles();
        const items: string[] = [];

        if (profiles.length > 0) {
          items.push('$(plug) Quick Connect (saved profiles)');
        }
        items.push(
          '$(add) Save New Connection',
          '$(trash) Delete Connection',
          '$(sign-out) Sign Out',
        );

        const pick = await ctx.vscode.window.showQuickPick(items, {
          placeHolder: `Signed in as ${storage.currentUser}`,
        });
        if (!pick) return;

        if (pick.includes('Quick Connect')) {
          await quickConnect();
        } else if (pick.includes('Save New')) {
          await addProfileFlow();
        } else if (pick.includes('Delete')) {
          await deleteProfileFlow();
        } else if (pick.includes('Sign Out')) {
          storage.logout();
          updateStatus();
          ctx.events.emit('account:logout');
          ctx.vscode.window.showInformationMessage('Signed out.');
        }
      }

      // ---------------------------------------------------------------
      // Quick Connect — pick a saved profile and connect via SFTP
      // ---------------------------------------------------------------

      async function quickConnect(): Promise<void> {
        const profiles = storage.getUserProfiles();
        if (profiles.length === 0) {
          ctx.vscode.window.showInformationMessage('No saved connections. Add one first.');
          return;
        }

        const items = profiles.map((p) => ({
          label: `$(server) ${p.label}`,
          description: `${p.username}@${p.host}:${p.port}`,
          detail: p.bridgeUrl,
          profile: p,
        }));

        const pick = await ctx.vscode.window.showQuickPick(items, {
          placeHolder: 'Select a connection to open',
        });
        if (!pick) return;

        const profile = (pick as any).profile as ConnectionProfile;

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
              const workspace = ctx.services.get<any>('workspace');
              if (workspace) {
                await workspace.sftpConnect({
                  bridgeUrl: profile.bridgeUrl,
                  host: profile.host,
                  port: profile.port,
                  username: profile.username,
                  privateKey: key,
                });
              }
              return;
            }
          }

          const workspace = ctx.services.get<any>('workspace');
          if (!workspace) {
            ctx.vscode.window.showErrorMessage('Workspace plugin not loaded. Register it before the account plugin.');
            return;
          }

          await workspace.sftpConnect({
            bridgeUrl: profile.bridgeUrl,
            host: profile.host,
            port: profile.port,
            username: profile.username,
            password,
          });

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
        storage.logout();
        updateStatus();
        ctx.events.emit('account:logout');
        ctx.vscode.window.showInformationMessage('Signed out.');
      }));
      disposables.push(ctx.registerCommand('account.menu', () => accountMenu()));
      disposables.push(ctx.registerCommand('account.quickConnect', () => quickConnect()));
      disposables.push(ctx.registerCommand('account.addProfile', () => addProfileFlow()));
      disposables.push(ctx.registerCommand('account.deleteProfile', () => deleteProfileFlow()));

      // ---------------------------------------------------------------
      // Register service
      // ---------------------------------------------------------------

      ctx.services.register('account', {
        get isLoggedIn() { return storage.isLoggedIn; },
        get currentUser() { return storage.currentUser; },
        login: () => loginFlow(),
        logout: () => { storage.logout(); updateStatus(); ctx.events.emit('account:logout'); },
        getProfiles: () => storage.getUserProfiles(),
        addProfile: (p: any) => storage.addProfile(p),
        deleteProfile: (id: string) => storage.deleteProfile(id),
        quickConnect: () => quickConnect(),
      });
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
