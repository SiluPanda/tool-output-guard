# tool-output-guard -- Specification

## 1. Overview

`tool-output-guard` is a runtime validation library that intercepts the output of tool functions in LLM-powered applications, validates the output against a Zod schema or JSON Schema, and either passes valid output through unchanged or applies a configurable failure strategy when validation fails. It wraps tool functions transparently -- the guarded function has the same signature as the original -- so that every tool result is guaranteed to conform to its declared schema before it reaches the LLM's context window. The library performs no network I/O, requires no API keys, and runs entirely in-process.

The gap this package fills is specific and well-documented. When an LLM calls a tool and receives the result, the LLM must parse and reason about that result to continue its conversation or execute the next step. If the tool result is malformed -- wrong types, missing required fields, extra fields the model was not told to expect, `null` where an object was expected, an HTML error page instead of JSON, a truncated response, or a string `"42"` where a number `42` was expected -- the LLM cannot reliably parse it. The consequences are predictable and severe. The model may hallucinate the structure it expected, inventing field values that do not exist in the actual output. It may attempt to call the same tool again with identical arguments, hoping for a different result, entering an infinite retry loop that burns tokens and time. It may misinterpret the malformed data as a valid but different result, producing subtly wrong answers. Or it may give up entirely, telling the user "I encountered an error" with no actionable detail. These failure modes are the most common cause of agent loop degradation in production systems.

The MCP 2025-06-18 specification codified this problem at the protocol level. The `outputSchema` field on tool definitions allows MCP servers to declare the expected JSON Schema of a tool's structured output. The `structuredContent` field in tool results carries the validated structured data. The specification is explicit: servers MUST provide structured results that conform to the declared `outputSchema`, and clients SHOULD validate structured results against the schema. But the specification mandates the contract without providing the validation machinery. MCP server authors must implement output validation themselves, and there is no standalone package in the ecosystem that does this for them. The official `@modelcontextprotocol/sdk` handles protocol-level message validation but does not validate tool output against tool-specific `outputSchema` definitions. Server authors are left to write ad-hoc validation code per tool, which is tedious, inconsistent, and frequently skipped.

Outside MCP, the situation is worse. OpenAI function calling returns tool results as plain strings in `tool` role messages -- there is no schema enforcement whatsoever. The application serializes the tool output to JSON and injects it into the conversation. If the serialized JSON does not match what the LLM was told to expect (via the function's `parameters` definition), the LLM is left to cope. Anthropic tool use returns `tool_result` content blocks with no schema enforcement beyond the `is_error` flag. The Vercel AI SDK defines tools with Zod schemas for input validation (the `parameters` field), but provides no corresponding output validation. LangChain provides `StructuredTool` with Zod input schemas but no output schemas. In every major framework and provider, tool input validation is well-supported and tool output validation is absent.

`tool-output-guard` fills this gap with a single, focused package. It provides a `guard` function that wraps a tool function with output validation, a `validate` function for standalone validation of arbitrary values, a `guardTools` function for wrapping a map of tool functions in a single call, a `createGuard` factory for creating reusable guard instances, and a `fromMCPTool` function for extracting a guard directly from an MCP tool definition's `outputSchema`. It supports Zod schemas natively, JSON Schema via bundled `ajv`-compatible validation, and TypeBox schemas (which are JSON Schema objects with static type inference). It auto-detects the schema type so the caller does not need to specify it. When validation fails, the caller chooses a failure strategy: throw a detailed `ValidationError`, return a configurable fallback value, return a structured error object formatted for LLM consumption, attempt type coercion and warn on changes, or strip unknown fields. Each strategy is designed for a specific production scenario. The validation pipeline is sub-millisecond for typical tool outputs, adding negligible overhead to tool execution.

The package composes with other packages in this monorepo. `tool-call-retry` retries tool execution when the tool function itself fails (network errors, timeouts, service unavailability) -- it handles execution failures. `tool-output-guard` validates the tool's return value when execution succeeds but the output is malformed -- it handles data quality failures. The two are complementary and compose naturally: wrap the tool with `tool-call-retry` for execution resilience, then wrap the result with `tool-output-guard` for output correctness. `schema-bridge` converts schemas between provider-specific formats (Zod to OpenAI JSON Schema, Zod to Anthropic tool input schema, etc.) -- it is a schema conversion utility. `tool-output-guard` is a schema validation runtime. `stream-validate` validates LLM output as it streams in token by token -- it validates the model's response. `tool-output-guard` validates the tool's response after execution completes -- it validates what goes back to the model.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `guard<T>(toolFn, schema, options?)` function that wraps an async tool function with output validation, returning a new function with the same input signature whose return value is guaranteed to conform to the schema.
- Provide a `validate<T>(output, schema, options?)` function that validates an arbitrary value against a schema and returns a `ValidationResult<T>` containing either the validated (and optionally coerced) value or a detailed violation report.
- Provide a `guardTools(toolMap, schemaMap, options?)` function that wraps a map of named tool functions with per-tool output schemas in a single call.
- Provide a `createGuard<T>(schema, options?)` factory that returns a reusable `Guard<T>` instance with `validate` and `wrap` methods, for scenarios where the same schema is applied to multiple tool functions or validated values.
- Provide a `fromMCPTool(toolDefinition)` function that extracts the `outputSchema` from an MCP tool definition and returns a configured guard, enabling zero-configuration output validation for MCP servers.
- Support Zod schemas as the primary schema format, using `safeParse` for validation and inferring TypeScript types from the schema via `z.infer<T>`.
- Support JSON Schema (draft-07 and draft-2020-12) as an alternative schema format, validated via a built-in JSON Schema validator. JSON Schema is the format used by MCP `outputSchema`, OpenAI function definitions, and most schema interchange formats.
- Support TypeBox schemas as a third schema format, recognized as JSON Schema objects with no conversion needed.
- Auto-detect the schema type (Zod, JSON Schema, TypeBox) so the caller does not need to specify which format they are passing. Detection is based on structural checks: Zod schemas have a `_def` property and a `safeParse` method; JSON Schema objects have a `type` property and optionally `properties`, `items`, `$schema`; TypeBox schemas have a `[Kind]` symbol property.
- Implement configurable failure strategies: `throw` (throw a `ValidationError`), `fallback` (return a default value), `error-result` (return a structured error for LLM consumption), `coerce-and-warn` (attempt type coercion, warn on changes), and `strip-extra` (pass valid fields, strip unknown fields).
- Implement optional type coercion that fixes common type mismatches before validation: string-encoded numbers (`"42"` to `42`), string-encoded booleans (`"true"` to `true`), string-encoded JSON arrays and objects, number-to-string conversion, and null-to-default-value substitution.
- Return detailed violation reports on validation failure, including the JSON path to each invalid field, expected type, received type, expected value constraints, received value, severity (error or warning for coerced fields), a human-readable message, and an LLM-readable message.
- Provide event hooks (`onValidationPass`, `onValidationFail`, `onCoercion`) for observability, logging, and metrics.
- Keep runtime dependencies minimal: `zod` as a peer dependency (optional -- only required if the caller uses Zod schemas). The JSON Schema validator is implemented internally to avoid depending on `ajv` (which is 150+ KB minified and brings its own dependency tree). The internal validator supports the subset of JSON Schema used in practice by MCP `outputSchema`, OpenAI function definitions, and typical tool output schemas.
- Maintain sub-millisecond validation overhead for typical tool outputs (objects with 5-20 fields, nested 1-2 levels deep, total payload under 10 KB).

### Non-Goals

- **Not a tool execution retry library.** This package validates tool output after successful execution. If the tool function throws an error (network failure, timeout, service unavailable), that is the concern of `tool-call-retry`. `tool-output-guard` only sees the return value of the tool function. If the tool returns an error page (HTML string instead of JSON), `tool-output-guard` catches this as a validation failure because the HTML string does not match the expected schema.
- **Not a streaming validator.** This package validates complete tool output after the tool function's promise resolves. It does not validate partial output as it streams in. For streaming validation of LLM responses, use `stream-validate`.
- **Not a schema conversion library.** This package validates data against schemas. It does not convert schemas between formats (Zod to JSON Schema, JSON Schema to TypeBox). For schema conversion, use `schema-bridge` or `zod-to-json-schema`.
- **Not an input validation library.** This package validates tool output (what the tool returns). It does not validate tool input (what the LLM sends as tool arguments). Tool input validation is handled by the tool-calling framework (MCP SDK, Vercel AI SDK, LangChain) or by the tool function itself.
- **Not an LLM output validator.** This package validates what tools return to the LLM. It does not validate what the LLM generates (structured output, JSON mode responses). For LLM output validation, use `stream-validate` for streaming or Zod's `parse`/`safeParse` for complete responses.
- **Not a full JSON Schema validator.** The built-in JSON Schema validator supports the subset of JSON Schema commonly used in tool output schemas: `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`/`oneOf`/`allOf`, `minLength`/`maxLength`, `minimum`/`maximum`, `pattern`, `format`, `default`, `additionalProperties`, and `$ref` (local references only). It does not support `$dynamicRef`, `$vocabulary`, `unevaluatedProperties`, `if`/`then`/`else`, or other advanced JSON Schema features. If you need full JSON Schema 2020-12 compliance, pass an `ajv` instance via the `jsonSchemaValidator` option.
- **Not a security boundary.** The coercion and strip-extra features are convenience mechanisms, not security controls. Do not rely on `tool-output-guard` to sanitize untrusted tool output for security purposes. Sanitize tool output in the tool function itself before returning it.

---

## 3. Target Users and Use Cases

### MCP Server Developers

Teams building MCP servers whose tools declare `outputSchema` in their tool definitions. The MCP 2025-06-18 specification requires that servers MUST provide structured results conforming to the declared `outputSchema`, but the SDK does not enforce this at runtime. `tool-output-guard` wraps tool handler functions so that every tool result is validated against its `outputSchema` before being sent to the client. A typical integration is: `const guard = fromMCPTool(toolDefinition); const result = await guard.validate(rawOutput);`. When validation fails, the server can return a well-formed error result (`isError: true`) instead of silently sending malformed data that confuses the LLM.

### AI Agent Developers

Developers building autonomous agents where tools call external APIs and the results are injected into the LLM's context. External APIs are the most common source of malformed tool output: a weather API returns temperatures as strings instead of numbers, a search API wraps results in an unexpected envelope object, a database query returns `null` instead of an empty array, or a rate-limited API returns an HTML error page instead of JSON. Without output validation, the LLM sees the malformed data and either hallucinates structure or enters a confused retry loop. `tool-output-guard` catches these mismatches at the tool boundary before they reach the model, either fixing them via coercion or returning a clear error that the LLM can reason about.

### Tool Library Authors

Developers building reusable tool libraries for agent frameworks. A tool library exposes functions like `searchWeb`, `queryDatabase`, `getWeather` for consumption by multiple agents. Each tool has a well-defined output schema that the library author controls. `tool-output-guard` lets the library author declare and enforce the output contract at the library level, so consumers of the library are guaranteed to receive well-typed, well-structured data regardless of what the underlying API returns. The guard acts as a contract boundary between the tool implementation (which may change) and the tool consumer (which relies on a stable schema).

### Agent Framework Authors

Teams building agent orchestration frameworks (similar to LangChain, CrewAI, or AutoGen) that manage collections of tools. The framework registers tools with their schemas, and every tool invocation is automatically guarded. The framework author calls `guardTools(toolMap, schemaMap)` once during initialization and does not think about output validation again. When a tool's output fails validation, the framework can apply its own recovery logic: retry with different arguments, fall back to an alternative tool, or return a structured error to the LLM.

### Reliability Engineers Debugging Agent Loops

Engineers investigating why an agent is looping, producing wrong answers, or burning excessive tokens. By enabling `tool-output-guard` with the `throw` failure strategy and `onValidationFail` hooks, they can identify exactly which tool is returning malformed data, what fields are invalid, and what the tool actually returned versus what was expected. The violation report provides the forensic detail needed to diagnose the root cause without modifying the tool functions themselves.

### Developers Integrating Uncontrolled Third-Party Tools

Teams whose agents use tools they did not build and cannot modify -- MCP servers provided by vendors, community-built tool plugins, or legacy internal services. The tool output may not match the documented schema, may change without notice, or may be inconsistently formatted. `tool-output-guard` sits between the tool and the LLM as a defensive layer, normalizing and validating output from tools the developer does not control.

---

## 4. Core Concepts

### Guard

A guard is a validation wrapper around a tool function. It intercepts the tool function's return value, validates it against a schema, and either passes the valid value through or applies a failure strategy. The guarded function is a drop-in replacement for the original -- callers do not know validation is happening. A guard is created by `guard(toolFn, schema, options?)`, which returns a new async function, or by `createGuard(schema, options?)`, which returns a reusable `Guard<T>` instance.

### Schema

A schema defines the expected structure and types of a tool's output. `tool-output-guard` accepts three schema formats:

- **Zod schemas**: The recommended format for TypeScript projects. Zod schemas provide static type inference (`z.infer<typeof schema>`) and rich validation with human-readable error messages. Example: `z.object({ temperature: z.number(), conditions: z.string() })`.
- **JSON Schema objects**: The format used by MCP `outputSchema`, OpenAI function definitions, and most cross-language schema interchange. Example: `{ type: "object", properties: { temperature: { type: "number" } }, required: ["temperature"] }`.
- **TypeBox schemas**: JSON Schema objects created with TypeBox's type builder, which add static TypeScript type inference to standard JSON Schema. Recognized and handled identically to JSON Schema at runtime.

The schema type is auto-detected. Zod schemas are identified by the presence of a `_def` property and a `safeParse` method. TypeBox schemas are identified by the `[Symbol.for('TypeBox.Kind')]` symbol. JSON Schema objects are identified by the presence of a `type` property or a `$schema` property.

### Validation Result

A validation result is the return type of the `validate` function. It is a discriminated union:

- **Success**: `{ success: true, data: T }` where `T` is the validated (and optionally coerced) value, typed according to the schema.
- **Failure**: `{ success: false, violations: Violation[] }` where `violations` is an array of detailed violation reports describing each invalid field.

The discriminated union pattern matches Zod's `safeParse` return type, making it familiar to TypeScript developers.

### Violation

A violation is a detailed report of a single validation failure. It includes the JSON path to the invalid field (e.g., `$.results[0].score`), the expected type or constraint, the received type and value, a severity level (`error` for validation failures, `warning` for coerced fields), a human-readable message, and an LLM-readable message. Violations are the primary diagnostic output of `tool-output-guard`.

### Coercion

Coercion is the optional, automatic conversion of values from one type to another to fix common mismatches. When a tool returns `{ temperature: "72.5" }` but the schema expects `temperature` to be a number, coercion converts the string `"72.5"` to the number `72.5` and the validation passes with a warning. Coercion is disabled by default and must be explicitly enabled. When enabled, coerced fields are recorded in the violation report with severity `warning` so the caller can track how often coercion is needed and address the root cause.

### Failure Strategy

A failure strategy determines what happens when validation fails. Five strategies are available:

- **`throw`**: Throw a `ValidationError` containing the full violation report. The caller's try-catch handles it.
- **`fallback`**: Return a preconfigured fallback value instead of the invalid output.
- **`error-result`**: Return a structured error object formatted for LLM consumption, similar to `tool-call-retry`'s `LLMFormattedError`.
- **`coerce-and-warn`**: Attempt to coerce invalid values to the expected types. If coercion succeeds for all violations, return the coerced value with warnings. If any violation cannot be coerced, fall through to a secondary strategy (default: `throw`).
- **`strip-extra`**: Pass through fields that are valid, strip fields that are not in the schema (unknown/extra fields). This is equivalent to Zod's `.strip()` mode for object schemas.

---

## 5. Validation Pipeline

The validation pipeline is the sequence of steps that transforms a raw tool output into either a validated value or a failure result. Each step is independent and configurable.

### Pipeline Steps

```
Raw Tool Output
      │
      ▼
┌─────────────┐
│  Step 1     │  Receive raw output from tool function
│  Receive    │  (the resolved value of the tool's Promise)
└─────┬───────┘
      │
      ▼
┌─────────────┐
│  Step 2     │  If coercion is enabled, attempt type fixes:
│  Coerce     │  "42" → 42, "true" → true, etc.
│  (optional) │  Record each coercion as a warning violation.
└─────┬───────┘
      │
      ▼
┌─────────────┐
│  Step 3     │  Validate against the schema (Zod or JSON Schema).
│  Validate   │  Collect all violations (not just the first one).
└─────┬───────┘
      │
      ├── Valid ──────────────────────────────────────┐
      │                                               ▼
      │                                    ┌──────────────────┐
      │                                    │  Return validated │
      │                                    │  value (typed T)  │
      │                                    └──────────────────┘
      │
      ├── Invalid ───────────────────────────────────┐
      │                                               ▼
      │                                    ┌──────────────────┐
      │                                    │  Step 4          │
      │                                    │  Apply failure   │
      │                                    │  strategy        │
      │                                    └──────┬───────────┘
      │                                           │
      │                              ┌────────────┼────────────┐
      │                              ▼            ▼            ▼
      │                         throw error  return fallback  return error-result
      │
      └── Coercion applied (all fields fixed) ──┐
                                                  ▼
                                       ┌──────────────────┐
                                       │  Return coerced   │
                                       │  value + warnings  │
                                       └──────────────────┘
```

### Step 1: Receive Raw Output

The guard intercepts the resolved value of the tool function's returned Promise. If the tool function throws, the guard does not catch it -- execution errors are the concern of `tool-call-retry` or the caller's error handling. The guard only processes successful return values.

### Step 2: Type Coercion (Optional)

If `coercion: true` is set in the options, the raw output is walked recursively and compared against the schema. When a value's type does not match the schema's expected type but can be losslessly converted, the conversion is applied. Coercion happens before validation, so the validator sees the coerced values. Each coercion is recorded as a violation with severity `warning`, including the original value, the coerced value, and the path. Coercion is conservative: it only converts when the conversion is unambiguous and lossless. Ambiguous cases (e.g., `"yes"` to boolean -- is it `true`?) are not coerced and are left for the validator to reject.

### Step 3: Schema Validation

The (optionally coerced) value is validated against the schema. For Zod schemas, this calls `schema.safeParse(value)`. For JSON Schema, this runs the built-in JSON Schema validator. Validation collects all violations, not just the first one. This means the violation report contains every invalid field in the output, giving the caller (or the LLM) complete information about what is wrong.

### Step 4: Apply Failure Strategy

If validation produced any violations with severity `error` (not just `warning` from coercion), the configured failure strategy is applied. The strategy determines the return value or thrown error. Each strategy is described in detail in section 7.

### Event Emission

After each validation, the appropriate event hook is called: `onValidationPass` if the output is valid (possibly with coercion warnings), `onValidationFail` if validation failed and a failure strategy was applied, or `onCoercion` for each individual field that was coerced. Events are synchronous -- the hook function is called inline, not queued. If a hook throws, the error propagates to the caller.

---

## 6. Schema Support

### Zod Schemas (Recommended)

Zod is the recommended schema format for TypeScript projects. Zod schemas provide static type inference, composable validation, human-readable error messages, and a rich API for defining constraints.

```typescript
import { z } from 'zod';
import { guard } from 'tool-output-guard';

const WeatherSchema = z.object({
  temperature: z.number().min(-100).max(60),
  conditions: z.string(),
  humidity: z.number().min(0).max(100),
  wind: z.object({
    speed: z.number(),
    direction: z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']),
  }).optional(),
});

const guardedWeatherTool = guard(rawWeatherTool, WeatherSchema);
```

When a Zod schema is detected, `tool-output-guard` calls `schema.safeParse(value)`. If `safeParse` returns `{ success: false }`, the Zod error issues are mapped to `Violation` objects. The `z.infer<typeof WeatherSchema>` type flows through the guard to the return type of the guarded function.

Zod is a peer dependency. If the caller does not use Zod schemas, they do not need to install Zod.

### JSON Schema (draft-07 and draft-2020-12)

JSON Schema is the format used by MCP `outputSchema`, OpenAI function definitions, and most cross-language schema interchange. `tool-output-guard` includes a built-in JSON Schema validator that supports the practically-used subset of the specification.

```typescript
import { guard } from 'tool-output-guard';

const weatherSchema = {
  type: 'object' as const,
  properties: {
    temperature: { type: 'number', minimum: -100, maximum: 60 },
    conditions: { type: 'string' },
    humidity: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['temperature', 'conditions', 'humidity'],
};

const guardedWeatherTool = guard(rawWeatherTool, weatherSchema);
```

The built-in validator supports: `type` (string, number, integer, boolean, null, object, array), `properties`, `required`, `additionalProperties`, `items` (single schema and tuple), `minItems`/`maxItems`, `minLength`/`maxLength`, `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`, `multipleOf`, `pattern`, `format` (date-time, email, uri -- validated by regex), `enum`, `const`, `anyOf`, `oneOf`, `allOf`, `not`, `$ref` (local JSON Pointer references only), and `default`.

For applications that require full JSON Schema compliance (including `$dynamicRef`, `unevaluatedProperties`, `if`/`then`/`else`, remote `$ref`), the `jsonSchemaValidator` option accepts a custom validator function. This allows plugging in `ajv` or any other JSON Schema validator:

```typescript
import Ajv from 'ajv';
import { guard } from 'tool-output-guard';

const ajv = new Ajv({ allErrors: true });

const guardedTool = guard(rawTool, jsonSchema, {
  jsonSchemaValidator: (schema, data) => {
    const validate = ajv.compile(schema);
    const valid = validate(data);
    return { valid, errors: validate.errors ?? [] };
  },
});
```

### TypeBox Schemas

TypeBox schemas are JSON Schema objects created with TypeBox's type builder. They carry static TypeScript type inference via TypeBox's `Static<T>` utility type. At runtime, TypeBox schemas are plain JSON Schema objects, so `tool-output-guard` validates them identically to JSON Schema. The auto-detection logic recognizes TypeBox schemas by the `[Symbol.for('TypeBox.Kind')]` symbol property, but the validation path is the same as JSON Schema.

```typescript
import { Type, Static } from '@sinclair/typebox';
import { guard } from 'tool-output-guard';

const WeatherSchema = Type.Object({
  temperature: Type.Number({ minimum: -100, maximum: 60 }),
  conditions: Type.String(),
  humidity: Type.Number({ minimum: 0, maximum: 100 }),
});

type Weather = Static<typeof WeatherSchema>;

const guardedWeatherTool = guard(rawWeatherTool, WeatherSchema);
```

### Auto-Detection

When a schema is passed to any `tool-output-guard` function, the schema type is detected automatically:

| Check | Schema Type | Validation Method |
|---|---|---|
| Has `_def` property and `safeParse` method | Zod | `schema.safeParse(value)` |
| Has `Symbol.for('TypeBox.Kind')` symbol | TypeBox (JSON Schema) | Built-in JSON Schema validator |
| Has `type` property or `$schema` property | JSON Schema | Built-in JSON Schema validator |

Detection is performed once when the guard is created, not on every validation call. If the schema does not match any known format, a `TypeError` is thrown synchronously at guard creation time.

### Schema-from-MCP

The `fromMCPTool` function extracts the `outputSchema` from an MCP tool definition and creates a guard. If the tool definition does not include an `outputSchema`, the function returns `null` (the tool has no output schema to validate against).

```typescript
import { fromMCPTool } from 'tool-output-guard';

const toolDefinition = {
  name: 'get_weather',
  inputSchema: { /* ... */ },
  outputSchema: {
    type: 'object',
    properties: {
      temperature: { type: 'number' },
      conditions: { type: 'string' },
    },
    required: ['temperature', 'conditions'],
  },
};

const weatherGuard = fromMCPTool(toolDefinition);
// weatherGuard is a Guard instance, or null if no outputSchema

if (weatherGuard) {
  const result = weatherGuard.validate(rawOutput);
}
```

---

## 7. Failure Strategies

When validation fails, the configured failure strategy determines the behavior. The strategy is set via the `onInvalid` option (default: `'throw'`).

### `throw`

Throw a `ValidationError` containing the full violation report. This is the default strategy and the correct choice during development and testing, where validation failures should be loud and immediately visible.

```typescript
const guardedTool = guard(rawTool, schema, { onInvalid: 'throw' });

try {
  const result = await guardedTool(args);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(error.violations);
    // [{ path: '$.temperature', expected: 'number', received: 'string', ... }]
  }
}
```

The `ValidationError` class extends `Error` with a `violations` property containing the full `Violation[]` array, a `toolName` property (if the guarded function was named or the tool name was provided), and a formatted `message` that summarizes the violations in human-readable form.

### `fallback`

Return a preconfigured fallback value instead of the invalid output. This is the correct choice when the caller needs a guaranteed valid value and has a reasonable default. The fallback value is validated against the schema at guard creation time -- if the fallback itself does not pass validation, a `TypeError` is thrown synchronously.

```typescript
const guardedTool = guard(rawTool, schema, {
  onInvalid: 'fallback',
  fallbackValue: { temperature: 0, conditions: 'unknown', humidity: 0 },
});

// Always returns a valid value, never throws on validation failure
const result = await guardedTool(args);
```

### `error-result`

Return a structured error object formatted for LLM consumption. The error object includes the violation details in a format that helps the LLM understand what went wrong and decide its next action. This is the correct choice when the tool result is injected into the LLM's context and the LLM needs to reason about the failure.

```typescript
const guardedTool = guard(rawTool, schema, {
  onInvalid: 'error-result',
});

const result = await guardedTool(args);
// If validation failed, result is:
// {
//   error: true,
//   code: 'INVALID_TOOL_OUTPUT',
//   message: 'The tool returned data that does not match the expected format.',
//   violations: [
//     { path: '$.temperature', message: 'Expected number, received string "72"' }
//   ],
//   suggestion: 'The tool may be malfunctioning. Try an alternative approach or ask the user for the information directly.'
// }
```

The error object structure is compatible with `tool-call-retry`'s `LLMFormattedError` format, so both packages produce errors that the LLM can reason about consistently.

### `coerce-and-warn`

Attempt to coerce invalid values to the expected types. If all violations can be resolved by coercion, return the coerced value along with warning-level violations. If any violation cannot be coerced, fall through to a secondary strategy (configured via `coercionFallback`, default: `'throw'`).

```typescript
const guardedTool = guard(rawTool, schema, {
  onInvalid: 'coerce-and-warn',
  coercionFallback: 'error-result',
});

// If the tool returns { temperature: "72", conditions: "sunny", humidity: 65 }
// and the schema expects temperature to be a number:
// → Coercion converts "72" to 72
// → Returns { temperature: 72, conditions: "sunny", humidity: 65 }
// → onCoercion hook fires with the coercion details
```

This strategy is equivalent to enabling coercion in Step 2 of the pipeline and treating the coerce-then-validate result as the final output. It is the most lenient strategy and is appropriate for tools that are known to return data with minor type mismatches (e.g., APIs that return all values as strings).

### `strip-extra`

Pass through fields that are valid and present in the schema, strip fields that are not in the schema. This does not fix type errors on known fields -- it only removes unknown fields. If known fields have type errors, the behavior depends on whether coercion is also enabled.

```typescript
const guardedTool = guard(rawTool, schema, {
  onInvalid: 'strip-extra',
});

// If the tool returns { temperature: 72, conditions: "sunny", humidity: 65, internalId: "abc123", debugInfo: { ... } }
// and the schema only defines temperature, conditions, humidity:
// → Returns { temperature: 72, conditions: "sunny", humidity: 65 }
// → internalId and debugInfo are stripped
```

This strategy is useful when tools return extra metadata fields that the LLM should not see. It is similar to Zod's `.strip()` passthrough mode for objects.

### Per-Field Strategies

For fine-grained control, the `fieldStrategies` option allows different handling for specific fields:

```typescript
const guardedTool = guard(rawTool, schema, {
  onInvalid: 'throw',
  fieldStrategies: {
    '$.metadata': 'strip-extra',       // Strip unknown metadata fields
    '$.score': 'coerce-and-warn',      // Coerce score to number if string
    '$.optional_field': 'fallback',    // Use default for this optional field
  },
  fieldFallbacks: {
    '$.optional_field': 'N/A',
  },
});
```

Field-level strategies are evaluated before the global strategy. If a field matches a field strategy and that strategy resolves the violation, the global strategy is not triggered for that field.

---

## 8. Type Coercion

Type coercion automatically fixes common type mismatches between the tool's actual output and the schema's expected types. Coercion is disabled by default (`coercion: false`) and must be explicitly enabled. When enabled, coercion runs before schema validation (Step 2 of the pipeline).

### Coercion Rules

| Source Type | Target Type | Rule | Example |
|---|---|---|---|
| string | number | Parse with `Number()`. Accept if result is finite and not `NaN`. | `"42"` -> `42`, `"3.14"` -> `3.14`, `"-7"` -> `-7` |
| string | integer | Parse with `Number()`. Accept if result is a finite integer. | `"42"` -> `42`. `"3.14"` is rejected (not an integer). |
| string | boolean | Accept `"true"` -> `true` and `"false"` -> `false` (case-insensitive). Reject all other strings. | `"true"` -> `true`, `"TRUE"` -> `true`, `"yes"` is rejected. |
| string | array | Attempt `JSON.parse()`. Accept if result is an array. | `"[1,2,3]"` -> `[1,2,3]` |
| string | object | Attempt `JSON.parse()`. Accept if result is a plain object. | `'{"a":1}'` -> `{a:1}` |
| number | string | Convert via `String()`. | `42` -> `"42"`, `3.14` -> `"3.14"` |
| boolean | string | Convert via `String()`. | `true` -> `"true"` |
| null | any (with default) | Substitute the schema's `default` value if one is declared. | `null` -> `0` (if default is `0`) |
| number | boolean | Not coerced. Numbers and booleans are semantically different. | `1` is not coerced to `true`. |
| boolean | number | Not coerced. | `true` is not coerced to `1`. |

### Coercion Configuration

Coercion is controlled by the `coercion` option, which is either `false` (disabled, default), `true` (all coercion rules enabled), or a `CoercionConfig` object for fine-grained control:

```typescript
interface CoercionConfig {
  /** Coerce string values to numbers. Default: true when coercion is enabled. */
  stringToNumber: boolean;

  /** Coerce string values to booleans ("true"/"false" only). Default: true when coercion is enabled. */
  stringToBoolean: boolean;

  /** Coerce string values to arrays/objects via JSON.parse. Default: true when coercion is enabled. */
  stringToJson: boolean;

  /** Coerce numbers to strings. Default: true when coercion is enabled. */
  numberToString: boolean;

  /** Substitute schema default values for null. Default: true when coercion is enabled. */
  nullToDefault: boolean;
}
```

### Coercion Reporting

Every coercion is recorded as a violation with severity `warning`:

```typescript
{
  path: '$.temperature',
  severity: 'warning',
  code: 'COERCED',
  expected: 'number',
  received: 'string',
  receivedValue: '72.5',
  coercedValue: 72.5,
  message: 'Value at $.temperature was coerced from string "72.5" to number 72.5',
  llmMessage: 'The temperature field was a string but was converted to a number.',
}
```

Coercion warnings are included in the `ValidationResult` even on success, so the caller can monitor how often coercion is needed and fix the root cause in the tool function.

### Recursive Coercion

Coercion operates recursively. If the schema describes a nested object, coercion walks into nested properties and array elements. For arrays, each element is coerced according to the `items` schema. For objects, each property is coerced according to its property schema. The recursion depth is bounded by the schema structure -- coercion does not recurse into untyped (`{}`) or unknown parts of the value.

---

## 9. API Surface

### Installation

```bash
npm install tool-output-guard
```

Peer dependency (optional):
```bash
npm install zod    # Only required if using Zod schemas
```

### Primary Function: `guard`

Wraps a tool function with output validation.

```typescript
import { guard } from 'tool-output-guard';
import { z } from 'zod';

const WeatherSchema = z.object({
  temperature: z.number(),
  conditions: z.string(),
  humidity: z.number(),
});

async function getWeather(args: { location: string }): Promise<unknown> {
  const resp = await fetch(`https://api.weather.com/v1?loc=${args.location}`);
  return resp.json();
}

const guardedGetWeather = guard(getWeather, WeatherSchema, {
  onInvalid: 'throw',
  coercion: true,
});

// guardedGetWeather has type: (args: { location: string }) => Promise<{ temperature: number; conditions: string; humidity: number }>
const weather = await guardedGetWeather({ location: 'New York' });
// weather is guaranteed to conform to WeatherSchema
```

### Standalone Validation: `validate`

Validates an arbitrary value against a schema without wrapping a function.

```typescript
import { validate } from 'tool-output-guard';
import { z } from 'zod';

const schema = z.object({ score: z.number().min(0).max(100) });

const result = validate({ score: 85 }, schema);

if (result.success) {
  console.log(result.data.score); // 85, typed as number
} else {
  console.error(result.violations);
}
```

### Batch Wrapper: `guardTools`

Wraps a map of named tool functions with per-tool output schemas.

```typescript
import { guardTools } from 'tool-output-guard';
import { z } from 'zod';

const tools = {
  search: searchFn,
  weather: weatherFn,
  calculator: calculatorFn,
};

const schemas = {
  search: z.object({ results: z.array(z.string()), totalCount: z.number() }),
  weather: z.object({ temperature: z.number(), conditions: z.string() }),
  calculator: z.object({ result: z.number() }),
};

const guardedTools = guardTools(tools, schemas, {
  onInvalid: 'throw',
  coercion: true,
  toolOptions: {
    weather: { coercion: { stringToNumber: true, stringToBoolean: false } },
    calculator: { onInvalid: 'fallback', fallbackValue: { result: 0 } },
  },
});

// guardedTools.search, guardedTools.weather, etc. are now validated
```

### Guard Factory: `createGuard`

Creates a reusable guard instance that can validate values or wrap functions.

```typescript
import { createGuard } from 'tool-output-guard';
import { z } from 'zod';

const weatherGuard = createGuard(z.object({
  temperature: z.number(),
  conditions: z.string(),
}), {
  onInvalid: 'coerce-and-warn',
  coercion: true,
});

// Use as a standalone validator
const result = weatherGuard.validate(rawOutput);

// Use to wrap a function
const guardedFn = weatherGuard.wrap(rawWeatherFn);
```

### MCP Tool Guard: `fromMCPTool`

Creates a guard from an MCP tool definition's `outputSchema`.

```typescript
import { fromMCPTool } from 'tool-output-guard';

const toolDef = {
  name: 'get_weather',
  description: 'Get weather data',
  inputSchema: { type: 'object', properties: { location: { type: 'string' } } },
  outputSchema: {
    type: 'object',
    properties: {
      temperature: { type: 'number' },
      conditions: { type: 'string' },
    },
    required: ['temperature', 'conditions'],
  },
};

const weatherGuard = fromMCPTool(toolDef);
// weatherGuard is Guard<{ temperature: number; conditions: string }> | null
```

### Type Definitions

```typescript
// ── Validation Result ───────────────────────────────────────────────

/** Discriminated union: validation succeeded or failed. */
type ValidationResult<T> =
  | { success: true; data: T; warnings: Violation[] }
  | { success: false; violations: Violation[] };

// ── Violation ───────────────────────────────────────────────────────

/** Severity level. */
type ViolationSeverity = 'error' | 'warning';

/** A single validation violation. */
interface Violation {
  /** JSON path to the invalid field (e.g., '$.results[0].score'). */
  path: string;

  /** Severity: 'error' for validation failures, 'warning' for coerced fields. */
  severity: ViolationSeverity;

  /** Machine-readable violation code. */
  code: ViolationCode;

  /** Expected type or constraint (e.g., 'number', 'string with minLength 1'). */
  expected: string;

  /** Received type (e.g., 'string', 'null', 'undefined'). */
  received: string;

  /** The actual received value. May be truncated for large values. */
  receivedValue?: unknown;

  /** The coerced value, if coercion was applied. */
  coercedValue?: unknown;

  /** Human-readable description of the violation. */
  message: string;

  /** LLM-readable description, suitable for including in a tool error result. */
  llmMessage: string;
}

/** Machine-readable violation codes. */
type ViolationCode =
  | 'WRONG_TYPE'
  | 'MISSING_REQUIRED'
  | 'UNKNOWN_FIELD'
  | 'CONSTRAINT_VIOLATION'
  | 'ENUM_MISMATCH'
  | 'PATTERN_MISMATCH'
  | 'COERCED';

// ── Validation Error ────────────────────────────────────────────────

/** Error thrown when onInvalid is 'throw'. */
class ValidationError extends Error {
  /** The full list of violations. */
  readonly violations: Violation[];

  /** The tool name, if available. */
  readonly toolName?: string;

  /** Human-readable summary of all violations. */
  readonly message: string;
}

// ── LLM Error Result ────────────────────────────────────────────────

/** Structured error returned when onInvalid is 'error-result'. */
interface LLMValidationError {
  /** Always true. Signals to the LLM that this is an error. */
  error: true;

  /** Machine-readable error code. */
  code: 'INVALID_TOOL_OUTPUT';

  /** Human-readable message for the LLM. */
  message: string;

  /** Summary of violations. */
  violations: Array<{ path: string; message: string }>;

  /** Actionable suggestion for the LLM. */
  suggestion: string;
}

// ── Failure Strategy ────────────────────────────────────────────────

/** Available failure strategies. */
type FailureStrategy = 'throw' | 'fallback' | 'error-result' | 'coerce-and-warn' | 'strip-extra';

// ── Coercion Config ─────────────────────────────────────────────────

/** Fine-grained coercion configuration. */
interface CoercionConfig {
  stringToNumber: boolean;
  stringToBoolean: boolean;
  stringToJson: boolean;
  numberToString: boolean;
  nullToDefault: boolean;
}

// ── Guard Options ───────────────────────────────────────────────────

/** Options for guard, createGuard, and guardTools. */
interface GuardOptions<T = unknown> {
  /** Failure strategy when validation fails. Default: 'throw'. */
  onInvalid: FailureStrategy;

  /** Fallback value for the 'fallback' strategy. Must pass schema validation. */
  fallbackValue?: T;

  /** Fallback strategy when coercion cannot resolve all violations.
   *  Only used with 'coerce-and-warn'. Default: 'throw'. */
  coercionFallback?: Exclude<FailureStrategy, 'coerce-and-warn'>;

  /** Enable type coercion. Default: false. */
  coercion: boolean | CoercionConfig;

  /** Per-field failure strategies. Keys are JSON paths (e.g., '$.score'). */
  fieldStrategies?: Record<string, FailureStrategy>;

  /** Per-field fallback values. Keys are JSON paths. */
  fieldFallbacks?: Record<string, unknown>;

  /** Custom JSON Schema validator. Overrides the built-in validator for JSON Schema schemas. */
  jsonSchemaValidator?: (schema: object, data: unknown) => { valid: boolean; errors: Array<{ path: string; message: string }> };

  /** Tool name for error messages and events. */
  toolName?: string;

  /** Event hook: called after successful validation. */
  onValidationPass?: (info: { toolName?: string; data: unknown; warnings: Violation[] }) => void;

  /** Event hook: called after failed validation. */
  onValidationFail?: (info: { toolName?: string; violations: Violation[]; rawOutput: unknown }) => void;

  /** Event hook: called for each coerced field. */
  onCoercion?: (info: { toolName?: string; path: string; from: unknown; to: unknown; fromType: string; toType: string }) => void;
}

// ── Guard Instance ──────────────────────────────────────────────────

/** Reusable guard instance created by createGuard. */
interface Guard<T> {
  /** Validate a value against the schema. */
  validate(value: unknown): ValidationResult<T>;

  /** Wrap a tool function with output validation. */
  wrap<TArgs>(toolFn: (args: TArgs) => Promise<unknown>): (args: TArgs) => Promise<T>;

  /** The schema used by this guard. */
  readonly schema: unknown;

  /** The options used by this guard. */
  readonly options: GuardOptions<T>;
}

// ── guardTools Options ──────────────────────────────────────────────

/** Options for guardTools, with per-tool overrides. */
interface GuardToolsOptions<T = unknown> extends GuardOptions<T> {
  /** Per-tool option overrides. Keys are tool names. */
  toolOptions?: Record<string, Partial<GuardOptions>>;
}
```

### Function Signatures

```typescript
/**
 * Wrap a tool function with output validation.
 *
 * @param toolFn - The async tool function to wrap.
 * @param schema - Zod schema, JSON Schema, or TypeBox schema for the output.
 * @param options - Validation and failure strategy options.
 * @returns A new function with the same input signature, validated output type.
 */
function guard<TArgs, TOutput>(
  toolFn: (args: TArgs) => Promise<unknown>,
  schema: ZodSchema<TOutput> | JSONSchema | TypeBoxSchema,
  options?: Partial<GuardOptions<TOutput>>,
): (args: TArgs) => Promise<TOutput>;

/**
 * Validate a value against a schema.
 *
 * @param value - The value to validate.
 * @param schema - Zod schema, JSON Schema, or TypeBox schema.
 * @param options - Validation options.
 * @returns ValidationResult with either validated data or violations.
 */
function validate<T>(
  value: unknown,
  schema: ZodSchema<T> | JSONSchema | TypeBoxSchema,
  options?: Partial<GuardOptions<T>>,
): ValidationResult<T>;

/**
 * Wrap a map of tool functions with per-tool output schemas.
 *
 * @param tools - Record of tool name to tool function.
 * @param schemas - Record of tool name to output schema.
 * @param options - Global options with optional per-tool overrides.
 * @returns Record with the same keys, each function guarded.
 */
function guardTools<T extends Record<string, (args: any) => Promise<any>>>(
  tools: T,
  schemas: { [K in keyof T]: ZodSchema | JSONSchema | TypeBoxSchema },
  options?: Partial<GuardToolsOptions>,
): T;

/**
 * Create a reusable guard instance.
 *
 * @param schema - Zod schema, JSON Schema, or TypeBox schema.
 * @param options - Validation options.
 * @returns A Guard instance with validate and wrap methods.
 */
function createGuard<T>(
  schema: ZodSchema<T> | JSONSchema | TypeBoxSchema,
  options?: Partial<GuardOptions<T>>,
): Guard<T>;

/**
 * Create a guard from an MCP tool definition's outputSchema.
 *
 * @param toolDefinition - MCP tool definition with optional outputSchema.
 * @param options - Validation options.
 * @returns A Guard instance, or null if the tool has no outputSchema.
 */
function fromMCPTool(
  toolDefinition: { outputSchema?: object; name?: string; [key: string]: unknown },
  options?: Partial<GuardOptions>,
): Guard<unknown> | null;
```

---

## 10. Violation Report

The violation report is the primary diagnostic output of `tool-output-guard`. It provides enough detail for a developer to immediately understand what is wrong, and enough structure for an LLM to reason about the failure and decide its next action.

### Violation Fields

| Field | Type | Description |
|---|---|---|
| `path` | `string` | JSON path to the invalid field. Root is `$`. Object keys use dot notation (`$.address.city`). Array indices use bracket notation (`$.results[0].score`). |
| `severity` | `'error' \| 'warning'` | `error` for validation failures that prevent the output from being used. `warning` for coerced fields that were fixed but should be noted. |
| `code` | `ViolationCode` | Machine-readable code: `WRONG_TYPE`, `MISSING_REQUIRED`, `UNKNOWN_FIELD`, `CONSTRAINT_VIOLATION`, `ENUM_MISMATCH`, `PATTERN_MISMATCH`, `COERCED`. |
| `expected` | `string` | Human-readable description of what was expected. Examples: `"number"`, `"string with minLength 1"`, `"one of: 'active', 'inactive'"`, `"object with properties: name, age"`. |
| `received` | `string` | Human-readable description of what was received. Examples: `"string"`, `"null"`, `"undefined"`, `"array with 3 elements"`. |
| `receivedValue` | `unknown` | The actual received value, for inspection. Truncated to 200 characters for large values (strings, serialized objects). |
| `coercedValue` | `unknown` | Present only when `code` is `COERCED`. The value after coercion. |
| `message` | `string` | Human-readable message for developer consumption. Example: `"Expected number at $.temperature, received string \"72\""`. |
| `llmMessage` | `string` | LLM-readable message, shorter and action-oriented. Example: `"The temperature field should be a number but was the string \"72\". The tool may be returning text instead of numeric data."` |

### Example Violation Report

Given a schema expecting `{ results: Array<{ title: string, score: number }>, totalCount: number }` and a tool that returns `{ results: [{ title: "Hello", score: "95" }, { score: 42 }], totalCount: "2", extra: true }`:

```typescript
[
  {
    path: '$.results[0].score',
    severity: 'error',
    code: 'WRONG_TYPE',
    expected: 'number',
    received: 'string',
    receivedValue: '95',
    message: 'Expected number at $.results[0].score, received string "95"',
    llmMessage: 'The score field in the first result should be a number but was the string "95".',
  },
  {
    path: '$.results[1].title',
    severity: 'error',
    code: 'MISSING_REQUIRED',
    expected: 'string (required)',
    received: 'undefined',
    message: 'Missing required field $.results[1].title (expected string)',
    llmMessage: 'The second result is missing the required title field.',
  },
  {
    path: '$.totalCount',
    severity: 'error',
    code: 'WRONG_TYPE',
    expected: 'number',
    received: 'string',
    receivedValue: '2',
    message: 'Expected number at $.totalCount, received string "2"',
    llmMessage: 'The totalCount field should be a number but was the string "2".',
  },
  {
    path: '$.extra',
    severity: 'error',
    code: 'UNKNOWN_FIELD',
    expected: '(not present)',
    received: 'boolean',
    receivedValue: true,
    message: 'Unknown field $.extra is not defined in the schema',
    llmMessage: 'The tool returned an unexpected field "extra" that is not part of the expected output.',
  },
]
```

If coercion were enabled, the `$.results[0].score` and `$.totalCount` violations would be replaced with coercion warnings (severity `warning`, code `COERCED`), and the validated output would contain the coerced numeric values.

### LLM-Formatted Violation Summary

When the `error-result` failure strategy is used, the violations are summarized into a single LLM-readable message:

```
The tool returned invalid data with 4 issues:
1. $.results[0].score: Expected number, received string "95"
2. $.results[1].title: Missing required field (expected string)
3. $.totalCount: Expected number, received string "2"
4. $.extra: Unknown field not in the expected schema
```

This summary is concise enough to fit in the LLM's context without dominating it, but specific enough for the LLM to understand what went wrong and decide whether to retry, use alternative data, or inform the user.

---

## 11. MCP Integration

### Server-Side Output Validation

MCP servers that declare `outputSchema` on their tools are required (MUST) to return `structuredContent` conforming to that schema. `tool-output-guard` provides the validation layer that enforces this requirement.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fromMCPTool, guard } from 'tool-output-guard';

const server = new McpServer({ name: 'weather-server', version: '1.0.0' });

const weatherOutputSchema = {
  type: 'object',
  properties: {
    temperature: { type: 'number' },
    conditions: { type: 'string' },
    humidity: { type: 'number' },
  },
  required: ['temperature', 'conditions', 'humidity'],
};

// Raw tool implementation -- may return malformed data from external API
async function rawGetWeather(args: { location: string }) {
  const resp = await fetch(`https://api.weather.com/v1?loc=${args.location}`);
  return resp.json(); // Could return strings for numbers, missing fields, etc.
}

// Guard the tool output
const guardedGetWeather = guard(rawGetWeather, weatherOutputSchema, {
  onInvalid: 'coerce-and-warn',
  coercion: { stringToNumber: true },
  toolName: 'get_weather',
  onCoercion: ({ path, from, to }) => {
    console.warn(`[get_weather] Coerced ${path}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  },
});

server.tool(
  'get_weather',
  'Get current weather for a location',
  { location: { type: 'string', description: 'City name' } },
  async (args) => {
    try {
      const data = await guardedGetWeather(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        structuredContent: data,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Weather data unavailable: ${error.message}` }],
        isError: true,
      };
    }
  },
);
```

### MCP Server Middleware Pattern

For MCP servers with many tools, a middleware pattern guards all tools automatically:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { guardTools } from 'tool-output-guard';

const toolImpls = {
  get_weather: rawGetWeather,
  search_docs: rawSearchDocs,
  get_stock_price: rawGetStockPrice,
};

const outputSchemas = {
  get_weather: weatherOutputSchema,
  search_docs: searchOutputSchema,
  get_stock_price: stockOutputSchema,
};

const guardedTools = guardTools(toolImpls, outputSchemas, {
  onInvalid: 'coerce-and-warn',
  coercion: true,
  coercionFallback: 'error-result',
  onValidationFail: ({ toolName, violations }) => {
    console.error(`[${toolName}] Output validation failed:`, violations);
  },
});

// Register all guarded tools with the MCP server
for (const [name, fn] of Object.entries(guardedTools)) {
  server.tool(name, outputSchemas[name], async (args) => {
    const data = await fn(args);
    if (data && typeof data === 'object' && 'error' in data && data.error === true) {
      return { content: [{ type: 'text', text: data.message }], isError: true };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data,
    };
  });
}
```

### Extracting Guards from MCP Tool Listings

When acting as an MCP client, you can extract guards from the tool definitions returned by `tools/list` and validate tool results before passing them to the LLM:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { fromMCPTool } from 'tool-output-guard';

const client = new Client({ name: 'my-client', version: '1.0.0' });
// ... connect to server ...

const { tools } = await client.listTools();
const guards = new Map();

for (const tool of tools) {
  const toolGuard = fromMCPTool(tool);
  if (toolGuard) {
    guards.set(tool.name, toolGuard);
  }
}

// When calling a tool, validate the result
const result = await client.callTool({ name: 'get_weather', arguments: { location: 'NYC' } });

const toolGuard = guards.get('get_weather');
if (toolGuard && result.structuredContent) {
  const validated = toolGuard.validate(result.structuredContent);
  if (!validated.success) {
    console.warn('Tool output does not match declared outputSchema:', validated.violations);
  }
}
```

---

## 12. Integration

### With tool-call-retry

`tool-call-retry` handles execution failures (network errors, timeouts, rate limits). `tool-output-guard` handles data quality failures (malformed output). The two compose by wrapping the tool with retry first, then guarding the output:

```typescript
import { withRetry } from 'tool-call-retry';
import { guard } from 'tool-output-guard';
import { z } from 'zod';

const schema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string().url() })),
  totalCount: z.number().int().nonneg(),
});

// 1. Wrap with retry for execution resilience
const resilientSearch = withRetry(rawSearchFn, {
  maxRetries: 3,
  circuitBreaker: { failureThreshold: 5 },
});

// 2. Guard the output for data quality
const guardedSearch = guard(resilientSearch, schema, {
  onInvalid: 'coerce-and-warn',
  coercion: true,
});

// guardedSearch: retries on failure, validates on success
const results = await guardedSearch({ query: 'TypeScript' });
```

### With OpenAI Function Calling

```typescript
import { guardTools } from 'tool-output-guard';
import { z } from 'zod';
import OpenAI from 'openai';

const openai = new OpenAI();

const tools = guardTools(
  { get_weather: rawGetWeather, search_web: rawSearchWeb },
  {
    get_weather: z.object({ temperature: z.number(), conditions: z.string() }),
    search_web: z.object({ results: z.array(z.string()), total: z.number() }),
  },
  { onInvalid: 'error-result', coercion: true },
);

// In the tool execution loop
for (const toolCall of response.choices[0].message.tool_calls) {
  const fn = tools[toolCall.function.name];
  const args = JSON.parse(toolCall.function.arguments);
  const result = await fn(args);

  // result is guaranteed valid or is an LLMValidationError
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  });
}
```

### With Anthropic Tool Use

```typescript
import { guard } from 'tool-output-guard';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

const searchTool = guard(rawSearchFn, z.object({
  results: z.array(z.object({ title: z.string(), snippet: z.string() })),
}), {
  onInvalid: 'error-result',
  coercion: true,
});

// In the tool execution loop
for (const block of response.content) {
  if (block.type === 'tool_use') {
    const result = await searchTool(block.input);

    if (result && typeof result === 'object' && 'error' in result) {
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.message,
        is_error: true,
      });
    } else {
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
  }
}
```

### With Vercel AI SDK

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { guard } from 'tool-output-guard';

const WeatherSchema = z.object({
  temperature: z.number(),
  conditions: z.string(),
});

const weatherTool = tool({
  description: 'Get current weather for a location',
  parameters: z.object({ location: z.string() }),
  execute: guard(
    async ({ location }) => {
      const resp = await fetch(`https://api.weather.com/v1?loc=${location}`);
      return resp.json();
    },
    WeatherSchema,
    { onInvalid: 'coerce-and-warn', coercion: true },
  ),
});
```

### With llm-retry

`llm-retry` retries the LLM call itself when the model's output fails validation. `tool-output-guard` validates tool output before it reaches the model. The two operate at different layers and compose naturally: `tool-output-guard` ensures the LLM receives clean tool data, and `llm-retry` ensures the application receives clean LLM output.

---

## 13. Configuration

### Default Values

| Option | Default | Description |
|---|---|---|
| `onInvalid` | `'throw'` | Failure strategy: `'throw'`, `'fallback'`, `'error-result'`, `'coerce-and-warn'`, `'strip-extra'`. |
| `coercion` | `false` | Enable type coercion before validation. `true`, `false`, or `CoercionConfig`. |
| `coercionFallback` | `'throw'` | Secondary strategy when coercion cannot resolve all violations. |
| `fallbackValue` | `undefined` | Fallback value for `'fallback'` strategy. Required when strategy is `'fallback'`. |
| `toolName` | `undefined` | Tool name for error messages, events, and diagnostics. |
| `fieldStrategies` | `{}` | Per-field failure strategy overrides. |
| `fieldFallbacks` | `{}` | Per-field fallback values. |
| `jsonSchemaValidator` | built-in | Custom JSON Schema validator function. |
| `onValidationPass` | `undefined` | Event hook for successful validation. |
| `onValidationFail` | `undefined` | Event hook for failed validation. |
| `onCoercion` | `undefined` | Event hook for each coerced field. |

### Coercion Defaults (when `coercion: true`)

| Rule | Default |
|---|---|
| `stringToNumber` | `true` |
| `stringToBoolean` | `true` |
| `stringToJson` | `true` |
| `numberToString` | `true` |
| `nullToDefault` | `true` |

### Configuration Validation

All options are validated when `guard`, `createGuard`, `guardTools`, or `fromMCPTool` is called. Invalid values throw synchronous `TypeError` with actionable messages:

| Rule | Error |
|---|---|
| `onInvalid` must be a valid strategy | `TypeError: onInvalid must be one of 'throw', 'fallback', 'error-result', 'coerce-and-warn', 'strip-extra', received 'invalid'` |
| `fallbackValue` required when strategy is `'fallback'` | `TypeError: fallbackValue is required when onInvalid is 'fallback'` |
| `fallbackValue` must pass schema validation | `TypeError: fallbackValue does not conform to the schema: Expected number at $.temperature` |
| Schema must be a recognized format | `TypeError: schema must be a Zod schema, JSON Schema object, or TypeBox schema` |
| `fieldStrategies` keys must be valid JSON paths | `TypeError: fieldStrategies key 'temperature' is not a valid JSON path (must start with '$.')` |
| `jsonSchemaValidator` must be a function | `TypeError: jsonSchemaValidator must be a function` |

### Configuration Priority (guardTools)

Options are resolved in this order (highest priority first):

1. **Per-tool explicit options** (`toolOptions.weather.coercion`)
2. **Global explicit options** (`coercion` at the top level)
3. **Package defaults** (`onInvalid: 'throw'`, `coercion: false`, etc.)

---

## 14. Testing Strategy

### Unit Tests

**Schema detection tests:** Zod schema detected by `_def` and `safeParse`. JSON Schema detected by `type` property. TypeBox schema detected by `Kind` symbol. Unknown schema type throws `TypeError`. Schema with both Zod markers and JSON Schema `type` property: Zod takes precedence.

**Zod validation tests:** Valid data passes. Wrong type fails with `WRONG_TYPE` code. Missing required field fails with `MISSING_REQUIRED` code. Extra field detection with strict mode. Nested object validation. Array element validation. Zod refinements respected (`.min()`, `.max()`, `.email()`, `.url()`). Zod enums respected. Zod unions respected. Violation paths correct for nested fields.

**JSON Schema validation tests:** Each supported JSON Schema keyword tested independently: `type` (all seven types), `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `minimum`/`maximum`, `minLength`/`maxLength`, `pattern`, `format`, `anyOf`/`oneOf`/`allOf`, `not`, `$ref`. Combined keywords tested. Draft-07 and draft-2020-12 keywords both accepted. Violations include correct paths and messages.

**Coercion tests:** Each coercion rule tested independently: string-to-number (integers, floats, negative, scientific notation, non-numeric strings rejected), string-to-boolean ("true", "false", "TRUE", "FALSE", other strings rejected), string-to-array (valid JSON arrays, invalid JSON rejected), string-to-object (valid JSON objects, invalid JSON rejected), number-to-string, null-to-default. Coercion disabled by default: no coercion applied. Coercion enabled: coercion applied before validation. Per-rule coercion config: only enabled rules applied. Recursive coercion: nested objects and array elements coerced. Coercion warnings recorded.

**Failure strategy tests:** `throw`: `ValidationError` thrown with correct `violations` and `message`. `fallback`: fallback value returned on failure, fallback validated at creation time. `error-result`: `LLMValidationError` returned with correct structure. `coerce-and-warn`: coercible violations resolved, non-coercible fall through to secondary strategy. `strip-extra`: unknown fields removed, known valid fields preserved, known invalid fields handled by global strategy. Per-field strategies: field-level strategy overrides global.

**Violation report tests:** Path correctness for root fields, nested fields, array elements, deeply nested paths. Expected and received type descriptions accurate. Received value truncated for large values. LLM message is concise and actionable. Machine-readable codes match the violation type.

### Integration Tests

**guard function tests:** Wrap a mock tool function. Valid output: passes through unchanged, `onValidationPass` called. Invalid output with `throw`: `ValidationError` thrown, `onValidationFail` called. Invalid output with `coerce-and-warn`: coerced value returned, `onCoercion` called per field. Invalid output with `fallback`: fallback value returned. Tool function that throws: error propagates (not caught by guard). Return type is correctly typed via TypeScript.

**guardTools function tests:** Wrap multiple tools with different schemas. Each tool validated against its own schema. Per-tool options override global options. Tool with no matching schema: tool passes through unguarded.

**createGuard factory tests:** Guard instance `validate` method works standalone. Guard instance `wrap` method wraps a function. Same guard instance applied to multiple functions.

**fromMCPTool tests:** Tool with `outputSchema`: guard created. Tool without `outputSchema`: returns null. Tool with complex `outputSchema` (nested objects, arrays, `$ref`): guard validates correctly.

**Custom JSON Schema validator tests:** Custom validator called instead of built-in. Custom validator errors mapped to `Violation` objects.

### Edge Cases

- Tool function returns `undefined` -- treated as missing output, validated against schema.
- Tool function returns `null` -- validated as `null` type.
- Tool function returns a primitive (string, number) -- validated against schema.
- Schema expects an object but tool returns an array (or vice versa) -- `WRONG_TYPE` violation.
- Empty object `{}` with required fields -- `MISSING_REQUIRED` for each required field.
- Deeply nested objects (10+ levels) -- paths correct, performance acceptable.
- Very large array (1000+ elements) -- validation completes without memory issues, performance logged.
- Circular references in tool output -- detected and reported as a violation (not infinite loop).
- Schema with no required fields and no type constraints -- everything passes.
- `fallbackValue` that does not match schema -- `TypeError` at creation time.
- `coercion: true` with a Zod schema that uses `.transform()` -- coercion runs first, then Zod transform runs during validation.

### Test Organization

```
src/__tests__/
  detection/
    schema-detection.test.ts            -- Auto-detection of schema types
  validation/
    zod-validation.test.ts              -- Zod schema validation
    json-schema-validation.test.ts      -- JSON Schema validation
    typebox-validation.test.ts          -- TypeBox schema validation
    custom-validator.test.ts            -- Custom JSON Schema validator
  coercion/
    string-to-number.test.ts            -- String-to-number coercion
    string-to-boolean.test.ts           -- String-to-boolean coercion
    string-to-json.test.ts              -- String-to-array/object coercion
    number-to-string.test.ts            -- Number-to-string coercion
    null-to-default.test.ts             -- Null-to-default coercion
    recursive.test.ts                   -- Recursive coercion in nested structures
    config.test.ts                      -- Per-rule coercion configuration
  strategies/
    throw.test.ts                       -- Throw strategy
    fallback.test.ts                    -- Fallback strategy
    error-result.test.ts                -- Error-result strategy
    coerce-and-warn.test.ts             -- Coerce-and-warn strategy
    strip-extra.test.ts                 -- Strip-extra strategy
    field-strategies.test.ts            -- Per-field strategies
  violations/
    paths.test.ts                       -- JSON path correctness
    messages.test.ts                    -- Human and LLM message formatting
    codes.test.ts                       -- Violation codes
  integration/
    guard.test.ts                       -- guard function end-to-end
    guard-tools.test.ts                 -- guardTools function end-to-end
    create-guard.test.ts                -- createGuard factory end-to-end
    from-mcp-tool.test.ts              -- fromMCPTool function end-to-end
    tool-call-retry-compose.test.ts     -- Composition with tool-call-retry
    openai.test.ts                      -- OpenAI function calling pattern
    anthropic.test.ts                   -- Anthropic tool use pattern
    mcp-server.test.ts                  -- MCP server integration
  fixtures/
    mock-tools.ts                       -- Mock tool functions
    mock-schemas.ts                     -- Mock schemas (Zod, JSON Schema, TypeBox)
```

### Test Runner

`vitest` (configured in `package.json`).

---

## 15. Performance

### Validation Overhead (Successful Call, Valid Output)

When a tool call succeeds and the output is valid, the guard adds:

1. **Schema type detection**: One property check (cached after first call) (~1 microsecond).
2. **Zod validation** (`safeParse`): Zod's `safeParse` for a typical 10-field object takes 10-50 microseconds. Zod is not the fastest validator, but for tool outputs (validated once per tool call, not in a hot loop), this is negligible.
3. **JSON Schema validation** (built-in validator): The built-in validator for a typical 10-field object takes 5-20 microseconds. It does not compile schemas to functions like `ajv` does, but for the small schemas typical of tool outputs, the difference is immaterial.
4. **Event hook invocation**: One function call (~1 microsecond).

**Total overhead for a valid output**: approximately 10-60 microseconds. This is negligible compared to any tool function that makes a network request (milliseconds to seconds).

### Validation Overhead (Invalid Output)

When validation fails:

1. **Validation**: Same as above (10-60 microseconds).
2. **Violation construction**: Creating `Violation` objects for each invalid field (~2-5 microseconds per violation).
3. **Failure strategy application**: `throw` (~5 microseconds for error construction), `fallback` (~1 microsecond for value return), `error-result` (~10 microseconds for LLM message formatting).

**Total overhead for an invalid output**: approximately 20-100 microseconds. Dominated by string formatting for violation messages.

### Coercion Overhead

When coercion is enabled:

1. **Recursive tree walk**: Walking the output object and comparing types against the schema (~5-20 microseconds for a 10-field object).
2. **Type conversion**: `Number()`, `String()`, `JSON.parse()` -- each conversion is sub-microsecond.
3. **Warning construction**: Creating `Violation` objects for coerced fields (~2-5 microseconds per coercion).

**Total coercion overhead**: approximately 10-30 microseconds. The tree walk is the dominant cost.

### Memory

The guard maintains no per-invocation state between calls. Each validation creates a `Violation[]` array (typically 0-5 elements) and, on success, returns the original value or a coerced copy. No caching, no pooling, no accumulation. Memory per guard instance: the schema reference and options object, approximately 100-500 bytes.

### Comparison to Not Validating

The alternative to `tool-output-guard` is not validating tool output, which costs zero microseconds at the tool boundary but costs tokens, latency, and reliability when the LLM receives malformed data. A single agent loop iteration caused by malformed tool output (LLM retries the tool call) costs 500-5000 tokens and 1-10 seconds of latency. A 50-microsecond validation that prevents that loop pays for itself by a factor of 10,000 or more.

---

## 16. Dependencies

### Runtime Dependencies

None. `tool-output-guard` has zero mandatory runtime dependencies.

| API | Purpose |
|---|---|
| `JSON.parse()`, `JSON.stringify()` | Coercion of string-encoded JSON values, violation message formatting |
| `typeof`, `Array.isArray()` | Type detection for coercion and validation |
| `Number()`, `String()`, `Boolean()` | Type coercion |
| `RegExp` | Pattern matching for JSON Schema `pattern` and `format` keywords |
| `Symbol.for()` | TypeBox schema detection |

### Peer Dependencies

| Package | Version | Required | Purpose |
|---|---|---|---|
| `zod` | `^3.0.0` | Optional | Required only when using Zod schemas. If only JSON Schema or TypeBox schemas are used, `zod` is not needed at runtime. The package detects whether `zod` is installed and skips Zod-specific code paths if it is not. |

### Development Dependencies

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `eslint` | Linting |
| `@types/node` | Node.js type definitions |
| `zod` | Zod schemas (used in tests) |
| `@sinclair/typebox` | TypeBox schemas (used in tests) |

### Why Minimal Dependencies

The package performs three categories of operations: type detection (typeof checks, property existence checks), data traversal (recursive object/array walking), and string formatting (violation messages). All three are trivially implementable with built-in JavaScript APIs. The built-in JSON Schema validator supports the practically-used subset of JSON Schema without requiring `ajv` (150+ KB minified with its own dependency tree). `zod` is a peer dependency because it is the caller's schema library, not the package's -- and it is optional for callers who only use JSON Schema.

---

## 17. File Structure

```
tool-output-guard/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                            -- Public API exports
    types.ts                            -- All TypeScript type definitions
    guard.ts                            -- guard() function implementation
    validate.ts                         -- validate() function implementation
    guard-tools.ts                      -- guardTools() function implementation
    create-guard.ts                     -- createGuard() factory implementation
    from-mcp-tool.ts                    -- fromMCPTool() function implementation
    detection/
      index.ts                          -- Schema type auto-detection
      zod.ts                            -- Zod schema detection and validation bridge
      json-schema.ts                    -- JSON Schema detection
      typebox.ts                        -- TypeBox schema detection
    validation/
      index.ts                          -- Unified validation dispatcher
      zod-validator.ts                  -- Zod schema validation (safeParse wrapper)
      json-schema-validator.ts          -- Built-in JSON Schema validator
    coercion/
      index.ts                          -- Coercion pipeline orchestration
      rules.ts                          -- Individual coercion rules (string→number, etc.)
      walker.ts                         -- Recursive schema-aware object walker
    strategies/
      index.ts                          -- Failure strategy dispatcher
      throw.ts                          -- Throw strategy implementation
      fallback.ts                       -- Fallback strategy implementation
      error-result.ts                   -- Error-result strategy implementation
      coerce-and-warn.ts                -- Coerce-and-warn strategy implementation
      strip-extra.ts                    -- Strip-extra strategy implementation
    violations/
      builder.ts                        -- Violation object construction
      paths.ts                          -- JSON path utilities
      messages.ts                       -- Human-readable and LLM-readable message formatting
  src/__tests__/
    detection/
      schema-detection.test.ts
    validation/
      zod-validation.test.ts
      json-schema-validation.test.ts
      typebox-validation.test.ts
      custom-validator.test.ts
    coercion/
      string-to-number.test.ts
      string-to-boolean.test.ts
      string-to-json.test.ts
      number-to-string.test.ts
      null-to-default.test.ts
      recursive.test.ts
      config.test.ts
    strategies/
      throw.test.ts
      fallback.test.ts
      error-result.test.ts
      coerce-and-warn.test.ts
      strip-extra.test.ts
      field-strategies.test.ts
    violations/
      paths.test.ts
      messages.test.ts
      codes.test.ts
    integration/
      guard.test.ts
      guard-tools.test.ts
      create-guard.test.ts
      from-mcp-tool.test.ts
      tool-call-retry-compose.test.ts
      openai.test.ts
      anthropic.test.ts
      mcp-server.test.ts
    fixtures/
      mock-tools.ts
      mock-schemas.ts
  dist/                                 -- Compiled output (generated by tsc)
```

---

## 18. Implementation Roadmap

### Phase 1: Core Validation and Guard (v0.1.0)

Implement the foundation: schema detection, validation, and the `guard` function.

1. **Types**: Define all TypeScript types in `types.ts` -- `ValidationResult`, `Violation`, `ViolationCode`, `ViolationSeverity`, `GuardOptions`, `FailureStrategy`, `CoercionConfig`, `ValidationError`, `LLMValidationError`, `Guard`.
2. **Schema detection**: Implement auto-detection for Zod, JSON Schema, and TypeBox schemas. Detect once at guard creation time, cache the result.
3. **Zod validator**: Implement the Zod validation bridge that calls `safeParse` and maps Zod error issues to `Violation` objects with correct paths, codes, and messages.
4. **JSON Schema validator**: Implement the built-in JSON Schema validator supporting `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `minimum`/`maximum`, `minLength`/`maxLength`, `pattern`, `anyOf`/`oneOf`/`allOf`, `not`, `$ref`.
5. **Violation builder**: Implement `Violation` object construction with JSON path utilities, human-readable messages, and LLM-readable messages.
6. **validate function**: Implement the standalone `validate(value, schema, options?)` function.
7. **guard function**: Implement the `guard(toolFn, schema, options?)` wrapper with the `throw` failure strategy.
8. **Tests**: Full test suite for schema detection, Zod validation, JSON Schema validation, and the guard function with `throw` strategy.

### Phase 2: Failure Strategies (v0.2.0)

Add all failure strategies.

1. **Fallback strategy**: Implement fallback value validation at creation time and return on failure.
2. **Error-result strategy**: Implement `LLMValidationError` construction with violation summary formatting.
3. **Strip-extra strategy**: Implement unknown field detection and removal.
4. **Per-field strategies**: Implement field-level strategy overrides with JSON path matching.
5. **Tests**: Strategy-specific tests, per-field strategy tests.

### Phase 3: Type Coercion (v0.3.0)

Add the coercion pipeline.

1. **Coercion rules**: Implement each coercion rule (string-to-number, string-to-boolean, string-to-JSON, number-to-string, null-to-default) as independent, testable functions.
2. **Schema-aware walker**: Implement recursive object traversal that compares each value against the schema's expected type and applies applicable coercion rules.
3. **Coercion warnings**: Record each coercion as a `warning` violation.
4. **Coerce-and-warn strategy**: Implement the strategy that runs coercion, re-validates, and falls through to a secondary strategy if violations remain.
5. **CoercionConfig**: Implement per-rule enable/disable configuration.
6. **Tests**: Per-rule coercion tests, recursive coercion tests, configuration tests, integration with guard function.

### Phase 4: Batch Wrapper, Factory, and MCP Integration (v0.4.0)

Add `guardTools`, `createGuard`, and `fromMCPTool`.

1. **guardTools function**: Implement batch wrapping with global defaults and per-tool overrides. Schema map validation: every tool must have a matching schema entry.
2. **createGuard factory**: Implement the reusable guard instance with `validate` and `wrap` methods.
3. **fromMCPTool function**: Implement `outputSchema` extraction from MCP tool definitions. Handle missing `outputSchema` (return null).
4. **Event hooks**: Implement `onValidationPass`, `onValidationFail`, `onCoercion` hooks across all functions.
5. **Tests**: guardTools integration tests, createGuard tests, fromMCPTool tests, event hook tests.

### Phase 5: Polish and Production Readiness (v1.0.0)

Harden for production use.

1. **Configuration validation**: Validate all options at creation time with clear `TypeError` messages.
2. **Edge case hardening**: Test with `undefined`, `null`, primitives, circular references, very large objects, deeply nested structures, empty schemas.
3. **Custom JSON Schema validator support**: Implement the `jsonSchemaValidator` option for plugging in `ajv` or other validators.
4. **Performance profiling**: Benchmark validation overhead for typical tool outputs. Verify sub-millisecond overhead.
5. **TypeBox integration tests**: Verify TypeBox schemas work end-to-end with static type inference.
6. **Documentation**: Comprehensive README with installation, quick start, configuration reference, integration examples, and troubleshooting guide.

---

## 19. Example Use Cases

### Guarding an MCP Weather Tool

An MCP server exposes a `get_weather` tool that calls an external weather API. The API sometimes returns temperatures as strings and occasionally omits the humidity field. Without output validation, the LLM receives `{ temperature: "72", conditions: "sunny" }` and may misinterpret the string temperature or fail to notice the missing humidity.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { guard } from 'tool-output-guard';

const weatherOutputSchema = {
  type: 'object',
  properties: {
    temperature: { type: 'number' },
    conditions: { type: 'string' },
    humidity: { type: 'number' },
  },
  required: ['temperature', 'conditions', 'humidity'],
};

const guardedWeather = guard(
  async (args: { location: string }) => {
    const resp = await fetch(`https://api.weather.com/v1?loc=${args.location}`);
    return resp.json();
  },
  weatherOutputSchema,
  {
    onInvalid: 'coerce-and-warn',
    coercion: { stringToNumber: true },
    coercionFallback: 'error-result',
    toolName: 'get_weather',
  },
);

const server = new McpServer({ name: 'weather-server', version: '1.0.0' });

server.tool('get_weather', weatherOutputSchema, async (args) => {
  const result = await guardedWeather(args);

  if (result && typeof result === 'object' && 'error' in result) {
    return { content: [{ type: 'text', text: result.message }], isError: true };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
});
```

With the guard, the string `"72"` is coerced to number `72`, and the missing humidity field triggers an `error-result` response that tells the LLM: "The weather tool returned incomplete data -- the humidity field is missing."

### Preventing Agent Loops with OpenAI Function Calling

An agent uses OpenAI function calling with a search tool. The search API occasionally returns an HTML error page (string) instead of the expected JSON object. Without output validation, the LLM receives the HTML string, cannot parse it, and calls the search tool again with the same arguments, entering an infinite loop.

```typescript
import { guardTools } from 'tool-output-guard';
import { z } from 'zod';

const searchSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
  })),
  totalCount: z.number(),
});

const tools = guardTools(
  { search: rawSearchFn },
  { search: searchSchema },
  {
    onInvalid: 'error-result',
    toolName: 'search',
  },
);

// When the search API returns an HTML error page:
// Instead of the LLM seeing "<html><body>503 Service Unavailable</body></html>"
// and trying to call search again, it sees:
// {
//   error: true,
//   code: 'INVALID_TOOL_OUTPUT',
//   message: 'The search tool returned data that does not match the expected format.
//             Expected an object with results array and totalCount number,
//             but received a string.',
//   suggestion: 'The search tool may be experiencing issues. Try an alternative
//                approach or inform the user that search is currently unavailable.'
// }
//
// The LLM can now reason about the failure and decide to:
// 1. Inform the user that search is unavailable
// 2. Try a different search query
// 3. Use a different tool to find the information
```

### Batch Validation for a Multi-Tool Agent

An agent has five tools that each call different external services. Each service has its own quirks: one returns all values as strings, one includes debug metadata the LLM should not see, one occasionally returns `null` for optional fields that have defaults.

```typescript
import { guardTools } from 'tool-output-guard';
import { z } from 'zod';

const schemas = {
  weather: z.object({ temp: z.number(), conditions: z.string() }),
  stocks: z.object({ price: z.number(), change: z.number(), symbol: z.string() }),
  news: z.object({ articles: z.array(z.object({ title: z.string(), summary: z.string() })) }),
  calculator: z.object({ result: z.number(), expression: z.string() }),
  translate: z.object({ translated: z.string(), sourceLang: z.string(), targetLang: z.string() }),
};

const guardedTools = guardTools(rawTools, schemas, {
  onInvalid: 'coerce-and-warn',
  coercion: true,
  coercionFallback: 'error-result',
  toolOptions: {
    stocks: {
      // Stock API returns everything as strings
      coercion: { stringToNumber: true, stringToBoolean: false },
    },
    news: {
      // News API includes internal debug fields
      onInvalid: 'strip-extra',
    },
    calculator: {
      // Calculator should never fail validation
      onInvalid: 'throw',
      coercion: false,
    },
  },
  onValidationFail: ({ toolName, violations }) => {
    metrics.increment('tool_output_validation_failure', { tool: toolName });
    logger.warn(`Tool output validation failed for ${toolName}`, { violations });
  },
  onCoercion: ({ toolName, path, from, to }) => {
    metrics.increment('tool_output_coercion', { tool: toolName, path });
  },
});
```

### Validating Third-Party MCP Server Tool Output

A client application connects to an MCP server it does not control. The server declares `outputSchema` on its tools, but the client wants to verify that the server actually conforms to its own schema before trusting the data.

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { fromMCPTool, validate } from 'tool-output-guard';

const client = new Client({ name: 'paranoid-client', version: '1.0.0' });
// ... connect to untrusted MCP server ...

const { tools } = await client.listTools();

// Build guards from the server's declared output schemas
const guards = new Map<string, ReturnType<typeof fromMCPTool>>();
for (const tool of tools) {
  guards.set(tool.name, fromMCPTool(tool));
}

// Call a tool and validate the result
const result = await client.callTool({ name: 'query_database', arguments: { sql: 'SELECT * FROM users LIMIT 10' } });

const toolGuard = guards.get('query_database');
if (toolGuard && result.structuredContent) {
  const validated = toolGuard.validate(result.structuredContent);
  if (validated.success) {
    // Safe to use validated.data -- it conforms to the declared schema
    processQueryResults(validated.data);
  } else {
    // Server violated its own schema contract
    console.error('MCP server returned invalid tool output:', validated.violations);
    // Fall back to treating the content as unstructured text
    processUnstructuredContent(result.content);
  }
}
```
