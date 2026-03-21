import type { ValidationResult, GuardOptions } from './types';
import { validateOutput } from './validation/index';

export function validate<T>(
  output: unknown,
  schema: unknown,
  options?: GuardOptions<T>,
): ValidationResult<T> {
  void options; // reserved for future use
  return validateOutput<T>(output, schema);
}
