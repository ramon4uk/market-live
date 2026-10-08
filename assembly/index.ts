// Market update generator. Compiled to WebAssembly (AssemblyScript).
//
// One record (update) = one simulated trade + the current bid/ask snapshot.
// All prices are integer cents. Metrics are NOT computed here: the TypeScript aggregator does that.
//
// Record layout in linear memory (RECORD_STRIDE × i32):
//   0 instrument      instrument index
//   1 priceCents      trade price (equals bidCents or askCents)
//   2 tradeQuantity   trade quantity, > 0
//   3 bidCents
//   4 askCents        always > bidCents
//   5 bidQuantity     available buy volume, >= 0
//   6 askQuantity     available sell volume, >= 0

const MAX_INSTRUMENTS: i32 = 256;
const MAX_BATCH: i32 = 4096;
const RECORD_STRIDE: i32 = 7;

const MIN_MID_CENTS: f64 = 100.0; // price never drops below $1
const VOLATILITY: f64 = 0.0002; // σ of the log step per update
const REVERSION: f64 = 0.0005; // weak pull towards the initial price so it doesn't drift away
const IMPACT: f64 = 0.0001; // a buy nudges the price up, a sell down

const BASE_DEPTH: f64 = 500.0; // typical book quantity on each side
const MAX_DEPTH: f64 = 2000.0;
const DEPTH_NOISE: f64 = 40.0; // σ of the book quantity step per update
const DEPTH_REVERSION: f64 = 0.15; // pull towards BASE_DEPTH: replenishes consumed liquidity fast enough
// that the buy-pressure feedback (bid-heavy → buys → ask consumed) does not pin imbalance at ±1
const SIDE_BIAS: f64 = 0.3; // how strongly the book imbalance tilts the trade side

// Per-instrument state is kept between calls.
const midCents = new StaticArray<f64>(MAX_INSTRUMENTS);
const anchorCents = new StaticArray<f64>(MAX_INSTRUMENTS);
const bidDepth = new StaticArray<f64>(MAX_INSTRUMENTS);
const askDepth = new StaticArray<f64>(MAX_INSTRUMENTS);
const output = new StaticArray<i32>(MAX_BATCH * RECORD_STRIDE);

let count: i32 = 0;
let rng: u64 = 1;

// ---------- Pseudo-random number generator (xorshift64*) ----------

function nextU64(): u64 {
  rng ^= rng >> 12;
  rng ^= rng << 25;
  rng ^= rng >> 27;
  return rng * 2685821657736338717;
}

// Uniform number in [0, 1).
function rand(): f64 {
  return <f64>(nextU64() >> 11) / 9007199254740992.0;
}

// Integer in [0, n).
function randInt(n: i32): i32 {
  return <i32>(rand() * <f64>n);
}

// Standard normal distribution (Box–Muller).
function gauss(): f64 {
  const u1: f64 = 1.0 - rand(); // (0, 1] so log never yields -inf
  const u2: f64 = rand();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

// Book quantity random walk: noise plus a pull towards BASE_DEPTH, kept within [0, MAX_DEPTH].
function evolveDepth(depth: f64): f64 {
  return min(max(depth + DEPTH_NOISE * gauss() + DEPTH_REVERSION * (BASE_DEPTH - depth), 0.0), MAX_DEPTH);
}

// ---------- Public API ----------

/** Starts a new run: resets state, seeds the PRNG. Returns the actual number of instruments. */
export function init(seed: u32, instrumentCount: i32): i32 {
  count = min(max(instrumentCount, 1), MAX_INSTRUMENTS);
  rng = (<u64>seed + 1) * 0x9e3779b97f4a7c15;
  for (let i = 0; i < count; i++) {
    const start = <f64>(2000 + ((i * 3701) % 20000)); // $20 … $220
    anchorCents[i] = start;
    midCents[i] = start;
    bidDepth[i] = BASE_DEPTH * (0.5 + rand());
    askDepth[i] = BASE_DEPTH * (0.5 + rand());
  }
  return count;
}

/**
 * Generates a batch of `requested` updates (clamped to [0, MAX_BATCH]) and returns the actual count.
 * Each update's instrument is chosen at random, so it may repeat within a batch.
 *
 * Per update, for that instrument:
 *   1. bid/ask book quantities take a random-walk step (so imbalance persists between updates);
 *   2. the trade side is drawn with a tilt towards the heavier side: more bids → buyers lift the ask more often;
 *   3. the mid price evolves from its previous value (random walk + small impact of the trade side);
 *   4. the trade consumes liquidity on the side it hits.
 */
export function generateBatch(requested: i32): i32 {
  if (count == 0) return 0;
  const n = min(max(requested, 0), MAX_BATCH);

  for (let k = 0; k < n; k++) {
    const i = randInt(count);

    let bidQty = evolveDepth(bidDepth[i]);
    let askQty = evolveDepth(askDepth[i]);
    const book = bidQty + askQty;
    const imbalance = book > 0.0 ? (bidQty - askQty) / book : 0.0;
    const buy = rand() < 0.5 + SIDE_BIAS * imbalance;

    // Evolve the "fair" price from its previous value.
    const mid = max(
      midCents[i] *
        Math.exp(
          VOLATILITY * gauss() + (buy ? IMPACT : -IMPACT) - REVERSION * Math.log(midCents[i] / anchorCents[i]),
        ),
      MIN_MID_CENTS,
    );
    midCents[i] = mid;

    const bid = <i32>Math.floor(mid); // >= 100
    const ask = bid + 1 + randInt(5); // spread of 1–5 cents, bid < ask
    const price = buy ? ask : bid; // a buy trades at the ask, a sell at the bid
    const quantity = 1 + randInt(100);

    // The trade takes liquidity from the side it hits.
    if (buy) askQty = max(askQty - <f64>quantity, 0.0);
    else bidQty = max(bidQty - <f64>quantity, 0.0);
    bidDepth[i] = bidQty;
    askDepth[i] = askQty;

    const o = k * RECORD_STRIDE;
    output[o] = i;
    output[o + 1] = price;
    output[o + 2] = quantity;
    output[o + 3] = bid;
    output[o + 4] = ask;
    output[o + 5] = <i32>bidQty;
    output[o + 6] = <i32>askQty;
  }
  return n;
}

/** Pointer to the results buffer: `generateBatch()` records of `recordStride()` i32 values each. */
export function outputPtr(): usize {
  return changetype<usize>(output);
}

export function recordStride(): i32 {
  return RECORD_STRIDE;
}

export function maxBatch(): i32 {
  return MAX_BATCH;
}

export function maxInstruments(): i32 {
  return MAX_INSTRUMENTS;
}
