/** One market update: a simulated trade and a bid/ask snapshot. Prices are integer cents. */
export interface MarketUpdate {
  instrument: number;
  priceCents: number;
  tradeQuantity: number;
  bidCents: number;
  askCents: number;
  bidQuantity: number;
  askQuantity: number;
}

/** Number of i32 values in one record written by Wasm (see assembly/index.ts). */
export const RECORD_STRIDE = 7;
/** Number of metric values per instrument in a snapshot: last, spread, volume, vwap, imbalance. */
export const METRIC_STRIDE = 5;

/** Accumulated state of one instrument since the run started. */
export interface InstrumentTotals {
  lastPriceCents: number | null;
  bidCents: number | null;
  askCents: number | null;
  bidQuantity: number;
  askQuantity: number;
  /** sum(tradeQuantity) */
  volume: number;
  /** sum(priceCents × tradeQuantity) */
  priceQuantitySum: number;
}

/** Computed metrics; prices in dollars. null = unavailable (no data or zero denominator). */
export interface Metrics {
  lastPrice: number | null;
  spread: number | null;
  volume: number;
  vwap: number | null;
  imbalance: number | null;
}

export function emptyTotals(): InstrumentTotals {
  return {
    lastPriceCents: null,
    bidCents: null,
    askCents: null,
    bidQuantity: 0,
    askQuantity: 0,
    volume: 0,
    priceQuantitySum: 0,
  };
}

/** Pure function: metrics from accumulated state. Rounding happens only at display time. */
export function computeMetrics(t: InstrumentTotals): Metrics {
  const bookTotal = t.bidQuantity + t.askQuantity;
  return {
    lastPrice: t.lastPriceCents === null ? null : t.lastPriceCents / 100,
    spread: t.bidCents === null || t.askCents === null ? null : (t.askCents - t.bidCents) / 100,
    volume: t.volume,
    vwap: t.volume === 0 ? null : t.priceQuantitySum / t.volume / 100,
    imbalance: bookTotal === 0 ? null : (t.bidQuantity - t.askQuantity) / bookTotal,
  };
}

/**
 * Accumulates updates per instrument. Event history is not stored — only totals,
 * but every trade is counted exactly once.
 *
 * Sums in `number` (f64) are exact up to 2^53: price ≤ ~2·10^4 cents × quantity ≤ 100 gives ~2·10^6 per trade,
 * leaving headroom for billions of trades.
 */
export class MetricsAggregator {
  private readonly totals: InstrumentTotals[];
  private updates = 0;

  constructor(readonly instrumentCount: number) {
    this.totals = Array.from({ length: instrumentCount }, emptyTotals);
  }

  get totalUpdates(): number {
    return this.updates;
  }

  applyUpdate(u: MarketUpdate): void {
    const t = this.totals[u.instrument];
    if (!t) throw new RangeError(`Unknown instrument: ${u.instrument}`);
    t.lastPriceCents = u.priceCents;
    t.bidCents = u.bidCents;
    t.askCents = u.askCents;
    t.bidQuantity = u.bidQuantity;
    t.askQuantity = u.askQuantity;
    t.volume += u.tradeQuantity;
    t.priceQuantitySum += u.priceCents * u.tradeQuantity;
    this.updates++;
  }

  /**
   * Applies `updateCount` records from the flat Wasm buffer. Same logic as `applyUpdate`, but reads the
   * Int32Array directly: no object per update on the hot path (up to 20,000 updates/s).
   */
  applyBatch(records: Int32Array, updateCount: number): void {
    for (let k = 0; k < updateCount; k++) {
      const o = k * RECORD_STRIDE;
      const t = this.totals[records[o]];
      if (!t) throw new RangeError(`Unknown instrument: ${records[o]}`);
      const price = records[o + 1];
      const quantity = records[o + 2];
      t.lastPriceCents = price;
      t.bidCents = records[o + 3];
      t.askCents = records[o + 4];
      t.bidQuantity = records[o + 5];
      t.askQuantity = records[o + 6];
      t.volume += quantity;
      t.priceQuantitySum += price * quantity;
    }
    this.updates += updateCount;
  }

  metrics(instrument: number): Metrics {
    return computeMetrics(this.totals[instrument]);
  }

  /** Flat snapshot for the UI: METRIC_STRIDE values per instrument, NaN = unavailable. */
  snapshot(): Float64Array {
    const out = new Float64Array(this.totals.length * METRIC_STRIDE);
    this.totals.forEach((t, i) => {
      const m = computeMetrics(t);
      const o = i * METRIC_STRIDE;
      out[o] = m.lastPrice ?? NaN;
      out[o + 1] = m.spread ?? NaN;
      out[o + 2] = m.volume;
      out[o + 3] = m.vwap ?? NaN;
      out[o + 4] = m.imbalance ?? NaN;
    });
    return out;
  }
}
