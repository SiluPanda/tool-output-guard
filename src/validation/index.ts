import type { ValidationResult } from '../types';
import { detectSchema } from '../detection/index';
import { validateWithZod } from './zod-validator';
import { validateWithJsonSchema } from './json-schema-validator';

export function validateOutput<T>(output: unknown, schema: unknown): ValidationResult<T> {
  const detected = detectSchema(schema);

  switch (detected.type) {
    case 'zod':
      return validateWithZod<T>(output, detected.schema);
    case 'json-schema':
    case 'typebox':
      return validateWithJsonSchema<T>(output, detected.schema);
    default: {
      const exhaustive: never = detected.type;
      throw new TypeError(`Unknown schema type: ${exhaustive}`);
    }
  }
}
