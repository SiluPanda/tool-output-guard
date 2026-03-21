import type { GuardOptions } from './types';
import { validateOutput } from './validation/index';
import { applyStrategy, preprocessForStrategy } from './strategies/index';

export function guard<T>(
  toolFn: (...args: unknown[]) => Promise<unknown>,
  schema: unknown,
  options?: GuardOptions<T>,
): (...args: unknown[]) => Promise<T> {
  return async (...args: unknown[]): Promise<T> => {
    const raw = await toolFn(...args);
    // Some strategies (strip-extra) preprocess the output before validation
    const preprocessed = preprocessForStrategy(raw, schema, options ?? {});
    const result = validateOutput<T>(preprocessed, schema);

    if (result.success) {
      if (options?.onValidationPass) {
        options.onValidationPass(result.data);
      }
      return result.data;
    }

    if (options?.onValidationFail) {
      options.onValidationFail(result.violations);
    }

    return applyStrategy<T>(result, preprocessed, schema, options ?? {});
  };
}
