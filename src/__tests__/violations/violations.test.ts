import { describe, it, expect } from 'vitest';
import {
  buildViolation,
  buildPath,
  formatViolationMessage,
  formatViolationsForLLM,
} from '../../violations/index';

describe('buildPath', () => {
  it('returns $ for empty parts', () => {
    expect(buildPath([])).toBe('$');
  });

  it('formats a single string key', () => {
    expect(buildPath(['name'])).toBe('$.name');
  });

  it('formats a numeric index', () => {
    expect(buildPath([0])).toBe('$[0]');
  });

  it('formats nested object path', () => {
    expect(buildPath(['user', 'address', 'street'])).toBe('$.user.address.street');
  });

  it('formats mixed path with array index', () => {
    expect(buildPath(['items', 0, 'name'])).toBe('$.items[0].name');
  });

  it('formats deep nested path', () => {
    expect(buildPath(['a', 'b', 2, 'c'])).toBe('$.a.b[2].c');
  });
});

describe('buildViolation', () => {
  it('builds a violation with all required fields', () => {
    const v = buildViolation('WRONG_TYPE', '$.name', 'Expected string, got number', 'number', 'string');
    expect(v.code).toBe('WRONG_TYPE');
    expect(v.path).toBe('$.name');
    expect(v.message).toBe('Expected string, got number');
    expect(v.received).toBe('number');
    expect(v.expected).toBe('string');
    expect(v.severity).toBe('error');
  });

  it('defaults severity to error', () => {
    const v = buildViolation('MISSING_REQUIRED', '$.field', 'Missing field');
    expect(v.severity).toBe('error');
  });

  it('accepts warning severity', () => {
    const v = buildViolation('COERCED', '$.field', 'Coerced value', 'string', 'number', 'warning');
    expect(v.severity).toBe('warning');
  });

  it('stores receivedValue and coercedValue', () => {
    const v = buildViolation('COERCED', '$.x', 'Coerced', 'string', 'number', 'warning', '42', 42);
    expect(v.receivedValue).toBe('42');
    expect(v.coercedValue).toBe(42);
  });

  it('generates a non-empty llmMessage', () => {
    const v = buildViolation('WRONG_TYPE', '$.name', 'Expected string', 'number', 'string');
    expect(typeof v.llmMessage).toBe('string');
    expect(v.llmMessage.length).toBeGreaterThan(0);
  });

  it('llmMessage references the path', () => {
    const v = buildViolation('MISSING_REQUIRED', '$.address', 'Missing field');
    expect(v.llmMessage).toContain('$.address');
  });

  it('handles ENUM_MISMATCH code', () => {
    const v = buildViolation('ENUM_MISMATCH', '$.status', 'Invalid enum', 'pending', 'active | inactive');
    expect(v.code).toBe('ENUM_MISMATCH');
    expect(v.llmMessage).toContain('active | inactive');
  });
});

describe('formatViolationMessage', () => {
  it('includes severity, path, code, and message', () => {
    const v = buildViolation('WRONG_TYPE', '$.name', 'Expected string, got number', 'number', 'string');
    const msg = formatViolationMessage(v);
    expect(msg).toContain('[ERROR]');
    expect(msg).toContain('$.name');
    expect(msg).toContain('WRONG_TYPE');
    expect(msg).toContain('Expected string, got number');
  });

  it('uses uppercase severity', () => {
    const v = buildViolation('COERCED', '$.x', 'Coerced', 'string', 'number', 'warning');
    expect(formatViolationMessage(v)).toContain('[WARNING]');
  });
});

describe('formatViolationsForLLM', () => {
  it('returns a no-violation message for empty array', () => {
    expect(formatViolationsForLLM([])).toBe('No violations found.');
  });

  it('includes violation count in the output', () => {
    const violations = [
      buildViolation('WRONG_TYPE', '$.a', 'Bad type', 'number', 'string'),
      buildViolation('MISSING_REQUIRED', '$.b', 'Missing'),
    ];
    const msg = formatViolationsForLLM(violations);
    expect(msg).toContain('2 violation(s)');
  });

  it('includes each violation llmMessage numbered', () => {
    const v = buildViolation('MISSING_REQUIRED', '$.name', 'Missing required field');
    const msg = formatViolationsForLLM([v]);
    expect(msg).toContain('1.');
    expect(msg).toContain(v.llmMessage);
  });

  it('ends with a fix suggestion', () => {
    const v = buildViolation('WRONG_TYPE', '$.x', 'Bad', 'string', 'number');
    const msg = formatViolationsForLLM([v]);
    expect(msg).toContain('Please fix');
  });
});
