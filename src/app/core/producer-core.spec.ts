import { FakeTimers, loadWasm } from '../../testing/fakes';
import { decodeRows } from './metrics';
import { DEFAULT_CONFIG, ProducerConfig } from './producer-config';
import { MarketExports, ProducerCore } from './producer-core';
import { WorkerOutput } from './worker-protocol';

function setup(wasm: MarketExports = loadWasm(), timers = new FakeTimers()) {
  const messages: WorkerOutput[] = [];
  const core = new ProducerCore(wasm, (m) => messages.push(m), timers, () => 42);
  const snapshots = () => messages.filter((m): m is Extract<WorkerOutput, { type: 'snapshot' }> => m.type === 'snapshot');
  const statuses = () => messages.filter((m) => m.type === 'status').map((m) => (m as { status: string }).status);
  const rows = () => decodeRows(snapshots().at(-1)!.values);
  return { core, timers, messages, snapshots, statuses, rows };
}

/** The real Wasm with generateBatch wrapped: lets a test inject failures or simulate processing time. */
function wrapBatch(generateBatch: (n: number, real: (n: number) => number) => number): MarketExports {
  const wasm = loadWasm();
  return { ...wasm, generateBatch: (n: number) => generateBatch(n, wasm.generateBatch) };
}

const config: ProducerConfig = { instruments: 3, updatesPerBatch: 100, batchIntervalMs: 200 };

describe('ProducerCore', () => {
  it('start: initial snapshot without data, then running', () => {
    const { core, snapshots, statuses, rows } = setup();
    core.start(1, config);
    expect(snapshots()).toHaveLength(1);
    expect(rows()).toHaveLength(3);
    expect(rows().every((r) => r.lastPrice === null && r.vwap === null && r.imbalance === null && r.volume === 0)).toBe(true);
    expect(statuses()).toEqual(['running']);
  });

  it('generates one batch per interval, each update counted once', () => {
    const { core, timers, snapshots } = setup();
    core.start(1, config);
    timers.advance(199);
    expect(snapshots()).toHaveLength(1); // too early
    timers.advance(1);
    expect(snapshots().at(-1)).toMatchObject({ batches: 1, updates: 100 });
    timers.advance(2000);
    expect(snapshots().at(-1)).toMatchObject({ batches: 11, updates: 1100 });
  });

  it('total volume across instruments grows only through generated trades', () => {
    const { core, timers, rows } = setup();
    core.start(1, config);
    timers.advance(200);
    const v1 = rows().reduce((s, r) => s + r.volume, 0);
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThanOrEqual(100 * 100); // ≤ 100 trades × ≤ 100 units
    timers.advance(200);
    expect(rows().reduce((s, r) => s + r.volume, 0)).toBeGreaterThan(v1);
  });

  it('pause stops generation; resume keeps values and doesn’t catch up on missed time', () => {
    const { core, timers, snapshots, statuses, rows } = setup();
    core.start(1, config);
    timers.advance(1000);
    const before = rows();
    const count = snapshots().length;

    core.pause(1);
    expect(statuses().at(-1)).toBe('paused');
    expect(timers.active).toBe(0); // no timer — nothing is generated
    timers.advance(10 * 60_000); // long idle period
    expect(snapshots()).toHaveLength(count);

    core.resume(1);
    expect(statuses().at(-1)).toBe('running');
    expect(rows()).toEqual(before); // values preserved
    expect(snapshots().at(-1)!.batches).toBe(5); // no batch appeared during the pause
    timers.advance(200);
    expect(snapshots().at(-1)).toMatchObject({ batches: 6, updates: 600 }); // exactly one new batch
    expect(rows().every((r, i) => r.volume >= before[i].volume)).toBe(true);
  });

  it('pause/resume are ignored in the wrong state', () => {
    const { core, statuses } = setup();
    core.pause(1);
    core.resume(1);
    expect(statuses()).toEqual([]);
    core.start(1, config);
    core.resume(1); // already running
    core.pause(1);
    core.pause(1); // already paused
    expect(statuses()).toEqual(['running', 'paused']);
  });

  it('commands with a different runId are ignored', () => {
    const { core, timers, statuses } = setup();
    core.start(2, config);
    core.pause(1); // command from an old run
    expect(statuses()).toEqual(['running']);
    expect(timers.active).toBe(1);
    core.pause(2);
    core.resume(1);
    expect(statuses()).toEqual(['running', 'paused']);
  });

  it('start from paused begins a new run from zero and runs again', () => {
    const { core, timers, snapshots, statuses, rows } = setup();
    core.start(1, config);
    timers.advance(1000);
    core.pause(1);
    core.start(2, { ...config, instruments: 2 });
    expect(statuses().at(-1)).toBe('running');
    expect(rows()).toHaveLength(2);
    expect(rows().every((r) => r.volume === 0 && r.vwap === null)).toBe(true);
    expect(snapshots().at(-1)).toMatchObject({ runId: 2, batches: 0, updates: 0 });
    timers.advance(200);
    expect(snapshots().at(-1)).toMatchObject({ runId: 2, batches: 1 });
  });

  it('restart leaves no extra timers, and messages carry runId', () => {
    const { core, timers, messages } = setup();
    core.start(1, config);
    core.start(2, config);
    core.start(3, config);
    expect(timers.active).toBe(1);
    timers.advance(200);
    expect(new Set(messages.slice(-2).map((m) => m.runId))).toEqual(new Set([3]));
  });

  it('dispose clears the timer', () => {
    const { core, timers, snapshots } = setup();
    core.start(1, config);
    core.dispose();
    expect(timers.active).toBe(0);
    timers.advance(5000);
    expect(snapshots()).toHaveLength(1);
  });

  it('Wasm error during a batch → status error, generation stops', () => {
    const { core, timers, messages } = setup(wrapBatch(() => { throw new Error('trap'); }));
    core.start(1, config);
    timers.advance(200);
    expect(messages.at(-1)).toEqual({ type: 'status', runId: 1, status: 'error', error: 'trap' });
    expect(timers.active).toBe(0);
  });

  it('batch processing time doesn’t stretch the interval (drift correction)', () => {
    const timers = new FakeTimers();
    const slow = wrapBatch((n, real) => { timers.time += 30; return real(n); }); // each batch costs 30 ms
    const { core, snapshots } = setup(slow, timers);
    core.start(1, config);
    timers.advance(2000);
    // Without correction: one batch per 230 ms → 8. With it: one per 200 ms → 10.
    expect(snapshots().at(-1)).toMatchObject({ batches: 10, updates: 1000 });
  });

  it('when generation falls behind, missed batches aren’t replayed in a burst', () => {
    const timers = new FakeTimers();
    const batchTimes: number[] = [];
    const overloaded = wrapBatch((n, real) => { batchTimes.push(timers.time); timers.time += 500; return real(n); });
    const { core } = setup(overloaded, timers);
    core.start(1, config);
    timers.advance(2000);
    // A batch takes 500 ms > 200 ms interval: batches run back to back, never two at the same moment.
    expect(batchTimes).toEqual([200, 700, 1200, 1700]);
  });

  it('activeMs counts running time only, pauses excluded', () => {
    const { core, timers, snapshots } = setup();
    core.start(1, config);
    expect(snapshots().at(-1)!.activeMs).toBe(0);
    timers.advance(400);
    expect(snapshots().at(-1)).toMatchObject({ batches: 2, activeMs: 400 });
    core.pause(1);
    timers.advance(10_000);
    core.resume(1);
    timers.advance(200);
    expect(snapshots().at(-1)).toMatchObject({ batches: 3, activeMs: 600 }); // actual rate = 300 / 0.6 s = 500/s
    core.start(2, config);
    expect(snapshots().at(-1)).toMatchObject({ runId: 2, activeMs: 0 });
  });

  it('failed: false while healthy, true after a Wasm error, cleared by a new start', () => {
    let broken = true;
    const { core, timers } = setup(wrapBatch((n, real) => { if (broken) throw new Error('trap'); return real(n); }));
    core.start(1, config);
    expect(core.failed).toBe(false);
    timers.advance(200);
    expect(core.failed).toBe(true);
    broken = false;
    core.start(2, config);
    expect(core.failed).toBe(false);
  });

  it('rejects Wasm with an incompatible record format', () => {
    const wasm = loadWasm();
    expect(() => new ProducerCore({ ...wasm, recordStride: () => 3 } as MarketExports, () => undefined)).toThrow(/Incompatible/);
  });

  it('default config works', () => {
    const { core, timers, snapshots } = setup();
    core.start(1, { ...DEFAULT_CONFIG });
    timers.advance(500);
    expect(snapshots().at(-1)).toMatchObject({ batches: 1, updates: 100 });
  });
});
