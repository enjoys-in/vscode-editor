import * as monaco from 'monaco-editor';
import type { Plugin, PluginContext, Disposable } from '@core/types';
import { API_CONFIG, apiUrl } from '../../minimal/config';

export interface AICompletionOptions {
  /** Override the stream endpoint (full URL). Falls back to config. */
  endpoint?: string;
  debounceMs?: number;
}

const DEFAULT_OPTIONS: AICompletionOptions = {
  debounceMs: 300,
};

export function createAICompletionPlugin(
  userOptions?: Partial<AICompletionOptions>,
): Plugin {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const disposables: Disposable[] = [];

  return {
    id: 'builtin.ai-completion',
    name: 'AI Code Completion',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      // Register inline completion provider
      const provider = monaco.languages.registerInlineCompletionsProvider(
        { pattern: '**' },
        new AIInlineCompletionProvider(options),
      );
      disposables.push({ dispose: () => provider.dispose() });

      // Register as a service so other plugins can reconfigure
      ctx.services.register('ai-completion', {
        updateOptions(patch: Partial<AICompletionOptions>) {
          Object.assign(options, patch);
        },
        getOptions: () => ({ ...options }),
      });

      // Commands — use vscode API to trigger inline suggest
      disposables.push(
        ctx.registerCommand('ai.triggerCompletion', () => {
          ctx.vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        }),
      );

      // Native VSCode statusbar item
      const endpoint = options.endpoint || apiUrl('aiStream');
      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Right,
        90,
      );
      statusItem.text = '$(sparkle) AI';
      statusItem.tooltip = `AI Completion → ${endpoint}`;
      statusItem.show();
      disposables.push(statusItem);
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

class AIInlineCompletionProvider
  implements monaco.languages.InlineCompletionsProvider
{
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(private options: AICompletionOptions) {}

  async provideInlineCompletions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.InlineCompletionContext,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.InlineCompletions> {
    // Cancel any previous in-flight request
    this.abortController?.abort();

    // Debounce
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          const result = await this.fetchStream(model, position, token);
          if (!result) {
            resolve({ items: [] });
            return;
          }

          resolve({
            items: [
              {
                insertText: result,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                ),
              },
            ],
          });
        } catch {
          resolve({ items: [] });
        }
      }, this.options.debounceMs);
    });
  }

  freeInlineCompletions(): void {
    // nothing to free
  }

  disposeInlineCompletions(): void {
    // nothing to dispose
  }

  private async fetchStream(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken,
  ): Promise<string | null> {
    const text = model.getValue();
    const offset = model.getOffsetAt(position);

    const endpoint = this.options.endpoint || apiUrl('aiStream');
    const controller = new AbortController();
    this.abortController = controller;

    // Cancel on Monaco cancellation
    token.onCancellationRequested(() => controller.abort());

    const uri = model.uri.toString();
    const filename = uri.split('/').pop() || 'untitled';
    const languageId = model.getLanguageId();

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        filename,
        language: languageId,
        textBeforeCursor: text.slice(0, offset),
        textAfterCursor: text.slice(offset),
        cursorPosition: {
          lineNumber: position.lineNumber,
          column: position.column,
        },
      }),
    });

    if (!resp.ok || !resp.body) return null;

    // Read SSE stream — each chunk is {"text":"..."}
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Handle SSE "data: ..." format or raw JSON lines
        const jsonStr = trimmed.startsWith('data: ')
          ? trimmed.slice(6)
          : trimmed;

        if (jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.text) {
            result += parsed.text;
          }
        } catch {
          // skip unparseable lines
        }
      }
    }

    return result || null;
  }
}
