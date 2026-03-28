import * as vscode from 'vscode';
import * as monaco from 'monaco-editor';
import type {
  Plugin,
  PluginFactory,
  PluginContext,
  Module,
  ModuleFactory,
  ModuleContext,
  Disposable,
  Keybinding,
  CommandHandler,
} from '@core/types';
import { PluginRegistry } from '@core/plugin-registry';
import { ModuleRegistry } from '@core/module-registry';
import { EventBus } from '@core/event-bus';
import { ServiceContainer } from '@core/service-container';
import { CommandRegistry } from '@core/command-registry';
import { initializeMonaco } from '@editor/setup';

export interface AppOptions {
  /** CSS selector or HTMLElement for the workbench container */
  container?: HTMLElement | string;
  /** Override default user configuration JSON string */
  userConfiguration?: string;
  /** Override default user keybindings JSON string */
  userKeybindings?: string;
}

export class App {
  readonly plugins = new PluginRegistry();
  readonly modules = new ModuleRegistry();
  readonly events = new EventBus();
  readonly services = new ServiceContainer();
  readonly commands = new CommandRegistry();

  constructor(private options: AppOptions = {}) {}

  // ------------------------------------------------------------------
  // Public API — register plugins & modules before boot
  // ------------------------------------------------------------------

  registerPlugin(p: Plugin | PluginFactory): Disposable {
    return this.plugins.register(p);
  }

  registerModule(m: Module | ModuleFactory): Disposable {
    return this.modules.register(m);
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  async boot(): Promise<void> {
    // Resolve workbench container
    const containerEl =
      typeof this.options.container === 'string'
        ? document.querySelector<HTMLElement>(this.options.container)!
        : this.options.container ?? document.getElementById('workbench')!;

    // 1. Init Monaco workbench (renders full VSCode UI into containerEl)
    await initializeMonaco({
      container: containerEl,
      userConfiguration: this.options.userConfiguration,
      userKeybindings: this.options.userKeybindings,
    });

    // 2. Register core services into service container
    this.services.register('events', this.events);
    this.services.register('commands', this.commands);

    // 3. Init modules (low-level services that plugins depend on)
    const moduleCtx: ModuleContext = {
      services: this.services,
      events: this.events,
    };
    await this.modules.initAll(moduleCtx);

    // 4. Activate plugins (get the full context with vscode + monaco APIs)
    const pluginCtx = this.buildPluginContext();
    await this.plugins.activateAll(pluginCtx);

    this.events.emit('editor:ready', undefined);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private buildPluginContext(): PluginContext {
    const self = this;
    return {
      services: this.services,
      events: this.events,
      vscode,
      monaco,
      registerCommand(id: string, handler: CommandHandler): Disposable {
        return self.commands.register(id, handler);
      },
      registerKeybinding(kb: Keybinding): Disposable {
        return self.commands.registerKeybinding(kb);
      },
    };
  }
}
