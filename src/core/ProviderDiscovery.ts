import { Container, Provider } from '../types';
import { PluginRegistry } from './PluginRegistry';

export class ProviderDiscovery {
  constructor(private container: Container) {}

  discover(): Provider[] {
    if (!this.container.has('pluginRegistry')) {
      return [];
    }
    const pluginRegistry = this.container.resolve<PluginRegistry>('pluginRegistry');
    const providers: Provider[] = [];
    for (const plugin of pluginRegistry.getAll()) {
      if (typeof plugin.getProviders === 'function') {
        providers.push(...plugin.getProviders());
      }
    }
    return providers;
  }
}
