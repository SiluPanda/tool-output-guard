import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateWithZod } from '../../validation/zod-validator';

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email().optional(),
});

describe('validateWithZod', () => {
  it('returns success: true for valid data', () => {
    const result = validateWithZod({ name: 'Alice', age: 30 }, UserSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'Alice', age: 30 });
    }
  });

  it('returns success: true with warnings: [] for valid data', () => {
    const result = validateWithZod({ name: 'Bob', age: 25 }, UserSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.warnings).toEqual([]);
    }
  });

  it('returns success: false for wrong type', () => {
    const result = validateWithZod({ name: 42, age: 30 }, UserSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.length).toBeGreaterThan(0);
      const v = result.violations[0];
      expect(v.code).toBe('WRONG_TYPE');
      expect(v.path).toContain('name');
    }
  });

  it('returns success: false for missing required field', () => {
    const result = validateWithZod({ age: 30 }, UserSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.length).toBeGreaterThan(0);
      const nameMissing = result.violations.find((v) => v.path.includes('name'));
      expect(nameMissing).toBeDefined();
    }
  });

  it('maps path correctly for nested schema', () => {
    const schema = z.object({ user: z.object({ name: z.string() }) });
    const result = validateWithZod({ user: { name: 42 } }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations[0];
      expect(v.path).toContain('user');
      expect(v.path).toContain('name');
    }
  });

  it('handles enum mismatch', () => {
    const schema = z.object({ status: z.enum(['active', 'inactive']) });
    const result = validateWithZod({ status: 'pending' }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations[0];
      expect(v.code).toBe('ENUM_MISMATCH');
    }
  });

  it('handles number constraint violation (too_big)', () => {
    const schema = z.object({ score: z.number().max(100) });
    const result = validateWithZod({ score: 150 }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations[0];
      expect(v.code).toBe('CONSTRAINT_VIOLATION');
    }
  });

  it('handles number constraint violation (too_small)', () => {
    const schema = z.object({ score: z.number().min(0) });
    const result = validateWithZod({ score: -5 }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations[0];
      expect(v.code).toBe('CONSTRAINT_VIOLATION');
    }
  });

  it('handles string pattern mismatch', () => {
    const schema = z.object({ code: z.string().regex(/^[A-Z]+$/) });
    const result = validateWithZod({ code: 'abc123' }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations[0];
      expect(v.code).toBe('PATTERN_MISMATCH');
    }
  });

  it('handles array path index', () => {
    const schema = z.object({ items: z.array(z.string()) });
    const result = validateWithZod({ items: ['a', 42, 'c'] }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations[0];
      expect(v.path).toContain('[1]');
    }
  });

  it('collects multiple violations', () => {
    const result = validateWithZod({ name: 42, age: 'old' }, UserSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('violations have non-empty messages', () => {
    const result = validateWithZod({}, UserSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      for (const v of result.violations) {
        expect(v.message.length).toBeGreaterThan(0);
        expect(v.llmMessage.length).toBeGreaterThan(0);
      }
    }
  });
});
