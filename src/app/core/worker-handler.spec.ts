import { FakeTimers, loadWasm } from '../../testing/fakes';
import { DEFAULT_CONFIG } from './producer-config';
import { MarketExports, ProducerCore } from './producer-core';
import { createCommandHandler } from './worker-handler';
import { WorkerInput, WorkerOutput } from './worker-protocol';

const start = (runId: number): WorkerInput => ({ type: 'start', runId, config: { ...DEFAULT_CONFIG }, wasmUrl: 'market.wasm' });

function setup() {
  const messages: WorkerOutput[] = [];
  const post = (m: WorkerOutput) => messages.push(m);
  const timers = new FakeTimers();
  /** Each created core gets its own Wasm instance; `instances` lets a test break one. */
  const instances: MarketExports[] = [];
  let release: () => void = () => undefined;
  let gate: Promise<void> | null = null;
  const createCore = vi.fn(async () => {
    if (gate) await gate;
    const wasm = { ...loadWasm() }; // a mutable copy: Wasm exports are frozen
    instances.push(wasm);
    return new ProducerCore(wasm, post, timers, () => 1);
  });
  const handle = createCommandHandler(createCore, post);
  /** Holds Wasm loading until `release()` is called. */
  const holdLoading = () => { gate = new Promise((r) => (release = r)); return () => release(); };
  const statuses = () => messages.filter((m) => m.type === 'status').map((m) => (m as { status: string }).status);
  return { handle, createCore, timers, messages, statuses, instances, holdLoading };
}

describe('worker command handler', () => {
  it('start: loading → running; the core is created once and reused by later runs', async () => {
    const { handle, createCore, statuses, messages } = setup();
    await handle(start(1));
    expect(statuses()).toEqual(['loading', 'running']);
    await handle(start(2));
    expect(createCore).toHaveBeenCalledTimes(1);
    expect(messages.at(-1)).toMatchObject({ runId: 2, status: 'running' });
  });

  it('commands sent while Wasm is loading are processed in order after it loads', async () => {
    const { handle, statuses, holdLoading } = setup();
    const release = holdLoading();
    void handle(start(1));
    void handle({ type: 'pause', runId: 1 }); // arrives before the core exists
    const done = handle({ type: 'resume', runId: 1 });
    await Promise.resolve();
    expect(statuses()).toEqual(['loading']);
    release();
    await done;
    expect(statuses()).toEqual(['loading', 'running', 'paused', 'running']);
  });

  it('pause/resume before any start are ignored without errors', async () => {
    const { handle, messages, createCore } = setup();
    await handle({ type: 'pause', runId: 1 });
    await handle({ type: 'resume', runId: 1 });
    expect(messages).toEqual([]);
    expect(createCore).not.toHaveBeenCalled();
  });

  it('an init error is reported with the run’s runId; the next start retries loading', async () => {
    const { handle, createCore, messages, statuses } = setup();
    createCore.mockRejectedValueOnce(new Error('HTTP 404'));
    await handle(start(1));
    expect(messages.at(-1)).toEqual({ type: 'status', runId: 1, status: 'error', error: 'HTTP 404' });
    await handle(start(2));
    expect(createCore).toHaveBeenCalledTimes(2);
    expect(statuses().at(-1)).toBe('running');
  });

  it('after a Wasm trap during generation the next start uses a fresh instance', async () => {
    const { handle, createCore, timers, instances, statuses } = setup();
    await handle(start(1));
    instances[0].generateBatch = () => { throw new Error('unreachable'); };
    timers.advance(DEFAULT_CONFIG.batchIntervalMs);
    expect(statuses().at(-1)).toBe('error');

    await handle(start(2));
    expect(createCore).toHaveBeenCalledTimes(2);
    expect(statuses().at(-1)).toBe('running');
    timers.advance(DEFAULT_CONFIG.batchIntervalMs); // the new instance generates normally
    expect(statuses().at(-1)).toBe('running');
  });

  it('an error inside start drops the core and stops its timer', async () => {
    const { handle, createCore, timers, instances, messages } = setup();
    await handle(start(1));
    instances[0].init = () => { throw new Error('init trap'); };
    await handle(start(2));
    expect(messages.at(-1)).toEqual({ type: 'status', runId: 2, status: 'error', error: 'init trap' });
    expect(timers.active).toBe(0);
    await handle(start(3));
    expect(createCore).toHaveBeenCalledTimes(2);
  });
});
