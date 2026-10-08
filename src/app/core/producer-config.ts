export interface ProducerConfig {
  /** Number of fictional instruments. */
  instruments: number;
  /** Total number of market updates per batch (across all instruments). */
  updatesPerBatch: number;
  /** Requested interval between batches, ms. */
  batchIntervalMs: number;
}

export interface Range {
  readonly min: number;
  readonly max: number;
}

export const LIMITS: Readonly<Record<keyof ProducerConfig, Range>> = {
  instruments: { min: 1, max: 50 },
  updatesPerBatch: { min: 1, max: 1000 },
  batchIntervalMs: { min: 50, max: 2000 },
};

export const DEFAULT_CONFIG: Readonly<ProducerConfig> = {
  instruments: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};

export function isIntegerInRange(value: unknown, { min, max }: Range): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Fields that fail validation (empty array = config is valid). */
export function configErrors(config: ProducerConfig): (keyof ProducerConfig)[] {
  return (Object.keys(LIMITS) as (keyof ProducerConfig)[]).filter(
    (key) => !isIntegerInRange(config[key], LIMITS[key]),
  );
}

/** Nominal rate: updates per second across all instruments. */
export function nominalRate(config: ProducerConfig): number {
  return (config.updatesPerBatch * 1000) / config.batchIntervalMs;
}

const NAMES = [
  'ALFA', 'BETA', 'GAMA', 'DELT', 'EPSI', 'ZETA', 'ETAA', 'THET',
  'IOTA', 'KAPA', 'LAMB', 'MUUU', 'NUUU', 'XIII', 'OMIK', 'PIII',
  'RHOO', 'SIGM', 'TAUU', 'UPSI', 'PHII', 'CHII', 'PSII', 'OMEG',
];

/** Unique symbol for an instrument index: ALFA … OMEG, ALFA2 … */
export function symbolFor(index: number): string {
  const round = Math.floor(index / NAMES.length);
  return NAMES[index % NAMES.length] + (round === 0 ? '' : round + 1);
}
