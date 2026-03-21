import type { ValidationResult } from '../types';
import { buildViolation, buildPath } from '../violations/index';
import type { Violation } from '../types';

type JSONSchemaObject = Record<string, unknown>;

function getType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateValue(
  data: unknown,
  schema: JSONSchemaObject,
  pathParts: (string | number)[],
  violations: Violation[],
): void {
  // type check
  if ('type' in schema) {
    const expectedType = schema['type'] as string | string[];
    const actualType = getType(data);
    const types = Array.isArray(expectedType) ? expectedType : [expectedType];
    if (!types.includes(actualType)) {
      violations.push(
        buildViolation(
          'WRONG_TYPE',
          buildPath(pathParts),
          `Expected type ${types.join(' | ')}, got ${actualType}`,
          actualType,
          types.join(' | '),
        ),
      );
      // don't recurse further if top-level type mismatch
      return;
    }
  }

  // enum
  if ('enum' in schema) {
    const enumValues = schema['enum'] as unknown[];
    const found = enumValues.some((v) => JSON.stringify(v) === JSON.stringify(data));
    if (!found) {
      violations.push(
        buildViolation(
          'ENUM_MISMATCH',
          buildPath(pathParts),
          `Value must be one of: ${enumValues.map(String).join(', ')}`,
          String(data),
          enumValues.map(String).join(' | '),
        ),
      );
    }
  }

  // const
  if ('const' in schema) {
    const constVal = schema['const'];
    if (JSON.stringify(data) !== JSON.stringify(constVal)) {
      violations.push(
        buildViolation(
          'CONSTRAINT_VIOLATION',
          buildPath(pathParts),
          `Value must be exactly ${JSON.stringify(constVal)}`,
          String(data),
          String(constVal),
        ),
      );
    }
  }

  // string constraints
  if (typeof data === 'string') {
    if ('minLength' in schema) {
      const min = schema['minLength'] as number;
      if (data.length < min) {
        violations.push(
          buildViolation(
            'CONSTRAINT_VIOLATION',
            buildPath(pathParts),
            `String length ${data.length} is less than minimum ${min}`,
            String(data.length),
            `>= ${min}`,
          ),
        );
      }
    }
    if ('maxLength' in schema) {
      const max = schema['maxLength'] as number;
      if (data.length > max) {
        violations.push(
          buildViolation(
            'CONSTRAINT_VIOLATION',
            buildPath(pathParts),
            `String length ${data.length} exceeds maximum ${max}`,
            String(data.length),
            `<= ${max}`,
          ),
        );
      }
    }
    if ('pattern' in schema) {
      const pattern = schema['pattern'] as string;
      const regex = new RegExp(pattern);
      if (!regex.test(data)) {
        violations.push(
          buildViolation(
            'PATTERN_MISMATCH',
            buildPath(pathParts),
            `String does not match pattern ${pattern}`,
            data,
            `matches /${pattern}/`,
          ),
        );
      }
    }
  }

  // number constraints
  if (typeof data === 'number') {
    if ('minimum' in schema) {
      const min = schema['minimum'] as number;
      if (data < min) {
        violations.push(
          buildViolation(
            'CONSTRAINT_VIOLATION',
            buildPath(pathParts),
            `Value ${data} is less than minimum ${min}`,
            String(data),
            `>= ${min}`,
          ),
        );
      }
    }
    if ('exclusiveMinimum' in schema) {
      const min = schema['exclusiveMinimum'] as number;
      if (data <= min) {
        violations.push(
          buildViolation(
            'CONSTRAINT_VIOLATION',
            buildPath(pathParts),
            `Value ${data} must be greater than ${min}`,
            String(data),
            `> ${min}`,
          ),
        );
      }
    }
    if ('maximum' in schema) {
      const max = schema['maximum'] as number;
      if (data > max) {
        violations.push(
          buildViolation(
            'CONSTRAINT_VIOLATION',
            buildPath(pathParts),
            `Value ${data} exceeds maximum ${max}`,
            String(data),
            `<= ${max}`,
          ),
        );
      }
    }
    if ('exclusiveMaximum' in schema) {
      const max = schema['exclusiveMaximum'] as number;
      if (data >= max) {
        violations.push(
          buildViolation(
            'CONSTRAINT_VIOLATION',
            buildPath(pathParts),
            `Value ${data} must be less than ${max}`,
            String(data),
            `< ${max}`,
          ),
        );
      }
    }
  }

  // array
  if (Array.isArray(data)) {
    if ('items' in schema && schema['items']) {
      const itemSchema = schema['items'] as JSONSchemaObject;
      data.forEach((item, idx) => {
        validateValue(item, itemSchema, [...pathParts, idx], violations);
      });
    }
    if ('minItems' in schema) {
      const min = schema['minItems'] as number;
      if (data.length < min) {
        violations.push(
          buildViolation(
            'CONSTRAINT_VIOLATION',
            buildPath(pathParts),
            `Array length ${data.length} is less than minimum ${min}`,
            String(data.length),
            `>= ${min} items`,
          ),
        );
      }
    }
    if ('maxItems' in schema) {
      const max = schema['maxItems'] as number;
      if (data.length > max) {
        violations.push(
          buildViolation(
            'CONSTRAINT_VIOLATION',
            buildPath(pathParts),
            `Array length ${data.length} exceeds maximum ${max}`,
            String(data.length),
            `<= ${max} items`,
          ),
        );
      }
    }
  }

  // object
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const dataObj = data as Record<string, unknown>;

    // required fields
    if ('required' in schema) {
      const required = schema['required'] as string[];
      for (const key of required) {
        if (!(key in dataObj)) {
          violations.push(
            buildViolation(
              'MISSING_REQUIRED',
              buildPath([...pathParts, key]),
              `Required field "${key}" is missing`,
              'undefined',
              key,
            ),
          );
        }
      }
    }

    // properties
    if ('properties' in schema && schema['properties']) {
      const properties = schema['properties'] as Record<string, JSONSchemaObject>;
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in dataObj) {
          validateValue(dataObj[key], propSchema, [...pathParts, key], violations);
        }
      }
    }

    // additionalProperties: false → unknown fields
    if ('additionalProperties' in schema && schema['additionalProperties'] === false) {
      const properties = (schema['properties'] as Record<string, unknown>) ?? {};
      for (const key of Object.keys(dataObj)) {
        if (!(key in properties)) {
          violations.push(
            buildViolation(
              'UNKNOWN_FIELD',
              buildPath([...pathParts, key]),
              `Field "${key}" is not allowed by the schema`,
              key,
              'not present',
            ),
          );
        }
      }
    }
  }

  // anyOf
  if ('anyOf' in schema) {
    const subSchemas = schema['anyOf'] as JSONSchemaObject[];
    const anyPasses = subSchemas.some((sub) => {
      const subViolations: Violation[] = [];
      validateValue(data, sub, pathParts, subViolations);
      return subViolations.length === 0;
    });
    if (!anyPasses) {
      violations.push(
        buildViolation(
          'CONSTRAINT_VIOLATION',
          buildPath(pathParts),
          'Value does not match any of the required schemas (anyOf)',
          getType(data),
          'one of the anyOf schemas',
        ),
      );
    }
  }

  // oneOf
  if ('oneOf' in schema) {
    const subSchemas = schema['oneOf'] as JSONSchemaObject[];
    const matchCount = subSchemas.filter((sub) => {
      const subViolations: Violation[] = [];
      validateValue(data, sub, pathParts, subViolations);
      return subViolations.length === 0;
    }).length;
    if (matchCount !== 1) {
      violations.push(
        buildViolation(
          'CONSTRAINT_VIOLATION',
          buildPath(pathParts),
          `Value must match exactly one schema (oneOf), but matched ${matchCount}`,
          String(matchCount),
          'exactly 1 of the oneOf schemas',
        ),
      );
    }
  }

  // allOf
  if ('allOf' in schema) {
    const subSchemas = schema['allOf'] as JSONSchemaObject[];
    for (const sub of subSchemas) {
      validateValue(data, sub, pathParts, violations);
    }
  }
}

export function stripExtraProperties(
  data: unknown,
  schema: JSONSchemaObject,
): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return data;
  }
  const dataObj = data as Record<string, unknown>;
  const properties = (schema['properties'] as Record<string, JSONSchemaObject> | undefined) ?? {};
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(dataObj)) {
    if (key in properties) {
      result[key] = stripExtraProperties(dataObj[key], properties[key]);
    }
  }
  return result;
}

export function validateWithJsonSchema<T>(
  output: unknown,
  schema: unknown,
): ValidationResult<T> {
  const violations: Violation[] = [];
  validateValue(output, schema as JSONSchemaObject, [], violations);

  if (violations.length === 0) {
    return { success: true, data: output as T, warnings: [] };
  }
  return { success: false, violations };
}
