// ---------------------------------------------------------------------------
// Extension Loader — drag-and-drop .vsix installation
//
// Drag .vsix files onto the editor to install them on the fly.
// Uses capture-phase events to intercept before Monaco's workbench.
// ---------------------------------------------------------------------------

import { unzipSync, strFromU8 } from 'fflate';
import { registerExtension, ExtensionHostKind } from '@codingame/monaco-vscode-api/extensions';
import * as vscode from 'vscode';

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Load a .vsix extension from an ArrayBuffer (e.g. from drag-and-drop or File input)
 */
export async function loadVsixFromBuffer(buffer: ArrayBuffer, name?: string): Promise<string> {
  const files = unzipSync(new Uint8Array(buffer));

  let extensionPrefix = '';
  for (const path of Object.keys(files)) {
    if (path === 'extension/package.json') {
      extensionPrefix = 'extension/';
      break;
    }
    if (path === 'package.json') {
      break;
    }
  }

  const manifestPath = `${extensionPrefix}package.json`;
  const manifestData = files[manifestPath];
  if (!manifestData) throw new Error(`No package.json found in ${name ?? 'vsix'}`);

  const manifest = JSON.parse(strFromU8(manifestData));
  const extId = `${manifest.publisher}.${manifest.name}`;
  console.log(`[ExtensionLoader] Installing ${extId}@${manifest.version}`);

  const { registerFileUrl } = registerExtension(
    manifest,
    ExtensionHostKind.LocalProcess,
  );

  for (const [filePath, content] of Object.entries(files)) {
    if (!filePath.startsWith(extensionPrefix)) continue;
    const relativePath = '/' + filePath.slice(extensionPrefix.length);
    if (relativePath === '/' || relativePath === '/package.json') continue;

    const data = content as Uint8Array;
    const blob = new Blob([new Uint8Array(data)], { type: getMimeType(filePath) });
    registerFileUrl(relativePath, URL.createObjectURL(blob));
  }

  console.log(`[ExtensionLoader] ${extId} installed`);
  return extId;
}

/**
 * Enable drag-and-drop of .vsix files onto the workbench.
 * Uses capture-phase listeners to intercept before Monaco's own drag handling.
 * Shows a VS Code-style drop overlay and notifications.
 */
export function enableVsixDragAndDrop(container: HTMLElement): void {
  let dragCounter = 0;
  let overlay: HTMLElement | null = null;

  function hasVsixFiles(dt: DataTransfer | null): boolean {
    if (!dt?.items) return false;
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file' && item.type === '') {
        // Browser doesn't expose filename on dragenter/over — allow potential vsix
        return true;
      }
    }
    return false;
  }

  function createOverlay(): HTMLElement {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.style.cssText = `
      display: none;
      position: fixed;
      inset: 0;
      z-index: 2550;
      background: transparent;
      pointer-events: none;
    `;

    const inner = document.createElement('div');
    inner.style.cssText = `
      position: absolute;
      inset: 8px;
      border: 2px dashed var(--vscode-focusBorder, #007fd4);
      border-radius: 8px;
      background: var(--vscode-editor-background, #1e1e1e);
      opacity: 0.92;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 8px;
    `;

    const icon = document.createElement('div');
    icon.textContent = '$(extensions)';
    icon.style.cssText = `
      font-size: 48px;
      color: var(--vscode-focusBorder, #007fd4);
      font-family: codicon;
    `;
    // Use a simpler visual — codicon may not render from text
    icon.textContent = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '48');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'var(--vscode-focusBorder, #007fd4)');
    svg.setAttribute('stroke-width', '1.5');
    svg.innerHTML = `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`;
    icon.appendChild(svg);

    const label = document.createElement('div');
    label.textContent = 'Drop to install extension';
    label.style.cssText = `
      font-size: 18px;
      font-weight: 500;
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, system-ui);
    `;

    const hint = document.createElement('div');
    hint.textContent = '.vsix files only';
    hint.style.cssText = `
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      font-family: var(--vscode-font-family, system-ui);
    `;

    inner.appendChild(icon);
    inner.appendChild(label);
    inner.appendChild(hint);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showOverlay() {
    const el = createOverlay();
    el.style.display = 'block';
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }

  // Use CAPTURE phase so we intercept before Monaco's workbench handlers
  container.addEventListener('dragenter', (e) => {
    if (!hasVsixFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (dragCounter === 1) showOverlay();
  }, true);

  container.addEventListener('dragleave', (e) => {
    if (!overlay || overlay.style.display === 'none') return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      hideOverlay();
    }
  }, true);

  container.addEventListener('dragover', (e) => {
    if (!overlay || overlay.style.display === 'none') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, true);

  container.addEventListener('drop', async (e) => {
    // Only intercept if we had our overlay showing
    if (!overlay || overlay.style.display === 'none') return;

    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    hideOverlay();

    const droppedFiles = e.dataTransfer?.files;
    if (!droppedFiles) return;

    const vsixFiles = Array.from(droppedFiles).filter(f => f.name.endsWith('.vsix'));
    if (vsixFiles.length === 0) {
      vscode.window.showWarningMessage('No .vsix files found. Only .vsix extension files can be installed via drag and drop.');
      return;
    }

    for (const file of vsixFiles) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing ${file.name}...`,
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: 'Reading file...' });
            const buffer = await file.arrayBuffer();

            progress.report({ message: 'Extracting extension...' });
            const extId = await loadVsixFromBuffer(buffer, file.name);

            vscode.window.showInformationMessage(
              `Extension "${extId}" installed successfully. Reload may be needed for full activation.`,
              'Reload Window',
            ).then((action) => {
              if (action === 'Reload Window') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
              }
            });
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to install ${file.name}: ${err.message}`);
          }
        },
      );
    }
  }, true);
}
