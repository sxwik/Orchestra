import { Container } from './Container';
import { EventBus } from './EventBus';
import { CapabilityRegistry } from './CapabilityRegistry';
import { PluginRegistry } from './PluginRegistry';
import { ProviderDiscovery } from './ProviderDiscovery';
import { ChatResponse, OrchestraConfig, OrchestraPlugin, Provider, ChatOptions, RaceResult, ConsensusResult } from '../types';

export class AIDomain {
  private healthMap = new Map<string, { consecutiveFailures: number; cooldownUntil: number }>();

  constructor(private container: Container) {}

  private isCoolingDown(providerName: string): boolean {
    const health = this.healthMap.get(providerName);
    if (!health) return false;
    return Date.now() < health.cooldownUntil;
  }

  private getCooldownDuration(): number {
    try {
      const config = this.container.resolve<OrchestraConfig>('config');
      return config.cooldownDurationMs ?? 15000;
    } catch {
      return 15000;
    }
  }

  private recordFailure(providerName: string, error: any): void {
    const health = this.healthMap.get(providerName) || { consecutiveFailures: 0, cooldownUntil: 0 };
    health.consecutiveFailures += 1;
    
    const isRateLimit = error?.code === 'RATE_LIMIT' || error?.status === 429;
    const isAuth = error?.code === 'AUTHENTICATION' || error?.status === 401 || error?.status === 403;
    
    if (isRateLimit || isAuth || health.consecutiveFailures >= 2) {
      const duration = isAuth ? 3600000 : this.getCooldownDuration();
      health.cooldownUntil = Date.now() + duration;
    }
    this.healthMap.set(providerName, health);
  }

  private recordSuccess(providerName: string): void {
    this.healthMap.delete(providerName);
  }

  private routePrompt(prompt: string, providers: Provider[]): Provider[] {
    const lowerPrompt = prompt.toLowerCase();
    
    const isCoding = 
      /```[\s\S]*```/.test(prompt) ||
      /\b(code|function|class|program|compile|debug|refactor|syntax|algorithm|api|database|json|html|css|javascript|typescript|python|c\+\+|java)\b/.test(lowerPrompt);

    const isLongContext = prompt.length > 8000;

    const isReasoning = 
      /\b(explain|why|logic|proof|solve|math|reason|step-by-step|derive|analyze|critical)\b/.test(lowerPrompt);

    let preference: string[] = [];
    if (isCoding) {
      preference = ['claude', 'openai', 'gemini'];
    } else if (isLongContext) {
      preference = ['gemini', 'openai', 'claude'];
    } else if (isReasoning) {
      preference = ['openai', 'claude', 'gemini'];
    } else {
      preference = ['gemini', 'openai', 'claude'];
    }

    const sorted = [...providers].sort((a, b) => {
      let idxA = preference.indexOf(a.name);
      let idxB = preference.indexOf(b.name);
      if (idxA === -1) idxA = 999;
      if (idxB === -1) idxB = 999;
      return idxA - idxB;
    });

    return sorted;
  }

  private getActiveProviders(
    capability: 'chat' | 'stream',
    prompt: string,
    options?: ChatOptions
  ): Provider[] {
    const capabilityRegistry = this.container.resolve<CapabilityRegistry>('capabilityRegistry');
    const providers = capabilityRegistry.resolve(capability);

    if (providers.length === 0) {
      throw new Error(`No providers with ${capability} capability are registered.`);
    }

    const config = this.container.resolve<OrchestraConfig>('config');
    let configuredNames: string[] = [];
    if (options?.providers && options.providers.length > 0) {
      configuredNames = options.providers;
    } else {
      configuredNames = getConfiguredProviders(config);
    }

    let activeProviders = providers.filter(p => 
      configuredNames.length === 0 || configuredNames.includes(p.name)
    );

    if (options?.provider && options.provider !== 'auto') {
      activeProviders = activeProviders.filter(p => p.name === options.provider);
    }

    if (activeProviders.length === 0) {
      throw new Error(`No configured providers with ${capability} capability are available.`);
    }

    const strategy = options?.strategy || (options?.provider === 'auto' ? 'router' : (config.strategy || 'fallback'));

    if (options?.provider === 'auto' || strategy === 'router') {
      activeProviders = this.routePrompt(prompt, activeProviders);
    } else {
      if (configuredNames.length > 0) {
        activeProviders.sort((a, b) => 
          configuredNames.indexOf(a.name) - configuredNames.indexOf(b.name)
        );
      }
    }

    return activeProviders;
  }

  async chat(prompt: string, options?: ChatOptions): Promise<ChatResponse> {
    const activeProviders = this.getActiveProviders('chat', prompt, options);
    const eventBus = this.container.resolve<EventBus>('eventBus');

    const healthyProviders = activeProviders.filter(p => !this.isCoolingDown(p.name));
    const selectedProviders = healthyProviders.length > 0 ? healthyProviders : activeProviders;

    let lastError: any = null;

    for (const provider of selectedProviders) {
      try {
        await eventBus.emit('before:chat', { prompt, provider: provider.name });
        const res = await provider.chat!(prompt, options);
        await eventBus.emit('after:chat', { prompt, response: res, provider: provider.name });
        this.recordSuccess(provider.name);
        return res;
      } catch (err: any) {
        lastError = err;
        this.recordFailure(provider.name, err);
        await eventBus.emit('error:chat', { prompt, error: err, provider: provider.name });
      }
    }

    throw lastError;
  }

  async *stream(prompt: string, options?: ChatOptions): AsyncIterable<string> {
    const activeProviders = this.getActiveProviders('stream', prompt, options);
    const eventBus = this.container.resolve<EventBus>('eventBus');

    const healthyProviders = activeProviders.filter(p => !this.isCoolingDown(p.name));
    const selectedProviders = healthyProviders.length > 0 ? healthyProviders : activeProviders;

    let lastError: any = null;

    for (const provider of selectedProviders) {
      try {
        await eventBus.emit('before:stream', { prompt, provider: provider.name });
        const streamIterable = provider.stream!(prompt, options);
        const iterator = streamIterable[Symbol.asyncIterator]();
        
        let firstResult: IteratorResult<string>;
        try {
          firstResult = await iterator.next();
        } catch (err) {
          lastError = err;
          this.recordFailure(provider.name, err);
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
        
        this.recordSuccess(provider.name);
        await eventBus.emit('after:stream', { prompt, provider: provider.name });
        return;
      } catch (err: any) {
        lastError = err;
        this.recordFailure(provider.name, err);
        await eventBus.emit('error:stream', { prompt, error: err, provider: provider.name });
      }
    }

    throw lastError;
  }

  async race(
    providersOrPrompt: string[] | string,
    prompt?: string,
    options?: ChatOptions
  ): Promise<RaceResult> {
    const eventBus = this.container.resolve<EventBus>('eventBus');
    let targetProviders: string[] = [];
    let actualPrompt = '';

    if (Array.isArray(providersOrPrompt)) {
      targetProviders = providersOrPrompt;
      actualPrompt = prompt || '';
    } else {
      actualPrompt = providersOrPrompt;
      const config = this.container.resolve<OrchestraConfig>('config');
      targetProviders = getConfiguredProviders(config);
    }

    const capabilityRegistry = this.container.resolve<CapabilityRegistry>('capabilityRegistry');
    const allProviders = capabilityRegistry.resolve('chat');
    
    const activeProviders = allProviders.filter(p => targetProviders.includes(p.name));
    
    if (activeProviders.length === 0) {
      throw new Error('No available providers matched the race targets.');
    }

    const startTime = Date.now();
    
    return new Promise<RaceResult>((resolve, reject) => {
      let completed = false;
      let failures = 0;
      const errors: any[] = [];

      activeProviders.forEach(async (provider) => {
        try {
          await eventBus.emit('before:chat', { prompt: actualPrompt, provider: provider.name });
          const res = await provider.chat!(actualPrompt, options);
          const latency = Date.now() - startTime;
          
          if (!completed) {
            completed = true;
            await eventBus.emit('after:chat', { prompt: actualPrompt, response: res, provider: provider.name });
            resolve({
              winner: provider.name,
              latency,
              response: res,
            });
          }
        } catch (err: any) {
          errors.push(err);
          failures++;
          await eventBus.emit('error:chat', { prompt: actualPrompt, error: err, provider: provider.name });
          
          if (failures === activeProviders.length && !completed) {
            reject(new Error(`All raced providers failed: ${errors.map(e => e.message || String(e)).join(', ')}`));
          }
        }
      });
    });
  }

  async consensus(
    providersOrPrompt: string[] | string,
    prompt?: string,
    options?: ChatOptions
  ): Promise<ConsensusResult> {
    const eventBus = this.container.resolve<EventBus>('eventBus');
    let targetProviders: string[] = [];
    let actualPrompt = '';

    if (Array.isArray(providersOrPrompt)) {
      targetProviders = providersOrPrompt;
      actualPrompt = prompt || '';
    } else {
      actualPrompt = providersOrPrompt;
      const config = this.container.resolve<OrchestraConfig>('config');
      targetProviders = getConfiguredProviders(config);
    }

    const capabilityRegistry = this.container.resolve<CapabilityRegistry>('capabilityRegistry');
    const allProviders = capabilityRegistry.resolve('chat');
    const activeProviders = allProviders.filter(p => targetProviders.includes(p.name));

    if (activeProviders.length === 0) {
      throw new Error('No available providers matched the consensus targets.');
    }

    const promises = activeProviders.map(async (provider) => {
      try {
        await eventBus.emit('before:chat', { prompt: actualPrompt, provider: provider.name });
        const res = await provider.chat!(actualPrompt, options);
        await eventBus.emit('after:chat', { prompt: actualPrompt, response: res, provider: provider.name });
        return { provider: provider.name, text: res.text, model: res.model, success: true as const, response: res };
      } catch (err: any) {
        await eventBus.emit('error:chat', { prompt: actualPrompt, error: err, provider: provider.name });
        return { provider: provider.name, text: '', model: '', success: false as const, error: err };
      }
    });

    const results = await Promise.all(promises);
    const successful = results.filter(r => r.success);

    if (successful.length === 0) {
      throw new Error('All providers failed to respond for consensus.');
    }

    if (successful.length === 1) {
      return {
        text: successful[0].text,
        judge: successful[0].provider,
        responses: successful.map(s => ({ provider: s.provider, text: s.text, model: s.model })),
        usage: successful[0].response.usage,
      };
    }

    const judgeProviderName: string = options?.judge || successful[0].provider;

    const judgeProvider = allProviders.find(p => p.name === judgeProviderName);
    if (!judgeProvider) {
      throw new Error(`Consensus Judge provider '${judgeProviderName}' not found or available.`);
    }

    const defaultJudgePrompt = `You are an expert consensus evaluator. Below are responses from different AI models to the prompt: "${actualPrompt}".
Analyze the responses, resolve any contradictions, and output the final, most accurate consensus response.

Responses:
${successful.map(r => `[Model ${r.provider}]:\n${r.text}`).join('\n\n')}

Provide the final consensus answer.`;

    const consensusPrompt = options?.judgePrompt || defaultJudgePrompt;

    await eventBus.emit('before:chat', { prompt: consensusPrompt, provider: judgeProviderName });
    const judgeRes = await judgeProvider.chat!(consensusPrompt, options);
    await eventBus.emit('after:chat', { prompt: consensusPrompt, response: judgeRes, provider: judgeProviderName });

    return {
      text: judgeRes.text,
      judge: judgeProviderName,
      responses: successful.map(s => ({ provider: s.provider, text: s.text, model: s.model })),
      usage: judgeRes.usage,
    };
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

  async chat(prompt: string, options?: ChatOptions): Promise<ChatResponse> {
    return this.ai.chat(prompt, options);
  }

  stream(prompt: string, options?: ChatOptions): AsyncIterable<string> {
    return this.ai.stream(prompt, options);
  }

  async race(
    providersOrPrompt: string[] | string,
    prompt?: string,
    options?: ChatOptions
  ): Promise<RaceResult> {
    return this.ai.race(providersOrPrompt, prompt, options);
  }

  async consensus(
    providersOrPrompt: string[] | string,
    prompt?: string,
    options?: ChatOptions
  ): Promise<ConsensusResult> {
    return this.ai.consensus(providersOrPrompt, prompt, options);
  }
}
