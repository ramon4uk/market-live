# Market Live — Angular + WebAssembly (AssemblyScript) + Web Worker

A real-time market dashboard and a settings page for the data producer.

- **Live demo:** https://ramon4uk.github.io/market-live/
- **Repository:** https://github.com/ramon4uk/market-live

## Running
```bash
nvm use            # Node 26.10.0 (.nvmrc)
npm install
npm start          # builds Wasm and runs ng serve (http://localhost:4200)
npm test           # builds Wasm and runs the unit tests (Vitest)
npm run build      # builds Wasm and the production bundle into dist/
npx playwright install chromium   # once, downloads the browser for the e2e tests
npm run e2e        # Playwright end-to-end tests (starts the dev server on :4300 itself)
```
Wasm is built with `npm run build:wasm` (AssemblyScript → `public/market.wasm`);
it is already part of `start`, `build` and `test`.

## Deployment
Every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): `npm ci`, the unit tests,
the Playwright e2e tests, a production build with `--base-href /<repo>/` and a deploy to GitHub Pages. Pull requests run the tests and the
build without deploying. `index.html` is copied to `404.html`, so deep links and reloads (e.g. `/settings`) are
handled by the Angular router; the browser console shows a 404 for such a reload, which is how Pages serves the fallback.
`public/market.wasm` is a build artifact (not committed): CI builds it from `assembly/index.ts`.

## Architecture
```
Wasm (assembly/index.ts)  →  Worker (ProducerCore + MetricsAggregator)  →  ProducerService (signals)  →  UI
  generates updates           computes metrics, owns the timer             runId, status, errors        table/form
```
- **Wasm generator** (`assembly/index.ts`) — PRNG (xorshift64*) and per-instrument state: the mid price and
  the bid/ask book quantities. Per update: the book quantities take a random-walk step; the trade side is
  tilted towards the heavier side of the book (more bids → buyers lift the ask more often); the price evolves
  from its previous value (random walk + small impact of the trade side, in integer cents); the trade consumes
  liquidity on the side it hits. `generateBatch(n)` writes `n` updates (instrument, trade price, quantity, bid,
  ask, bid/ask quantities) into linear memory. It does not compute metrics.
- **`aggregator.ts`** — pure TypeScript metrics logic: accumulates `volume`, `Σ(price×qty)`, the latest bid/ask
  and quantities per instrument. Event history is not stored; every trade is counted exactly once.
  Unavailable (`null`/`NaN`) when there is no data or the denominator is zero.
- **`producer-core.ts`** — drives Wasm, the timer and the aggregator; independent of the Worker API, so it is
  tested with fake timers (no real waits).
- **`worker-handler.ts`** — worker command handling without Worker globals (unit-tested): an ordered command
  queue (commands sent while Wasm is loading wait for it), init errors, replacing a failed Wasm instance.
- **`market.worker.ts`** — a thin wrapper: fetches and compiles `market.wasm` once, instantiates it, wires the
  handler to `postMessage`.
- **`producer.service.ts`** — a single producer per app (root service) that survives navigation.
- **RxJS** — worker messages flow through a `Subject`; the `runId` filter and the split into `snapshots$` /
  `statuses$` are RxJS pipes, and the results are written into signals. The "Applied" confirmation is
  `Subject` + `switchMap(timer)` (a repeated Apply restarts the countdown).
- **Styles** — SCSS: design tokens and mixins live in `src/styles/`.

## Key decisions
- **Metrics in TypeScript, not in Wasm:** the requirement says Wasm generates *updates*, and metrics must be
  testable on their own. Aggregation runs in the worker, so the main thread is not loaded with computation.
- **Pause** cancels the timer; nothing is generated while paused. Resume schedules the next batch from scratch
  (no catching up); values and totals are preserved.
- **The next batch is scheduled after the previous one** (`setTimeout`, not `setInterval`), so batches don't
  pile up when processing is slow. The delay is counted from the batch's *planned* time, so processing time
  doesn't stretch the interval (drift correction). If generation falls behind, the next batch runs right away,
  but missed batches are never replayed in a burst.
- **Actual rate:** the worker reports running time (pauses excluded) with each snapshot; the dashboard shows
  `updates / running time` next to the nominal rate, so it's visible whether the producer keeps up. At the
  maximum setting (1000 updates / 50 ms = 20,000/s) it stays at ≈ 20,000/s.
- **runId:** every run (Apply) gets a new `runId`. Commands and results carry it; the worker ignores commands
  with a foreign `runId`, and the service discards late messages from a previous run.
- **Apply** starts a new run: clears values and totals and lifts the pause. The form is a draft: the producer
  doesn't change until Apply. Settings are not persisted across reloads. After Apply the button gives
  feedback (press animation and a short "Applied" message).
- **UI performance:** the worker sends the UI a compact metrics snapshot (`Float64Array`, transferable) —
  one batch = one message regardless of the number of updates per batch (up to 1000). At 20,000 updates/s
  the interface stays responsive.
- **Resources:** when the service is destroyed the worker is terminated; a broken worker (`error` or
  `messageerror`) is destroyed and recreated on the next Apply. After a Wasm error (trap) the instance is
  dropped, since its memory may be corrupted: the next Apply instantiates a fresh one from the already compiled
  module. Init errors (HTTP error, unsupported WebAssembly/Worker) are shown on the dashboard.
- **Hot path without allocations:** the aggregator reads the Wasm buffer (`Int32Array`) directly, without
  creating an object per update.
- **Price trend:** the last price is coloured with ▲/▼ by its change since the previous snapshot (derived on
  the main thread from the rows already shown, so the worker protocol stays minimal).
- **Money:** prices are integer cents; rounding happens only at display time. Sums in `number` are exact up to
  2^53 (headroom for billions of trades).
- The `market.wasm` URL is built from `document.baseURI`, so the app also works from a sub-path (GitHub Pages).

## Tests (`npm test`)
Metrics (the example from the task, zero denominators, instrument isolation), settings validation,
pause/resume and discarding results of a previous run, timer drift correction and the actual rate (fake
timers, no real waits), the worker command queue and error recovery, navigation between pages (a single
producer, the paused state survives), the generator (the real compiled Wasm: batch size, value validity,
price and book evolution, the trade side following the book, seed determinism).
Shared test doubles (fake timers, fake worker, Wasm loader) live in `src/testing/`.

## End-to-end tests (`npm run e2e`)
Playwright (Chromium) drives the real app with the real Wasm in the worker, in [`e2e/`](e2e): the producer starts and
fills the table, Pause freezes the counters and Resume continues them, Apply restarts the run with the new
configuration (and lifts a pause), invalid settings block Apply, a reload on `/settings` works.
Assertions are web-first (auto-retrying) on UI state such as `data-status` and the counters; the only fixed waits are in the Pause test, to prove the counters stay frozen.
Failed runs keep a trace in `test-results/` (`npx playwright show-trace <trace.zip>`).
