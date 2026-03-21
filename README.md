# tool-output-guard

Runtime validator for tool execution results against schemas (Zod, JSON Schema, TypeBox).

Validates data returned by LLM tool calls, MCP tools, or any async function against a schema you provide. Automatically detects the schema format — just pass your schema and the library handles the rest.

## Installation

```bash
npm install tool-output-guard
```

Zod is an optional peer dependency. Install it only if you use Zod schemas:

```bash
npm install zod
```

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
    return { temperature: 22, unit: 'celsius', description: 'Sunny' };
  },
  WeatherSchema,
  { onInvalid: 'throw' },
);

const result = await getWeather('London');
// result is typed and validated against WeatherSchema
```

## Core API

### `guard(toolFn, schema, options?)`

Wraps an async tool function with output validation. The returned function has the same call signature as the original.

```ts
import { guard } from 'tool-output-guard';
import { z } from 'zod';

const schema = z.object({ id: z.number(), name: z.string() });

const getUserTool = guard(
  async (id: number) => fetchUser(id),
  schema,
  {
    onInvalid: 'throw',
    onValidationPass: (data) => console.log('valid:', data),
    onValidationFail: (violations) => console.error('invalid:', violations),
  },
);

const user = await getUserTool(42);
```

### `validate(output, schema, options?)`

Standalone validation of any value against a schema. Returns a `ValidationResult<T>` discriminated union.

```ts
import { validate } from 'tool-output-guard';

const result = validate({ id: 1, name: 'Alice' }, schema);

if (result.success) {
  console.log(result.data); // typed as T
} else {
  console.error(result.violations); // Violation[]
}
```

### `createGuard(schema, options?)`

Factory that creates a reusable `Guard<T>` instance with `validate()` and `wrap()` methods.

```ts
import { createGuard } from 'tool-output-guard';

const guard = createGuard(schema, { onInvalid: 'fallback', fallbackValue: defaultUser });

// Validate a value directly
const result = guard.validate(someData);

// Wrap a tool function
const safeFetch = guard.wrap((args: { id: number }) => fetchUser(args.id));
const user = await safeFetch({ id: 42 });
```

### `guardTools(toolMap, schemaMap, options?)`

Wraps an entire map of tool functions in a single call — one schema per tool.

```ts
import { guardTools } from 'tool-output-guard';

const tools = {
  getUser: async (id: number) => fetchUser(id),
  getWeather: async (city: string) => fetchWeather(city),
};

const schemas = {
  getUser: userSchema,
  getWeather: weatherSchema,
};

const guardedTools = guardTools(tools, schemas, { onInvalid: 'throw' });
// Each tool in guardedTools is now validated against its schema
```

## Failure Strategies

Set `onInvalid` in `GuardOptions` to control what happens when validation fails:

| Strategy | Behavior |
|---|---|
| `'throw'` (default) | Throws `ValidationError` with full violation details |
| `'fallback'` | Returns `options.fallbackValue` (must be provided) |
| `'error-result'` | Returns `{ __error: true, violations: [...] }` for LLM consumption |
| `'coerce-and-warn'` | Attempts type coercion (string→number etc.), warns on changes, re-validates |
| `'strip-extra'` | Strips properties not defined in the JSON Schema before returning |

```ts
// fallback
guard(fn, schema, { onInvalid: 'fallback', fallbackValue: defaultValue });

// error-result — useful for LLM agents that can reason about errors
guard(fn, schema, { onInvalid: 'error-result' });

// coerce-and-warn — auto-fix common API type mismatches
guard(fn, schema, { onInvalid: 'coerce-and-warn' });

// strip-extra — remove unexpected fields
guard(fn, schema, { onInvalid: 'strip-extra' });
```

## Violation Format

Each `Violation` in a `ValidationResult` contains:

| Field | Type | Description |
|---|---|---|
| `path` | `string` | JSONPath-style: `$.user.address[0].street` |
| `severity` | `'error' \| 'warning'` | Errors block validation; warnings on coerced fields |
| `code` | `ViolationCode` | See below |
| `expected` | `string` | What the schema expected |
| `received` | `string` | What was actually received |
| `receivedValue` | `unknown` | The actual value |
| `coercedValue` | `unknown` | The coerced value (if applicable) |
| `message` | `string` | Human-readable message |
| `llmMessage` | `string` | LLM-friendly message (more verbose, action-oriented) |

### Violation Codes

| Code | When |
|---|---|
| `WRONG_TYPE` | Field has the wrong JavaScript type |
| `MISSING_REQUIRED` | A required field is absent |
| `UNKNOWN_FIELD` | A field is present but not in the schema |
| `CONSTRAINT_VIOLATION` | Number/string/array constraint failed (min, max, length, etc.) |
| `ENUM_MISMATCH` | Value is not one of the allowed enum values |
| `PATTERN_MISMATCH` | String does not match the required regex pattern |
| `COERCED` | Value was automatically coerced to the expected type |

## Violation Utilities

```ts
import {
  buildViolation,
  buildPath,
  formatViolationMessage,
  formatViolationsForLLM,
} from 'tool-output-guard';

// Build a path string from parts
buildPath(['user', 'address', 0, 'street']); // => '$.user.address[0].street'

// Format a single violation for humans
formatViolationMessage(violation); // => '[ERROR] $.name (WRONG_TYPE): Expected string, got number'

// Format all violations for LLM consumption
formatViolationsForLLM(violations);
// => 'Tool output validation failed with 2 violation(s):\n\n1. ...\n2. ...\n\nPlease fix...'
```

## ValidationError

```ts
import { ValidationError } from 'tool-output-guard';

try {
  await guardedTool(args);
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(err.violations);  // Violation[]
    console.error(err.toolName);    // string | undefined
  }
}
```

## Available Exports

### Types

```ts
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
} from 'tool-output-guard';

import { ValidationError } from 'tool-output-guard';
```

### Schema Detection

Detect which schema format an object uses. Detection is performed once and cached via `WeakMap`.

```ts
import {
  detectSchema,
  isZodSchema,
  isTypeBoxSchema,
  isJSONSchema,
} from 'tool-output-guard';

import type { SchemaType, DetectedSchema } from 'tool-output-guard';
```

#### `detectSchema(schema: unknown): DetectedSchema`

Auto-detect the schema format. Returns a `DetectedSchema` with `type` (`'zod' | 'typebox' | 'json-schema'`) and the original `schema`. Throws `TypeError` if the format is not recognized.

Priority order: Zod > TypeBox > JSON Schema.

```ts
import { z } from 'zod';
import { Type } from '@sinclair/typebox';

detectSchema(z.string());
// => { type: 'zod', schema: [ZodString] }

detectSchema(Type.Object({ name: Type.String() }));
// => { type: 'typebox', schema: { [Symbol(TypeBox.Kind)]: 'Object', ... } }

detectSchema({ type: 'object', properties: { name: { type: 'string' } } });
// => { type: 'json-schema', schema: { type: 'object', ... } }

detectSchema({ foo: 'bar' });
// => throws TypeError
```

## Supported Schemas

| Schema Library | Detection Method | Version |
|---|---|---|
| [Zod](https://zod.dev) | `_def` property + `safeParse` method | v3 / v4 |
| [JSON Schema](https://json-schema.org) | `$schema`, `type`, `properties`, or combinators | draft-07 / 2020-12 |
| [TypeBox](https://github.com/sinclairzx81/typebox) | `Symbol.for('TypeBox.Kind')` property | v0.34+ |

Schema format is auto-detected at guard creation time and cached. You never need to specify which format you are using.

### Supported JSON Schema Keywords

`type`, `required`, `properties`, `items`, `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `additionalProperties`, `anyOf`, `oneOf`, `allOf`.

## Node.js Compatibility

Requires Node.js >= 18.

## License

MIT
