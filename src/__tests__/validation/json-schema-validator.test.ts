import { describe, it, expect } from 'vitest';
import { validateWithJsonSchema } from '../../validation/json-schema-validator';

describe('validateWithJsonSchema — type', () => {
  it('passes when type matches string', () => {
    const result = validateWithJsonSchema('hello', { type: 'string' });
    expect(result.success).toBe(true);
  });

  it('passes when type matches number', () => {
    const result = validateWithJsonSchema(42, { type: 'number' });
    expect(result.success).toBe(true);
  });

  it('passes when type matches boolean', () => {
    const result = validateWithJsonSchema(true, { type: 'boolean' });
    expect(result.success).toBe(true);
  });

  it('passes when type matches null', () => {
    const result = validateWithJsonSchema(null, { type: 'null' });
    expect(result.success).toBe(true);
  });

  it('passes when type matches array', () => {
    const result = validateWithJsonSchema([1, 2], { type: 'array' });
    expect(result.success).toBe(true);
  });

  it('fails when type is wrong (string received number)', () => {
    const result = validateWithJsonSchema(42, { type: 'string' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe('WRONG_TYPE');
    }
  });

  it('fails when type is wrong (number received string)', () => {
    const result = validateWithJsonSchema('hello', { type: 'number' });
    expect(result.success).toBe(false);
  });
});

describe('validateWithJsonSchema — required', () => {
  const schema = {
    type: 'object',
    required: ['name', 'age'],
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
    },
  };

  it('passes when all required fields are present', () => {
    const result = validateWithJsonSchema({ name: 'Alice', age: 30 }, schema);
    expect(result.success).toBe(true);
  });

  it('fails when a required field is missing', () => {
    const result = validateWithJsonSchema({ name: 'Alice' }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations.find((x) => x.code === 'MISSING_REQUIRED');
      expect(v).toBeDefined();
      expect(v?.path).toContain('age');
    }
  });

  it('fails when multiple required fields are missing', () => {
    const result = validateWithJsonSchema({}, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('validateWithJsonSchema — properties', () => {
  const schema = {
    type: 'object',
    properties: {
      score: { type: 'number' },
      label: { type: 'string' },
    },
  };

  it('passes for matching properties', () => {
    const result = validateWithJsonSchema({ score: 99, label: 'good' }, schema);
    expect(result.success).toBe(true);
  });

  it('fails when property has wrong type', () => {
    const result = validateWithJsonSchema({ score: 'high', label: 'good' }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations.find((x) => x.path.includes('score'));
      expect(v?.code).toBe('WRONG_TYPE');
    }
  });
});

describe('validateWithJsonSchema — enum', () => {
  it('passes for valid enum value', () => {
    const result = validateWithJsonSchema('active', { enum: ['active', 'inactive'] });
    expect(result.success).toBe(true);
  });

  it('fails for invalid enum value', () => {
    const result = validateWithJsonSchema('pending', { enum: ['active', 'inactive'] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe('ENUM_MISMATCH');
    }
  });
});

describe('validateWithJsonSchema — minimum/maximum', () => {
  it('passes when value is within range', () => {
    const result = validateWithJsonSchema(50, { type: 'number', minimum: 0, maximum: 100 });
    expect(result.success).toBe(true);
  });

  it('fails when below minimum', () => {
    const result = validateWithJsonSchema(-1, { type: 'number', minimum: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe('CONSTRAINT_VIOLATION');
    }
  });

  it('fails when above maximum', () => {
    const result = validateWithJsonSchema(101, { type: 'number', maximum: 100 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe('CONSTRAINT_VIOLATION');
    }
  });
});

describe('validateWithJsonSchema — minLength/maxLength', () => {
  it('passes when string length is within bounds', () => {
    const result = validateWithJsonSchema('hello', { type: 'string', minLength: 2, maxLength: 10 });
    expect(result.success).toBe(true);
  });

  it('fails when string is too short', () => {
    const result = validateWithJsonSchema('a', { type: 'string', minLength: 3 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe('CONSTRAINT_VIOLATION');
    }
  });

  it('fails when string is too long', () => {
    const result = validateWithJsonSchema('hello world', { type: 'string', maxLength: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe('CONSTRAINT_VIOLATION');
    }
  });
});

describe('validateWithJsonSchema — pattern', () => {
  it('passes when string matches pattern', () => {
    const result = validateWithJsonSchema('abc', { type: 'string', pattern: '^[a-z]+$' });
    expect(result.success).toBe(true);
  });

  it('fails when string does not match pattern', () => {
    const result = validateWithJsonSchema('ABC', { type: 'string', pattern: '^[a-z]+$' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe('PATTERN_MISMATCH');
    }
  });
});

describe('validateWithJsonSchema — items (array)', () => {
  it('passes when all items match schema', () => {
    const result = validateWithJsonSchema([1, 2, 3], { type: 'array', items: { type: 'number' } });
    expect(result.success).toBe(true);
  });

  it('fails when an item has wrong type', () => {
    const result = validateWithJsonSchema([1, 'two', 3], { type: 'array', items: { type: 'number' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations[0];
      expect(v.code).toBe('WRONG_TYPE');
      expect(v.path).toContain('[1]');
    }
  });
});

describe('validateWithJsonSchema — nested objects', () => {
  const schema = {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      },
    },
  };

  it('passes for valid nested object', () => {
    const result = validateWithJsonSchema({ user: { name: 'Alice', age: 30 } }, schema);
    expect(result.success).toBe(true);
  });

  it('fails for wrong type in nested field', () => {
    const result = validateWithJsonSchema({ user: { name: 42, age: 30 } }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].path).toContain('user');
      expect(result.violations[0].path).toContain('name');
    }
  });

  it('fails for missing required nested field', () => {
    const result = validateWithJsonSchema({ user: { age: 30 } }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      const v = result.violations.find((x) => x.code === 'MISSING_REQUIRED');
      expect(v).toBeDefined();
    }
  });
});

describe('validateWithJsonSchema — additionalProperties: false', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    additionalProperties: false,
  };

  it('passes when no extra properties', () => {
    const result = validateWithJsonSchema({ name: 'Alice' }, schema);
    expect(result.success).toBe(true);
  });

  it('fails when extra properties present', () => {
    const result = validateWithJsonSchema({ name: 'Alice', extra: true }, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations[0].code).toBe('UNKNOWN_FIELD');
    }
  });
});
