import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { guard } from '../guard';
import { ValidationError } from '../types';

const WeatherSchema = z.object({
  temperature: z.number(),
  unit: z.enum(['celsius', 'fahrenheit']),
  description: z.string(),
});

const validWeather = { temperature: 22, unit: 'celsius' as const, description: 'Sunny' };
const invalidWeather = { temperature: 'hot', unit: 'kelvin', description: 'Warm' };

describe('guard() — basic wrapping', () => {
  it('returns valid data unchanged when output matches schema', async () => {
    const toolFn = async () => validWeather;
    const guarded = guard(toolFn, WeatherSchema);
    const result = await guarded();
    expect(result).toEqual(validWeather);
  });

  it('passes arguments through to the wrapped function', async () => {
    const toolFn = vi.fn(async (city: unknown) => ({ city, temperature: 20, unit: 'celsius' as const, description: 'OK' }));
    const schema = z.object({ city: z.string(), temperature: z.number(), unit: z.enum(['celsius', 'fahrenheit']), description: z.string() });
    const guarded = guard(toolFn as (...args: unknown[]) => Promise<unknown>, schema);
    await guarded('London');
    expect(toolFn).toHaveBeenCalledWith('London');
  });
});

describe('guard() — strategy: throw (default)', () => {
  it('throws ValidationError when output is invalid', async () => {
    const toolFn = async () => invalidWeather;
    const guarded = guard(toolFn, WeatherSchema);
    await expect(guarded()).rejects.toBeInstanceOf(ValidationError);
  });

  it('ValidationError contains violation details', async () => {
    const toolFn = async () => invalidWeather;
    const guarded = guard(toolFn, WeatherSchema, { onInvalid: 'throw' });
    try {
      await guarded();
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).violations.length).toBeGreaterThan(0);
    }
  });
});

describe('guard() — strategy: fallback', () => {
  it('returns fallbackValue when output is invalid', async () => {
    const fallback = { temperature: 0, unit: 'celsius' as const, description: 'Unknown' };
    const toolFn = async () => invalidWeather;
    const guarded = guard(toolFn, WeatherSchema, { onInvalid: 'fallback', fallbackValue: fallback });
    const result = await guarded();
    expect(result).toEqual(fallback);
  });

  it('throws when fallbackValue is not provided', async () => {
    const toolFn = async () => invalidWeather;
    const guarded = guard(toolFn, WeatherSchema, { onInvalid: 'fallback' });
    await expect(guarded()).rejects.toThrow();
  });
});

describe('guard() — strategy: error-result', () => {
  it('returns error object when output is invalid', async () => {
    const toolFn = async () => invalidWeather;
    const guarded = guard<{ __error: boolean; violations: unknown[] }>(
      toolFn,
      WeatherSchema,
      { onInvalid: 'error-result' },
    );
    const result = await guarded();
    expect(result.__error).toBe(true);
    expect(Array.isArray(result.violations)).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

describe('guard() — onPass and onFail hooks', () => {
  it('calls onValidationPass with the valid data', async () => {
    const onPass = vi.fn();
    const toolFn = async () => validWeather;
    const guarded = guard(toolFn, WeatherSchema, { onValidationPass: onPass });
    await guarded();
    expect(onPass).toHaveBeenCalledWith(validWeather);
  });

  it('calls onValidationFail with violations on invalid output', async () => {
    const onFail = vi.fn();
    const toolFn = async () => invalidWeather;
    const guarded = guard(toolFn, WeatherSchema, { onValidationFail: onFail, onInvalid: 'fallback', fallbackValue: validWeather });
    await guarded();
    expect(onFail).toHaveBeenCalledTimes(1);
    const violations = onFail.mock.calls[0][0];
    expect(Array.isArray(violations)).toBe(true);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('does not call onValidationFail for valid output', async () => {
    const onFail = vi.fn();
    const toolFn = async () => validWeather;
    const guarded = guard(toolFn, WeatherSchema, { onValidationFail: onFail });
    await guarded();
    expect(onFail).not.toHaveBeenCalled();
  });

  it('does not call onValidationPass for invalid output', async () => {
    const onPass = vi.fn();
    const toolFn = async () => invalidWeather;
    const guarded = guard(toolFn, WeatherSchema, { onValidationPass: onPass, onInvalid: 'fallback', fallbackValue: validWeather });
    await guarded();
    expect(onPass).not.toHaveBeenCalled();
  });
});

describe('guard() — JSON Schema', () => {
  const schema = {
    type: 'object',
    required: ['name', 'score'],
    properties: {
      name: { type: 'string' },
      score: { type: 'number' },
    },
  };

  it('returns valid data with JSON Schema', async () => {
    const toolFn = async () => ({ name: 'Alice', score: 95 });
    const guarded = guard(toolFn, schema);
    const result = await guarded();
    expect(result).toEqual({ name: 'Alice', score: 95 });
  });

  it('throws ValidationError for invalid JSON Schema data', async () => {
    const toolFn = async () => ({ name: 42, score: 'high' });
    const guarded = guard(toolFn, schema, { onInvalid: 'throw' });
    await expect(guarded()).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('guard() — strategy: coerce-and-warn', () => {
  it('coerces string to number in JSON Schema', async () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
    };
    const toolFn = async () => ({ count: '42' });
    const guarded = guard<{ count: number }>(toolFn, schema, { onInvalid: 'coerce-and-warn' });
    const result = await guarded();
    expect(result.count).toBe(42);
  });
});

describe('guard() — strategy: strip-extra', () => {
  it('strips extra properties from JSON Schema output', async () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    };
    const toolFn = async () => ({ name: 'Alice', extra: 'unwanted' });
    const guarded = guard<{ name: string }>(toolFn, schema, { onInvalid: 'strip-extra' });
    const result = await guarded();
    expect(result).toEqual({ name: 'Alice' });
    expect((result as Record<string, unknown>)['extra']).toBeUndefined();
  });
});
