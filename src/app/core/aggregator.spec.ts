import { computeMetrics, emptyTotals, MarketUpdate, MetricsAggregator, METRIC_STRIDE } from './aggregator';
import { decodeRows } from './metrics';

const update = (over: Partial<MarketUpdate> = {}): MarketUpdate => ({
  instrument: 0, priceCents: 10200, tradeQuantity: 30, bidCents: 10196, askCents: 10200,
  bidQuantity: 600, askQuantity: 400, ...over,
});

describe('computeMetrics', () => {
  it('before any data: everything unavailable, volume zero', () => {
    expect(computeMetrics(emptyTotals())).toEqual({
      lastPrice: null, spread: null, volume: 0, vwap: null, imbalance: null,
    });
  });
});

describe('MetricsAggregator', () => {
  it('example from the task: 10@$100 and 30@$102', () => {
    const agg = new MetricsAggregator(1);
    agg.applyUpdate(update({ priceCents: 10000, tradeQuantity: 10, bidCents: 9996, askCents: 10000 }));
    agg.applyUpdate(update({ priceCents: 10200, tradeQuantity: 30 })); // bid 101.96, ask 102, 600/400
    const m = agg.metrics(0);
    expect(m.lastPrice).toBe(102);
    expect(m.volume).toBe(40);
    expect(m.vwap).toBeCloseTo(101.5, 10);
    expect(m.spread).toBeCloseTo(0.04, 10);
    expect(m.imbalance).toBeCloseTo(0.2, 10);
  });

  it('volume and VWAP are cumulative, not windowed', () => {
    const agg = new MetricsAggregator(1);
    for (let i = 0; i < 1000; i++) agg.applyUpdate(update({ priceCents: 10000, tradeQuantity: 2 }));
    expect(agg.metrics(0).volume).toBe(2000);
    expect(agg.metrics(0).vwap).toBe(100);
    expect(agg.totalUpdates).toBe(1000);
  });

  it('available bid/ask quantities don’t affect traded volume or VWAP', () => {
    const agg = new MetricsAggregator(1);
    agg.applyUpdate(update({ priceCents: 5000, tradeQuantity: 10, bidQuantity: 1, askQuantity: 1 }));
    agg.applyUpdate(update({ priceCents: 5000, tradeQuantity: 10, bidQuantity: 9999, askQuantity: 5 }));
    expect(agg.metrics(0).volume).toBe(20);
    expect(agg.metrics(0).vwap).toBe(50);
  });

  it('larger trades weigh more in VWAP', () => {
    const agg = new MetricsAggregator(1);
    agg.applyUpdate(update({ priceCents: 10000, tradeQuantity: 1 }));
    agg.applyUpdate(update({ priceCents: 20000, tradeQuantity: 99 }));
    expect(agg.metrics(0).vwap).toBeCloseTo(199, 10);
  });

  it('zero imbalance denominator → unavailable', () => {
    const agg = new MetricsAggregator(1);
    agg.applyUpdate(update({ bidQuantity: 0, askQuantity: 0 }));
    expect(agg.metrics(0).imbalance).toBeNull();
    expect(agg.metrics(0).volume).toBe(30); // other metrics unaffected
  });

  it('imbalance uses only the latest quantities, within [−1, +1]', () => {
    const agg = new MetricsAggregator(1);
    agg.applyUpdate(update({ bidQuantity: 100, askQuantity: 0 }));
    expect(agg.metrics(0).imbalance).toBe(1);
    agg.applyUpdate(update({ bidQuantity: 0, askQuantity: 100 }));
    expect(agg.metrics(0).imbalance).toBe(-1);
    agg.applyUpdate(update({ bidQuantity: 300, askQuantity: 300 }));
    expect(agg.metrics(0).imbalance).toBe(0);
  });

  it('isolation between instruments', () => {
    const agg = new MetricsAggregator(3);
    agg.applyUpdate(update({ instrument: 1, priceCents: 5000, tradeQuantity: 7, bidQuantity: 10, askQuantity: 30 }));
    expect(agg.metrics(0)).toEqual({ lastPrice: null, spread: null, volume: 0, vwap: null, imbalance: null });
    expect(agg.metrics(2).volume).toBe(0);
    expect(agg.metrics(1)).toMatchObject({ lastPrice: 50, volume: 7, vwap: 50, imbalance: -0.5 });
    agg.applyUpdate(update({ instrument: 0, priceCents: 9000, tradeQuantity: 1 }));
    expect(agg.metrics(1).volume).toBe(7); // instrument 1 unchanged
    expect(agg.metrics(0).lastPrice).toBe(90);
  });

  it('applyBatch reads the flat Wasm buffer and counts each trade once', () => {
    const agg = new MetricsAggregator(2);
    // [instrument, price, qty, bid, ask, bidQty, askQty] × 2
    const records = new Int32Array([0, 10000, 10, 9996, 10000, 100, 100, 0, 10200, 30, 10196, 10200, 600, 400]);
    agg.applyBatch(records, 2);
    expect(agg.metrics(0)).toMatchObject({ volume: 40, lastPrice: 102 });
    expect(agg.metrics(0).vwap).toBeCloseTo(101.5, 10);
    expect(agg.totalUpdates).toBe(2);
    agg.applyBatch(records, 0); // an empty batch adds nothing
    expect(agg.totalUpdates).toBe(2);
  });

  it('applyBatch and applyUpdate give identical results', () => {
    const records = new Int32Array(Array.from({ length: 300 }, (_, k) => [k % 3, 1000 + k, 1 + (k % 7), 999 + k, 1001 + k, k, 300 - k]).flat());
    const batched = new MetricsAggregator(3);
    batched.applyBatch(records, 300);
    const single = new MetricsAggregator(3);
    for (let k = 0; k < 300; k++) {
      const [instrument, priceCents, tradeQuantity, bidCents, askCents, bidQuantity, askQuantity] = records.subarray(k * 7, k * 7 + 7);
      single.applyUpdate({ instrument, priceCents, tradeQuantity, bidCents, askCents, bidQuantity, askQuantity });
    }
    expect(batched.snapshot()).toEqual(single.snapshot());
    expect(batched.totalUpdates).toBe(single.totalUpdates);
  });

  it('rejects an unknown instrument', () => {
    expect(() => new MetricsAggregator(1).applyUpdate(update({ instrument: 5 }))).toThrow(RangeError);
    expect(() => new MetricsAggregator(1).applyBatch(new Int32Array([5, 1, 1, 1, 2, 0, 0]), 1)).toThrow(RangeError);
  });

  it('snapshot: NaN for unavailable values, decoded to null', () => {
    const agg = new MetricsAggregator(2);
    agg.applyUpdate(update({ instrument: 1 }));
    const snap = agg.snapshot();
    expect(snap).toHaveLength(2 * METRIC_STRIDE);
    const [a, b] = decodeRows(snap);
    expect(a).toEqual({ symbol: 'ALFA', lastPrice: null, trend: 0, spread: null, volume: 0, vwap: null, imbalance: null });
    expect(b).toMatchObject({ symbol: 'BETA', lastPrice: 102, volume: 30, imbalance: 0.2 });
  });

  it('precision: prices in cents, no floating-point error accumulation', () => {
    const agg = new MetricsAggregator(1);
    for (let i = 0; i < 100_000; i++) agg.applyUpdate(update({ priceCents: 10, tradeQuantity: 3, bidCents: 9, askCents: 10 }));
    expect(agg.metrics(0).vwap).toBe(0.1);
    expect(agg.metrics(0).volume).toBe(300_000);
  });
});
