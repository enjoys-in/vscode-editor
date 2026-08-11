import type { Plugin, PluginContext, Disposable } from '@core/types';
import type * as vscodeType from 'vscode';
import { registerExtension } from '@codingame/monaco-vscode-api/extensions';
import { ExtensionHostKind } from '@codingame/monaco-vscode-extensions-service-override';
import { API_CONFIG, GITHUB_CONFIG } from '../../minimal/config';

// ---------------------------------------------------------------------------
// GitHub Authentication Plugin
//
// Registers a `vscode.authentication` provider with id `github`, so plugins can
// call `vscode.authentication.getSession('github', scopes, ...)`.
//
// Flow (OAuth web flow — the client secret never touches the browser):
//   1. Open a popup to GitHub's authorize URL with redirect_uri pointing at the
//      backend callback (GITHUB_CONFIG.callbackPath).
//   2. The backend exchanges `code` → access token (using the client secret)
//      and returns an HTML page that runs:
//        window.opener.postMessage({ type:'github-auth', token, state }, '*')
//      then closes the popup.
//   3. This plugin receives the token, fetches the GitHub user (api.github.com
//      supports CORS with a bearer token) and creates the session.
//
// Backend contract you must implement:
//   GET  {baseUrl}/api/auth/github/callback?code=...&state=...
//        → exchanges code for a token, responds with the postMessage HTML above.
// ---------------------------------------------------------------------------

const PROVIDER_ID = 'github';
const PROVIDER_LABEL = 'GitHub';
const SESSION_KEY = 'webterminal:github-session';

interface StoredSession {
  id: string;
  accessToken: string;
  account: { id: string; label: string };
  scopes: string[];
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

/** Open GitHub's OAuth popup and resolve with the access token from the backend. */
function openOAuthPopup(url: string, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(url, 'github-oauth', 'width=600,height=740');
    if (!popup) {
      reject(new Error('Popup blocked — allow popups for this site to sign in.'));
      return;
    }

    const timer = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('Sign-in was cancelled.'));
      }
    }, 500);

    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; token?: string; state?: string; error?: string };
      if (!data || data.type !== 'github-auth') return;
      if (data.state && state && data.state !== state) return;
      cleanup();
      try { popup!.close(); } catch { /* ignore */ }
      if (data.token) resolve(data.token);
      else reject(new Error(data.error || 'No token returned from GitHub.'));
    }

    function cleanup() {
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
    }

    window.addEventListener('message', onMessage);
  });
}

async function fetchGitHubUser(token: string): Promise<{ id: number; login: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.json();
}

export function createGithubAuthPlugin(): Plugin {
  const disposables: Disposable[] = [];

  return {
    id: 'builtin.github-auth',
    name: 'GitHub Authentication',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      const { getApi } = registerExtension(
        {
          name: 'github-auth',
          publisher: 'webterminal',
          version: '1.0.0',
          engines: { vscode: '*' },
          contributes: {
            authentication: [{ id: PROVIDER_ID, label: PROVIDER_LABEL }],
          },
        } as any,
        ExtensionHostKind.LocalProcess,
      );

      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Right,
        160,
      );
      disposables.push(statusItem);

      function updateStatus(session: StoredSession | null) {
        if (session) {
          statusItem.text = `$(github) ${session.account.label}`;
          statusItem.tooltip = 'Signed in to GitHub — click to sign out';
          statusItem.command = 'github.signOut';
        } else {
          statusItem.text = '$(github) Sign in';
          statusItem.tooltip = 'Sign in to GitHub';
          statusItem.command = 'github.signIn';
        }
        statusItem.show();
      }

      void getApi().then((api) => {
        let current = loadSession();
        const onDidChange = new api.EventEmitter<vscodeType.AuthenticationProviderAuthenticationSessionsChangeEvent>();

        async function signIn(scopes: readonly string[]): Promise<StoredSession> {
          if (!GITHUB_CONFIG.clientId) {
            throw new Error('GitHub client id missing — set VITE_GITHUB_CLIENT_ID in .env');
          }
          const state = crypto.randomUUID();
          const redirectUri = `${API_CONFIG.baseUrl}${GITHUB_CONFIG.callbackPath}`;
          const scopeList = scopes.length ? [...scopes] : [...GITHUB_CONFIG.scopes];
          const authorizeUrl =
            'https://github.com/login/oauth/authorize'
            + `?client_id=${encodeURIComponent(GITHUB_CONFIG.clientId)}`
            + `&redirect_uri=${encodeURIComponent(redirectUri)}`
            + `&scope=${encodeURIComponent(scopeList.join(' '))}`
            + `&state=${encodeURIComponent(state)}`;

          const token = await openOAuthPopup(authorizeUrl, state);
          const user = await fetchGitHubUser(token);
          const session: StoredSession = {
            id: crypto.randomUUID(),
            accessToken: token,
            account: { id: String(user.id), label: user.login },
            scopes: scopeList,
          };
          current = session;
          saveSession(session);
          updateStatus(session);
          return session;
        }

        const provider = {
          onDidChangeSessions: onDidChange.event,
          async getSessions(scopes?: readonly string[]) {
            if (!current) return [];
            if (scopes && scopes.length && !scopes.every((s) => current!.scopes.includes(s))) {
              return [];
            }
            return [current];
          },
          async createSession(scopes: readonly string[]) {
            const session = await signIn(scopes);
            onDidChange.fire({ added: [session], removed: [], changed: [] });
            return session;
          },
          async removeSession(sessionId: string) {
            if (current && current.id === sessionId) {
              const removed = current;
              current = null;
              saveSession(null);
              updateStatus(null);
              onDidChange.fire({ added: [], removed: [removed], changed: [] });
            }
          },
        };

        disposables.push(
          api.authentication.registerAuthenticationProvider(
            PROVIDER_ID,
            PROVIDER_LABEL,
            provider,
            { supportsMultipleAccounts: false },
          ),
        );

        disposables.push(
          api.commands.registerCommand('github.signIn', async () => {
            try {
              await api.authentication.getSession(PROVIDER_ID, GITHUB_CONFIG.scopes, {
                createIfNone: true,
              });
              api.window.showInformationMessage(`Signed in to GitHub as ${current?.account.label}.`);
            } catch (err: any) {
              api.window.showErrorMessage(`GitHub sign-in failed: ${err.message}`);
            }
          }),
        );

        disposables.push(
          api.commands.registerCommand('github.signOut', async () => {
            if (current) await provider.removeSession(current.id);
            api.window.showInformationMessage('Signed out of GitHub.');
          }),
        );

        updateStatus(current);
      });

      // Expose the token to other plugins.
      ctx.services.register('github-auth', {
        get session() { return loadSession(); },
        getToken: () => loadSession()?.accessToken,
        signIn: () => ctx.vscode.commands.executeCommand('github.signIn'),
        signOut: () => ctx.vscode.commands.executeCommand('github.signOut'),
      });
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
