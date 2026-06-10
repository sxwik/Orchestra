import { describe, it, expect, vi } from 'vitest';
import { Orchestra } from '../src/Orchestra';
import { OrchestraCore } from '../src/core/OrchestraCore';
import { Container } from '../src/core/Container';
import { CapabilityRegistry } from '../src/core/CapabilityRegistry';
import { PluginRegistry } from '../src/core/PluginRegistry';
import { EventBus } from '../src/core/EventBus';
import { OrchestraError, OrchestraPlugin } from '../src/types';

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
});
