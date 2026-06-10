import { Container, OrchestraPlugin, Provider } from '../../types';
import { GeminiProvider } from './GeminiProvider';

export class GeminiPlugin implements OrchestraPlugin {
  readonly name = 'gemini';
  readonly version = '1.0.0';
  private provider?: GeminiProvider;

  constructor(private options?: { apiKey?: string; model?: string }) {}

  install(app: any): void {
    this.provider = new GeminiProvider(app.container, this.options);
  }

  getProviders(): Provider[] {
    return this.provider ? [this.provider] : [];
  }
}
