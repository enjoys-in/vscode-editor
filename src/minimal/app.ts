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
import { initializeMonaco } from './setup';

export interface MinimalAppOptions {
  container?: HTMLElement | string;
  userConfiguration?: string;
  userKeybindings?: string;
}

export class MinimalApp {
  readonly plugins = new PluginRegistry();
  readonly modules = new ModuleRegistry();
  readonly events = new EventBus();
  readonly services = new ServiceContainer();
  readonly commands = new CommandRegistry();

  constructor(private options: MinimalAppOptions = {}) {}

  registerPlugin(p: Plugin | PluginFactory): Disposable {
    return this.plugins.register(p);
  }

  registerModule(m: Module | ModuleFactory): Disposable {
    return this.modules.register(m);
  }

  async boot(): Promise<void> {
    const containerEl =
      typeof this.options.container === 'string'
        ? document.querySelector<HTMLElement>(this.options.container)!
        : this.options.container ?? document.getElementById('workbench')!;

    console.log('[MinimalApp] Before initializeMonaco');
    await initializeMonaco({
      container: containerEl,
      userConfiguration: this.options.userConfiguration,
      userKeybindings: this.options.userKeybindings,
    });
    console.log('[MinimalApp] After initializeMonaco');

    this.services.register('events', this.events);
    this.services.register('commands', this.commands);

    const moduleCtx: ModuleContext = {
      services: this.services,
      events: this.events,
    };
    await this.modules.initAll(moduleCtx);
    console.log('[MinimalApp] Modules initialized');

    const pluginCtx = this.buildPluginContext();
    await this.plugins.activateAll(pluginCtx);
    console.log('[MinimalApp] Plugins activated');

    this.events.emit('editor:ready', undefined);
  }

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
