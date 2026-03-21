import type { Violation, ViolationCode, ViolationSeverity } from '../types';

export function buildPath(parts: (string | number)[]): string {
  if (parts.length === 0) return '$';
  let result = '$';
  for (const part of parts) {
    if (typeof part === 'number') {
      result += `[${part}]`;
    } else {
      result += `.${part}`;
    }
  }
  return result;
}

export function buildViolation(
  code: ViolationCode,
  path: string,
  message: string,
  actual?: string,
  expected?: string,
  severity: ViolationSeverity = 'error',
  receivedValue?: unknown,
  coercedValue?: unknown,
): Violation {
  return {
    path,
    severity,
    code,
    expected: expected ?? '',
    received: actual ?? '',
    receivedValue,
    coercedValue,
    message,
    llmMessage: buildLLMMessage(code, path, message, actual, expected),
  };
}

function buildLLMMessage(
  code: ViolationCode,
  path: string,
  _message: string,
  actual?: string,
  expected?: string,
): string {
  switch (code) {
    case 'WRONG_TYPE':
      return `The field at ${path} has the wrong type. Expected ${expected ?? 'unknown'}, but got ${actual ?? 'unknown'}. Please return the correct type.`;
    case 'MISSING_REQUIRED':
      return `The field at ${path} is required but was not provided. Please include this field in the output.`;
    case 'UNKNOWN_FIELD':
      return `The field at ${path} is not part of the expected schema. Please remove it from the output.`;
    case 'CONSTRAINT_VIOLATION':
      return `The value at ${path} violates a constraint. Expected ${expected ?? 'a valid value'}, but got ${actual ?? 'an invalid value'}. Please provide a conforming value.`;
    case 'ENUM_MISMATCH':
      return `The value at ${path} is not one of the allowed values. Expected one of: ${expected ?? 'the valid options'}. Got: ${actual ?? 'an invalid value'}.`;
    case 'PATTERN_MISMATCH':
      return `The string at ${path} does not match the required pattern. Expected pattern: ${expected ?? 'a valid pattern'}. Got: ${actual ?? 'an invalid string'}.`;
    case 'COERCED':
      return `The value at ${path} was automatically coerced from ${actual ?? 'the original type'} to ${expected ?? 'the expected type'}.`;
    default:
      return `Validation error at ${path}: ${_message}`;
  }
}

export function formatViolationMessage(v: Violation): string {
  return `[${v.severity.toUpperCase()}] ${v.path} (${v.code}): ${v.message}`;
}

export function formatViolationsForLLM(violations: Violation[]): string {
  if (violations.length === 0) return 'No violations found.';
  const lines = [
    `Tool output validation failed with ${violations.length} violation(s):`,
    '',
    ...violations.map((v, i) => `${i + 1}. ${v.llmMessage}`),
    '',
    'Please fix the tool output to conform to the expected schema.',
  ];
  return lines.join('\n');
}
