import { isZodSchema } from './zod';
import { isTypeBoxSchema } from './typebox';
import { isJSONSchema } from './json-schema';

export type SchemaType = 'zod' | 'typebox' | 'json-schema';

export interface DetectedSchema {
  type: SchemaType;
  schema: unknown;
}

const cache = new WeakMap<object, DetectedSchema>();

export function detectSchema(schema: unknown): DetectedSchema {
  if (typeof schema !== 'object' || schema === null) {
    throw new TypeError('Cannot detect schema type: schema must be a non-null object');
  }
  const cached = cache.get(schema as object);
  if (cached) return cached;

  let result: DetectedSchema;
  if (isZodSchema(schema)) {
    result = { type: 'zod', schema };
  } else if (isTypeBoxSchema(schema)) {
    result = { type: 'typebox', schema };
  } else if (isJSONSchema(schema)) {
    result = { type: 'json-schema', schema };
  } else {
    throw new TypeError('Cannot detect schema type: schema does not match Zod, TypeBox, or JSON Schema format');
  }

  cache.set(schema as object, result);
  return result;
}

export { isZodSchema } from './zod';
export { isTypeBoxSchema } from './typebox';
export { isJSONSchema } from './json-schema';
