import { computed, DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, Subject } from 'rxjs';
import { configErrors, DEFAULT_CONFIG, ProducerConfig } from './producer-config';
import { decodeRows, emptyRows, InstrumentRow } from './metrics';
import { ProducerStatus, WorkerInput, WorkerOutput } from './worker-protocol';

type Message<T extends WorkerOutput['type']> = Extract<WorkerOutput, { type: T }>;

/** Minimal Worker interface — lets tests substitute it. */
export interface WorkerLike {
  postMessage(message: WorkerInput): void;
  onmessage: ((event: MessageEvent<WorkerOutput>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

export const WORKER_FACTORY = new InjectionToken<() => WorkerLike>('WORKER_FACTORY', {
  providedIn: 'root',
  factory: () => () => new Worker(new URL('./market.worker', import.meta.url), { type: 'module' }),
});

/**
 * The single bridge between Angular and the Wasm worker. Lives at root level, so navigating between pages
 * neither creates extra producers nor resets the run.
 */
@Injectable({ providedIn: 'root' })
export class ProducerService {
  private readonly createWorker = inject(WORKER_FACTORY);
  private worker: WorkerLike | null = null;
  /** Identifier of the active run; messages with a different runId are discarded. */
  private runId = 0;

  /** Raw stream of everything the worker posts. */
  private readonly incoming$ = new Subject<WorkerOutput>();
  /** Messages of the active run only: late messages from previous runs are dropped here. */
  private readonly activeRun$ = this.incoming$.pipe(filter((m) => m.runId === this.runId));
  readonly snapshots$ = this.activeRun$.pipe(filter((m): m is Message<'snapshot'> => m.type === 'snapshot'));
  readonly statuses$ = this.activeRun$.pipe(filter((m): m is Message<'status'> => m.type === 'status'));

  private readonly _config = signal<ProducerConfig>({ ...DEFAULT_CONFIG });
  private readonly _status = signal<ProducerStatus>('idle');
  private readonly _rows = signal<InstrumentRow[]>(emptyRows(DEFAULT_CONFIG.instruments));
  private readonly _batches = signal(0);
  private readonly _updates = signal(0);
  private readonly _activeMs = signal(0);
  private readonly _error = signal<string | null>(null);

  /** Config of the active run (not the form draft). */
  readonly config = this._config.asReadonly();
  readonly status = this._status.asReadonly();
  readonly rows = this._rows.asReadonly();
  readonly batches = this._batches.asReadonly();
  readonly updates = this._updates.asReadonly();
  readonly error = this._error.asReadonly();
  /** Measured generation rate (updates per second of running time); null until the first batch. */
  readonly actualRate = computed(() => {
    const ms = this._activeMs();
    return this._batches() > 0 && ms > 0 ? (this._updates() * 1000) / ms : null;
  });
  readonly canToggle = computed(() => this._status() === 'running' || this._status() === 'paused');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disposeWorker());
    this.snapshots$.pipe(takeUntilDestroyed()).subscribe((m) => {
      this._rows.set(decodeRows(m.values, this._rows()));
      this._batches.set(m.batches);
      this._updates.set(m.updates);
      this._activeMs.set(m.activeMs);
    });
    this.statuses$.pipe(takeUntilDestroyed()).subscribe((m) => {
      this._status.set(m.status);
      this._error.set(m.status === 'error' ? (m.error ?? 'Unknown error') : null);
    });
  }

  /** Starts the producer with default settings, only if no run has happened yet. */
  ensureStarted(): void {
    if (this.runId === 0) this.apply(DEFAULT_CONFIG);
  }

  /**
   * Starts a new run: clears the previous run's values and totals, and lifts any pause.
   * Returns false if the config is invalid (the run is left unchanged).
   */
  apply(config: ProducerConfig): boolean {
    if (configErrors(config).length > 0) return false;
    const clean: ProducerConfig = {
      instruments: config.instruments,
      updatesPerBatch: config.updatesPerBatch,
      batchIntervalMs: config.batchIntervalMs,
    };
    this.runId++;
    this._config.set(clean);
    this._rows.set(emptyRows(clean.instruments));
    this._batches.set(0);
    this._updates.set(0);
    this._activeMs.set(0);
    this._error.set(null);
    this._status.set('loading');
    this.send({ type: 'start', runId: this.runId, config: clean, wasmUrl: new URL('market.wasm', document.baseURI).href });
    return true;
  }

  pause(): void {
    this.send({ type: 'pause', runId: this.runId });
  }

  resume(): void {
    this.send({ type: 'resume', runId: this.runId });
  }

  toggle(): void {
    if (this._status() === 'running') this.pause();
    else if (this._status() === 'paused') this.resume();
  }

  private send(message: WorkerInput): void {
    try {
      this.ensureWorker().postMessage(message);
    } catch (e) {
      this.fail(`Failed to start the Web Worker: ${e instanceof Error ? e.message : e}`);
    }
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = ({ data }) => this.incoming$.next(data);
    // A broken worker is not reused: the next Apply creates a new one.
    worker.onerror = (event) => this.failWorker(event.message || 'Web Worker error');
    worker.onmessageerror = () => this.failWorker('A message from the Web Worker could not be deserialized');
    return (this.worker = worker);
  }

  private fail(error: string): void {
    this._status.set('error');
    this._error.set(error);
  }

  private failWorker(error: string): void {
    this.disposeWorker();
    this.fail(error);
  }

  private disposeWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }
}
