import * as monaco from 'monaco-editor';
import type { Plugin, PluginContext, Disposable } from '@core/types';

export interface AICompletionOptions {
  endpoint: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  debounceMs?: number;
}

const DEFAULT_OPTIONS: AICompletionOptions = {
  endpoint: '',
  model: 'gpt-4',
  maxTokens: 256,
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
      const statusItem = ctx.vscode.window.createStatusBarItem(
        ctx.vscode.StatusBarAlignment.Right,
        90,
      );
      statusItem.text = options.endpoint ? '$(sparkle) AI' : '$(sparkle) AI (no endpoint)';
      statusItem.tooltip = 'AI Completion';
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

  constructor(private options: AICompletionOptions) {}

  async provideInlineCompletions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.InlineCompletionContext,
    _token: monaco.CancellationToken,
  ): Promise<monaco.languages.InlineCompletions> {
    if (!this.options.endpoint) return { items: [] };

    // Debounce
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          const text = model.getValue();
          const offset = model.getOffsetAt(position);
          const prefix = text.slice(0, offset);
          const suffix = text.slice(offset);

          const result = await this.fetchCompletion(prefix, suffix);
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

  private async fetchCompletion(
    prefix: string,
    suffix: string,
  ): Promise<string | null> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.options.apiKey) {
      headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    }

    const resp = await fetch(this.options.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        messages: [
          {
            role: 'system',
            content:
              'You are an inline code completion engine. Return ONLY the code to insert. No explanations.',
          },
          {
            role: 'user',
            content: `Complete the code at the cursor position marked with <CURSOR>:\n\n${prefix}<CURSOR>${suffix}`,
          },
        ],
      }),
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  }
}
