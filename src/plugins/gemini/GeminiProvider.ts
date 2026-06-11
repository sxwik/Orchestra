import { GoogleGenAI } from '@google/genai';
import { ChatResponse, Provider, OrchestraError, OrchestraErrorCode, Container, OrchestraConfig, ChatOptions } from '../../types';
import { resolveProviderConfig } from '../../core/config';

export class GeminiProvider implements Provider {
  readonly name = 'gemini';
  private aiInstance?: GoogleGenAI;
  private model: string = 'gemini-2.5-flash';

  constructor(
    private container: Container,
    private options?: { apiKey?: string; model?: string }
  ) {
    if (options?.model) {
      this.model = options.model;
    }
  }

  private getAI(): GoogleGenAI {
    if (this.aiInstance) {
      return this.aiInstance;
    }

    let apiKey = this.options?.apiKey;
    let model = this.options?.model;

    if (!apiKey || !model) {
      try {
        const config = this.container.resolve<OrchestraConfig>('config');
        const resolved = resolveProviderConfig('gemini', config);
        if (!apiKey) apiKey = resolved.apiKey;
        if (!model) model = resolved.model;
      } catch {}
    }

    if (model) {
      this.model = model;
    }

    this.aiInstance = new GoogleGenAI(apiKey ? { apiKey } : {});
    return this.aiInstance;
  }

  async chat(prompt: string, options?: ChatOptions): Promise<ChatResponse> {
    try {
      const ai = this.getAI();
      const model = options?.model || this.model;
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });

      return {
        text: response.text || '',
        model,
        provider: 'gemini',
        usage: response.usageMetadata ? {
          inputTokens: response.usageMetadata.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
        } : undefined,
      };
    } catch (error: any) {
      throw this.normalizeError(error);
    }
  }

  async *stream(prompt: string, options?: ChatOptions): AsyncIterable<string> {
    try {
      const ai = this.getAI();
      const model = options?.model || this.model;
      const responseStream = await ai.models.generateContentStream({
        model,
        contents: prompt,
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          yield chunk.text;
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

    if (status === 401 || status === 403 || lowerMessage.includes('key') || lowerMessage.includes('unauthorized') || lowerMessage.includes('api_key_invalid')) {
      code = 'AUTHENTICATION';
    } else if (status === 429 || lowerMessage.includes('rate limit') || lowerMessage.includes('quota') || lowerMessage.includes('exhausted')) {
      code = 'RATE_LIMIT';
    } else if (status === 400 || lowerMessage.includes('invalid') || lowerMessage.includes('bad request')) {
      code = 'INVALID_REQUEST';
    }

    return new OrchestraError(message, code, 'gemini', err);
  }
}
