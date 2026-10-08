import { formatImbalance, formatPrice, formatVolume, UNAVAILABLE } from './format';

describe('format', () => {
  it('formats prices as currency', () => {
    expect(formatPrice(101.5)).toBe('$101.50');
    expect(formatPrice(0.04)).toBe('$0.04');
    expect(formatPrice(1234.5)).toBe('$1,234.50');
  });

  it('shows unavailable values as a dash', () => {
    expect(formatPrice(null)).toBe(UNAVAILABLE);
    expect(formatImbalance(null)).toBe(UNAVAILABLE);
  });

  it('formats volume as an integer, zero as 0', () => {
    expect(formatVolume(0)).toBe('0');
    expect(formatVolume(1234567)).toBe('1,234,567');
  });

  it('formats imbalance with a sign within [−1, +1]', () => {
    expect(formatImbalance(0.2)).toBe('+0.20');
    expect(formatImbalance(-0.35)).toBe('-0.35');
    expect(formatImbalance(0)).toBe('0.00');
    expect(formatImbalance(1)).toBe('+1.00');
    expect(formatImbalance(-1)).toBe('-1.00');
  });

  it('clamps out-of-range values', () => {
    expect(formatImbalance(1.7)).toBe('+1.00');
    expect(formatImbalance(-3)).toBe('-1.00');
  });
});
