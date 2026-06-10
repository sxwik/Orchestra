export class CapabilityRegistry {
  private registry = new Map<string, any[]>();

  constructor(private app?: any) {}

  register(capability: string, value: any): void {
    if (!this.registry.has(capability)) {
      this.registry.set(capability, []);
    }
    const list = this.registry.get(capability)!;
    list.push(value);

    if (this.app && !(capability in this.app)) {
      if (typeof value === 'function') {
        this.app[capability] = async (...args: any[]) => {
          return value(...args);
        };
      } else {
        this.app[capability] = value;
      }
    }
  }

  resolve(capability: string): any[] {
    return this.registry.get(capability) || [];
  }
}
