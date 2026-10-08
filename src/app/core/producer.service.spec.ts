import { TestBed } from '@angular/core/testing';
import { FakeWorker } from '../../testing/fakes';
import { DEFAULT_CONFIG } from './producer-config';
import { ProducerService, WORKER_FACTORY } from './producer.service';
import { WorkerInput, WorkerOutput } from './worker-protocol';

const snap = (runId: number, first: number[], updates = 1, activeMs = 500): WorkerOutput => ({
  type: 'snapshot', runId, values: new Float64Array(first), batches: 1, updates, activeMs,
});

describe('ProducerService', () => {
  let workers: FakeWorker[];
  let service: ProducerService;

  beforeEach(() => {
    workers = [];
    TestBed.configureTestingModule({
      providers: [{ provide: WORKER_FACTORY, useValue: () => { const w = new FakeWorker(); workers.push(w); return w; } }],
    });
    service = TestBed.inject(ProducerService);
  });
  const worker = () => workers[0];
  const lastStart = () => worker().sent.filter((m) => m.type === 'start').at(-1) as Extract<WorkerInput, { type: 'start' }>;

  it('starts idle; rows unavailable with zero volume', () => {
    expect(service.status()).toBe('idle');
    expect(service.rows()).toHaveLength(DEFAULT_CONFIG.instruments);
    expect(service.rows()[0]).toMatchObject({ lastPrice: null, vwap: null, volume: 0 });
    expect(service.canToggle()).toBe(false);
    expect(workers).toHaveLength(0); // the worker is created only on start
  });

  it('ensureStarted starts the default settings exactly once', () => {
    service.ensureStarted();
    service.ensureStarted();
    expect(workers).toHaveLength(1);
    expect(worker().sent).toHaveLength(1);
    expect(lastStart()).toMatchObject({ runId: 1, config: DEFAULT_CONFIG });
    expect(lastStart().wasmUrl).toMatch(/market\.wasm$/);
    expect(service.status()).toBe('loading');
  });

  it('applies snapshots and statuses of the active run', () => {
    service.ensureStarted();
    worker().emit({ type: 'status', runId: 1, status: 'running' });
    worker().emit(snap(1, [102, 0.04, 40, 101.5, 0.2], 7));
    expect(service.status()).toBe('running');
    expect(service.updates()).toBe(7);
    expect(service.rows()[0]).toEqual({ symbol: 'ALFA', lastPrice: 102, trend: 0, spread: 0.04, volume: 40, vwap: 101.5, imbalance: 0.2 });
    expect(service.canToggle()).toBe(true);
  });

  it('price trend is derived from the previous snapshot', () => {
    service.ensureStarted();
    worker().emit(snap(1, [102, 0.04, 40, 101.5, 0.2]));
    worker().emit(snap(1, [101, 0.04, 50, 101.4, 0.2]));
    expect(service.rows()[0].trend).toBe(-1);
  });

  it('actual rate: updates per second of running time; null before the first batch and after Apply', () => {
    service.ensureStarted();
    expect(service.actualRate()).toBeNull();
    worker().emit({ ...snap(1, [102, 0.04, 40, 101.5, 0.2]), batches: 0, updates: 0, activeMs: 0 } as WorkerOutput);
    expect(service.actualRate()).toBeNull();
    worker().emit(snap(1, [102, 0.04, 40, 101.5, 0.2], 300, 1500));
    expect(service.actualRate()).toBe(200);
    service.apply(DEFAULT_CONFIG);
    expect(service.actualRate()).toBeNull();
  });

  it('toggle: running → pause, paused → resume; with the active run’s runId', () => {
    service.ensureStarted();
    worker().emit({ type: 'status', runId: 1, status: 'running' });
    service.toggle();
    expect(worker().sent.at(-1)).toEqual({ type: 'pause', runId: 1 });
    worker().emit({ type: 'status', runId: 1, status: 'paused' });
    expect(service.status()).toBe('paused');
    service.toggle();
    expect(worker().sent.at(-1)).toEqual({ type: 'resume', runId: 1 });
  });

  it('toggle sends nothing during loading/error', () => {
    service.ensureStarted();
    service.toggle();
    expect(worker().sent).toHaveLength(1);
  });

  describe('apply', () => {
    it('clears the previous run’s values and totals and changes the config', () => {
      service.ensureStarted();
      worker().emit({ type: 'status', runId: 1, status: 'running' });
      worker().emit(snap(1, [102, 0.04, 40, 101.5, 0.2], 9));
      expect(service.apply({ instruments: 2, updatesPerBatch: 10, batchIntervalMs: 100 })).toBe(true);
      expect(service.config()).toEqual({ instruments: 2, updatesPerBatch: 10, batchIntervalMs: 100 });
      expect(service.rows()).toHaveLength(2);
      expect(service.rows().every((r) => r.volume === 0 && r.lastPrice === null && r.vwap === null)).toBe(true);
      expect(service.updates()).toBe(0);
      expect(service.batches()).toBe(0);
      expect(lastStart()).toMatchObject({ runId: 2, config: { instruments: 2 } });
    });

    it('from paused starts a new run (generation resumes)', () => {
      service.ensureStarted();
      worker().emit({ type: 'status', runId: 1, status: 'running' });
      worker().emit({ type: 'status', runId: 1, status: 'paused' });
      service.apply(DEFAULT_CONFIG);
      expect(service.status()).toBe('loading');
      expect(lastStart().runId).toBe(2);
      worker().emit({ type: 'status', runId: 2, status: 'running' });
      expect(service.status()).toBe('running');
    });

    it('rejects invalid settings and leaves the active run unchanged', () => {
      service.ensureStarted();
      worker().emit({ type: 'status', runId: 1, status: 'running' });
      expect(service.apply({ instruments: 0, updatesPerBatch: 100, batchIntervalMs: 500 })).toBe(false);
      expect(service.apply({ instruments: 5, updatesPerBatch: 100.5, batchIntervalMs: 500 })).toBe(false);
      expect(worker().sent).toHaveLength(1);
      expect(service.status()).toBe('running');
      expect(service.config()).toEqual(DEFAULT_CONFIG);
    });

    it('doesn’t create extra workers', () => {
      service.ensureStarted();
      service.apply(DEFAULT_CONFIG);
      service.apply({ ...DEFAULT_CONFIG, instruments: 9 });
      expect(workers).toHaveLength(1);
    });
  });

  describe('discarding results of a previous run', () => {
    it('snapshots and statuses with an old runId don’t affect the new run', () => {
      service.ensureStarted();
      worker().emit({ type: 'status', runId: 1, status: 'running' });
      service.apply({ instruments: 2, updatesPerBatch: 10, batchIntervalMs: 100 }); // runId 2
      worker().emit(snap(1, [999, 1, 5000, 999, 0.9, 999, 1, 5000, 999, 0.9], 123)); // late one from run 1
      worker().emit({ type: 'status', runId: 1, status: 'paused' });
      expect(service.rows().every((r) => r.volume === 0 && r.lastPrice === null)).toBe(true);
      expect(service.updates()).toBe(0);
      expect(service.status()).toBe('loading');
      worker().emit(snap(2, [50, 0.01, 3, 50, 0.1, NaN, NaN, 0, NaN, NaN], 3));
      expect(service.rows()[0].volume).toBe(3);
      expect(service.updates()).toBe(3);
    });

    it('a late error from an old run doesn’t corrupt the new one', () => {
      service.ensureStarted();
      service.apply(DEFAULT_CONFIG);
      worker().emit({ type: 'status', runId: 1, status: 'error', error: 'old' });
      expect(service.error()).toBeNull();
      expect(service.status()).toBe('loading');
    });
  });

  describe('errors and resources', () => {
    it('Wasm init error is shown; the next Apply clears it', () => {
      service.ensureStarted();
      worker().emit({ type: 'status', runId: 1, status: 'error', error: 'Failed to load Wasm' });
      expect(service.status()).toBe('error');
      expect(service.error()).toContain('Wasm');
      service.apply(DEFAULT_CONFIG);
      expect(service.error()).toBeNull();
      expect(service.status()).toBe('loading');
    });

    it('worker failure: error, worker is destroyed, Apply creates a new one', () => {
      service.ensureStarted();
      worker().onerror?.({ message: 'crash' } as ErrorEvent);
      expect(service.status()).toBe('error');
      expect(service.error()).toBe('crash');
      expect(worker().terminate).toHaveBeenCalledTimes(1);
      service.apply(DEFAULT_CONFIG);
      expect(workers).toHaveLength(2);
    });

    it('an undeserializable message: error, worker is destroyed', () => {
      service.ensureStarted();
      worker().onmessageerror?.({} as MessageEvent);
      expect(service.status()).toBe('error');
      expect(service.error()).toContain('deserialized');
      expect(worker().terminate).toHaveBeenCalledTimes(1);
      service.apply(DEFAULT_CONFIG);
      expect(workers).toHaveLength(2);
    });

    it('if the worker can’t be created — a clear error, no exception', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: WORKER_FACTORY, useValue: () => { throw new Error('no workers'); } }] });
      const s = TestBed.inject(ProducerService);
      expect(() => s.ensureStarted()).not.toThrow();
      expect(s.status()).toBe('error');
      expect(s.error()).toContain('no workers');
    });

    it('destroying the service terminates the worker', () => {
      service.ensureStarted();
      TestBed.resetTestingModule();
      expect(worker().terminate).toHaveBeenCalledTimes(1);
    });
  });
});
