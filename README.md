# tool-output-guard

Runtime validation for tool execution results against Zod, JSON Schema, and TypeBox schemas.

[![npm version](https://img.shields.io/npm/v/tool-output-guard.svg)](https://www.npmjs.com/package/tool-output-guard)
[![npm downloads](https://img.shields.io/npm/dt/tool-output-guard.svg)](https://www.npmjs.com/package/tool-output-guard)
[![license](https://img.shields.io/npm/l/tool-output-guard.svg)](https://github.com/SiluPanda/tool-output-guard/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/tool-output-guard.svg)](https://nodejs.org)
[![types](https://img.shields.io/npm/types/tool-output-guard.svg)](https://www.npmjs.com/package/tool-output-guard)

---

## Description

`tool-output-guard` validates data returned by LLM tool calls, MCP tools, or any async function against a schema you provide. It sits between a tool's return value and the consumer (typically an LLM's context window), guaranteeing that every tool result conforms to its declared schema before it reaches the model.

When a tool returns malformed output -- wrong types, missing required fields, extra fields, `null` where an object was expected, or a string `"42"` where a number `42` was expected -- the consequences for an LLM agent are severe: hallucinated structure, infinite retry loops, subtly wrong answers, or opaque failures. `tool-output-guard` catches these mismatches at the tool boundary and applies a configurable failure strategy: throw a detailed error, return a fallback value, return a structured error object for LLM consumption, attempt type coercion, or strip unknown fields.

The library auto-detects the schema format (Zod, JSON Schema, or TypeBox), performs no network I/O, requires no API keys, and runs entirely in-process with sub-millisecond overhead for typical tool outputs.

---

## Installation

```bash
npm install tool-output-guard
```

Zod is an optional peer dependency. Install it only if you use Zod schemas:

```bash
npm install zod
```

TypeBox is an optional dev/peer dependency. Install it only if you use TypeBox schemas:

```bash
npm install @sinclair/typebox
```

---

## Quick Start

```ts
import { guard } from 'tool-output-guard';
import { z } from 'zod';

const WeatherSchema = z.object({
  temperature: z.number(),
  unit: z.enum(['celsius', 'fahrenheit']),
  description: z.string(),
});

const getWeather = guard(
  async (city: string) => {
    // Simulate a tool call that returns data from an external API
    return { temperature: 22, unit: 'celsius', description: 'Sunny' };
  },
  WeatherSchema,
  { onInvalid: 'throw' },
);

const result = await getWeather('London');
// result is validated and typed as { temperature: number; unit: "celsius" | "fahrenheit"; description: string }
```

If the tool returns invalid data, `guard` throws a `ValidationError` with detailed violation information instead of passing malformed data downstream.

---

## Features

- **Auto-detection of schema format** -- Pass a Zod schema, a JSON Schema object, or a TypeBox schema. The library detects the format automatically and routes to the correct validator. Detection results are cached via `WeakMap` for zero-cost repeated lookups.
- **Five failure strategies** -- `throw`, `fallback`, `error-result`, `coerce-and-warn`, and `strip-extra`. Each strategy is designed for a specific production scenario.
- **Detailed violation reports** -- Every validation failure produces a `Violation` array with JSON path, expected type, received type, violation code, human-readable message, and LLM-readable message.
- **Type coercion** -- The `coerce-and-warn` strategy automatically fixes common type mismatches (string-to-number, string-to-boolean, number-to-string, string-to-JSON) and records each coercion as a warning.
- **Extra field stripping** -- The `strip-extra` strategy removes properties not defined in the schema before validation, useful for normalizing noisy API responses.
- **Event hooks** -- `onValidationPass`, `onValidationFail`, and `onCoercion` callbacks for observability, logging, and metrics.
- **Batch tool guarding** -- `guardTools` wraps an entire map of tool functions with per-tool schemas in a single call.
- **Reusable guard instances** -- `createGuard` returns a `Guard<T>` object with `validate()` and `wrap()` methods for applying the same schema across multiple tool functions.
- **Built-in JSON Schema validator** -- No dependency on `ajv`. The internal validator supports the JSON Schema subset commonly used by MCP `outputSchema`, OpenAI function definitions, and typical tool output schemas.
- **Zero runtime dependencies** -- The package has no production dependencies. Zod and TypeBox are optional peer dependencies required only when using their respective schema formats.

---

## API Reference

### `guard(toolFn, schema, options?)`

Wraps an async tool function with output validation. Returns a new function with the same call signature whose return value is guaranteed to conform to the schema (or a failure strategy is applied).

```ts
import { guard } from 'tool-output-guard';

function guard<T>(
  toolFn: (...args: unknown[]) => Promise<unknown>,
  schema: unknown,
  options?: GuardOptions<T>,
): (...args: unknown[]) => Promise<T>;
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `toolFn` | `(...args: unknown[]) => Promise<unknown>` | The async tool function to wrap |
| `schema` | `unknown` | A Zod schema, JSON Schema object, or TypeBox schema |
| `options` | `GuardOptions<T>` | Optional configuration (failure strategy, hooks, coercion) |

**Example:**

```ts
import { guard } from 'tool-output-guard';
import { z } from 'zod';

const schema = z.object({ id: z.number(), name: z.string() });

const getUserTool = guard(
  async (id: number) => fetchUser(id),
  schema,
  {
    onInvalid: 'throw',
    toolName: 'getUser',
    onValidationPass: (data) => console.log('Valid output:', data),
    onValidationFail: (violations) => console.error('Invalid output:', violations),
  },
);

const user = await getUserTool(42);
```

---

### `validate(output, schema, options?)`

Standalone validation of any value against a schema. Returns a `ValidationResult<T>` discriminated union without wrapping a function.

```ts
import { validate } from 'tool-output-guard';

function validate<T>(
  output: unknown,
  schema: unknown,
  options?: GuardOptions<T>,
): ValidationResult<T>;
```

**Example:**

```ts
import { validate } from 'tool-output-guard';

const schema = {
  type: 'object',
  required: ['id', 'value'],
  properties: {
    id: { type: 'number' },
    value: { type: 'string' },
  },
};

const result = validate({ id: 1, value: 'hello' }, schema);

if (result.success) {
  console.log(result.data);     // typed as T
  console.log(result.warnings); // Violation[] (empty if no coercions)
} else {
  console.error(result.violations); // Violation[]
}
```

---

### `createGuard(schema, options?)`

Factory that creates a reusable `Guard<T>` instance. Useful when the same schema is applied to multiple tool functions or validated values.

```ts
import { createGuard } from 'tool-output-guard';

function createGuard<T>(
  schema: unknown,
  options?: GuardOptions<T>,
): Guard<T>;
```

The returned `Guard<T>` exposes:

| Member | Type | Description |
|---|---|---|
| `validate(value)` | `(value: unknown) => ValidationResult<T>` | Validate a value directly |
| `wrap(toolFn)` | `<TArgs>(toolFn: (args: TArgs) => Promise<unknown>) => (args: TArgs) => Promise<T>` | Wrap a tool function with validation |
| `schema` | `unknown` (readonly) | The schema this guard validates against |
| `options` | `GuardOptions<T>` (readonly) | The options this guard was created with |

**Example:**

```ts
import { createGuard } from 'tool-output-guard';
import { z } from 'zod';

const schema = z.object({ id: z.number(), name: z.string() });

const userGuard = createGuard(schema, {
  onInvalid: 'fallback',
  fallbackValue: { id: 0, name: 'Unknown' },
});

// Validate directly
const result = userGuard.validate({ id: 1, name: 'Alice' });

// Wrap a tool function
const safeFetchUser = userGuard.wrap((args: { id: number }) => fetchUser(args.id));
const user = await safeFetchUser({ id: 42 });
```

---

### `guardTools(toolMap, schemaMap, options?)`

Wraps an entire map of tool functions in a single call. Each tool is matched to its schema by key. Tools without a corresponding schema are passed through unchanged.

```ts
import { guardTools } from 'tool-output-guard';

function guardTools<T extends Record<string, unknown>>(
  toolMap: Record<string, (...args: unknown[]) => Promise<unknown>>,
  schemaMap: Record<string, unknown>,
  options?: GuardToolsOptions<T>,
): Record<string, (...args: unknown[]) => Promise<unknown>>;
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `toolMap` | `Record<string, (...args: unknown[]) => Promise<unknown>>` | Map of tool name to tool function |
| `schemaMap` | `Record<string, unknown>` | Map of tool name to schema (Zod, JSON Schema, or TypeBox) |
| `options` | `GuardToolsOptions<T>` | Shared options applied to all tools, with optional per-tool overrides via `toolOptions` |

**Example:**

```ts
import { guardTools } from 'tool-output-guard';
import { z } from 'zod';

const tools = {
  getUser: async (id: number) => fetchUser(id),
  getWeather: async (city: string) => fetchWeather(city),
};

const schemas = {
  getUser: z.object({ id: z.number(), name: z.string() }),
  getWeather: {
    type: 'object',
    required: ['temperature'],
    properties: { temperature: { type: 'number' }, conditions: { type: 'string' } },
  },
};

const guarded = guardTools(tools, schemas, {
  onInvalid: 'throw',
  toolOptions: {
    getWeather: { onInvalid: 'coerce-and-warn' },
  },
});

const user = await guarded.getUser(42);
const weather = await guarded.getWeather('London');
```

---

### `validateOutput(output, schema)`

Low-level validation dispatcher. Detects the schema type and routes to the appropriate validator (Zod or JSON Schema/TypeBox). This is the internal function used by `guard`, `validate`, and `createGuard`.

```ts
import { validateOutput } from 'tool-output-guard';

function validateOutput<T>(
  output: unknown,
  schema: unknown,
): ValidationResult<T>;
```

---

### `detectSchema(schema)`

Auto-detects the schema format. Returns a `DetectedSchema` object. Detection results are cached via `WeakMap`.

```ts
import { detectSchema } from 'tool-output-guard';

function detectSchema(schema: unknown): DetectedSchema;
```

**Detection priority:** Zod > TypeBox > JSON Schema.

Throws `TypeError` if the schema is not a non-null object or does not match any recognized format.

```ts
import { z } from 'zod';
import { Type } from '@sinclair/typebox';

detectSchema(z.string());
// => { type: 'zod', schema: ZodString }

detectSchema(Type.Object({ name: Type.String() }));
// => { type: 'typebox', schema: { [Symbol(TypeBox.Kind)]: 'Object', ... } }

detectSchema({ type: 'object', properties: { name: { type: 'string' } } });
// => { type: 'json-schema', schema: { type: 'object', ... } }
```

---

### `isZodSchema(schema)`

Returns `true` if the value is a Zod schema (has `_def` property and `safeParse` method).

```ts
import { isZodSchema } from 'tool-output-guard';

function isZodSchema(schema: unknown): boolean;
```

---

### `isTypeBoxSchema(schema)`

Returns `true` if the value is a TypeBox schema (has `Symbol.for('TypeBox.Kind')` property).

```ts
import { isTypeBoxSchema } from 'tool-output-guard';

function isTypeBoxSchema(schema: unknown): boolean;
```

---

### `isJSONSchema(schema)`

Returns `true` if the value looks like a JSON Schema object (has `$schema`, `type`, `properties`, `items`, `allOf`, `anyOf`, or `oneOf`).

```ts
import { isJSONSchema } from 'tool-output-guard';

function isJSONSchema(schema: unknown): boolean;
```

---

### `buildViolation(code, path, message, actual?, expected?, severity?, receivedValue?, coercedValue?)`

Constructs a `Violation` object with all required fields, including an auto-generated `llmMessage`.

```ts
import { buildViolation } from 'tool-output-guard';

function buildViolation(
  code: ViolationCode,
  path: string,
  message: string,
  actual?: string,
  expected?: string,
  severity?: ViolationSeverity, // default: 'error'
  receivedValue?: unknown,
  coercedValue?: unknown,
): Violation;
```

---

### `buildPath(parts)`

Converts an array of path segments into a JSONPath-style string.

```ts
import { buildPath } from 'tool-output-guard';

function buildPath(parts: (string | number)[]): string;
```

```ts
buildPath([]);                           // => '$'
buildPath(['user']);                      // => '$.user'
buildPath(['items', 0, 'name']);         // => '$.items[0].name'
buildPath(['a', 'b', 2, 'c']);          // => '$.a.b[2].c'
```

---

### `formatViolationMessage(violation)`

Formats a single violation as a human-readable string.

```ts
import { formatViolationMessage } from 'tool-output-guard';

function formatViolationMessage(v: Violation): string;
```

```ts
formatViolationMessage(violation);
// => '[ERROR] $.name (WRONG_TYPE): Expected string, got number'
```

---

### `formatViolationsForLLM(violations)`

Formats an array of violations into a multi-line string suitable for including in an LLM prompt or error message.

```ts
import { formatViolationsForLLM } from 'tool-output-guard';

function formatViolationsForLLM(violations: Violation[]): string;
```

```ts
formatViolationsForLLM(violations);
// => 'Tool output validation failed with 2 violation(s):\n\n1. The field at $.name ...\n2. ...\n\nPlease fix the tool output to conform to the expected schema.'

formatViolationsForLLM([]);
// => 'No violations found.'
```

---

### `ValidationError`

Error class thrown by the `throw` failure strategy. Extends `Error` with structured violation data.

```ts
import { ValidationError } from 'tool-output-guard';

class ValidationError extends Error {
  readonly violations: Violation[];
  readonly toolName?: string;
}
```

The error `message` includes the violation count and a formatted summary of each violation:

```
Validation failed for tool "getUser": 2 violation(s)
  [error] $.name: Expected type string, got number
  [error] $.age: Required field "age" is missing
```

**Example:**

```ts
import { ValidationError } from 'tool-output-guard';

try {
  await guardedTool(args);
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(err.message);      // Human-readable summary
    console.error(err.violations);   // Violation[]
    console.error(err.toolName);     // string | undefined
  }
}
```

---

## Configuration

### `GuardOptions<T>`

| Option | Type | Default | Description |
|---|---|---|---|
| `onInvalid` | `FailureStrategy` | `'throw'` | Strategy to apply when validation fails |
| `fallbackValue` | `T` | `undefined` | Value to return when using the `'fallback'` strategy |
| `coercionFallback` | `T` | `undefined` | Fallback value when coercion fails |
| `coercion` | `Partial<CoercionConfig>` | `undefined` | Fine-grained coercion toggles |
| `fieldStrategies` | `Record<string, FailureStrategy>` | `undefined` | Per-field failure strategy overrides |
| `fieldFallbacks` | `Record<string, unknown>` | `undefined` | Per-field fallback values |
| `jsonSchemaValidator` | `(schema: unknown, data: unknown) => boolean` | `undefined` | Custom JSON Schema validator (e.g., `ajv`) |
| `toolName` | `string` | `undefined` | Tool name included in error messages |
| `onValidationPass` | `(data: T) => void` | `undefined` | Called when validation succeeds |
| `onValidationFail` | `(violations: Violation[]) => void` | `undefined` | Called when validation fails |
| `onCoercion` | `(path: string, original: unknown, coerced: unknown) => void` | `undefined` | Called for each coerced field |

### `GuardToolsOptions<T>`

Extends `GuardOptions<T>` with:

| Option | Type | Description |
|---|---|---|
| `toolOptions` | `Record<string, Partial<GuardOptions>>` | Per-tool option overrides, keyed by tool name |

### `CoercionConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `stringToNumber` | `boolean` | `false` | Coerce `"42"` to `42` |
| `stringToBoolean` | `boolean` | `false` | Coerce `"true"` to `true`, `"false"` to `false` |
| `stringToJson` | `boolean` | `false` | Coerce JSON strings to parsed objects/arrays |
| `numberToString` | `boolean` | `false` | Coerce `42` to `"42"` |
| `nullToDefault` | `boolean` | `false` | Replace `null` with schema default value |

### Failure Strategies

| Strategy | Behavior |
|---|---|
| `'throw'` (default) | Throws a `ValidationError` with full violation details |
| `'fallback'` | Returns `options.fallbackValue`. Throws if `fallbackValue` is not provided. |
| `'error-result'` | Returns `{ __error: true, violations: [{ path, message }] }` for LLM consumption |
| `'coerce-and-warn'` | Attempts type coercion (string-to-number, string-to-boolean, etc.), calls `onCoercion` for each fix, re-validates. Falls through to `throw` if coercion cannot fix all violations. |
| `'strip-extra'` | Strips properties not defined in the JSON Schema before validation. JSON Schema only; falls through to `throw` for Zod schemas. |

---

## Error Handling

### ValidationError

All failure paths that use the `'throw'` strategy (including fallthrough from `'coerce-and-warn'` and `'strip-extra'`) throw a `ValidationError`. Catch it by class:

```ts
import { guard, ValidationError } from 'tool-output-guard';

try {
  const result = await guardedTool(args);
} catch (err) {
  if (err instanceof ValidationError) {
    // Structured error with violations array
    for (const v of err.violations) {
      console.error(`${v.path}: ${v.message} (${v.code})`);
    }
  }
}
```

### Error-result strategy

The `'error-result'` strategy never throws. Instead, it returns a structured error object suitable for injection into an LLM conversation:

```ts
const guarded = guard(toolFn, schema, { onInvalid: 'error-result' });
const result = await guarded(args);

if (result.__error) {
  // result.violations contains [{ path, message }] pairs
  // Feed this back to the LLM so it can reason about the failure
}
```

### Unrecognized schemas

`detectSchema` throws a `TypeError` when passed a value that is not a recognized schema format:

```ts
import { detectSchema } from 'tool-output-guard';

detectSchema(null);           // TypeError: schema must be a non-null object
detectSchema({ foo: 'bar' }); // TypeError: does not match Zod, TypeBox, or JSON Schema format
```

---

## Advanced Usage

### Observability hooks

Attach callbacks to monitor validation outcomes without changing control flow:

```ts
const guarded = guard(toolFn, schema, {
  onInvalid: 'fallback',
  fallbackValue: defaultValue,
  toolName: 'fetchWeather',
  onValidationPass: (data) => {
    metrics.increment('tool.output.valid', { tool: 'fetchWeather' });
  },
  onValidationFail: (violations) => {
    logger.warn('Tool output validation failed', {
      tool: 'fetchWeather',
      violations: violations.map((v) => ({ path: v.path, code: v.code })),
    });
    metrics.increment('tool.output.invalid', { tool: 'fetchWeather' });
  },
  onCoercion: (path, original, coerced) => {
    logger.info('Coerced tool output field', { path, original, coerced });
  },
});
```

### Coerce-and-warn for noisy APIs

When wrapping tools that call external APIs with inconsistent type formatting:

```ts
const guarded = guard(fetchWeather, weatherSchema, {
  onInvalid: 'coerce-and-warn',
  onCoercion: (path, original, coerced) => {
    console.warn(`[tool-output-guard] Coerced ${path}: ${JSON.stringify(original)} -> ${JSON.stringify(coerced)}`);
  },
});

// If the API returns { temperature: "72.5" } but the schema expects a number,
// the guard coerces it to { temperature: 72.5 } and logs a warning.
```

### Strip extra fields from JSON Schema output

When a tool returns more fields than the schema declares and you want to pass only the declared fields downstream:

```ts
const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    score: { type: 'number' },
  },
};

const guarded = guard(toolFn, schema, { onInvalid: 'strip-extra' });
const result = await guarded(args);
// If toolFn returns { name: 'Alice', score: 95, debug: 'internal', _meta: {} },
// result is { name: 'Alice', score: 95 }
```

### Per-tool overrides with guardTools

Apply shared defaults across all tools while overriding specific tools:

```ts
const guarded = guardTools(tools, schemas, {
  onInvalid: 'throw',
  toolOptions: {
    getWeather: {
      onInvalid: 'coerce-and-warn',
    },
    getStockPrice: {
      onInvalid: 'fallback',
      fallbackValue: { price: 0, currency: 'USD' },
    },
  },
});
```

### Formatting violations for LLM feedback

When you need to feed validation errors back to the LLM so it can correct its tool usage:

```ts
import { validate, formatViolationsForLLM } from 'tool-output-guard';

const result = validate(toolOutput, schema);

if (!result.success) {
  const llmFeedback = formatViolationsForLLM(result.violations);
  // Include llmFeedback in the next message to the LLM:
  // "Tool output validation failed with 2 violation(s):
  //
  // 1. The field at $.temperature has the wrong type. Expected number, but got string. Please return the correct type.
  // 2. The field at $.unit is not one of the allowed values. Expected one of: celsius | fahrenheit. Got: kelvin.
  //
  // Please fix the tool output to conform to the expected schema."
}
```

### Using with TypeBox schemas

TypeBox schemas are JSON Schema objects with static TypeScript type inference. They work out of the box:

```ts
import { createGuard } from 'tool-output-guard';
import { Type, type Static } from '@sinclair/typebox';

const WeatherSchema = Type.Object({
  temperature: Type.Number(),
  conditions: Type.String(),
});

type Weather = Static<typeof WeatherSchema>;

const weatherGuard = createGuard<Weather>(WeatherSchema, { onInvalid: 'throw' });

const result = weatherGuard.validate({ temperature: 22, conditions: 'Sunny' });
```

---

## TypeScript

`tool-output-guard` is written in TypeScript and ships with full type declarations (`dist/index.d.ts` and declaration maps). All public types are exported from the package root:

```ts
// Type-only imports
import type {
  Violation,
  ViolationSeverity,
  ViolationCode,
  ValidationResult,
  LLMValidationError,
  FailureStrategy,
  CoercionConfig,
  GuardOptions,
  Guard,
  GuardToolsOptions,
  SchemaType,
  DetectedSchema,
} from 'tool-output-guard';

// Value imports
import {
  guard,
  validate,
  createGuard,
  guardTools,
  validateOutput,
  detectSchema,
  isZodSchema,
  isTypeBoxSchema,
  isJSONSchema,
  buildViolation,
  buildPath,
  formatViolationMessage,
  formatViolationsForLLM,
  ValidationError,
} from 'tool-output-guard';
```

### `ValidationResult<T>`

A discriminated union:

```ts
type ValidationResult<T> =
  | { success: true; data: T; warnings: Violation[] }
  | { success: false; violations: Violation[] };
```

### `Violation`

```ts
interface Violation {
  path: string;           // JSONPath-style: '$.user.address[0].street'
  severity: ViolationSeverity;  // 'error' | 'warning'
  code: ViolationCode;
  expected: string;
  received: string;
  receivedValue?: unknown;
  coercedValue?: unknown;
  message: string;        // Human-readable
  llmMessage: string;     // LLM-friendly, action-oriented
}
```

### `ViolationCode`

```ts
type ViolationCode =
  | 'WRONG_TYPE'
  | 'MISSING_REQUIRED'
  | 'UNKNOWN_FIELD'
  | 'CONSTRAINT_VIOLATION'
  | 'ENUM_MISMATCH'
  | 'PATTERN_MISMATCH'
  | 'COERCED';
```

---

## Supported Schema Formats

| Schema Library | Detection Method | Supported Versions |
|---|---|---|
| [Zod](https://zod.dev) | `_def` property + `safeParse` method | v3, v4 |
| [JSON Schema](https://json-schema.org) | `$schema`, `type`, `properties`, `items`, or combinators | draft-07, 2020-12 |
| [TypeBox](https://github.com/sinclairzx81/typebox) | `Symbol.for('TypeBox.Kind')` property | v0.34+ |

Schema format is auto-detected and cached. You never need to specify which format you are using.

### Supported JSON Schema Keywords

`type`, `required`, `properties`, `items`, `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `additionalProperties`, `anyOf`, `oneOf`, `allOf`.

---

## License

MIT
