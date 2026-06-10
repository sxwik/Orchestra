import { OrchestraConfig, ProviderConfig } from '../types';

export function resolveProviderConfig(
  name: string,
  config: OrchestraConfig
): { apiKey?: string; model?: string } {
  const configList: (string | ProviderConfig)[] = [];
  if (config.provider) {
    configList.push(config.provider);
  } else if (config.providers && config.providers.length > 0) {
    configList.push(...config.providers);
  }

  const match = configList.find(item => 
    typeof item === 'string' ? item === name : item.name === name
  );

  let apiKey: string | undefined;
  let model: string | undefined;

  if (match) {
    if (typeof match === 'string') {
      apiKey = config.apiKeys?.[name] || (configList.length === 1 ? config.apiKey : undefined);
    } else {
      apiKey = match.apiKey || config.apiKeys?.[name] || (configList.length === 1 ? config.apiKey : undefined);
      model = match.model;
    }
  } else {
    apiKey = config.apiKeys?.[name] || (configList.length <= 1 ? config.apiKey : undefined);
  }

  return { apiKey, model };
}
