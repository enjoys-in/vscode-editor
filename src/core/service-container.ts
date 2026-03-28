export class ServiceContainer {
  private services = new Map<string, unknown>();

  register<T>(id: string, service: T): void {
    if (this.services.has(id)) {
      throw new Error(`Service "${id}" is already registered`);
    }
    this.services.set(id, service);
  }

  get<T>(id: string): T {
    const svc = this.services.get(id);
    if (!svc) throw new Error(`Service "${id}" not found`);
    return svc as T;
  }

  has(id: string): boolean {
    return this.services.has(id);
  }

  unregister(id: string): void {
    this.services.delete(id);
  }
}
