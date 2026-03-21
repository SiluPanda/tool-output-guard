import { describe, it, expect } from 'vitest';
import { ValidationError } from '../types';
import type { Violation } from '../types';

function makeViolation(overrides: Partial<Violation> = {}): Violation {
  return {
    path: 'root.field',
    severity: 'error',
    code: 'WRONG_TYPE',
    expected: 'string',
    received: 'number',
    message: 'Expected string, got number',
    llmMessage: 'The field should be a string',
    ...overrides,
  };
}

describe('ValidationError', () => {
  it('has the correct name', () => {
    const err = new ValidationError([makeViolation()]);
    expect(err.name).toBe('ValidationError');
  });

  it('includes violation count in the message', () => {
    const err = new ValidationError([makeViolation(), makeViolation({ path: 'root.other' })]);
    expect(err.message).toContain('2 violation(s)');
  });

  it('includes each violation path and message in the error message', () => {
    const v = makeViolation();
    const err = new ValidationError([v]);
    expect(err.message).toContain(v.path);
    expect(err.message).toContain(v.message);
  });

  it('includes severity in the error message', () => {
    const err = new ValidationError([makeViolation({ severity: 'warning' })]);
    expect(err.message).toContain('[warning]');
  });

  it('violations array is accessible', () => {
    const violations = [makeViolation(), makeViolation({ path: 'root.other', code: 'MISSING_REQUIRED' })];
    const err = new ValidationError(violations);
    expect(err.violations).toBe(violations);
    expect(err.violations).toHaveLength(2);
  });

  it('instanceof check works', () => {
    const err = new ValidationError([makeViolation()]);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(Error);
  });

  it('with toolName includes tool name in the message', () => {
    const err = new ValidationError([makeViolation()], 'myTool');
    expect(err.message).toContain('for tool "myTool"');
    expect(err.toolName).toBe('myTool');
  });

  it('without toolName omits tool name from the message', () => {
    const err = new ValidationError([makeViolation()]);
    expect(err.message).not.toContain('for tool');
    expect(err.toolName).toBeUndefined();
  });

  it('constructs with no violations', () => {
    const err = new ValidationError([]);
    expect(err.violations).toHaveLength(0);
    expect(err.message).toContain('0 violation(s)');
  });

  it('extends Error so stack is present', () => {
    const err = new ValidationError([makeViolation()]);
    expect(err.stack).toBeDefined();
  });
});
