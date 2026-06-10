import { Container } from './Container';
import { EventBus } from './EventBus';
import { CapabilityRegistry } from './CapabilityRegistry';
import { PluginRegistry } from './PluginRegistry';
import { ProviderDiscovery } from './ProviderDiscovery';
import { ChatResponse, OrchestraConfig, OrchestraPlugin, Provider } from '../types';

export class AIDomain {
  constructor(private container: Container) {}

  async chat(prompt: string): Promise<ChatResponse> {
    const capabilityRegistry = this.container.resolve<CapabilityRegistry>('capabilityRegistry');
    const eventBus = this.container.resolve<EventBus>('eventBus');
    const providers = capabilityRegistry.resolve('chat');

    if (providers.length === 0) {
      throw new Error('No providers with chat capability are registered.');
    }

    const config = this.container.resolve<OrchestraConfig>('config');
    const configuredNames = getConfiguredProviders(config);

    const activeProviders = providers.filter(p => 
      configuredNames.length === 0 || configuredNames.includes(p.name)
    );

    if (activeProviders.length === 0) {
      throw new Error('No configured providers with chat capability are available.');
    }

    if (configuredNames.length > 0) {
      activeProviders.sort((a, b) => 
        configuredNames.indexOf(a.name) - configuredNames.indexOf(b.name)
      );
    }

    let lastError: any = null;

    for (const provider of activeProviders) {
      try {
        await eventBus.emit('before:chat', { prompt, provider: provider.name });
        const res = await provider.chat!(prompt);
        await eventBus.emit('after:chat', { prompt, response: res, provider: provider.name });
        return res;
      } catch (err: any) {
        lastError = err;
        await eventBus.emit('error:chat', { prompt, error: err, provider: provider.name });
      }
    }

    throw lastError;
  }

  async *stream(prompt: string): AsyncIterable<string> {
    const capabilityRegistry = this.container.resolve<CapabilityRegistry>('capabilityRegistry');
    const eventBus = this.container.resolve<EventBus>('eventBus');
    const providers = capabilityRegistry.resolve('stream');

    if (providers.length === 0) {
      throw new Error('No providers with stream capability are registered.');
    }

    const config = this.container.resolve<OrchestraConfig>('config');
    const configuredNames = getConfiguredProviders(config);

    const activeProviders = providers.filter(p => 
      configuredNames.length === 0 || configuredNames.includes(p.name)
    );

    if (activeProviders.length === 0) {
      throw new Error('No configured providers with stream capability are available.');
    }

    if (configuredNames.length > 0) {
      activeProviders.sort((a, b) => 
        configuredNames.indexOf(a.name) - configuredNames.indexOf(b.name)
      );
    }

    let lastError: any = null;

    for (const provider of activeProviders) {
      try {
        await eventBus.emit('before:stream', { prompt, provider: provider.name });
        const streamIterable = provider.stream!(prompt);
        const iterator = streamIterable[Symbol.asyncIterator]();
        
        let firstResult: IteratorResult<string>;
        try {
          firstResult = await iterator.next();
        } catch (err) {
          lastError = err;
          await eventBus.emit('error:stream', { prompt, error: err, provider: provider.name });
          continue;
        }

        if (!firstResult.done) {
          yield firstResult.value;
        }

        while (true) {
          const { value, done } = await iterator.next();
          if (done) break;
          yield value;
        }
        
        await eventBus.emit('after:stream', { prompt, provider: provider.name });
        return;
      } catch (err: any) {
        lastError = err;
        await eventBus.emit('error:stream', { prompt, error: err, provider: provider.name });
      }
    }

    throw lastError;
  }
}

function getConfiguredProviders(config: OrchestraConfig): string[] {
  const list: string[] = [];
  if (config.provider) {
    list.push(typeof config.provider === 'string' ? config.provider : config.provider.name);
  } else if (config.providers) {
    for (const p of config.providers) {
      list.push(typeof p === 'string' ? p : p.name);
    }
  }
  return list;
}

export class OrchestraCore {
  public container: Container;
  public ai: AIDomain;
  public capabilities: CapabilityRegistry;

  constructor(config: OrchestraConfig = {}) {
    this.container = new Container();
    this.container.bind('config', config);

    const eventBus = new EventBus();
    this.container.bind('eventBus', eventBus);

    this.capabilities = new CapabilityRegistry(this);
    this.container.bind('capabilityRegistry', this.capabilities);

    const pluginRegistry = new PluginRegistry(this.container, this);
    this.container.bind('pluginRegistry', pluginRegistry);

    const providerDiscovery = new ProviderDiscovery(this.container);
    this.container.bind('providerDiscovery', providerDiscovery);

    this.ai = new AIDomain(this.container);
  }

  use(plugin: OrchestraPlugin): void {
    const pluginRegistry = this.container.resolve<PluginRegistry>('pluginRegistry');
    pluginRegistry.register(plugin);
  }

  async chat(prompt: string): Promise<ChatResponse> {
    return this.ai.chat(prompt);
  }

  stream(prompt: string): AsyncIterable<string> {
    return this.ai.stream(prompt);
  }
}
