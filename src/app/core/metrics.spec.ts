import { decodeRows, emptyRows } from './metrics';

describe('metrics', () => {
  it('emptyRows: everything unavailable, volume zero', () => {
    const rows = emptyRows(3);
    expect(rows.map((r) => r.symbol)).toEqual(['ALFA', 'BETA', 'GAMA']);
    for (const r of rows) {
      expect(r).toMatchObject({ lastPrice: null, spread: null, vwap: null, imbalance: null, volume: 0 });
    }
  });

  it('decodeRows: NaN → null, numbers preserved', () => {
    const values = new Float64Array([102, 0.04, 40, 101.5, 0.2, NaN, NaN, 0, NaN, NaN]);
    const [a, b] = decodeRows(values);
    expect(a).toEqual({ symbol: 'ALFA', lastPrice: 102, trend: 0, spread: 0.04, volume: 40, vwap: 101.5, imbalance: 0.2 });
    expect(b).toEqual({ symbol: 'BETA', lastPrice: null, trend: 0, spread: null, volume: 0, vwap: null, imbalance: null });
  });

  it('decodeRows: trend compares the last price with the previous rows', () => {
    const snap = (...prices: number[]) => new Float64Array(prices.flatMap((p) => [p, 0.01, 1, p, 0]));
    let rows = decodeRows(snap(100, 50, NaN)); // no previous rows → no trend
    expect(rows.map((r) => r.trend)).toEqual([0, 0, 0]);
    rows = decodeRows(snap(101, 49, 10), rows);
    expect(rows.map((r) => r.trend)).toEqual([1, -1, 0]); // the third had no price before
    rows = decodeRows(snap(101, 49, 9), rows);
    expect(rows.map((r) => r.trend)).toEqual([1, -1, -1]); // unchanged price keeps the previous trend
  });
});
