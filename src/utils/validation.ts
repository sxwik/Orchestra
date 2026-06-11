import { Provider } from '../types';

export interface ValidationResult {
  passed: boolean;
  errors: string[];
}

/**
 * Validates that a provider conforms to the Orchestra specification.
 * This is useful for third-party plugin authors to verify their implementations.
 */
export async function validateProvider(
  provider: Provider,
  testPrompt: string = 'hello'
): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. Verify provider name
  if (!provider.name || typeof provider.name !== 'string' || provider.name.trim() === '') {
    errors.push('Provider name must be a non-empty string.');
  }

  const hasChat = typeof provider.chat === 'function';
  const hasStream = typeof provider.stream === 'function';

  if (!hasChat && !hasStream) {
    errors.push('Provider must implement either a chat() or stream() method.');
  }

  // 2. Validate chat capability
  if (hasChat) {
    try {
      const response = await provider.chat!(testPrompt);
      if (!response || typeof response !== 'object') {
        errors.push('chat() must return a ChatResponse object.');
      } else {
        if (typeof response.text !== 'string') {
          errors.push('ChatResponse.text must be a string.');
        }
        if (typeof response.model !== 'string') {
          errors.push('ChatResponse.model must be a string.');
        }
        if (typeof response.provider !== 'string') {
          errors.push('ChatResponse.provider must be a string.');
        }
        if (response.provider !== provider.name) {
          errors.push(`ChatResponse.provider ("${response.provider}") must match provider.name ("${provider.name}").`);
        }
        if (response.usage !== undefined) {
          if (typeof response.usage !== 'object' || response.usage === null) {
            errors.push('ChatResponse.usage must be an object if present.');
          } else {
            if (typeof response.usage.inputTokens !== 'number') {
              errors.push('ChatResponse.usage.inputTokens must be a number.');
            }
            if (typeof response.usage.outputTokens !== 'number') {
              errors.push('ChatResponse.usage.outputTokens must be a number.');
            }
          }
        }
      }
    } catch (err: any) {
      if (!(err instanceof Error)) {
        errors.push('chat() threw a non-Error value during validation.');
      }
    }
  }

  // 3. Validate stream capability
  if (hasStream) {
    try {
      const stream = provider.stream!(testPrompt);
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        errors.push('stream() must return an AsyncIterable.');
      } else {
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();
        if (!first.done && typeof first.value !== 'string') {
          errors.push('stream() yielded values must be strings.');
        }
      }
    } catch (err: any) {
      if (!(err instanceof Error)) {
        errors.push('stream() threw a non-Error value during validation.');
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}
