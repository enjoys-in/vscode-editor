import { updateUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override';
import type { Plugin, PluginContext, Disposable } from '@core/types';

export interface ThemePluginOptions {
  defaultTheme?: string;
  userConfig?: Record<string, unknown>;
}

export function createThemePlugin(options?: ThemePluginOptions): Plugin {
  const disposables: Disposable[] = [];

  return {
    id: 'builtin.theme',
    name: 'Theme Manager',
    version: '1.0.0',

    activate(ctx: PluginContext) {
      // Initial config is loaded from user/configuration.json in setup.ts.
      // This plugin provides a runtime API to change theme / settings on the fly.
      const currentOverrides: Record<string, unknown> = {
        ...options?.userConfig,
      };
      if (options?.defaultTheme) {
        currentOverrides['workbench.colorTheme'] = options.defaultTheme;
      }

      // Apply any overrides provided at plugin creation
      if (Object.keys(currentOverrides).length > 0) {
        updateUserConfiguration(JSON.stringify(currentOverrides));
      }

      // Service for runtime theme/config changes
      const themeService = {
        setTheme(theme: string) {
          currentOverrides['workbench.colorTheme'] = theme;
          updateUserConfiguration(JSON.stringify(currentOverrides));
        },
        updateConfig(patch: Record<string, unknown>) {
          Object.assign(currentOverrides, patch);
          updateUserConfiguration(JSON.stringify(currentOverrides));
        },
        getConfig: () => ({ ...currentOverrides }),
      };

      ctx.services.register('theme', themeService);

      disposables.push(
        ctx.registerCommand('theme.setTheme', (theme: unknown) => {
          if (typeof theme === 'string') themeService.setTheme(theme);
        }),
      );
    },

    deactivate() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
