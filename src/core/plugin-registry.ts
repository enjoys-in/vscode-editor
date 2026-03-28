import type {
  Plugin,
  PluginFactory,
  PluginContext,
  Disposable,
} from './types';

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private activated = new Set<string>();

  register(factoryOrPlugin: PluginFactory | Plugin): Disposable {
    const plugin =
      typeof factoryOrPlugin === 'function' ? factoryOrPlugin() : factoryOrPlugin;

    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.plugins.set(plugin.id, plugin);
    return { dispose: () => this.unregister(plugin.id) };
  }

  async activate(id: string, ctx: PluginContext): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" not found`);
    if (this.activated.has(id)) return;

    await plugin.activate(ctx);
    this.activated.add(id);
    ctx.events.emit('plugin:activated', { id });
  }

  async activateAll(ctx: PluginContext): Promise<void> {
    for (const id of this.plugins.keys()) {
      await this.activate(id, ctx);
    }
  }

  async deactivate(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin || !this.activated.has(id)) return;

    await plugin.deactivate?.();
    this.activated.delete(id);
  }

  private async unregister(id: string): Promise<void> {
    await this.deactivate(id);
    this.plugins.delete(id);
  }

  get(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): Plugin[] {
    return [...this.plugins.values()];
  }

  isActive(id: string): boolean {
    return this.activated.has(id);
  }
}
