import type { CommandHandler, Disposable, Keybinding } from './types';

export class CommandRegistry {
  private commands = new Map<string, CommandHandler>();
  private keybindings: Keybinding[] = [];

  register(id: string, handler: CommandHandler): Disposable {
    if (this.commands.has(id)) {
      throw new Error(`Command "${id}" is already registered`);
    }
    this.commands.set(id, handler);
    return { dispose: () => this.commands.delete(id) };
  }

  execute(id: string, ...args: unknown[]): unknown {
    const handler = this.commands.get(id);
    if (!handler) throw new Error(`Command "${id}" not found`);
    return handler(...args);
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  registerKeybinding(kb: Keybinding): Disposable {
    this.keybindings.push(kb);
    return {
      dispose: () => {
        const idx = this.keybindings.indexOf(kb);
        if (idx >= 0) this.keybindings.splice(idx, 1);
      },
    };
  }

  getKeybindings(): readonly Keybinding[] {
    return this.keybindings;
  }
}
