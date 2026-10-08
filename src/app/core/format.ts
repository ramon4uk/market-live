export const UNAVAILABLE = '—';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const signed = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});

export function formatPrice(value: number | null): string {
  return value === null ? UNAVAILABLE : currency.format(value);
}

export function formatVolume(value: number): string {
  return integer.format(value);
}

/** Imbalance in the range [−1, +1] with an explicit sign: +0.20, −0.35, 0.00. */
export function formatImbalance(value: number | null): string {
  return value === null ? UNAVAILABLE : signed.format(Math.min(1, Math.max(-1, value)));
}
