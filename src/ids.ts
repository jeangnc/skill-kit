export const PLUGIN_ID = /^[a-z0-9-]+$/;
export const FQ_ID = /^[a-z0-9-]+:[a-z0-9-]+$/;

export function isPluginId(value: string): boolean {
  return PLUGIN_ID.test(value);
}

export function isFqId(value: string): boolean {
  return FQ_ID.test(value);
}
