import type { EventBus } from './event-bus';
import type { ServiceContainer } from './service-container';

// ---------------------------------------------------------------------------
// Plugin System Types
// ---------------------------------------------------------------------------

export interface PluginContext {
  /** Shared service container for inter-plugin communication */
  services: ServiceContainer;
  /** Event bus for pub/sub communication */
  events: EventBus;
  /** Full vscode extension API */
  vscode: typeof import('vscode');
  /** Full monaco-editor API */
  monaco: typeof import('monaco-editor');
  /** Register a command that can be triggered by keybindings or other plugins */
  registerCommand(id: string, handler: CommandHandler): Disposable;
  /** Register a keybinding */
  registerKeybinding(keybinding: Keybinding): Disposable;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  activate(ctx: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export type PluginFactory = () => Plugin;

// ---------------------------------------------------------------------------
// Module System Types
// ---------------------------------------------------------------------------

export interface ModuleContext {
  services: ServiceContainer;
  events: EventBus;
}

export interface Module {
  id: string;
  name: string;
  init(ctx: ModuleContext): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export type ModuleFactory = () => Module;

// ---------------------------------------------------------------------------
// Command / Keybinding Types
// ---------------------------------------------------------------------------

export type CommandHandler = (...args: unknown[]) => unknown;

export interface Keybinding {
  command: string;
  key: string;
  when?: string;
}

// ---------------------------------------------------------------------------
// Disposable
// ---------------------------------------------------------------------------

export interface Disposable {
  dispose(): void;
}

export class DisposableStore implements Disposable {
  private items: Disposable[] = [];

  add<T extends Disposable>(d: T): T {
    this.items.push(d);
    return d;
  }

  dispose(): void {
    for (const d of this.items.splice(0)) {
      d.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EditorEvents {
  'editor:ready': undefined;
  'editor:model-changed': { uri: string };
  'plugin:activated': { id: string };
  'plugin:deactivated': { id: string };
  'module:initialized': { id: string };
  'command:execute': { id: string; args: unknown[] };
}
