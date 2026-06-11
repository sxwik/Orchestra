export type OrchestraErrorCode = 'RATE_LIMIT' | 'AUTHENTICATION' | 'INVALID_REQUEST' | 'UNKNOWN';

export interface ChatResponse {
  text: string;
  model: string;
  provider: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ProviderConfig {
  name: string;
  apiKey?: string;
  model?: string;
}

export interface ChatOptions {
  provider?: string | 'auto';
  strategy?: 'fallback' | 'race' | 'consensus' | 'router' | string;
  model?: string;
  providers?: string[];
  judge?: string;
  judgePrompt?: string;
}

export interface RaceResult {
  winner: string;
  latency: number;
  response: ChatResponse;
}

export interface ConsensusResult {
  text: string;
  judge: string;
  responses: { provider: string; text: string; model: string }[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface OrchestraConfig {
  provider?: string | ProviderConfig;
  providers?: (string | ProviderConfig)[];
  apiKey?: string;
  apiKeys?: Record<string, string>;
  strategy?: 'fallback' | 'race' | 'consensus' | 'router' | string;
  cooldownDurationMs?: number;
}

export class OrchestraError extends Error {
  code: OrchestraErrorCode;
  provider: string;
  rawError: any;

  constructor(
    message: string,
    code: OrchestraErrorCode,
    provider: string,
    rawError: any
  ) {
    super(message);
    this.name = 'OrchestraError';
    this.code = code;
    this.provider = provider;
    this.rawError = rawError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrchestraError);
    }
  }
}

export interface Container {
  bind<T>(name: string, instance: T): void;
  resolve<T>(name: string): T;
  has(name: string): boolean;
}

export interface Provider {
  readonly name: string;
  chat?(prompt: string, options?: ChatOptions): Promise<ChatResponse>;
  stream?(prompt: string, options?: ChatOptions): AsyncIterable<string>;
}

export interface OrchestraPlugin {
  readonly name: string;
  readonly version: string;
  install(app: any): void;
  getProviders?(): Provider[];
}

