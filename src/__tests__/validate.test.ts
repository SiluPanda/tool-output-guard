import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate } from '../validate';

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
});

describe('validate() — Zod schema', () => {
  it('returns success: true for valid data', () => {
    const result = validate({ name: 'Alice', age: 30 }, PersonSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'Alice', age: 30 });
    }
  });

  it('returns success: false for invalid data', () => {
    const result = validate({ name: 42, age: 'old' }, PersonSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  it('includes violation codes and paths', () => {
    const result = validate({ name: 42, age: 'old' }, PersonSchema);
    if (!result.success) {
      const codes = result.violations.map((v) => v.code);
      expect(codes).toContain('WRONG_TYPE');
    }
  });
});

describe('validate() — JSON Schema', () => {
  const schema = {
    type: 'object',
    required: ['id', 'value'],
    properties: {
      id: { type: 'number' },
      value: { type: 'string' },
    },
  };

  it('returns success: true for valid JSON Schema data', () => {
    const result = validate({ id: 1, value: 'hello' }, schema);
    expect(result.success).toBe(true);
  });

  it('returns success: false for invalid JSON Schema data', () => {
    const result = validate({ id: 'one' }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  it('reports missing required field', () => {
    const result = validate({ id: 1 }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const missing = result.violations.find((v) => v.code === 'MISSING_REQUIRED');
      expect(missing).toBeDefined();
    }
  });
});

describe('validate() — throws for unknown schema', () => {
  it('throws TypeError for an unrecognized object', () => {
    expect(() => validate({ x: 1 }, { foo: 'bar' })).toThrow(TypeError);
  });
});
