import { Container, OrchestraPlugin } from '../types';
import { CapabilityRegistry } from './CapabilityRegistry';
import { EventBus } from './EventBus';

export class PluginRegistry {
  private plugins = new Map<string, OrchestraPlugin>();

  constructor(
    private container: Container,
    private app: any
  ) {}

  register(plugin: OrchestraPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered.`);
    }
    this.plugins.set(plugin.name, plugin);

    plugin.install(this.app);

    if (typeof plugin.getProviders === 'function') {
      const capabilityRegistry = this.container.resolve<CapabilityRegistry>('capabilityRegistry');
      const providers = plugin.getProviders();
      for (const provider of providers) {
        if (typeof provider.chat === 'function') {
          capabilityRegistry.register('chat', provider);
        }
        if (typeof provider.stream === 'function') {
          capabilityRegistry.register('stream', provider);
        }
      }
    }

    if (this.container.has('eventBus')) {
      const eventBus = this.container.resolve<EventBus>('eventBus');
      eventBus.emit('plugin:registered', plugin).catch(err => {
        console.error(`Error emitting plugin:registered for ${plugin.name}:`, err);
      });
    }
  }

  get(name: string): OrchestraPlugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): OrchestraPlugin[] {
    return Array.from(this.plugins.values());
  }
}
