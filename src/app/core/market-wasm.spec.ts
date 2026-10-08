import { loadWasm } from '../../testing/fakes';
import { RECORD_STRIDE } from './aggregator';
import { MarketExports } from './producer-core';

/** Tests of the real Wasm library (public/market.wasm is built by the pretest script). */
interface Generator extends MarketExports {
  maxBatch(): number;
  maxInstruments(): number;
}

const load = () => loadWasm<Generator>();

interface Rec { instrument: number; price: number; qty: number; bid: number; ask: number; bidQty: number; askQty: number }
function batch(w: Generator, n: number): Rec[] {
  const produced = w.generateBatch(n);
  const raw = new Int32Array(w.memory.buffer, w.outputPtr(), produced * RECORD_STRIDE);
  return Array.from({ length: produced }, (_, k) => {
    const o = k * RECORD_STRIDE;
    return { instrument: raw[o], price: raw[o + 1], qty: raw[o + 2], bid: raw[o + 3], ask: raw[o + 4], bidQty: raw[o + 5], askQty: raw[o + 6] };
  });
}

describe('Wasm generator', () => {
  it('record layout matches what TypeScript expects', () => {
    expect(load().recordStride()).toBe(RECORD_STRIDE);
  });

  it('returns batches of the requested size', () => {
    const w = load();
    w.init(1, 5);
    for (const n of [1, 2, 100, 500, 1000]) expect(batch(w, n)).toHaveLength(n);
  });

  it('invalid size: 0/negative → empty batch, oversized is clamped', () => {
    const w = load();
    w.init(1, 5);
    expect(batch(w, 0)).toHaveLength(0);
    expect(batch(w, -10)).toHaveLength(0);
    expect(w.generateBatch(10 ** 6)).toBe(w.maxBatch());
  });

  it('generates nothing without init', () => {
    expect(load().generateBatch(10)).toBe(0);
  });

  it('init clamps the instrument count', () => {
    const w = load();
    expect(w.init(1, 0)).toBe(1);
    expect(w.init(1, 50)).toBe(50);
    expect(w.init(1, 10 ** 6)).toBe(w.maxInstruments());
  });

  it('all values are valid across many batches', () => {
    const w = load();
    const instruments = 50;
    w.init(123, instruments);
    // Count violations in a loop (rather than an expect per record) to keep the test fast.
    const violations: Record<string, number> = {};
    const check = (name: string, ok: boolean) => { if (!ok) violations[name] = (violations[name] ?? 0) + 1; };
    let total = 0;
    for (let b = 0; b < 100; b++) {
      for (const r of batch(w, 1000)) {
        total++;
        check('instrument', Number.isInteger(r.instrument) && r.instrument >= 0 && r.instrument < instruments);
        check('prices are positive', r.bid > 0 && r.ask > 0 && r.price > 0);
        check('bid < ask', r.ask > r.bid);
        check('trade at bid or ask', r.price === r.bid || r.price === r.ask);
        check('trade quantity > 0', r.qty > 0);
        check('book quantities >= 0', r.bidQty >= 0 && r.askQty >= 0);
      }
    }
    expect(total).toBe(100_000);
    expect(violations).toEqual({});
  });

  it('an instrument may repeat within a batch; all instruments appear', () => {
    const w = load();
    w.init(9, 3);
    const recs = batch(w, 1000);
    const counts = [0, 0, 0];
    recs.forEach((r) => counts[r.instrument]++);
    expect(counts.every((c) => c > 0)).toBe(true);
    expect(counts.some((c) => c > 1)).toBe(true);
    w.init(9, 1);
    expect(new Set(batch(w, 100).map((r) => r.instrument))).toEqual(new Set([0]));
  });

  it('prices evolve from previous values rather than being independent', () => {
    const w = load();
    w.init(5, 1);
    let prev = batch(w, 1)[0].bid;
    for (let i = 0; i < 2000; i++) {
      const cur = batch(w, 1)[0].bid;
      expect(Math.abs(cur - prev) / prev).toBeLessThan(0.01); // step is far smaller than 1%
      prev = cur;
    }
  });

  it('book quantities evolve from previous values (imbalance persists)', () => {
    const w = load();
    w.init(11, 1);
    let prev = batch(w, 1)[0];
    let bigJumps = 0;
    for (let i = 0; i < 2000; i++) {
      const cur = batch(w, 1)[0];
      // A step is noise (σ = 40) plus consumption by one trade (≤ 100); independent draws over 0…2000 would jump far more.
      if (Math.abs(cur.bidQty - prev.bidQty) > 300 || Math.abs(cur.askQty - prev.askQty) > 300) bigJumps++;
      prev = cur;
    }
    expect(bigJumps).toBe(0);
  });

  it('the trade side follows the book: buys (at the ask) dominate when bids outweigh asks', () => {
    const w = load();
    w.init(21, 1);
    const side = { bidHeavy: { buys: 0, total: 0 }, askHeavy: { buys: 0, total: 0 } };
    let prev = batch(w, 1)[0];
    for (let i = 0; i < 20_000; i++) {
      const cur = batch(w, 1)[0];
      const imbalance = (prev.bidQty - prev.askQty) / (prev.bidQty + prev.askQty || 1);
      const bucket = imbalance > 0.3 ? side.bidHeavy : imbalance < -0.3 ? side.askHeavy : null;
      if (bucket) { bucket.total++; if (cur.price === cur.ask) bucket.buys++; }
      prev = cur;
    }
    expect(side.bidHeavy.total).toBeGreaterThan(100);
    expect(side.askHeavy.total).toBeGreaterThan(100);
    expect(side.bidHeavy.buys / side.bidHeavy.total).toBeGreaterThan(0.55);
    expect(side.askHeavy.buys / side.askHeavy.total).toBeLessThan(0.45);
  });

  it('state persists between calls: batches form a single trajectory', () => {
    const a = load();
    a.init(7, 2);
    const split = [...batch(a, 50), ...batch(a, 50)];
    const b = load();
    b.init(7, 2);
    expect(batch(b, 100)).toEqual(split);
  });

  it('the same seed yields the same data, a different one yields different data', () => {
    const run = (seed: number) => { const w = load(); w.init(seed, 4); return batch(w, 200); };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('init resets the previous run’s state', () => {
    const w = load();
    w.init(3, 4);
    const first = batch(w, 100);
    batch(w, 500);
    w.init(3, 4);
    expect(batch(w, 100)).toEqual(first);
  });

  it('instances are isolated from each other', () => {
    const a = load(), b = load();
    a.init(1, 2);
    b.init(2, 2);
    batch(a, 10);
    expect(batch(b, 5)).toHaveLength(5);
  });
});
