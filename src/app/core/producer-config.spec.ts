import { configErrors, DEFAULT_CONFIG, isIntegerInRange, LIMITS, nominalRate, symbolFor } from './producer-config';

describe('producer-config', () => {
  it('defaults and limits match the requirements', () => {
    expect(DEFAULT_CONFIG).toEqual({ instruments: 5, updatesPerBatch: 100, batchIntervalMs: 500 });
    expect(LIMITS.instruments).toEqual({ min: 1, max: 50 });
    expect(LIMITS.updatesPerBatch).toEqual({ min: 1, max: 1000 });
    expect(LIMITS.batchIntervalMs).toEqual({ min: 50, max: 2000 });
    expect(configErrors(DEFAULT_CONFIG)).toEqual([]);
  });

  it('limits are inclusive: minimum and maximum are allowed', () => {
    expect(configErrors({ instruments: 1, updatesPerBatch: 1, batchIntervalMs: 50 })).toEqual([]);
    expect(configErrors({ instruments: 50, updatesPerBatch: 1000, batchIntervalMs: 2000 })).toEqual([]);
  });

  it('rejects out-of-range values, per field', () => {
    expect(configErrors({ instruments: 0, updatesPerBatch: 100, batchIntervalMs: 500 })).toEqual(['instruments']);
    expect(configErrors({ instruments: 51, updatesPerBatch: 100, batchIntervalMs: 500 })).toEqual(['instruments']);
    expect(configErrors({ instruments: 5, updatesPerBatch: 1001, batchIntervalMs: 500 })).toEqual(['updatesPerBatch']);
    expect(configErrors({ instruments: 5, updatesPerBatch: 100, batchIntervalMs: 49 })).toEqual(['batchIntervalMs']);
    expect(configErrors({ instruments: 5, updatesPerBatch: 100, batchIntervalMs: 2001 })).toEqual(['batchIntervalMs']);
  });

  it('rejects non-integer and non-numeric values', () => {
    const r = { min: 1, max: 10 };
    expect(isIntegerInRange(2.5, r)).toBe(false);
    expect(isIntegerInRange(NaN, r)).toBe(false);
    expect(isIntegerInRange(Infinity, r)).toBe(false);
    expect(isIntegerInRange('5', r)).toBe(false);
    expect(isIntegerInRange(null, r)).toBe(false);
    expect(isIntegerInRange(5, r)).toBe(true);
  });

  it('nominal rate: 100 updates / 500 ms = 200 per second across all instruments', () => {
    expect(nominalRate(DEFAULT_CONFIG)).toBe(200);
    expect(nominalRate({ instruments: 1, updatesPerBatch: 1000, batchIntervalMs: 50 })).toBe(20000);
  });

  it('symbols are unique across all 50 instruments', () => {
    const symbols = Array.from({ length: 50 }, (_, i) => symbolFor(i));
    expect(new Set(symbols).size).toBe(50);
    expect(symbols.slice(0, 2)).toEqual(['ALFA', 'BETA']);
  });
});
