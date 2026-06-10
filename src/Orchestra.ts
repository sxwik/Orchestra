import { OrchestraConfig } from './types';
import { OrchestraCore } from './core/OrchestraCore';
import { GeminiPlugin } from './plugins/gemini/GeminiPlugin';
import { OpenAIPlugin } from './plugins/openai/OpenAIPlugin';

export class Orchestra extends OrchestraCore {
  constructor(config: OrchestraConfig = {}) {
    super(config);
    this.use(new GeminiPlugin());
    this.use(new OpenAIPlugin());
  }
}
