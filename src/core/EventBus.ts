export type EventListener<T = any> = (data: T) => void | Promise<void>;

export class EventBus {
  private listeners = new Map<string, EventListener[]>();

  on(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  off(event: string, listener: EventListener): void {
    const list = this.listeners.get(event);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) {
        list.splice(idx, 1);
      }
    }
  }

  async emit(event: string, data?: any): Promise<void> {
    const list = this.listeners.get(event) || [];
    for (const listener of list) {
      try {
        await listener(data);
      } catch (err) {
        console.error(`Error in event listener for '${event}':`, err);
      }
    }
  }
}
