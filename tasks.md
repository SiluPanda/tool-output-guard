# tool-output-guard -- Implementation Tasks

This file tracks all implementation tasks derived from SPEC.md. Each task is granular, actionable, and grouped by logical phase.

---

## Phase 1: Project Setup and Scaffolding

- [x] **1.1 Install dev dependencies** -- Add `typescript`, `vitest`, `eslint`, `@types/node`, `zod`, and `@sinclair/typebox` as dev dependencies. Configure `zod` as an optional peer dependency (`^3.0.0`). | Status: done
- [x] **1.2 Configure vitest** -- Add vitest configuration (either in `vitest.config.ts` or within `package.json`). Ensure test runner discovers files matching `src/__tests__/**/*.test.ts`. | Status: done
- [x] **1.3 Configure eslint** -- Set up eslint with TypeScript support. Ensure `npm run lint` works against `src/`. | Status: done
- [x] **1.4 Create source directory structure** -- Create all directories specified in section 17 of the spec: `src/detection/`, `src/validation/`, `src/coercion/`, `src/strategies/`, `src/violations/`, and `src/__tests__/` with its subdirectories (`detection/`, `validation/`, `coercion/`, `strategies/`, `violations/`, `integration/`, `fixtures/`). | Status: done
- [x] **1.5 Create placeholder source files** -- Create empty/stub files for all source modules listed in section 17: `types.ts`, `guard.ts`, `validate.ts`, `guard-tools.ts`, `create-guard.ts`, `from-mcp-tool.ts`, and all subdirectory `index.ts` files. This ensures imports resolve from day one. | Status: done
- [x] **1.6 Verify build pipeline** -- Run `npm run build` (tsc) and ensure it compiles successfully with the empty stubs. Fix any tsconfig issues. | Status: done

---

## Phase 2: Type Definitions (`src/types.ts`)

- [x] **2.1 Define `ViolationSeverity` type** -- `type ViolationSeverity = 'error' | 'warning'` as specified in section 9. | Status: done
- [x] **2.2 Define `ViolationCode` type** -- `type ViolationCode = 'WRONG_TYPE' | 'MISSING_REQUIRED' | 'UNKNOWN_FIELD' | 'CONSTRAINT_VIOLATION' | 'ENUM_MISMATCH' | 'PATTERN_MISMATCH' | 'COERCED'` as specified in section 9. | Status: done
- [x] **2.3 Define `Violation` interface** -- Include all fields: `path`, `severity`, `code`, `expected`, `received`, `receivedValue?`, `coercedValue?`, `message`, `llmMessage` as specified in section 9. | Status: done
- [x] **2.4 Define `ValidationResult<T>` discriminated union** -- Success case: `{ success: true; data: T; warnings: Violation[] }`. Failure case: `{ success: false; violations: Violation[] }`. | Status: done
- [x] **2.5 Define `ValidationError` class** -- Extends `Error` with `violations: Violation[]`, `toolName?: string`, and formatted `message` summarizing violations. | Status: done
- [x] **2.6 Define `LLMValidationError` interface** -- `{ error: true; code: 'INVALID_TOOL_OUTPUT'; message: string; violations: Array<{ path: string; message: string }>; suggestion: string }`. | Status: done
- [x] **2.7 Define `FailureStrategy` type** -- `'throw' | 'fallback' | 'error-result' | 'coerce-and-warn' | 'strip-extra'`. | Status: done
- [x] **2.8 Define `CoercionConfig` interface** -- `{ stringToNumber: boolean; stringToBoolean: boolean; stringToJson: boolean; numberToString: boolean; nullToDefault: boolean }`. | Status: done
- [x] **2.9 Define `GuardOptions<T>` interface** -- Include all fields from section 9: `onInvalid`, `fallbackValue`, `coercionFallback`, `coercion`, `fieldStrategies`, `fieldFallbacks`, `jsonSchemaValidator`, `toolName`, `onValidationPass`, `onValidationFail`, `onCoercion`. | Status: done
- [x] **2.10 Define `Guard<T>` interface** -- `{ validate(value: unknown): ValidationResult<T>; wrap<TArgs>(toolFn): (args: TArgs) => Promise<T>; readonly schema: unknown; readonly options: GuardOptions<T> }`. | Status: done
- [x] **2.11 Define `GuardToolsOptions<T>` interface** -- Extends `GuardOptions<T>` with `toolOptions?: Record<string, Partial<GuardOptions>>`. | Status: done
- [x] **2.12 Define helper types for schema inputs** -- Type aliases or generic types for `ZodSchema`, `JSONSchema`, `TypeBoxSchema` to use in function signatures. | Status: done
- [x] **2.13 Export all types from `src/types.ts`** -- Ensure all types are exported and re-exported from `src/index.ts`. | Status: done

---

## Phase 3: Schema Detection (`src/detection/`)

- [x] **3.1 Implement Zod schema detection (`src/detection/zod.ts`)** -- Detect Zod schemas by checking for `_def` property and `safeParse` method. Export an `isZodSchema(schema: unknown): boolean` function. | Status: done
- [x] **3.2 Implement JSON Schema detection (`src/detection/json-schema.ts`)** -- Detect JSON Schema objects by checking for `type` property or `$schema` property. Export an `isJSONSchema(schema: unknown): boolean` function. | Status: done
- [x] **3.3 Implement TypeBox schema detection (`src/detection/typebox.ts`)** -- Detect TypeBox schemas by checking for `Symbol.for('TypeBox.Kind')` symbol property. Export an `isTypeBoxSchema(schema: unknown): boolean` function. | Status: done
- [x] **3.4 Implement unified detection dispatcher (`src/detection/index.ts`)** -- Export a `detectSchema(schema: unknown)` function that returns a discriminated result indicating the schema type (`'zod' | 'json-schema' | 'typebox'`). Priority order: Zod first, then TypeBox, then JSON Schema. Throw `TypeError` if no format matches. Detection is performed once and cached. | Status: done
- [x] **3.5 Write schema detection tests (`src/__tests__/detection/schema-detection.test.ts`)** -- Test: Zod schema detected by `_def` and `safeParse`. JSON Schema detected by `type` property. JSON Schema detected by `$schema` property. TypeBox detected by `Kind` symbol. Unknown schema throws `TypeError`. Schema with both Zod markers and JSON Schema `type`: Zod takes precedence. | Status: done

---

## Phase 4: Violation Infrastructure (`src/violations/`)

- [ ] **4.1 Implement JSON path utilities (`src/violations/paths.ts`)** -- Utility functions: build path strings (`$.address.city`, `$.results[0].score`), append property key to path, append array index to path. Root is `$`. Object keys use dot notation, array indices use bracket notation. | Status: not_done
- [ ] **4.2 Implement violation builder (`src/violations/builder.ts`)** -- Factory function to create `Violation` objects. Accept parameters for all fields. Truncate `receivedValue` to 200 characters for large values (strings, serialized objects). | Status: not_done
- [ ] **4.3 Implement message formatting (`src/violations/messages.ts`)** -- Generate human-readable `message` strings (e.g., `Expected number at $.temperature, received string "72"`). Generate LLM-readable `llmMessage` strings (shorter, action-oriented). Generate LLM-formatted violation summaries for the `error-result` strategy. | Status: not_done
- [ ] **4.4 Write violation path tests (`src/__tests__/violations/paths.test.ts`)** -- Test path correctness for: root fields, nested fields, array elements, deeply nested paths (10+ levels). | Status: not_done
- [ ] **4.5 Write violation message tests (`src/__tests__/violations/messages.test.ts`)** -- Test human-readable message formatting. Test LLM-readable message formatting. Test violation summary formatting. | Status: not_done
- [ ] **4.6 Write violation code tests (`src/__tests__/violations/codes.test.ts`)** -- Test that each violation type maps to the correct `ViolationCode`: `WRONG_TYPE`, `MISSING_REQUIRED`, `UNKNOWN_FIELD`, `CONSTRAINT_VIOLATION`, `ENUM_MISMATCH`, `PATTERN_MISMATCH`, `COERCED`. | Status: not_done

---

## Phase 5: Zod Validation (`src/validation/zod-validator.ts`)

- [ ] **5.1 Implement Zod validation bridge** -- Call `schema.safeParse(value)`. Map Zod error issues to `Violation` objects with correct `path`, `code`, `expected`, `received`, `receivedValue`, `message`, and `llmMessage`. | Status: not_done
- [ ] **5.2 Map Zod error codes to ViolationCodes** -- Map Zod's `invalid_type` to `WRONG_TYPE`, `invalid_enum_value` to `ENUM_MISMATCH`, custom refinements to `CONSTRAINT_VIOLATION`, etc. | Status: not_done
- [ ] **5.3 Handle Zod path format** -- Convert Zod's path format (array of strings/numbers) to JSON path string format (`$.field.nested[0]`). | Status: not_done
- [ ] **5.4 Write Zod validation tests (`src/__tests__/validation/zod-validation.test.ts`)** -- Test: valid data passes, wrong type fails with `WRONG_TYPE`, missing required field fails with `MISSING_REQUIRED`, extra field detection with strict mode, nested object validation, array element validation, Zod refinements (`.min()`, `.max()`, `.email()`, `.url()`), Zod enums, Zod unions, violation paths correct for nested fields. | Status: not_done

---

## Phase 6: Built-in JSON Schema Validator (`src/validation/json-schema-validator.ts`)

- [ ] **6.1 Implement `type` keyword validation** -- Support all seven JSON Schema types: `string`, `number`, `integer`, `boolean`, `null`, `object`, `array`. | Status: not_done
- [ ] **6.2 Implement `properties` and `required` keywords** -- Validate object properties against their sub-schemas. Report `MISSING_REQUIRED` for missing required fields. | Status: not_done
- [ ] **6.3 Implement `additionalProperties` keyword** -- When `additionalProperties: false`, report `UNKNOWN_FIELD` for properties not listed in `properties`. When `additionalProperties` is a schema, validate additional properties against that schema. | Status: not_done
- [ ] **6.4 Implement `items` keyword** -- Support single-schema items (all array elements validated against one schema) and tuple validation (each element validated against its positional schema). | Status: not_done
- [ ] **6.5 Implement `minItems` / `maxItems` keywords** -- Validate array length constraints. | Status: not_done
- [ ] **6.6 Implement `enum` and `const` keywords** -- Validate value is one of the allowed enum values. Validate value equals the const value. Report `ENUM_MISMATCH` on failure. | Status: not_done
- [ ] **6.7 Implement `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` keywords** -- Validate numeric range constraints. Report `CONSTRAINT_VIOLATION` on failure. | Status: not_done
- [ ] **6.8 Implement `multipleOf` keyword** -- Validate that a number is a multiple of the given value. | Status: not_done
- [ ] **6.9 Implement `minLength` / `maxLength` keywords** -- Validate string length constraints. Report `CONSTRAINT_VIOLATION` on failure. | Status: not_done
- [ ] **6.10 Implement `pattern` keyword** -- Validate string matches the given regex pattern. Report `PATTERN_MISMATCH` on failure. | Status: not_done
- [ ] **6.11 Implement `format` keyword** -- Validate format hints: `date-time`, `email`, `uri` using regex patterns. | Status: not_done
- [ ] **6.12 Implement `anyOf` / `oneOf` / `allOf` keywords** -- `anyOf`: value must match at least one sub-schema. `oneOf`: value must match exactly one sub-schema. `allOf`: value must match all sub-schemas. | Status: not_done
- [ ] **6.13 Implement `not` keyword** -- Value must NOT match the given sub-schema. | Status: not_done
- [ ] **6.14 Implement `$ref` keyword (local references only)** -- Resolve local JSON Pointer references (e.g., `#/definitions/Foo`). Do not support remote `$ref`. | Status: not_done
- [ ] **6.15 Implement `default` keyword support** -- Record the default value for use by null-to-default coercion. | Status: not_done
- [ ] **6.16 Implement unified validation dispatcher (`src/validation/index.ts`)** -- Route validation to Zod validator or JSON Schema validator based on detected schema type. Accept optional custom `jsonSchemaValidator` function. | Status: not_done
- [ ] **6.17 Write JSON Schema validation tests (`src/__tests__/validation/json-schema-validation.test.ts`)** -- Test each keyword independently: `type` (all seven types), `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `minimum`/`maximum`, `exclusiveMinimum`/`exclusiveMaximum`, `multipleOf`, `minLength`/`maxLength`, `minItems`/`maxItems`, `pattern`, `format`, `anyOf`/`oneOf`/`allOf`, `not`, `$ref`. Test combined keywords. Test both draft-07 and draft-2020-12 keywords. Verify violation paths and messages are correct. | Status: not_done
- [ ] **6.18 Write TypeBox validation tests (`src/__tests__/validation/typebox-validation.test.ts`)** -- Verify TypeBox schemas validate identically to JSON Schema. End-to-end tests with TypeBox Type builder and Static type inference. | Status: not_done
- [ ] **6.19 Write custom validator tests (`src/__tests__/validation/custom-validator.test.ts`)** -- Test that a custom `jsonSchemaValidator` function is called instead of the built-in. Test that custom validator errors are mapped to `Violation` objects. | Status: not_done

---

## Phase 7: Type Coercion (`src/coercion/`)

- [ ] **7.1 Implement string-to-number coercion rule (`src/coercion/rules.ts`)** -- Parse with `Number()`. Accept if result is finite and not `NaN`. Handle integers, floats, negative numbers, scientific notation. Reject non-numeric strings. | Status: not_done
- [ ] **7.2 Implement string-to-integer coercion rule** -- Parse with `Number()`. Accept if result is a finite integer. Reject floats (e.g., `"3.14"` is rejected). | Status: not_done
- [ ] **7.3 Implement string-to-boolean coercion rule** -- Accept `"true"` -> `true` and `"false"` -> `false` (case-insensitive). Reject all other strings (e.g., `"yes"`, `"1"`, `"0"`). | Status: not_done
- [ ] **7.4 Implement string-to-array coercion rule** -- Attempt `JSON.parse()`. Accept if result is an array. Reject if parse fails or result is not an array. | Status: not_done
- [ ] **7.5 Implement string-to-object coercion rule** -- Attempt `JSON.parse()`. Accept if result is a plain object (not null, not array). Reject if parse fails or result is not a plain object. | Status: not_done
- [ ] **7.6 Implement number-to-string coercion rule** -- Convert via `String()`. E.g., `42` -> `"42"`, `3.14` -> `"3.14"`. | Status: not_done
- [ ] **7.7 Implement boolean-to-string coercion rule** -- Convert via `String()`. E.g., `true` -> `"true"`. | Status: not_done
- [ ] **7.8 Implement null-to-default coercion rule** -- Substitute the schema's `default` value when the actual value is `null`. Only apply when the schema declares a `default` value. | Status: not_done
- [ ] **7.9 Verify non-coercion cases** -- Ensure number-to-boolean is NOT coerced (`1` is not coerced to `true`). Ensure boolean-to-number is NOT coerced (`true` is not coerced to `1`). | Status: not_done
- [ ] **7.10 Implement schema-aware recursive walker (`src/coercion/walker.ts`)** -- Walk the output object recursively, comparing each value against the schema's expected type. For objects, walk into each property. For arrays, walk each element against the `items` schema. Bound recursion by schema structure -- do not recurse into untyped parts. | Status: not_done
- [ ] **7.11 Implement coercion pipeline orchestrator (`src/coercion/index.ts`)** -- Accept raw output and schema. Walk the output using the schema-aware walker. Apply applicable coercion rules based on `CoercionConfig`. Record each coercion as a `warning` violation (code `COERCED`). Return the coerced output and the list of coercion warnings. | Status: not_done
- [ ] **7.12 Implement `CoercionConfig` handling** -- When `coercion: true`, enable all rules. When `coercion: false`, disable all. When `coercion: CoercionConfig`, enable only the specified rules. Default all rules to `true` when coercion is enabled. | Status: not_done
- [ ] **7.13 Implement coercion warning reporting** -- Each coercion produces a `Violation` with severity `warning`, code `COERCED`, including `path`, `expected`, `received`, `receivedValue`, `coercedValue`, `message`, and `llmMessage`. | Status: not_done
- [ ] **7.14 Write string-to-number coercion tests (`src/__tests__/coercion/string-to-number.test.ts`)** -- Test: integers, floats, negative numbers, scientific notation, non-numeric strings rejected, empty string rejected, `"NaN"` rejected, `"Infinity"` rejected. | Status: not_done
- [ ] **7.15 Write string-to-boolean coercion tests (`src/__tests__/coercion/string-to-boolean.test.ts`)** -- Test: `"true"` -> `true`, `"false"` -> `false`, `"TRUE"` -> `true`, `"FALSE"` -> `false`, `"True"` -> `true`, `"yes"` rejected, `"1"` rejected, `"0"` rejected, empty string rejected. | Status: not_done
- [ ] **7.16 Write string-to-json coercion tests (`src/__tests__/coercion/string-to-json.test.ts`)** -- Test: valid JSON array string, valid JSON object string, invalid JSON rejected, JSON number string (not array/object) rejected, nested JSON. | Status: not_done
- [ ] **7.17 Write number-to-string coercion tests (`src/__tests__/coercion/number-to-string.test.ts`)** -- Test: integer, float, negative, zero. | Status: not_done
- [ ] **7.18 Write null-to-default coercion tests (`src/__tests__/coercion/null-to-default.test.ts`)** -- Test: null with schema default substituted, null without schema default left as null, default value types (number, string, boolean, object, array). | Status: not_done
- [ ] **7.19 Write recursive coercion tests (`src/__tests__/coercion/recursive.test.ts`)** -- Test: nested objects coerced, array elements coerced, deeply nested structures, mixed coercion in complex objects. | Status: not_done
- [ ] **7.20 Write coercion config tests (`src/__tests__/coercion/config.test.ts`)** -- Test: `coercion: true` enables all rules, `coercion: false` disables all, per-rule config enables only specified rules, disabled rule leaves value unchanged. | Status: not_done

---

## Phase 8: Failure Strategies (`src/strategies/`)

- [ ] **8.1 Implement `throw` strategy (`src/strategies/throw.ts`)** -- Throw a `ValidationError` with the full `Violation[]`, `toolName`, and formatted `message`. This is the default strategy. | Status: not_done
- [ ] **8.2 Implement `fallback` strategy (`src/strategies/fallback.ts`)** -- Return the preconfigured `fallbackValue`. Validate the fallback value against the schema at guard creation time. Throw `TypeError` synchronously if the fallback does not pass validation. | Status: not_done
- [ ] **8.3 Implement `error-result` strategy (`src/strategies/error-result.ts`)** -- Return an `LLMValidationError` object with `error: true`, `code: 'INVALID_TOOL_OUTPUT'`, human-readable `message`, summarized `violations` array, and actionable `suggestion`. Format must be compatible with `tool-call-retry`'s `LLMFormattedError`. | Status: not_done
- [ ] **8.4 Implement `coerce-and-warn` strategy (`src/strategies/coerce-and-warn.ts`)** -- Run coercion on the raw output. Re-validate the coerced output. If all violations resolved, return coerced value with coercion warnings. If violations remain, fall through to `coercionFallback` strategy (default: `'throw'`). | Status: not_done
- [ ] **8.5 Implement `strip-extra` strategy (`src/strategies/strip-extra.ts`)** -- Walk the output and remove fields not present in the schema. Preserve valid known fields. Do not fix type errors on known fields (those are handled by the global strategy or coercion). | Status: not_done
- [ ] **8.6 Implement per-field strategies** -- Evaluate `fieldStrategies` before the global strategy. For each violation, check if its JSON path matches a `fieldStrategies` key. If matched and the field strategy resolves the violation, skip the global strategy for that field. Support `fieldFallbacks` for per-field fallback values. | Status: not_done
- [ ] **8.7 Implement failure strategy dispatcher (`src/strategies/index.ts`)** -- Route to the correct strategy based on the `onInvalid` option. Handle the dispatch logic for per-field strategies before global. | Status: not_done
- [ ] **8.8 Write `throw` strategy tests (`src/__tests__/strategies/throw.test.ts`)** -- Test: `ValidationError` thrown with correct `violations`, `toolName`, and `message`. Error is instance of both `ValidationError` and `Error`. | Status: not_done
- [ ] **8.9 Write `fallback` strategy tests (`src/__tests__/strategies/fallback.test.ts`)** -- Test: fallback value returned on validation failure. Fallback validated at creation time. Invalid fallback throws `TypeError` at creation time. | Status: not_done
- [ ] **8.10 Write `error-result` strategy tests (`src/__tests__/strategies/error-result.test.ts`)** -- Test: `LLMValidationError` returned with correct structure. `error` is `true`, `code` is `'INVALID_TOOL_OUTPUT'`. `violations` array summarizes all failures. `suggestion` is actionable. | Status: not_done
- [ ] **8.11 Write `coerce-and-warn` strategy tests (`src/__tests__/strategies/coerce-and-warn.test.ts`)** -- Test: coercible violations resolved, coerced value returned with warnings. Non-coercible violations fall through to secondary strategy. Default secondary is `throw`. Custom secondary (`coercionFallback`) respected. | Status: not_done
- [ ] **8.12 Write `strip-extra` strategy tests (`src/__tests__/strategies/strip-extra.test.ts`)** -- Test: unknown fields removed. Known valid fields preserved. Known invalid fields still trigger validation errors if not coerced. Nested unknown fields stripped. | Status: not_done
- [ ] **8.13 Write per-field strategy tests (`src/__tests__/strategies/field-strategies.test.ts`)** -- Test: field-level strategy overrides global for matched paths. Field fallback values used. Unmatched fields use global strategy. Multiple field strategies on different paths. | Status: not_done

---

## Phase 9: Core API Functions

### 9A: `validate` function (`src/validate.ts`)

- [ ] **9A.1 Implement `validate(value, schema, options?)` function** -- Standalone validation: detect schema type, optionally run coercion, validate against schema, return `ValidationResult<T>`. No function wrapping -- just validates a value. | Status: not_done
- [ ] **9A.2 Handle coercion in `validate`** -- If `coercion` is enabled in options, run coercion pipeline before validation. Include coercion warnings in the result. | Status: not_done
- [ ] **9A.3 Handle failure strategies in `validate`** -- Apply the configured `onInvalid` strategy when validation fails. For `throw`, throw `ValidationError`. For `fallback`, return the fallback value. For `error-result`, return `LLMValidationError`. | Status: not_done

### 9B: `guard` function (`src/guard.ts`)

- [ ] **9B.1 Implement `guard(toolFn, schema, options?)` function** -- Wrap an async tool function. Return a new function with the same input signature. On invocation: call the tool function, validate the resolved output, apply failure strategy if needed, return the validated value. | Status: not_done
- [ ] **9B.2 Preserve tool function signature** -- The guarded function must accept the same arguments as the original. TypeScript generics must flow the input type through. | Status: not_done
- [ ] **9B.3 Handle tool function errors** -- If the tool function throws, the error propagates unchanged. The guard does not catch execution errors -- only validates successful return values. | Status: not_done
- [ ] **9B.4 Fire event hooks in `guard`** -- Call `onValidationPass` on success (with data and warnings). Call `onValidationFail` on failure (with violations and raw output). Call `onCoercion` for each coerced field. Events are synchronous -- hook errors propagate. | Status: not_done
- [ ] **9B.5 Cache schema detection in `guard`** -- Detect schema type once at guard creation time, not on every invocation. | Status: not_done

### 9C: `guardTools` function (`src/guard-tools.ts`)

- [ ] **9C.1 Implement `guardTools(tools, schemas, options?)` function** -- Accept a record of tool functions and a record of schemas with matching keys. Guard each tool with its corresponding schema. Return a record with the same keys, each function guarded. | Status: not_done
- [ ] **9C.2 Implement per-tool option overrides** -- Merge global options with `toolOptions[toolName]` for each tool. Per-tool options have highest priority, then global options, then defaults. | Status: not_done
- [ ] **9C.3 Validate schema map completeness** -- Every key in `tools` should have a matching key in `schemas`. Decide on behavior for tools without schemas (spec section 14 says "tool passes through unguarded"). | Status: not_done

### 9D: `createGuard` factory (`src/create-guard.ts`)

- [ ] **9D.1 Implement `createGuard(schema, options?)` factory** -- Return a `Guard<T>` instance with `validate` and `wrap` methods, plus `schema` and `options` properties. | Status: not_done
- [ ] **9D.2 Implement `Guard.validate` method** -- Validate a value against the guard's schema using the guard's options. Return `ValidationResult<T>`. | Status: not_done
- [ ] **9D.3 Implement `Guard.wrap` method** -- Wrap a tool function with the guard's schema and options. Equivalent to calling `guard(toolFn, schema, options)`. | Status: not_done
- [ ] **9D.4 Ensure reusability** -- Same guard instance can be applied to multiple tool functions or used to validate multiple values. No per-invocation state leaks between calls. | Status: not_done

### 9E: `fromMCPTool` function (`src/from-mcp-tool.ts`)

- [ ] **9E.1 Implement `fromMCPTool(toolDefinition, options?)` function** -- Extract `outputSchema` from the MCP tool definition. If `outputSchema` exists, create and return a `Guard<unknown>` instance using `createGuard`. If `outputSchema` does not exist, return `null`. | Status: not_done
- [ ] **9E.2 Pass tool name through** -- If the tool definition has a `name` property, use it as `toolName` in the guard options (unless overridden by the caller's options). | Status: not_done

---

## Phase 10: Configuration Validation

- [ ] **10.1 Validate `onInvalid` option** -- Must be one of the valid `FailureStrategy` values. Throw `TypeError` with actionable message if invalid. | Status: not_done
- [ ] **10.2 Validate `fallbackValue` required for `fallback` strategy** -- If `onInvalid` is `'fallback'`, `fallbackValue` must be provided. Throw `TypeError` if missing. | Status: not_done
- [ ] **10.3 Validate `fallbackValue` against schema** -- At guard creation time, validate the fallback value against the schema. Throw `TypeError` if it does not conform, including the violation details. | Status: not_done
- [ ] **10.4 Validate schema format** -- Schema must be a recognized format (Zod, JSON Schema, or TypeBox). Throw `TypeError` with descriptive message if unrecognized. | Status: not_done
- [ ] **10.5 Validate `fieldStrategies` keys** -- Keys must be valid JSON paths starting with `$.`. Throw `TypeError` if a key is not a valid JSON path. | Status: not_done
- [ ] **10.6 Validate `jsonSchemaValidator` is a function** -- If provided, must be a function. Throw `TypeError` if not. | Status: not_done
- [ ] **10.7 Validate `coercionFallback` is not `coerce-and-warn`** -- The `coercionFallback` must be one of `'throw' | 'fallback' | 'error-result' | 'strip-extra'`. Prevent infinite recursion. | Status: not_done

---

## Phase 11: Public API Exports (`src/index.ts`)

- [ ] **11.1 Export all public functions** -- `guard`, `validate`, `guardTools`, `createGuard`, `fromMCPTool`. | Status: not_done
- [ ] **11.2 Export all public types** -- `ValidationResult`, `Violation`, `ViolationSeverity`, `ViolationCode`, `ValidationError`, `LLMValidationError`, `FailureStrategy`, `CoercionConfig`, `GuardOptions`, `Guard`, `GuardToolsOptions`. | Status: not_done
- [ ] **11.3 Ensure no internal modules leak** -- Only the public API is accessible from `import { ... } from 'tool-output-guard'`. Internal modules (detection, validation, coercion, strategies, violations) are not directly importable. | Status: not_done

---

## Phase 12: Integration Tests

- [ ] **12.1 Write `guard` integration tests (`src/__tests__/integration/guard.test.ts`)** -- Wrap a mock tool function. Test: valid output passes through unchanged and `onValidationPass` called. Invalid output with `throw` throws `ValidationError` and `onValidationFail` called. Invalid output with `coerce-and-warn` returns coerced value and `onCoercion` called per field. Invalid output with `fallback` returns fallback value. Tool function that throws: error propagates (not caught by guard). Return type correctly typed via TypeScript. | Status: not_done
- [ ] **12.2 Write `guardTools` integration tests (`src/__tests__/integration/guard-tools.test.ts`)** -- Wrap multiple tools with different schemas. Each tool validated against its own schema. Per-tool options override global. Tool with no matching schema passes through unguarded. | Status: not_done
- [ ] **12.3 Write `createGuard` integration tests (`src/__tests__/integration/create-guard.test.ts`)** -- Guard instance `validate` method works standalone. Guard instance `wrap` method wraps a function. Same guard applied to multiple functions. | Status: not_done
- [ ] **12.4 Write `fromMCPTool` integration tests (`src/__tests__/integration/from-mcp-tool.test.ts`)** -- Tool with `outputSchema`: guard created and validates correctly. Tool without `outputSchema`: returns null. Tool with complex `outputSchema` (nested objects, arrays, `$ref`): guard validates correctly. Tool `name` used as `toolName`. | Status: not_done
- [ ] **12.5 Write composition with `tool-call-retry` test (`src/__tests__/integration/tool-call-retry-compose.test.ts`)** -- Verify the pattern: wrap with retry first, then guard output. Retry handles execution failure, guard handles output validation failure. Both compose correctly. | Status: not_done
- [ ] **12.6 Write OpenAI function calling pattern test (`src/__tests__/integration/openai.test.ts`)** -- Simulate OpenAI tool call loop with guarded tools. Valid tool output passes to LLM context. Invalid tool output produces `error-result` for LLM. | Status: not_done
- [ ] **12.7 Write Anthropic tool use pattern test (`src/__tests__/integration/anthropic.test.ts`)** -- Simulate Anthropic tool use loop with guarded tools. Verify `is_error` flag set for validation failures. | Status: not_done
- [ ] **12.8 Write MCP server integration test (`src/__tests__/integration/mcp-server.test.ts`)** -- Simulate MCP server with `outputSchema` on tools. Guard tool handlers. Valid output produces `structuredContent`. Invalid output produces `isError: true`. | Status: not_done

---

## Phase 13: Test Fixtures

- [ ] **13.1 Create mock tools (`src/__tests__/fixtures/mock-tools.ts`)** -- Mock tool functions that return valid data, invalid data, data with type mismatches (strings instead of numbers), data with extra fields, data with missing fields, null, undefined, primitives, HTML error pages. | Status: not_done
- [ ] **13.2 Create mock schemas (`src/__tests__/fixtures/mock-schemas.ts`)** -- Mock schemas in all three formats: Zod schemas, JSON Schema objects, TypeBox schemas. Include simple schemas, nested schemas, schemas with arrays, schemas with enums, schemas with constraints. | Status: not_done

---

## Phase 14: Edge Cases

- [ ] **14.1 Handle `undefined` tool output** -- Tool function returns `undefined`. Validate against schema. Should produce appropriate violation (`WRONG_TYPE` or `MISSING_REQUIRED`). | Status: not_done
- [ ] **14.2 Handle `null` tool output** -- Tool function returns `null`. Validate as `null` type against schema. | Status: not_done
- [ ] **14.3 Handle primitive tool output** -- Tool function returns a string, number, or boolean. Validate against schema. | Status: not_done
- [ ] **14.4 Handle type mismatch at root** -- Schema expects object but tool returns array (or vice versa). Produce `WRONG_TYPE` violation at root path `$`. | Status: not_done
- [ ] **14.5 Handle empty object with required fields** -- `{}` with required fields produces `MISSING_REQUIRED` for each required field. | Status: not_done
- [ ] **14.6 Handle deeply nested objects (10+ levels)** -- Paths are correct. Performance is acceptable. | Status: not_done
- [ ] **14.7 Handle large arrays (1000+ elements)** -- Validation completes without memory issues. Performance logged. | Status: not_done
- [ ] **14.8 Handle circular references in tool output** -- Detect circular references. Report as a violation rather than entering infinite loop. | Status: not_done
- [ ] **14.9 Handle schema with no constraints** -- Schema with no required fields and no type constraints. Everything passes. | Status: not_done
- [ ] **14.10 Handle coercion with Zod `.transform()`** -- When `coercion: true` and the Zod schema uses `.transform()`, coercion runs first (Step 2), then Zod transform runs during validation (Step 3). | Status: not_done

---

## Phase 15: Event Hooks

- [ ] **15.1 Implement `onValidationPass` hook** -- Called after successful validation. Receives `{ toolName?: string; data: unknown; warnings: Violation[] }`. Synchronous -- hook errors propagate. | Status: not_done
- [ ] **15.2 Implement `onValidationFail` hook** -- Called after failed validation. Receives `{ toolName?: string; violations: Violation[]; rawOutput: unknown }`. Synchronous. | Status: not_done
- [ ] **15.3 Implement `onCoercion` hook** -- Called for each coerced field. Receives `{ toolName?: string; path: string; from: unknown; to: unknown; fromType: string; toType: string }`. Synchronous. | Status: not_done
- [ ] **15.4 Write event hook tests** -- Verify each hook is called with correct data. Verify hooks that throw propagate the error. Verify hooks not provided do not cause errors. Test hooks across all API functions (`guard`, `validate`, `guardTools`, `createGuard`). | Status: not_done

---

## Phase 16: Documentation

- [ ] **16.1 Write README.md** -- Installation instructions. Quick start example. Configuration reference (all options with defaults). Schema format guide (Zod, JSON Schema, TypeBox). Failure strategy reference. Coercion reference. Integration examples (MCP, OpenAI, Anthropic, Vercel AI SDK, tool-call-retry). API reference for all exported functions and types. Troubleshooting guide. | Status: not_done
- [ ] **16.2 Add JSDoc comments to all exported functions** -- `guard`, `validate`, `guardTools`, `createGuard`, `fromMCPTool` with parameter descriptions, return types, and usage examples. | Status: not_done
- [ ] **16.3 Add JSDoc comments to all exported types** -- `ValidationResult`, `Violation`, `ValidationError`, `LLMValidationError`, `GuardOptions`, `Guard`, etc. | Status: not_done

---

## Phase 17: Final Verification and Publishing Prep

- [ ] **17.1 Run full test suite** -- `npm run test` must pass with zero failures. | Status: not_done
- [ ] **17.2 Run linter** -- `npm run lint` must pass with zero errors. | Status: not_done
- [ ] **17.3 Run build** -- `npm run build` must produce `dist/` with `.js`, `.d.ts`, `.d.ts.map`, and `.js.map` files. | Status: not_done
- [ ] **17.4 Verify package.json fields** -- `main` points to `dist/index.js`. `types` points to `dist/index.d.ts`. `files` includes `dist`. Peer dependencies list `zod` as optional. Version is `0.1.0` or appropriate for current phase. | Status: not_done
- [ ] **17.5 Verify exports** -- Import from the built package resolves all public API symbols. No internal modules leak. | Status: not_done
- [ ] **17.6 Performance smoke test** -- Validate a typical 10-field object against a Zod schema and a JSON Schema. Confirm overhead is sub-millisecond (under 1ms). | Status: not_done
- [ ] **17.7 Bump version for release** -- Set version according to semver based on the implementation phase (e.g., `0.1.0` for Phase 1, `1.0.0` for full spec). | Status: not_done
