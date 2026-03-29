// ---------------------------------------------------------------------------
// SFTP Sidebar View — registered at module load time (before Monaco init)
//
// Must be imported in setup.ts files BEFORE initializeMonacoService().
// The Account plugin sets the render callback via setSftpViewRenderer().
// ---------------------------------------------------------------------------

import { registerCustomView, ViewContainerLocation } from '@codingame/monaco-vscode-views-service-override';
import type * as monaco from 'monaco-editor';

// SVG icon for the activity bar (server/remote style)
const sftpIcon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="%23C5C5C5" d="M1.5 2h13l.5.5v3l-.5.5h-13l-.5-.5v-3l.5-.5zm1 1v1h11V3h-11zm-1 5h13l.5.5v3l-.5.5h-13l-.5-.5v-3l.5-.5zm1 1v1h11V9h-11zM3 4h1v1H3V4zm0 6h1v1H3v-1z"/></svg>`)}`;

type RenderCallback = (container: HTMLElement) => monaco.IDisposable;

let _renderer: RenderCallback | null = null;
let _pendingContainer: HTMLElement | null = null;

/**
 * Called by the Account plugin to provide the render function.
 * If the view is already visible, renders immediately.
 */
export function setSftpViewRenderer(renderer: RenderCallback): void {
  _renderer = renderer;
  if (_pendingContainer) {
    renderer(_pendingContainer);
    _pendingContainer = null;
  }
}

// Register the view container + view at module load time
registerCustomView({
  id: 'sftp-connections-view',
  name: 'SFTP Connections',
  order: 10,
  renderBody(container: HTMLElement): monaco.IDisposable {
    container.style.padding = '8px';
    container.style.overflowY = 'auto';
    container.style.height = '100%';

    if (_renderer) {
      return _renderer(container);
    }

    // Plugin hasn't activated yet — show loading, render when ready
    container.innerHTML = '<div style="padding:12px;color:var(--vscode-descriptionForeground)">Loading SFTP panel...</div>';
    _pendingContainer = container;
    return {
      dispose() {
        _pendingContainer = null;
      },
    };
  },
  location: ViewContainerLocation.Sidebar,
  icon: sftpIcon,
});
