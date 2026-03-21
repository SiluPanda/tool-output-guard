import type { GuardToolsOptions } from './types';
import { guard } from './guard';

export function guardTools<T extends Record<string, unknown>>(
  toolMap: Record<string, (...args: unknown[]) => Promise<unknown>>,
  schemaMap: Record<string, unknown>,
  options?: GuardToolsOptions<T>,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const result: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const [toolName, toolFn] of Object.entries(toolMap)) {
    const schema = schemaMap[toolName];
    if (!schema) {
      // No schema for this tool — pass through unchanged
      result[toolName] = toolFn;
      continue;
    }

    const toolSpecificOptions = options?.toolOptions?.[toolName];
    const mergedOptions = {
      ...options,
      ...toolSpecificOptions,
      toolName,
    };

    result[toolName] = guard(toolFn, schema, mergedOptions as GuardToolsOptions<unknown>);
  }

  return result;
}
