import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '../src/plugins/openai/OpenAIProvider';
import { Container } from '../src/core/Container';
import { OrchestraError } from '../src/types';

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: vi.fn().mockImplementation(async ({ messages, stream }) => {
              const prompt = messages[0].content;
              if (prompt === 'fail_auth') {
                const err = new Error('Incorrect API key provided');
                (err as any).status = 401;
                throw err;
              }
              if (prompt === 'fail_rate') {
                const err = new Error('Rate limit reached');
                (err as any).status = 429;
                throw err;
              }

              if (stream) {
                return (async function* () {
                  yield { choices: [{ delta: { content: 'hello' } }] };
                  yield { choices: [{ delta: { content: ' ' } }] };
                  yield { choices: [{ delta: { content: 'world' } }] };
                })();
              }

              return {
                choices: [{ message: { content: 'mocked openai response' } }],
                usage: {
                  prompt_tokens: 12,
                  completion_tokens: 6,
                 },
              };
            }),
          },
        },
      };
    }),
  };
});

describe('OpenAIProvider', () => {
  it('should format successful chat responses correctly', async () => {
    const container = new Container();
    const provider = new OpenAIProvider(container, { apiKey: 'fake-key' });
    const res = await provider.chat('hello');
    expect(res.text).toBe('mocked openai response');
    expect(res.provider).toBe('openai');
    expect(res.usage?.inputTokens).toBe(12);
    expect(res.usage?.outputTokens).toBe(6);
  });

  it('should stream chunks correctly', async () => {
    const container = new Container();
    const provider = new OpenAIProvider(container, { apiKey: 'fake-key' });
    const chunks = [];
    for await (const chunk of provider.stream('hello')) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('hello world');
  });

  it('should normalize authentication errors', async () => {
    const container = new Container();
    const provider = new OpenAIProvider(container, { apiKey: 'fake-key' });
    await expect(provider.chat('fail_auth')).rejects.toThrow(OrchestraError);
    try {
      await provider.chat('fail_auth');
    } catch (e: any) {
      expect(e.code).toBe('AUTHENTICATION');
      expect(e.provider).toBe('openai');
    }
  });

  it('should normalize rate limit errors', async () => {
    const container = new Container();
    const provider = new OpenAIProvider(container, { apiKey: 'fake-key' });
    try {
      await provider.chat('fail_rate');
    } catch (e: any) {
      expect(e.code).toBe('RATE_LIMIT');
      expect(e.provider).toBe('openai');
    }
  });
});
