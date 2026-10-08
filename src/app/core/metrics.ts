import { METRIC_STRIDE } from './aggregator';
import { symbolFor } from './producer-config';

/** Direction of the last price change: up, down, or none yet. */
export type Trend = 1 | -1 | 0;

/** One table row. null = value unavailable. */
export interface InstrumentRow {
  symbol: string;
  lastPrice: number | null;
  /** Last price vs the previous snapshot; kept while the price doesn't change. */
  trend: Trend;
  spread: number | null;
  volume: number;
  vwap: number | null;
  imbalance: number | null;
}

const orNull = (v: number | undefined): number | null =>
  v === undefined || Number.isNaN(v) ? null : v;

/** Rows before any data arrives: everything unavailable, volume zero. */
export function emptyRows(count: number): InstrumentRow[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: symbolFor(i),
    lastPrice: null,
    trend: 0,
    spread: null,
    volume: 0,
    vwap: null,
    imbalance: null,
  }));
}

function trendOf(price: number | null, previous: InstrumentRow | undefined): Trend {
  const before = previous?.lastPrice ?? null;
  if (price === null || before === null || price === before) return previous?.trend ?? 0;
  return price > before ? 1 : -1;
}

/**
 * Parses the flat metrics snapshot (NaN → null). Order: last, spread, volume, vwap, imbalance.
 * `previous` (the rows currently shown) is only used to derive the price trend.
 */
export function decodeRows(values: Float64Array, previous: readonly InstrumentRow[] = []): InstrumentRow[] {
  const rows: InstrumentRow[] = [];
  for (let i = 0; i * METRIC_STRIDE < values.length; i++) {
    const o = i * METRIC_STRIDE;
    const lastPrice = orNull(values[o]);
    rows.push({
      symbol: symbolFor(i),
      lastPrice,
      trend: trendOf(lastPrice, previous[i]),
      spread: orNull(values[o + 1]),
      volume: orNull(values[o + 2]) ?? 0,
      vwap: orNull(values[o + 3]),
      imbalance: orNull(values[o + 4]),
    });
  }
  return rows;
}
