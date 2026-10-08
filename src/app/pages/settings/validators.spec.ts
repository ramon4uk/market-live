import { FormControl } from '@angular/forms';
import { integerInRange } from './validators';

describe('integerInRange', () => {
  const v = integerInRange({ min: 1, max: 50 });
  const check = (value: unknown) => v(new FormControl(value));

  it('accepts integers in range, including the bounds', () => {
    for (const ok of [1, 5, 50]) expect(check(ok)).toBeNull();
  });
  it('rejects out-of-range values', () => {
    expect(check(0)).toEqual({ range: { min: 1, max: 50 } });
    expect(check(51)).toEqual({ range: { min: 1, max: 50 } });
    expect(check(-3)).toEqual({ range: { min: 1, max: 50 } });
  });
  it('rejects non-integer and non-numeric values', () => {
    expect(check(2.5)).toEqual({ integer: true });
    expect(check(NaN)).toEqual({ integer: true });
    expect(check('7')).toEqual({ integer: true });
  });
  it('leaves an empty value to required', () => {
    expect(check(null)).toBeNull();
    expect(check('')).toBeNull();
  });
});
