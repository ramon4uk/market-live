import { MetricsAggregator, RECORD_STRIDE } from './aggregator';
import { ProducerConfig } from './producer-config';
import { ProducerStatus, WorkerOutput } from './worker-protocol';

/** Exports of the Wasm library (see assembly/index.ts). */
export interface MarketExports {
  memory: WebAssembly.Memory;
  init(seed: number, instrumentCount: number): number;
  generateBatch(requested: number): number;
  outputPtr(): number;
  recordStride(): number;
}

export interface Timers {
  /** Monotonic time, ms. */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const randomSeed = () => Math.floor(Math.random() * 0x100000000);

/**
 * Producer logic independent of the Worker API: drives the Wasm generator, the aggregator and the timer.
 *
 * The next batch is scheduled after the previous one finishes (not via setInterval), so batches never pile up.
 * The delay is measured from the batch's planned time, not from when it finished, so batch processing time
 * doesn't stretch the interval. If generation falls behind, the next batch runs immediately, but missed
 * batches are never replayed in a burst.
 * Pause cancels the timer and resume schedules a fresh batch from scratch — nothing is generated while paused.
 */
export class ProducerCore {
  private timer: unknown = null;
  private status: ProducerStatus = 'idle';
  private runId = 0;
  private config!: ProducerConfig;
  private aggregator: MetricsAggregator | null = null;
  private batches = 0;
  /** Planned time of the next batch. */
  private nextAt = 0;
  /** Running time of the run, excluding pauses: accumulated part + start of the current running stretch. */
  private activeBefore = 0;
  private runningSince: number | null = null;

  constructor(
    private readonly wasm: MarketExports,
    private readonly emit: (message: WorkerOutput, transfer?: Transferable[]) => void,
    private readonly timers: Timers = realTimers,
    private readonly seed: () => number = randomSeed,
  ) {
    if (wasm.recordStride() !== RECORD_STRIDE) {
      throw new Error(`Incompatible Wasm record format: ${wasm.recordStride()} ≠ ${RECORD_STRIDE}`);
    }
  }

  /** Starts a new run: fresh generation, zeroed totals. The previous run is cancelled. */
  start(runId: number, config: ProducerConfig): void {
    this.cancelTimer();
    this.runId = runId;
    this.config = config;
    this.batches = 0;
    this.activeBefore = 0;
    this.runningSince = null;
    this.aggregator = new MetricsAggregator(this.wasm.init(this.seed(), config.instruments));
    this.emitSnapshot(); // initial state: values unavailable, volume zero
    this.run();
  }

  pause(runId: number): void {
    if (runId !== this.runId || this.status !== 'running') return;
    this.cancelTimer();
    this.activeBefore = this.activeMs();
    this.runningSince = null;
    this.setStatus('paused');
  }

  resume(runId: number): void {
    if (runId !== this.runId || this.status !== 'paused') return;
    this.run();
  }

  /** True after a Wasm error during generation: the instance may be corrupted and should be replaced. */
  get failed(): boolean {
    return this.status === 'error';
  }

  /** Releases the timer; called when the producer is no longer needed. */
  dispose(): void {
    this.cancelTimer();
    this.runningSince = null;
    this.status = 'idle';
  }

  /** Enters `running` and plans the first batch one full interval from now. */
  private run(): void {
    const now = this.timers.now();
    this.runningSince = now;
    this.nextAt = now + this.config.batchIntervalMs;
    this.setStatus('running');
    this.schedule();
  }

  private schedule(): void {
    const delay = Math.max(0, this.nextAt - this.timers.now());
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      try {
        this.runBatch();
      } catch (e) {
        this.status = 'error';
        this.runningSince = null;
        this.emit({ type: 'status', runId: this.runId, status: 'error', error: describe(e) });
        return;
      }
      if (this.status !== 'running') return;
      // Next planned slot; if we're already past it, start from now (no burst of missed batches).
      this.nextAt = Math.max(this.nextAt + this.config.batchIntervalMs, this.timers.now());
      this.schedule();
    }, delay);
  }

  private activeMs(): number {
    return this.activeBefore + (this.runningSince === null ? 0 : this.timers.now() - this.runningSince);
  }

  private runBatch(): void {
    const produced = this.wasm.generateBatch(this.config.updatesPerBatch);
    const records = new Int32Array(this.wasm.memory.buffer, this.wasm.outputPtr(), produced * RECORD_STRIDE);
    this.aggregator!.applyBatch(records, produced); // every trade is counted exactly once
    this.batches++;
    this.emitSnapshot();
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setStatus(status: ProducerStatus): void {
    this.status = status;
    this.emit({ type: 'status', runId: this.runId, status });
  }

  private emitSnapshot(): void {
    const values = this.aggregator!.snapshot();
    this.emit(
      {
        type: 'snapshot',
        runId: this.runId,
        values,
        batches: this.batches,
        updates: this.aggregator!.totalUpdates,
        activeMs: this.activeMs(),
      },
      [values.buffer],
    );
  }
}

export function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
