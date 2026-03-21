import type { FailureStrategy, GuardOptions, ValidationResult, Violation } from '../types';
import { ValidationError } from '../types';
import { validateOutput } from '../validation/index';
import { validateWithJsonSchema, stripExtraProperties } from '../validation/json-schema-validator';
import { buildViolation, buildPath } from '../violations/index';
import { isJSONSchema } from '../detection/json-schema';

function attemptCoercion(data: unknown): { coerced: unknown; changed: boolean } {
  // Without schema context for Zod schemas, we cannot do field-level coercion.
  // Return unchanged; callers handle re-validation.
  return { coerced: data, changed: false };
}

function coerceValue(
  value: unknown,
  expectedType: string,
  path: string,
  coercions: Violation[],
): unknown {
  if (expectedType === 'number' && typeof value === 'string') {
    const n = Number(value);
    if (!isNaN(n)) {
      coercions.push(
        buildViolation(
          'COERCED',
          path,
          `Coerced string "${value}" to number ${n}`,
          'string',
          'number',
          'warning',
          value,
          n,
        ),
      );
      return n;
    }
  }
  if (expectedType === 'boolean' && typeof value === 'string') {
    if (value === 'true') {
      coercions.push(
        buildViolation(
          'COERCED',
          path,
          `Coerced string "true" to boolean true`,
          'string',
          'boolean',
          'warning',
          value,
          true,
        ),
      );
      return true;
    }
    if (value === 'false') {
      coercions.push(
        buildViolation(
          'COERCED',
          path,
          `Coerced string "false" to boolean false`,
          'string',
          'boolean',
          'warning',
          value,
          false,
        ),
      );
      return false;
    }
  }
  if (expectedType === 'string' && typeof value === 'number') {
    const s = String(value);
    coercions.push(
      buildViolation(
        'COERCED',
        path,
        `Coerced number ${value} to string "${s}"`,
        'number',
        'string',
        'warning',
        value,
        s,
      ),
    );
    return s;
  }
  if ((expectedType === 'object' || expectedType === 'array') && typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      coercions.push(
        buildViolation(
          'COERCED',
          path,
          `Coerced JSON string to ${expectedType}`,
          'string',
          expectedType,
          'warning',
          value,
          parsed,
        ),
      );
      return parsed;
    } catch {
      // not parseable, leave as-is
    }
  }
  return value;
}

function coerceAgainstJsonSchema(
  data: unknown,
  schema: Record<string, unknown>,
  pathParts: (string | number)[],
  coercions: Violation[],
): unknown {
  if (typeof schema['type'] === 'string') {
    const expectedType = schema['type'] as string;
    const actualType = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
    if (actualType !== expectedType) {
      return coerceValue(data, expectedType, buildPath(pathParts), coercions);
    }
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    if (typeof schema['properties'] === 'object' && schema['properties'] !== null) {
      const properties = schema['properties'] as Record<string, Record<string, unknown>>;
      const dataObj = data as Record<string, unknown>;
      const result: Record<string, unknown> = { ...dataObj };
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in result) {
          result[key] = coerceAgainstJsonSchema(result[key], propSchema, [...pathParts, key], coercions);
        }
      }
      return result;
    }
  }

  if (Array.isArray(data) && typeof schema['items'] === 'object' && schema['items'] !== null) {
    const itemSchema = schema['items'] as Record<string, unknown>;
    return data.map((item, idx) =>
      coerceAgainstJsonSchema(item, itemSchema, [...pathParts, idx], coercions),
    );
  }

  return data;
}

export function preprocessForStrategy<T>(
  output: unknown,
  schema: unknown,
  options: GuardOptions<T>,
): unknown {
  const strategy: FailureStrategy = options.onInvalid ?? 'throw';
  if (strategy === 'strip-extra' && isJSONSchema(schema)) {
    return stripExtraProperties(output, schema as Record<string, unknown>);
  }
  return output;
}

export function applyStrategy<T>(
  validationResult: ValidationResult<T>,
  output: unknown,
  schema: unknown,
  options: GuardOptions<T>,
): T {
  const strategy: FailureStrategy = options.onInvalid ?? 'throw';

  if (validationResult.success) {
    return validationResult.data;
  }

  const { violations } = validationResult;

  switch (strategy) {
    case 'throw': {
      throw new ValidationError(violations, options.toolName);
    }

    case 'fallback': {
      if (options.fallbackValue === undefined) {
        throw new Error(
          'GuardOptions.fallbackValue must be provided when using the "fallback" strategy',
        );
      }
      return options.fallbackValue as T;
    }

    case 'error-result': {
      const errorObj = {
        __error: true,
        violations: violations.map((v) => ({ path: v.path, message: v.message })),
      };
      return errorObj as unknown as T;
    }

    case 'coerce-and-warn': {
      const coercions: Violation[] = [];
      let coerced = output;

      if (isJSONSchema(schema)) {
        coerced = coerceAgainstJsonSchema(
          output,
          schema as Record<string, unknown>,
          [],
          coercions,
        );
      } else {
        // For Zod, we can only do minimal coercion without schema introspection
        const result = attemptCoercion(output);
        coerced = result.coerced;
      }

      if (coercions.length > 0) {
        coercions.forEach((c) => {
          if (options.onCoercion) {
            options.onCoercion(c.path, c.receivedValue, c.coercedValue);
          } else {
            console.warn(
              `[tool-output-guard] Coerced ${c.path}: ${c.message}`,
            );
          }
        });
      }

      // Re-validate after coercion
      const revalidated = validateOutput<T>(coerced, schema);
      if (revalidated.success) {
        return revalidated.data;
      }
      // If still fails after coercion, fall through to throw
      throw new ValidationError(revalidated.violations, options.toolName);
    }

    case 'strip-extra': {
      if (!isJSONSchema(schema)) {
        // Can't strip from Zod schemas without introspection — just re-throw
        throw new ValidationError(violations, options.toolName);
      }
      const stripped = stripExtraProperties(output, schema as Record<string, unknown>);
      const revalidated = validateWithJsonSchema<T>(stripped, schema);
      if (revalidated.success) {
        return revalidated.data;
      }
      throw new ValidationError(revalidated.violations, options.toolName);
    }

    default: {
      const exhaustive: never = strategy;
      throw new Error(`Unknown failure strategy: ${exhaustive}`);
    }
  }
}
