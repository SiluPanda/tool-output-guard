import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Type } from '@sinclair/typebox';
import {
  isZodSchema,
  isJSONSchema,
  isTypeBoxSchema,
  detectSchema,
} from '../../detection/index';

describe('isZodSchema', () => {
  it('returns true for z.string()', () => {
    expect(isZodSchema(z.string())).toBe(true);
  });

  it('returns true for z.object()', () => {
    expect(isZodSchema(z.object({ name: z.string() }))).toBe(true);
  });

  it('returns false for a plain JSON Schema object (no safeParse)', () => {
    expect(isZodSchema({ type: 'string' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isZodSchema(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isZodSchema('string')).toBe(false);
  });

  it('returns false for a TypeBox schema', () => {
    expect(isZodSchema(Type.String())).toBe(false);
  });
});

describe('isJSONSchema', () => {
  it('returns true for { type: "string" }', () => {
    expect(isJSONSchema({ type: 'string' })).toBe(true);
  });

  it('returns true for a schema with $schema keyword', () => {
    expect(isJSONSchema({ $schema: 'http://json-schema.org/draft-07/schema' })).toBe(true);
  });

  it('returns true for a schema with properties', () => {
    expect(isJSONSchema({ properties: { name: { type: 'string' } } })).toBe(true);
  });

  it('returns true for a schema with items', () => {
    expect(isJSONSchema({ items: { type: 'number' } })).toBe(true);
  });

  it('returns true for a schema with allOf', () => {
    expect(isJSONSchema({ allOf: [] })).toBe(true);
  });

  it('returns true for a schema with anyOf', () => {
    expect(isJSONSchema({ anyOf: [] })).toBe(true);
  });

  it('returns true for a schema with oneOf', () => {
    expect(isJSONSchema({ oneOf: [] })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isJSONSchema(null)).toBe(false);
  });

  it('returns false for a non-object primitive', () => {
    expect(isJSONSchema('string')).toBe(false);
    expect(isJSONSchema(42)).toBe(false);
  });

  it('returns false for an empty object (no recognized JSON Schema keywords)', () => {
    expect(isJSONSchema({})).toBe(false);
  });
});

describe('isTypeBoxSchema', () => {
  it('returns true for Type.String()', () => {
    expect(isTypeBoxSchema(Type.String())).toBe(true);
  });

  it('returns true for Type.Object()', () => {
    expect(isTypeBoxSchema(Type.Object({ name: Type.String() }))).toBe(true);
  });

  it('returns false for a plain JSON Schema object (no TypeBox.Kind symbol)', () => {
    expect(isTypeBoxSchema({ type: 'string' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTypeBoxSchema(null)).toBe(false);
  });

  it('returns false for a Zod schema', () => {
    expect(isTypeBoxSchema(z.string())).toBe(false);
  });
});

describe('detectSchema', () => {
  it('detects a Zod schema', () => {
    expect(detectSchema(z.string()).type).toBe('zod');
  });

  it('detects a Zod object schema', () => {
    expect(detectSchema(z.object({ x: z.number() })).type).toBe('zod');
  });

  it('detects a TypeBox schema', () => {
    expect(detectSchema(Type.String()).type).toBe('typebox');
  });

  it('detects a TypeBox object schema', () => {
    expect(detectSchema(Type.Object({ name: Type.String() })).type).toBe('typebox');
  });

  it('detects a plain JSON Schema object', () => {
    expect(detectSchema({ type: 'string' }).type).toBe('json-schema');
  });

  it('detects a JSON Schema with $schema keyword', () => {
    expect(detectSchema({ $schema: 'http://json-schema.org/draft-07/schema' }).type).toBe('json-schema');
  });

  it('throws TypeError for null', () => {
    expect(() => detectSchema(null)).toThrow(TypeError);
    expect(() => detectSchema(null)).toThrow('schema must be a non-null object');
  });

  it('throws TypeError for a string', () => {
    expect(() => detectSchema('string')).toThrow(TypeError);
    expect(() => detectSchema('string')).toThrow('schema must be a non-null object');
  });

  it('throws TypeError for an unrecognised object', () => {
    expect(() => detectSchema({ foo: 'bar' })).toThrow(TypeError);
    expect(() => detectSchema({ foo: 'bar' })).toThrow('does not match Zod, TypeBox, or JSON Schema format');
  });

  it('caches result — same DetectedSchema object returned for same input', () => {
    const schema = z.string();
    const first = detectSchema(schema);
    const second = detectSchema(schema);
    expect(first).toBe(second);
  });

  it('Zod takes priority over JSON Schema (Zod schemas can have a "type" property internally)', () => {
    // A Zod schema satisfies isZodSchema but might also partially match isJSONSchema.
    // detectSchema must return 'zod', not 'json-schema'.
    const zodSchema = z.string();
    expect(detectSchema(zodSchema).type).toBe('zod');
  });

  it('TypeBox takes priority over JSON Schema (TypeBox schemas have a "type" property)', () => {
    // TypeBox schemas include a "type" field, which would make isJSONSchema return true.
    // But detectSchema must return 'typebox' because TypeBox.Kind symbol is present.
    const tbSchema = Type.String();
    expect(detectSchema(tbSchema).type).toBe('typebox');
  });
});
