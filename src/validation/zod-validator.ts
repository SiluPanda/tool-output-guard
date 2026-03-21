import type { ValidationResult, ViolationCode } from '../types';
import { buildViolation, buildPath } from '../violations/index';

// Zod v4 issue shape — kept loose so we don't import zod types
interface ZodIssue {
  code: string;
  path: (string | number)[];
  message: string;
  expected?: string;
  received?: string;
  values?: unknown[];
  minimum?: number;
  maximum?: number;
  origin?: string;
  format?: string;
  pattern?: string;
  inclusive?: boolean;
}

interface ZodError {
  issues: ZodIssue[];
}

interface ZodSafeParseSuccess<T> {
  success: true;
  data: T;
}

interface ZodSafeParseError {
  success: false;
  error: ZodError;
}

type ZodSafeParseResult<T> = ZodSafeParseSuccess<T> | ZodSafeParseError;

interface ZodLikeSchema {
  safeParse(data: unknown): ZodSafeParseResult<unknown>;
}

function mapZodIssueCode(code: string): ViolationCode {
  switch (code) {
    case 'invalid_type':
      return 'WRONG_TYPE';
    case 'invalid_value':
      return 'ENUM_MISMATCH';
    case 'invalid_format':
      return 'PATTERN_MISMATCH';
    case 'too_small':
    case 'too_big':
      return 'CONSTRAINT_VIOLATION';
    case 'missing_keys':
      return 'MISSING_REQUIRED';
    case 'unrecognized_keys':
      return 'UNKNOWN_FIELD';
    default:
      return 'CONSTRAINT_VIOLATION';
  }
}

function describeExpected(issue: ZodIssue): string {
  if (issue.expected) return issue.expected;
  if (issue.values && Array.isArray(issue.values)) {
    return issue.values.map(String).join(' | ');
  }
  if (issue.code === 'too_small' && issue.minimum !== undefined) {
    const op = issue.inclusive ? '>=' : '>';
    return `${issue.origin ?? 'value'} ${op} ${issue.minimum}`;
  }
  if (issue.code === 'too_big' && issue.maximum !== undefined) {
    const op = issue.inclusive ? '<=' : '<';
    return `${issue.origin ?? 'value'} ${op} ${issue.maximum}`;
  }
  if (issue.format) return `format: ${issue.format}`;
  if (issue.pattern) return `pattern: ${issue.pattern}`;
  return 'valid value';
}

function describeReceived(issue: ZodIssue): string {
  if (issue.received) return issue.received;
  return 'invalid value';
}

export function validateWithZod<T>(
  output: unknown,
  schema: unknown,
): ValidationResult<T> {
  const zodSchema = schema as ZodLikeSchema;
  const result = zodSchema.safeParse(output);

  if (result.success) {
    return { success: true, data: result.data as T, warnings: [] };
  }

  const violations = result.error.issues.map((issue) => {
    const path = buildPath(issue.path);
    const code = mapZodIssueCode(issue.code);
    const expected = describeExpected(issue);
    const received = describeReceived(issue);
    return buildViolation(code, path, issue.message, received, expected);
  });

  return { success: false, violations };
}
