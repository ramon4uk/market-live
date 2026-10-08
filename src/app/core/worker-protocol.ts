import { ProducerConfig } from './producer-config';

export type ProducerStatus = 'idle' | 'loading' | 'running' | 'paused' | 'error';

/**
 * Every command carries the run's runId. The worker ignores commands with a foreign runId,
 * and the main thread discards worker messages whose runId doesn't match the active one.
 */
export type WorkerInput =
  | { type: 'start'; runId: number; config: ProducerConfig; wasmUrl: string }
  | { type: 'pause'; runId: number }
  | { type: 'resume'; runId: number };

export type WorkerOutput =
  | { type: 'status'; runId: number; status: ProducerStatus; error?: string }
  | {
      type: 'snapshot';
      runId: number;
      /** Per-instrument metrics (see METRIC_STRIDE), NaN = unavailable. */
      values: Float64Array;
      /** Number of batches and updates processed in this run. */
      batches: number;
      updates: number;
      /** Running time of this run in ms, pauses excluded (for the actual rate: updates / activeMs). */
      activeMs: number;
    };
