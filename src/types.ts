export type ViolationSeverity = 'error' | 'warning';

export type ViolationCode =
  | 'WRONG_TYPE'
  | 'MISSING_REQUIRED'
  | 'UNKNOWN_FIELD'
  | 'CONSTRAINT_VIOLATION'
  | 'ENUM_MISMATCH'
  | 'PATTERN_MISMATCH'
  | 'COERCED';

export interface Violation {
  path: string;
  severity: ViolationSeverity;
  code: ViolationCode;
  expected: string;
  received: string;
  receivedValue?: unknown;
  coercedValue?: unknown;
  message: string;
  llmMessage: string;
}

export type ValidationResult<T> =
  | { success: true; data: T; warnings: Violation[] }
  | { success: false; violations: Violation[] };

export class ValidationError extends Error {
  constructor(
    public readonly violations: Violation[],
    public readonly toolName?: string,
  ) {
    super(
      `Validation failed${toolName ? ` for tool "${toolName}"` : ''}: ${violations.length} violation(s)\n` +
      violations.map(v => `  [${v.severity}] ${v.path}: ${v.message}`).join('\n')
    );
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export interface LLMValidationError {
  error: true;
  code: 'INVALID_TOOL_OUTPUT';
  message: string;
  violations: Array<{ path: string; message: string }>;
  suggestion: string;
}

export type FailureStrategy = 'throw' | 'fallback' | 'error-result' | 'coerce-and-warn' | 'strip-extra';

export interface CoercionConfig {
  stringToNumber: boolean;
  stringToBoolean: boolean;
  stringToJson: boolean;
  numberToString: boolean;
  nullToDefault: boolean;
}

export interface GuardOptions<T = unknown> {
  onInvalid?: FailureStrategy;
  fallbackValue?: T;
  coercionFallback?: T;
  coercion?: Partial<CoercionConfig>;
  fieldStrategies?: Record<string, FailureStrategy>;
  fieldFallbacks?: Record<string, unknown>;
  jsonSchemaValidator?: (schema: unknown, data: unknown) => boolean;
  toolName?: string;
  onValidationPass?: (data: T) => void;
  onValidationFail?: (violations: Violation[]) => void;
  onCoercion?: (path: string, original: unknown, coerced: unknown) => void;
}

export interface Guard<T> {
  validate(value: unknown): ValidationResult<T>;
  wrap<TArgs>(toolFn: (args: TArgs) => Promise<unknown>): (args: TArgs) => Promise<T>;
  readonly schema: unknown;
  readonly options: GuardOptions<T>;
}

export interface GuardToolsOptions<T = unknown> extends GuardOptions<T> {
  toolOptions?: Record<string, Partial<GuardOptions>>;
}
