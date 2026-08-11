// ---------------------------------------------------------------------------
// Welcome page — a VS Code-style "Welcome" tab shown on startup with project
// info and links (Built by Mullayam · GitHub · LinkedIn · Portfolio).
// ---------------------------------------------------------------------------

import type * as vscodeType from 'vscode';

export const AUTHOR_LINKS = {
  github: 'https://github.com/Mullayam',
  linkedin: 'https://linkedin.com/in/mullayam06',
  portfolio: 'https://me.enjoys.in',
} as const;

const STARTUP_KEY = 'webterminal:welcome-on-startup';

let panel: vscodeType.WebviewPanel | null = null;

/** Whether the welcome tab should auto-open on startup (default: true). */
export function shouldShowOnStartup(): boolean {
  return localStorage.getItem(STARTUP_KEY) !== 'false';
}

/** Open (or focus) the Welcome tab. */
export function showWelcome(vscode: typeof vscodeType): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'terminus.welcome',
    'Welcome',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = getWelcomeHtml(shouldShowOnStartup());

  panel.onDidDispose(() => {
    panel = null;
  });

  panel.webview.onDidReceiveMessage((msg: { type?: string; url?: string; value?: boolean }) => {
    if (msg?.type === 'open' && msg.url) {
      vscode.env.openExternal(vscode.Uri.parse(msg.url));
    } else if (msg?.type === 'startup') {
      localStorage.setItem(STARTUP_KEY, msg.value ? 'true' : 'false');
    }
  });
}

// ---------------------------------------------------------------------------
// Release notes — shown once per version
// ---------------------------------------------------------------------------

export const APP_VERSION = '1.1.0';
const RELEASE_DATE = 'August 11, 2026';
const RELEASE_NOTES_KEY = 'webterminal:release-notes-seen';

const RELEASE_NOTES: string[] = [
  'Integrated terminal over SFTP/SSH — multiple tabs, stays alive when hidden, with IndexedDB history restore.',
  'AI Chat (Copilot-style) panel enabled by default.',
  'SFTP saved connections can now be edited and deleted.',
  'New Welcome page, GitHub status-bar link, and product favicon.',
  'Session entry gating via VITE_APP_ENV (DEV bypasses checks; prod requires a valid session).',
];

let notesPanel: vscodeType.WebviewPanel | null = null;

/** Whether release notes for the current version have not yet been shown. */
export function shouldShowReleaseNotes(): boolean {
  return localStorage.getItem(RELEASE_NOTES_KEY) !== APP_VERSION;
}

/** Open the release notes tab and mark this version as seen. */
export function showReleaseNotes(vscode: typeof vscodeType): void {
  localStorage.setItem(RELEASE_NOTES_KEY, APP_VERSION);

  if (notesPanel) {
    notesPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  notesPanel = vscode.window.createWebviewPanel(
    'terminus.releaseNotes',
    `Release Notes — v${APP_VERSION}`,
    vscode.ViewColumn.One,
    { enableScripts: false, retainContextWhenHidden: true },
  );

  notesPanel.webview.html = getReleaseNotesHtml();
  notesPanel.onDidDispose(() => {
    notesPanel = null;
  });
}

function getReleaseNotesHtml(): string {
  const items = RELEASE_NOTES.map((n) => `<li>${n}</li>`).join('');
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body {
    margin: 0; padding: 48px 40px;
    font-family: var(--vscode-font-family, system-ui);
    color: var(--vscode-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
    display: flex; flex-direction: column; align-items: center; text-align: center;
  }
  h1 { margin: 0 0 4px; font-size: 24px; font-weight: 600; }
  .date { margin: 0 0 28px; font-size: 12px; color: var(--vscode-descriptionForeground, #8a8a8a); }
  ul {
    max-width: 560px; margin: 0; padding: 0; list-style: none;
    display: flex; flex-direction: column; gap: 10px; text-align: left;
  }
  li {
    padding: 12px 16px; border-radius: 6px; font-size: 13px; line-height: 1.5;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, #333);
  }
</style>
</head>
<body>
  <h1>What's New in v${APP_VERSION}</h1>
  <p class="date">Released · ${RELEASE_DATE}</p>
  <ul>${items}</ul>
</body>
</html>`;
}

function getWelcomeHtml(onStartup: boolean): string {
  const logo = `
    <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#1e1e1e"/>
      <path d="M8 10l6 6-6 6" stroke="#007acc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <line x1="16" y1="22" x2="24" y2="22" stroke="#007acc" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:;" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 56px 40px;
    font-family: var(--vscode-font-family, system-ui);
    color: var(--vscode-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
  .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
  .tagline { color: var(--vscode-descriptionForeground, #8a8a8a); margin: 0; }
  .built {
    margin: 4px 0 4px;
    font-size: 13px;
    color: var(--vscode-descriptionForeground, #8a8a8a);
  }
  .built strong { color: var(--vscode-foreground, #ccc); }
  .updated {
    margin: 0 0 28px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #8a8a8a);
  }
  h2 {
    font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--vscode-descriptionForeground, #8a8a8a);
    margin: 0 0 12px;
  }
  .links {
    display: flex; flex-direction: column; gap: 8px;
    width: 100%; max-width: 340px;
  }
  .link {
    display: flex; align-items: center; justify-content: center; gap: 12px;
    padding: 12px 14px; border-radius: 6px; cursor: pointer;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, #333);
    color: inherit;
    font-family: inherit; /* buttons don't inherit the workbench font */
    font-size: 13px;
  }
  .link:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  .link .icon { width: 20px; height: 20px; flex: 0 0 20px; display: flex; }
  .link .meta { display: flex; flex-direction: column; align-items: center; }
  .link .meta .name { font-weight: 500; }
  .link .meta .sub { color: var(--vscode-descriptionForeground, #8a8a8a); font-size: 11px; }
  .footer {
    margin-top: 32px; display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--vscode-descriptionForeground, #8a8a8a);
  }
  .version { margin-left: 4px; opacity: .8; }
</style>
</head>
<body>
  <div class="header">
    ${logo}
    <div>
      <h1>Terminus</h1>
      <p class="tagline">Remote Code Editor</p>
    </div>
  </div>
  <p class="built">Built by <strong>Mullayam</strong> · Powered by Enjoys<span class="version">v1.1.0</span></p>
  <p class="updated">Last updated · August 11, 2026</p>

  <h2>Connect</h2>
  <div class="links">
    <button class="link" data-url="${AUTHOR_LINKS.github}">
      <span class="icon"><svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></span>
      <span class="meta"><span class="name">GitHub</span><span class="sub">github.com/Mullayam</span></span>
    </button>
    <button class="link" data-url="${AUTHOR_LINKS.linkedin}">
      <span class="icon"><svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor"><path d="M13.63 0H2.37A2.37 2.37 0 000 2.37v11.26A2.37 2.37 0 002.37 16h11.26A2.37 2.37 0 0016 13.63V2.37A2.37 2.37 0 0013.63 0zM4.9 13.5H2.5V6h2.4v7.5zM3.7 4.9a1.4 1.4 0 110-2.8 1.4 1.4 0 010 2.8zM13.5 13.5h-2.4V9.6c0-.93-.02-2.13-1.3-2.13-1.3 0-1.5 1.02-1.5 2.06v3.97H5.9V6h2.3v1.02h.03c.32-.6 1.1-1.24 2.27-1.24 2.43 0 2.88 1.6 2.88 3.68v4.04z"/></svg></span>
      <span class="meta"><span class="name">LinkedIn</span><span class="sub">linkedin.com/in/mullayam06</span></span>
    </button>
    <button class="link" data-url="${AUTHOR_LINKS.portfolio}">
      <span class="icon"><svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="7"/><path d="M1 8h14M8 1c2 2 2 12 0 14M8 1c-2 2-2 12 0 14"/></svg></span>
      <span class="meta"><span class="name">Portfolio</span><span class="sub">me.enjoys.in</span></span>
    </button>
  </div>

  <label class="footer">
    <input type="checkbox" id="startup" ${onStartup ? 'checked' : ''} />
    Show welcome page on startup
  </label>

<script>
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('.link').forEach((el) => {
    el.addEventListener('click', () => {
      vscode.postMessage({ type: 'open', url: el.getAttribute('data-url') });
    });
  });
  document.getElementById('startup').addEventListener('change', (e) => {
    vscode.postMessage({ type: 'startup', value: e.target.checked });
  });
</script>
</body>
</html>`;
}
