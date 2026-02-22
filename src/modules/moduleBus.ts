type Handler<T> = (payload: T) => void;

export class CanBus<TEvents extends object> {
  private handlers = new Map<keyof TEvents, Set<Handler<any>>>();

  on<K extends keyof TEvents>(event: K, handler: Handler<TEvents[K]>): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler<TEvents[K]>>();
    set.add(handler);
    this.handlers.set(event, set as Set<Handler<any>>);
    return () => {
      const current = this.handlers.get(event);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.forEach((handler) => handler(payload));
  }
}
