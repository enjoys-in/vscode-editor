import type {
  Module,
  ModuleFactory,
  ModuleContext,
  Disposable,
} from './types';

export class ModuleRegistry {
  private modules = new Map<string, Module>();
  private initialized = new Set<string>();

  register(factoryOrModule: ModuleFactory | Module): Disposable {
    const mod =
      typeof factoryOrModule === 'function' ? factoryOrModule() : factoryOrModule;

    if (this.modules.has(mod.id)) {
      throw new Error(`Module "${mod.id}" is already registered`);
    }
    this.modules.set(mod.id, mod);
    return { dispose: () => this.unregister(mod.id) };
  }

  async init(id: string, ctx: ModuleContext): Promise<void> {
    const mod = this.modules.get(id);
    if (!mod) throw new Error(`Module "${id}" not found`);
    if (this.initialized.has(id)) return;

    await mod.init(ctx);
    this.initialized.add(id);
    ctx.events.emit('module:initialized', { id });
  }

  async initAll(ctx: ModuleContext): Promise<void> {
    for (const id of this.modules.keys()) {
      await this.init(id, ctx);
    }
  }

  async dispose(id: string): Promise<void> {
    const mod = this.modules.get(id);
    if (!mod || !this.initialized.has(id)) return;

    await mod.dispose?.();
    this.initialized.delete(id);
  }

  private async unregister(id: string): Promise<void> {
    await this.dispose(id);
    this.modules.delete(id);
  }

  get(id: string): Module | undefined {
    return this.modules.get(id);
  }

  getAll(): Module[] {
    return [...this.modules.values()];
  }
}
