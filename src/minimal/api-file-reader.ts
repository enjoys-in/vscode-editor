import type { Plugin, PluginContext, Disposable } from '@core/types';
import {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override';

// ---------------------------------------------------------------------------
// API File Reader Plugin
//
// Reads a remote directory via POST /api/file/read using:
//   - sessionId from URL query ?sessionId= (or defaults to empty)
//   - path from URL query ?path=
//
// On activation, fetches the file tree and loads all files into the
// virtual filesystem so explorer, editor, search all work.
// ---------------------------------------------------------------------------

export interface ApiFileReaderOptions {
  /** Base URL for the API (default: same origin) */
  apiBase?: string;
  /** Base path inside the virtual FS (default: /workspace) */
  basePath?: string;
}

interface ApiResponse {
  status: boolean;
  message: string;
  result: string;
}

export function createApiFileReaderPlugin(options?: ApiFileReaderOptions): Plugin {
  const disposables: Disposable[] = [];
  const basePath = options?.basePath ?? '/workspace';
  const apiBase = options?.apiBase ?? '';

  return {
    id: 'builtin.api-file-reader',
    name: 'API File Reader',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      const fsProvider = new RegisteredFileSystemProvider(false);
      const overlay = registerFileSystemOverlay(2, fsProvider);
      disposables.push(overlay);

      // Read query params
      const params = new URLSearchParams(window.location.search);
      const remotePath = params.get('path');
      const sessionId = params.get('tabId') ?? '';

      console.log('[ApiFileReader] URL:', window.location.href);
      console.log('[ApiFileReader] sessionId:', sessionId, 'path:', remotePath);

      if (!remotePath) {
        console.log('[ApiFileReader] No ?path= query param, skipping auto-load');
        return;
      }

      // Auto-load on activation
      console.log('[ApiFileReader] Loading file:', remotePath);
      loadFile(remotePath, sessionId).catch((err) => {
        console.error('[ApiFileReader] Load failed:', err);
        ctx.vscode.window.showErrorMessage(`Failed to load file: ${err.message}`);
      });

      // -------------------------------------------------------------------
      // Fetch a single file from the API
      // -------------------------------------------------------------------

      async function fetchFile(filePath: string, sid: string): Promise<string> {
        const url = `${apiBase}/api/file/read`;
        const body = { sessionId: sid, path: filePath };
        console.log('[ApiFileReader] POST', url, body);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        console.log('[ApiFileReader] Response status:', res.status);

        if (!res.ok) {
          const text = await res.text();
          console.error('[ApiFileReader] Response error body:', text);
          throw new Error(`API returned ${res.status}: ${text}`);
        }

        const data: ApiResponse = await res.json();
        console.log('[ApiFileReader] Response data:', { status: data.status, message: data.message, resultLength: data.result?.length });

        if (!data.status) {
          throw new Error(data.message || 'File read failed');
        }

        return data.result;
      }

      // -------------------------------------------------------------------
      // Load a file into the virtual FS and open it
      // -------------------------------------------------------------------

      async function loadFile(filePath: string, sid: string): Promise<void> {
        console.log('[ApiFileReader] loadFile start:', filePath);
        const content = await fetchFile(filePath, sid);
        const fileName = filePath.split('/').pop() || 'file';
        const vsPath = `${basePath}/${fileName}`;
        const uri = ctx.vscode.Uri.file(vsPath);
        console.log('[ApiFileReader] Registering file at:', vsPath, '(', content.length, 'bytes)');

        try {
          fsProvider.registerFile(new RegisteredMemoryFile(uri, content));
          console.log('[ApiFileReader] File registered successfully');
        } catch (e) {
          console.warn('[ApiFileReader] File already registered or error:', e);
        }

        // Open the file in the editor
        console.log('[ApiFileReader] Opening document...');
        const doc = await ctx.vscode.workspace.openTextDocument(uri);
        await ctx.vscode.window.showTextDocument(doc);
        console.log('[ApiFileReader] File opened in editor:', vsPath);
      }

      // -------------------------------------------------------------------
      // Expose service for manual use
      // -------------------------------------------------------------------

      ctx.services.register('apiFileReader', {
        loadFile: (path: string, sid?: string) =>
          loadFile(path, sid ?? sessionId),
        fetchFile: (path: string, sid?: string) =>
          fetchFile(path, sid ?? sessionId),
      });

      // -------------------------------------------------------------------
      // Command for manual load
      // -------------------------------------------------------------------

      disposables.push(
        ctx.registerCommand('apiFileReader.load', async () => {
          const path = await ctx.vscode.window.showInputBox({
            prompt: 'Remote file path to load',
            value: remotePath ?? '',
          });
          if (path) {
            await loadFile(path, sessionId);
          }
        }),
      );
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
