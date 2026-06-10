import OpenAI from 'openai';
import { ChatResponse, Provider, OrchestraError, OrchestraErrorCode, Container, OrchestraConfig } from '../../types';
import { resolveProviderConfig } from '../../core/config';

export class OpenAIProvider implements Provider {
  readonly name = 'openai';
  private aiInstance?: OpenAI;
  private model: string = 'gpt-4o-mini';

  constructor(
    private container: Container,
    private options?: { apiKey?: string; model?: string }
  ) {
    if (options?.model) {
      this.model = options.model;
    }
  }

  private getAI(): OpenAI {
    if (this.aiInstance) {
      return this.aiInstance;
    }

    let apiKey = this.options?.apiKey;
    let model = this.options?.model;

    if (!apiKey || !model) {
      try {
        const config = this.container.resolve<OrchestraConfig>('config');
        const resolved = resolveProviderConfig('openai', config);
        if (!apiKey) apiKey = resolved.apiKey;
        if (!model) model = resolved.model;
      } catch {}
    }

    if (model) {
      this.model = model;
    }

    this.aiInstance = new OpenAI(apiKey ? { apiKey } : {});
    return this.aiInstance;
  }

  async chat(prompt: string): Promise<ChatResponse> {
    try {
      const ai = this.getAI();
      const response = await ai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      });

      const choice = response.choices[0];
      const text = choice?.message?.content || '';

      return {
        text,
        model: this.model,
        provider: 'openai',
        usage: response.usage ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        } : undefined,
      };
    } catch (error: any) {
      throw this.normalizeError(error);
    }
  }

  async *stream(prompt: string): AsyncIterable<string> {
    try {
      const ai = this.getAI();
      const responseStream = await ai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      });

      for await (const chunk of responseStream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    } catch (error: any) {
      throw this.normalizeError(error);
    }
  }

  private normalizeError(err: any): OrchestraError {
    const message = err?.message || String(err);
    let code: OrchestraErrorCode = 'UNKNOWN';

    const status = err?.status || err?.statusCode || err?.status_code || err?.response?.status;
    const lowerMessage = message.toLowerCase();

    if (status === 401 || status === 403 || lowerMessage.includes('api key') || lowerMessage.includes('unauthorized')) {
      code = 'AUTHENTICATION';
    } else if (status === 429 || lowerMessage.includes('rate limit') || lowerMessage.includes('quota')) {
      code = 'RATE_LIMIT';
    } else if (status === 400 || lowerMessage.includes('invalid') || lowerMessage.includes('bad request')) {
      code = 'INVALID_REQUEST';
    }

    return new OrchestraError(message, code, 'openai', err);
  }
}
