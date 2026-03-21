import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createGuard } from '../create-guard';
import { ValidationError } from '../types';

const TemperatureSchema = z.object({
  value: z.number(),
  unit: z.enum(['C', 'F', 'K']),
});

type Temperature = { value: number; unit: 'C' | 'F' | 'K' };
const validTemp: Temperature = { value: 100, unit: 'C' };

describe('createGuard() — validate method', () => {
  it('returns success: true for valid data', () => {
    const g = createGuard(TemperatureSchema);
    const result = g.validate(validTemp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validTemp);
    }
  });

  it('returns success: false for invalid data', () => {
    const g = createGuard(TemperatureSchema);
    const result = g.validate({ value: 'hot', unit: 'X' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  it('exposes the schema', () => {
    const g = createGuard(TemperatureSchema);
    expect(g.schema).toBe(TemperatureSchema);
  });

  it('exposes the options', () => {
    const options = { onInvalid: 'fallback' as const, fallbackValue: validTemp };
    const g = createGuard(TemperatureSchema, options);
    expect(g.options).toEqual(options);
  });
});

describe('createGuard() — wrap method', () => {
  it('returns valid data from wrapped function', async () => {
    const g = createGuard<Temperature>(TemperatureSchema);
    const toolFn = async () => validTemp;
    const wrapped = g.wrap(toolFn);
    const result = await wrapped(null);
    expect(result).toEqual(validTemp);
  });

  it('throws ValidationError by default for invalid data', async () => {
    const g = createGuard(TemperatureSchema);
    const toolFn = async () => ({ value: 'hot', unit: 'X' });
    const wrapped = g.wrap(toolFn);
    await expect(wrapped(null)).rejects.toBeInstanceOf(ValidationError);
  });

  it('respects onInvalid: fallback', async () => {
    const g = createGuard<Temperature>(TemperatureSchema, {
      onInvalid: 'fallback',
      fallbackValue: validTemp,
    });
    const toolFn = async () => ({ value: 'bad', unit: 'X' });
    const wrapped = g.wrap(toolFn);
    const result = await wrapped(null);
    expect(result).toEqual(validTemp);
  });

  it('calls onValidationPass on success', async () => {
    const onPass = vi.fn();
    const g = createGuard<Temperature>(TemperatureSchema, { onValidationPass: onPass });
    const toolFn = async () => validTemp;
    const wrapped = g.wrap(toolFn);
    await wrapped(null);
    expect(onPass).toHaveBeenCalledWith(validTemp);
  });

  it('calls onValidationFail on failure', async () => {
    const onFail = vi.fn();
    const g = createGuard<Temperature>(TemperatureSchema, {
      onValidationFail: onFail,
      onInvalid: 'fallback',
      fallbackValue: validTemp,
    });
    const toolFn = async () => ({ value: 'bad', unit: 'X' });
    const wrapped = g.wrap(toolFn);
    await wrapped(null);
    expect(onFail).toHaveBeenCalledTimes(1);
  });
});

describe('createGuard() — JSON Schema', () => {
  const schema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'number' } },
  };

  it('validates valid data against JSON Schema', () => {
    const g = createGuard(schema);
    const result = g.validate({ id: 1 });
    expect(result.success).toBe(true);
  });

  it('reports violations for invalid data against JSON Schema', () => {
    const g = createGuard(schema);
    const result = g.validate({ id: 'abc' });
    expect(result.success).toBe(false);
  });
});
