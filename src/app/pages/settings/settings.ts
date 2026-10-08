import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { concat, map, of, Subject, switchMap, timer } from 'rxjs';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LIMITS, nominalRate, ProducerConfig } from '../../core/producer-config';
import { ProducerService } from '../../core/producer.service';
import { StatusPill } from '../../shared/status-pill';
import { integerInRange } from './validators';

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, StatusPill],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  protected readonly producer = inject(ProducerService);
  protected readonly limits = LIMITS;

  /** The form is a draft: it does not affect the producer until Apply is pressed. */
  protected readonly form = inject(NonNullableFormBuilder).group({
    instruments: [this.producer.config().instruments, this.validators('instruments')],
    updatesPerBatch: [this.producer.config().updatesPerBatch, this.validators('updatesPerBatch')],
    batchIntervalMs: [this.producer.config().batchIntervalMs, this.validators('batchIntervalMs')],
  });

  private readonly draft = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly draftRate = computed(() => {
    const d = this.draft() as ProducerConfig;
    return this.form.valid && d.batchIntervalMs > 0 ? nominalRate(d) : null;
  });

  /** Fires on every successful Apply. */
  private readonly applied$ = new Subject<void>();
  /** Brief feedback after Apply: true for 2 s; a new Apply restarts the countdown (switchMap cancels the old timer). */
  protected readonly justApplied = toSignal(
    this.applied$.pipe(switchMap(() => concat(of(true), timer(2000).pipe(map(() => false))))),
    { initialValue: false },
  );

  protected apply(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    // The form is already valid, so apply() should accept it; confirm only what actually started.
    if (this.producer.apply(this.form.getRawValue())) this.applied$.next();
  }

  /** Steps a field by `delta`, clamped to its limits (also recovers an empty/invalid value). */
  protected step(name: keyof ProducerConfig, delta: number): void {
    const control = this.form.controls[name];
    const { min, max } = LIMITS[name];
    const current = Number.isFinite(control.value) ? Math.round(control.value) : min - delta;
    control.setValue(Math.min(max, Math.max(min, current + delta)));
    control.markAsDirty();
  }

  protected error(name: keyof ProducerConfig): string | null {
    const c = this.form.controls[name];
    if (!c.touched && !c.dirty) return null;
    const { min, max } = LIMITS[name];
    if (c.hasError('required')) return 'Required field';
    if (c.hasError('integer')) return 'Must be an integer';
    if (c.hasError('range')) return `Allowed range: ${min}–${max}`;
    return null;
  }

  private validators(name: keyof ProducerConfig) {
    return [Validators.required, integerInRange(LIMITS[name])];
  }
}
