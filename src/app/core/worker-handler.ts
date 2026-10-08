import { describe, ProducerCore } from './producer-core';
import { WorkerInput, WorkerOutput } from './worker-protocol';

/** Creates a producer for a fresh Wasm instance (loads or reuses the compiled module). */
export type CoreFactory = (wasmUrl: string) => Promise<ProducerCore>;

/**
 * Worker command handling, independent of the Worker globals so it can be unit-tested.
 *
 * - Commands are processed strictly in order, even while Wasm is still loading (a promise queue).
 * - The producer is created once and reused across runs.
 * - After any error the Wasm instance is dropped: its memory may be corrupted after a trap.
 *   The next `start` creates a fresh instance.
 *
 * Returns the message handler; its promise resolves once that command has been processed.
 */
export function createCommandHandler(createCore: CoreFactory, post: (message: WorkerOutput) => void) {
  let core: ProducerCore | null = null;
  let queue: Promise<void> = Promise.resolve();

  const drop = () => {
    core?.dispose();
    core = null;
  };

  async function handle(message: WorkerInput): Promise<void> {
    try {
      switch (message.type) {
        case 'start':
          post({ type: 'status', runId: message.runId, status: 'loading' });
          if (core?.failed) drop(); // a Wasm trap during the previous run
          core ??= await createCore(message.wasmUrl);
          core.start(message.runId, message.config);
          break;
        case 'pause':
          core?.pause(message.runId);
          break;
        case 'resume':
          core?.resume(message.runId);
          break;
      }
    } catch (e) {
      drop();
      post({ type: 'status', runId: message.runId, status: 'error', error: describe(e) });
    }
  }

  return (message: WorkerInput): Promise<void> => (queue = queue.then(() => handle(message)));
}
