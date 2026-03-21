# tool-output-guard

Runtime validator for tool execution results against schemas (Zod, JSON Schema, TypeBox).

Validates data returned by LLM tool calls, MCP tools, or any async function against a schema you provide. Automatically detects the schema format -- just pass your schema and the library handles the rest.

## Installation

```bash
npm install tool-output-guard
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

// Wrap any async tool function with schema validation
const getWeather = guard(
  async (city: string) => {
    // call external API, LLM tool, etc.
    return { temperature: 22, unit: 'celsius', description: 'Sunny' };
  },
  WeatherSchema,
  { onInvalid: 'throw' },
);

const result = await getWeather('London');
// result is typed and validated against WeatherSchema
```

The `guard()` API is planned for a future release. The current version provides type definitions and schema detection utilities.

## Available Exports

### Types

All core types used throughout the library are exported and ready to use:

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

| Type | Description |
|---|---|
| `Violation` | A single validation violation with path, severity, code, and messages |
| `ViolationSeverity` | `'error' \| 'warning'` |
| `ViolationCode` | `'WRONG_TYPE' \| 'MISSING_REQUIRED' \| 'UNKNOWN_FIELD' \| 'CONSTRAINT_VIOLATION' \| 'ENUM_MISMATCH' \| 'PATTERN_MISMATCH' \| 'COERCED'` |
| `ValidationResult<T>` | Discriminated union: `{ success: true; data: T; warnings: Violation[] }` or `{ success: false; violations: Violation[] }` |
| `ValidationError` | Error class with `violations` array and optional `toolName` |
| `LLMValidationError` | Structured error object for LLM consumption |
| `FailureStrategy` | `'throw' \| 'fallback' \| 'error-result' \| 'coerce-and-warn' \| 'strip-extra'` |
| `CoercionConfig` | Per-rule coercion toggles (stringToNumber, stringToBoolean, etc.) |
| `GuardOptions<T>` | Full configuration for guard behavior |
| `Guard<T>` | Guard instance with `validate()` and `wrap()` methods |
| `GuardToolsOptions<T>` | Options for guarding multiple tools at once |

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

#### `isZodSchema(schema: unknown): boolean`

Returns `true` if the schema has `_def` and a `safeParse` function (Zod schema markers).

#### `isTypeBoxSchema(schema: unknown): boolean`

Returns `true` if the schema has the `Symbol.for('TypeBox.Kind')` property.

#### `isJSONSchema(schema: unknown): boolean`

Returns `true` if the schema has any recognized JSON Schema keyword (`$schema`, `type`, `properties`, `items`, `allOf`, `anyOf`, `oneOf`).

## Supported Schemas

| Schema Library | Detection Method | Version |
|---|---|---|
| [Zod](https://zod.dev) | `_def` property + `safeParse` method | v3 / v4 |
| [JSON Schema](https://json-schema.org) | `$schema`, `type`, `properties`, or combinators | draft-07 / 2020-12 |
| [TypeBox](https://github.com/sinclairzx81/typebox) | `Symbol.for('TypeBox.Kind')` property | v0.34+ |

Schema format is auto-detected at guard creation time and cached. You never need to specify which format you are using.

## Node.js Compatibility

Requires Node.js >= 18.

## License

MIT
