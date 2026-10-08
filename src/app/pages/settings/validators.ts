import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { Range } from '../../core/producer-config';

/** The value must be an integer within [min, max]. An empty value is left to `required`. */
export function integerInRange(range: Range): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'number' || !Number.isInteger(value)) return { integer: true };
    if (value < range.min || value > range.max) return { range: range };
    return null;
  };
}
