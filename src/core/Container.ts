import { Container as IContainer } from '../types';

export class Container implements IContainer {
  private bindings = new Map<string, any>();

  bind<T>(name: string, instance: T): void {
    this.bindings.set(name, instance);
  }

  resolve<T>(name: string): T {
    if (!this.bindings.has(name)) {
      throw new Error(`Dependency '${name}' not found in container.`);
    }
    return this.bindings.get(name) as T;
  }

  has(name: string): boolean {
    return this.bindings.has(name);
  }
}
