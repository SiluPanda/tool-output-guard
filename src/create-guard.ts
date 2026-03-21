import type { Guard, GuardOptions, ValidationResult } from './types';
import { validateOutput } from './validation/index';
import { applyStrategy, preprocessForStrategy } from './strategies/index';

export function createGuard<T>(schema: unknown, options?: GuardOptions<T>): Guard<T> {
  function validate(value: unknown): ValidationResult<T> {
    return validateOutput<T>(value, schema);
  }

  function wrap<TArgs>(
    toolFn: (args: TArgs) => Promise<unknown>,
  ): (args: TArgs) => Promise<T> {
    return async (args: TArgs): Promise<T> => {
      const raw = await toolFn(args);
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

  return {
    validate,
    wrap,
    schema,
    options: options ?? {},
  };
}
