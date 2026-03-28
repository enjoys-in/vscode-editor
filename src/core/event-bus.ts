import type { EditorEvents } from './types';

type EventKey = keyof EditorEvents;
type Handler<K extends EventKey> = (payload: EditorEvents[K]) => void;

export class EventBus {
  private handlers = new Map<string, Set<Function>>();

  on<K extends EventKey>(event: K, handler: Handler<K>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off<K extends EventKey>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit<K extends EventKey>(event: K, payload: EditorEvents[K]): void {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }

  once<K extends EventKey>(event: K, handler: Handler<K>): () => void {
    const wrapper = ((payload: EditorEvents[K]) => {
      off();
      handler(payload);
    }) as Handler<K>;
    const off = this.on(event, wrapper);
    return off;
  }

  clear(): void {
    this.handlers.clear();
  }
}
