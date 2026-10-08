// Test doubles shared by several spec files. Excluded from the app build (see tsconfig.app.json).
import { readFileSync } from 'node:fs';
import { MarketExports, Timers } from '../app/core/producer-core';
import { WorkerLike } from '../app/core/producer.service';
import { WorkerInput, WorkerOutput } from '../app/core/worker-protocol';

/** Manual timers: time moves only via advance() (or `time +=` to simulate work); there are no real waits. */
export class FakeTimers implements Timers {
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  time = 0;
  get active() { return this.pending.size; }
  now() { return this.time; }
  setTimeout(fn: () => void, ms: number) { const id = this.next++; this.pending.set(id, { at: this.time + ms, fn }); return id; }
  clearTimeout(h: unknown) { this.pending.delete(h as number); }
  advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.time = Math.max(this.time, due[1].at);
      due[1].fn();
    }
    this.time = Math.max(this.time, end);
  }
}

/** Worker stand-in: records sent commands, lets the test emit worker messages. */
export class FakeWorker implements WorkerLike {
  sent: WorkerInput[] = [];
  onmessage: ((e: MessageEvent<WorkerOutput>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage(m: WorkerInput) { this.sent.push(m); }
  emit(data: WorkerOutput) { this.onmessage?.({ data } as MessageEvent<WorkerOutput>); }
}

/** The real compiled generator (public/market.wasm is built by the pretest script). */
const compiled = new WebAssembly.Module(readFileSync('public/market.wasm'));
export const loadWasm = <T extends MarketExports = MarketExports>(): T =>
  new WebAssembly.Instance(compiled, { env: { abort: () => { throw new Error('abort'); } } }).exports as unknown as T;
