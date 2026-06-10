import { describe, it, expect, vi } from 'vitest';
import { GeminiProvider } from '../src/plugins/gemini/GeminiProvider';
import { Container } from '../src/core/Container';
import { OrchestraError } from '../src/types';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: vi.fn().mockImplementation(async ({ contents }) => {
            if (contents === 'fail_auth') {
              const err = new Error('API key is invalid');
              (err as any).status = 403;
              throw err;
            }
            if (contents === 'fail_rate') {
              const err = new Error('Rate limit exceeded');
              (err as any).status = 429;
              throw err;
            }
            return {
              text: 'mocked gemini response',
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 5,
              },
            };
          }),
          generateContentStream: vi.fn().mockImplementation(async function* ({ contents }) {
            if (contents === 'fail_auth') {
              const err = new Error('API key is invalid');
              (err as any).status = 403;
              throw err;
            }
            yield { text: 'hello' };
            yield { text: ' ' };
            yield { text: 'world' };
          }),
        },
      };
    }),
  };
});

describe('GeminiProvider', () => {
  it('should format successful chat responses correctly', async () => {
    const container = new Container();
    const provider = new GeminiProvider(container, { apiKey: 'fake-key' });
    const res = await provider.chat('hello');
    expect(res.text).toBe('mocked gemini response');
    expect(res.provider).toBe('gemini');
    expect(res.usage?.inputTokens).toBe(10);
    expect(res.usage?.outputTokens).toBe(5);
  });

  it('should stream chunks correctly', async () => {
    const container = new Container();
    const provider = new GeminiProvider(container, { apiKey: 'fake-key' });
    const chunks = [];
    for await (const chunk of provider.stream('hello')) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('hello world');
  });

  it('should normalize authentication errors in chat', async () => {
    const container = new Container();
    const provider = new GeminiProvider(container, { apiKey: 'fake-key' });
    await expect(provider.chat('fail_auth')).rejects.toThrow(OrchestraError);
    try {
      await provider.chat('fail_auth');
    } catch (e: any) {
      expect(e.code).toBe('AUTHENTICATION');
      expect(e.provider).toBe('gemini');
    }
  });

  it('should normalize authentication errors in stream', async () => {
    const container = new Container();
    const provider = new GeminiProvider(container, { apiKey: 'fake-key' });
    try {
      const stream = provider.stream('fail_auth');
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
    } catch (e: any) {
      expect(e.code).toBe('AUTHENTICATION');
      expect(e.provider).toBe('gemini');
    }
  });

  it('should normalize rate limit errors', async () => {
    const container = new Container();
    const provider = new GeminiProvider(container, { apiKey: 'fake-key' });
    try {
      await provider.chat('fail_rate');
    } catch (e: any) {
      expect(e.code).toBe('RATE_LIMIT');
      expect(e.provider).toBe('gemini');
    }
  });
});
