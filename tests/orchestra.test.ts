import { describe, it, expect, vi } from 'vitest';
import { Orchestra } from '../src/Orchestra';
import { OrchestraCore } from '../src/core/OrchestraCore';
import { Container } from '../src/core/Container';
import { CapabilityRegistry } from '../src/core/CapabilityRegistry';
import { PluginRegistry } from '../src/core/PluginRegistry';
import { EventBus } from '../src/core/EventBus';
import { OrchestraError, OrchestraPlugin } from '../src/types';
import { validateProvider } from '../src/utils/validation';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: vi.fn().mockImplementation(async ({ contents }) => {
            if (contents === 'both_fail' || contents === 'gemini_fail') {
              const err = new Error('Gemini failed');
              (err as any).status = 500;
              throw err;
            }
            return {
              text: 'gemini response',
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
            };
          }),
          generateContentStream: vi.fn().mockImplementation(async function* ({ contents }) {
            if (contents === 'both_fail' || contents === 'gemini_fail') {
              const err = new Error('Gemini failed');
              (err as any).status = 500;
              throw err;
            }
            yield { text: 'gemini stream chunk' };
          }),
        },
      };
    }),
  };
});

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: vi.fn().mockImplementation(async ({ messages, stream }) => {
              const content = messages[0].content;
              if (content === 'both_fail' || content === 'openai_fail') {
                const err = new Error('OpenAI failed');
                (err as any).status = 500;
                throw err;
              }

              if (stream) {
                return (async function* () {
                  yield { choices: [{ delta: { content: 'openai stream chunk' } }] };
                })();
              }

              return {
                choices: [{ message: { content: 'openai response' } }],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
              };
            }),
          },
        },
      };
    }),
  };
});

describe('Orchestra SDK', () => {
  it('should execute single provider flow (gemini)', async () => {
    const ai = new Orchestra({
      provider: 'gemini',
      apiKey: 'test-key',
    });
    const res = await ai.ai.chat('hello');
    expect(res.text).toBe('gemini response');
    expect(res.provider).toBe('gemini');
  });

  it('should execute single provider flow (openai)', async () => {
    const ai = new Orchestra({
      provider: 'openai',
      apiKey: 'test-key',
    });
    const res = await ai.ai.chat('hello');
    expect(res.text).toBe('openai response');
    expect(res.provider).toBe('openai');
  });

  it('should handle complex object-based inline configurations', async () => {
    const ai = new Orchestra({
      strategy: 'fallback',
      providers: [
        { name: 'gemini', apiKey: 'inline-gemini-key', model: 'gemini-2.5-flash' },
        { name: 'openai', apiKey: 'inline-openai-key', model: 'gpt-4o' }
      ]
    });

    const res = await ai.ai.chat('hello');
    expect(res.text).toBe('gemini response');
  });

  it('should fall back to next provider if first one fails in chat', async () => {
    const ai = new Orchestra({
      providers: ['gemini', 'openai'],
    });

    const res = await ai.ai.chat('gemini_fail');
    expect(res.text).toBe('openai response');
    expect(res.provider).toBe('openai');
  });

  it('should stream successfully', async () => {
    const ai = new Orchestra({
      provider: 'gemini',
    });
    const chunks = [];
    for await (const chunk of ai.ai.stream('hello')) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('gemini stream chunk');
  });

  it('should fall back to next provider if first one fails in stream', async () => {
    const ai = new Orchestra({
      providers: ['gemini', 'openai'],
    });

    const chunks = [];
    for await (const chunk of ai.ai.stream('gemini_fail')) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('openai stream chunk');
  });

  it('should throw last error if all providers fail', async () => {
    const ai = new Orchestra({
      providers: ['gemini', 'openai'],
    });

    await expect(ai.ai.chat('both_fail')).rejects.toThrow(OrchestraError);
    try {
      await ai.ai.chat('both_fail');
    } catch (e: any) {
      expect(e.provider).toBe('openai');
      expect(e.message).toBe('OpenAI failed');
    }
  });

  it('should throw last error if all providers fail during stream initialization', async () => {
    const ai = new Orchestra({
      providers: ['gemini', 'openai'],
    });

    try {
      const stream = ai.ai.stream('both_fail');
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
    } catch (e: any) {
      expect(e.provider).toBe('openai');
      expect(e.message).toBe('OpenAI failed');
    }
  });

  it('should register and resolve services via Container', () => {
    const app = new Orchestra();
    const container = app.container;
    expect(container.has('config')).toBe(true);
    expect(container.has('eventBus')).toBe(true);
    expect(container.has('pluginRegistry')).toBe(true);
    expect(container.has('capabilityRegistry')).toBe(true);
    expect(container.has('providerDiscovery')).toBe(true);
  });

  it('should emit EventBus lifecycle events', async () => {
    const app = new Orchestra({
      provider: 'gemini',
    });

    const eventBus = app.container.resolve<EventBus>('eventBus');
    const beforeChatCalled: any[] = [];
    const afterChatCalled: any[] = [];

    eventBus.on('before:chat', (data) => {
      beforeChatCalled.push(data);
    });
    eventBus.on('after:chat', (data) => {
      afterChatCalled.push(data);
    });

    await app.ai.chat('hello event bus');

    expect(beforeChatCalled.length).toBe(1);
    expect(beforeChatCalled[0].prompt).toBe('hello event bus');
    expect(beforeChatCalled[0].provider).toBe('gemini');

    expect(afterChatCalled.length).toBe(1);
    expect(afterChatCalled[0].prompt).toBe('hello event bus');
    expect(afterChatCalled[0].response.text).toBe('gemini response');
  });

  it('should support dynamic custom plugin registration without modifying core', async () => {
    const app = new OrchestraCore({
      provider: 'custom-service',
    });

    const customPlugin: OrchestraPlugin = {
      name: 'custom-service',
      version: '2.0.0',
      install(kernel: any) {
        const capabilityRegistry = kernel.container.resolve<CapabilityRegistry>('capabilityRegistry');
        capabilityRegistry.register('chat', {
          name: 'custom-service',
          async chat(prompt: string) {
            return {
              text: `custom result for: ${prompt}`,
              model: 'custom-model-1',
              provider: 'custom-service',
            };
          }
        });
      }
    };

    app.use(customPlugin);

    const res = await app.ai.chat('hello custom');
    expect(res.text).toBe('custom result for: hello custom');
    expect(res.provider).toBe('custom-service');
  });

  it('should support dynamic dynamic property attachment for arbitrary capabilities (HelloPlugin)', async () => {
    const app = new Orchestra({
      provider: 'gemini',
    });

    class HelloPlugin {
      name = 'hello-plugin';
      version = '1.0.0';
      install(app: any) {
        app.capabilities.register(
          "hello",
          () => "hello world"
        );
      }
    }

    app.use(new HelloPlugin() as any);

    const res = await (app as any).hello();
    expect(res).toBe('hello world');
  });

  it('should target a specific provider when specified in options', async () => {
    const ai = new Orchestra({
      providers: ['gemini', 'openai'],
    });

    const resOpenAI = await ai.chat('hello', { provider: 'openai' });
    expect(resOpenAI.provider).toBe('openai');
    expect(resOpenAI.text).toBe('openai response');

    const resGemini = await ai.chat('hello', { provider: 'gemini' });
    expect(resGemini.provider).toBe('gemini');
    expect(resGemini.text).toBe('gemini response');
  });

  it('should route prompts based on heuristics', async () => {
    const ai = new Orchestra({
      providers: ['gemini', 'openai'],
    });

    // Simple chat -> prefers gemini
    const resSimple = await ai.chat('hello', { provider: 'auto' });
    expect(resSimple.provider).toBe('gemini');

    // Coding -> prefers openai (since claude not registered, openai is next best)
    const resCoding = await ai.chat('Write a typescript function to sort an array.', { provider: 'auto' });
    expect(resCoding.provider).toBe('openai');

    // Long prompt -> prefers gemini
    const longPrompt = 'A'.repeat(9000);
    const resLong = await ai.chat(longPrompt, { provider: 'auto' });
    expect(resLong.provider).toBe('gemini');
  });

  it('should place failed providers on cooldown and bypass them', async () => {
    const app = new OrchestraCore({
      providers: ['fail-provider', 'success-provider'],
      cooldownDurationMs: 50, // very short cooldown for testing
    });

    let failCount = 0;
    const failProvider = {
      name: 'fail-provider',
      async chat(prompt: string) {
        failCount++;
        const err = new Error('Rate limit exceeded');
        (err as any).status = 429; // triggers cooldown
        throw err;
      }
    };

    let successCount = 0;
    const successProvider = {
      name: 'success-provider',
      async chat(prompt: string) {
        successCount++;
        return { text: 'success response', model: 'ok', provider: 'success-provider' };
      }
    };

    app.capabilities.register('chat', failProvider);
    app.capabilities.register('chat', successProvider);

    // First call: fail-provider is tried, fails, gets put on cooldown. Then success-provider runs.
    const res1 = await app.chat('hello');
    expect(res1.text).toBe('success response');
    expect(failCount).toBe(1);
    expect(successCount).toBe(1);

    // Second call: fail-provider is on cooldown, so it is bypassed. Only success-provider runs.
    const res2 = await app.chat('hello');
    expect(res2.text).toBe('success response');
    expect(failCount).toBe(1); // still 1!
    expect(successCount).toBe(2);

    // Wait for cooldown to expire
    await new Promise(resolve => setTimeout(resolve, 60));

    // Third call: cooldown expired, so fail-provider is tried again.
    const res3 = await app.chat('hello');
    expect(res3.text).toBe('success response');
    expect(failCount).toBe(2); // increased to 2!
    expect(successCount).toBe(3);
  });

  it('should race providers and return the fastest successful result', async () => {
    const app = new OrchestraCore();

    const slowProvider = {
      name: 'slow-provider',
      async chat(prompt: string) {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { text: 'slow response', model: 'slow', provider: 'slow-provider' };
      }
    };

    const fastProvider = {
      name: 'fast-provider',
      async chat(prompt: string) {
        return { text: 'fast response', model: 'fast', provider: 'fast-provider' };
      }
    };

    app.capabilities.register('chat', slowProvider);
    app.capabilities.register('chat', fastProvider);

    const result = await app.race(['slow-provider', 'fast-provider'], 'Explain quantum physics');
    expect(result.winner).toBe('fast-provider');
    expect(result.response.text).toBe('fast response');
    expect(result.latency).toBeLessThan(50);
  });

  it('should formulate consensus using a judge model', async () => {
    const app = new OrchestraCore();

    const p1 = {
      name: 'model-a',
      async chat(prompt: string) {
        return { text: 'Answer A', model: 'a', provider: 'model-a' };
      }
    };

    const p2 = {
      name: 'model-b',
      async chat(prompt: string) {
        return { text: 'Answer B', model: 'b', provider: 'model-b' };
      }
    };

    const judge = {
      name: 'judge-model',
      async chat(prompt: string) {
        // We expect prompt to contain both responses
        expect(prompt).toContain('[Model model-a]:\nAnswer A');
        expect(prompt).toContain('[Model model-b]:\nAnswer B');
        return { text: 'Consensus is Answer A and B combined', model: 'judge', provider: 'judge-model' };
      }
    };

    app.capabilities.register('chat', p1);
    app.capabilities.register('chat', p2);
    app.capabilities.register('chat', judge);

    const result = await app.consensus(['model-a', 'model-b'], 'What is 2+2?', { judge: 'judge-model' });
    expect(result.text).toBe('Consensus is Answer A and B combined');
    expect(result.judge).toBe('judge-model');
    expect(result.responses.length).toBe(2);
    expect(result.responses[0].provider).toBe('model-a');
    expect(result.responses[1].provider).toBe('model-b');
  });

  describe('Provider Compliance Suite', () => {
    it('should pass validation for a fully compliant provider', async () => {
      const validProvider = {
        name: 'valid-provider',
        async chat(prompt: string) {
          return {
            text: `Echo: ${prompt}`,
            model: 'valid-model-1',
            provider: 'valid-provider',
          };
        }
      };

      const result = await validateProvider(validProvider);
      expect(result.passed).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect compliance failures for incorrect formats or names', async () => {
      const invalidProvider = {
        name: '', // Empty name
        async chat(prompt: string) {
          return {
            text: 123 as any, // Not a string
            model: 'valid-model-1',
            provider: 'different-provider-name', // Mismatched provider
          };
        }
      };

      const result = await validateProvider(invalidProvider as any);
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
      expect(result.errors.some(e => e.includes('text'))).toBe(true);
      expect(result.errors.some(e => e.includes('match'))).toBe(true);
    });
  });
});
