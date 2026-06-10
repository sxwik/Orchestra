import { Container, OrchestraPlugin, Provider } from '../../types';
import { OpenAIProvider } from './OpenAIProvider';

export class OpenAIPlugin implements OrchestraPlugin {
  readonly name = 'openai';
  readonly version = '1.0.0';
  private provider?: OpenAIProvider;

  constructor(private options?: { apiKey?: string; model?: string }) {}

  install(app: any): void {
    this.provider = new OpenAIProvider(app.container, this.options);
  }

  getProviders(): Provider[] {
    return this.provider ? [this.provider] : [];
  }
}
