import { ProducerStatus } from './worker-protocol';

/** Human-readable label for each producer status. */
export const STATUS_LABELS: Record<ProducerStatus, string> = {
  idle: 'Not started',
  loading: 'Loading Wasm…',
  running: 'Running',
  paused: 'Paused',
  error: 'Error',
};
