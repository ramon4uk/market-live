import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_CONFIG } from '../../core/producer-config';
import { ProducerService } from '../../core/producer.service';
import { Settings } from './settings';

describe('Settings', () => {
  const producer = { config: signal({ ...DEFAULT_CONFIG }), status: signal('running'), apply: vi.fn(() => true) };

  const render = async () => {
    TestBed.configureTestingModule({ imports: [Settings], providers: [{ provide: ProducerService, useValue: producer }] });
    const fixture = TestBed.createComponent(Settings);
    await fixture.whenStable();
    return fixture;
  };
  const input = (el: HTMLElement, name: string) => el.querySelector<HTMLInputElement>(`[formControlName="${name}"]`)!;
  async function type(fixture: Awaited<ReturnType<typeof render>>, name: string, value: string) {
    const field = input(fixture.nativeElement, name);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  }
  const submit = (fixture: Awaited<ReturnType<typeof render>>) =>
    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));

  beforeEach(() => { producer.apply.mockClear(); producer.config.set({ ...DEFAULT_CONFIG }); });

  it('is filled with the current run config (defaults: 5 / 100 / 500)', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    expect(input(el, 'instruments').value).toBe('5');
    expect(input(el, 'updatesPerBatch').value).toBe('100');
    expect(input(el, 'batchIntervalMs').value).toBe('500');
  });

  it('editing the form does NOT affect the producer until Apply is pressed', async () => {
    const fixture = await render();
    await type(fixture, 'instruments', '12');
    await type(fixture, 'updatesPerBatch', '999');
    expect(producer.apply).not.toHaveBeenCalled();
  });

  it('Apply passes the changed integer values', async () => {
    const fixture = await render();
    await type(fixture, 'instruments', '12');
    await type(fixture, 'updatesPerBatch', '999');
    await type(fixture, 'batchIntervalMs', '50');
    submit(fixture);
    expect(producer.apply).toHaveBeenCalledWith({ instruments: 12, updatesPerBatch: 999, batchIntervalMs: 50 });
  });

  it('− and + buttons step the value and stop at the limits', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const [minus, plus] = Array.from(el.querySelectorAll<HTMLButtonElement>('.stepper')[0].querySelectorAll('button'));
    plus.click();
    await fixture.whenStable();
    expect(input(el, 'instruments').value).toBe('6');
    minus.click();
    minus.click();
    await fixture.whenStable();
    expect(input(el, 'instruments').value).toBe('4');
    await type(fixture, 'instruments', '50');
    expect(plus.disabled).toBe(true);
    expect(producer.apply).not.toHaveBeenCalled();
  });

  it('shows a confirmation after Apply that disappears after 2 s', async () => {
    const fixture = await render();
    vi.useFakeTimers();
    try {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="applied"]')).toBeNull();
      submit(fixture);
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="applied"]')).not.toBeNull();
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="applied"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('no confirmation if the service rejects the config', async () => {
    const fixture = await render();
    producer.apply.mockReturnValueOnce(false);
    submit(fixture);
    fixture.detectChanges();
    expect(producer.apply).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="applied"]')).toBeNull();
  });

  it('a repeated Apply restarts the 2 s confirmation countdown', async () => {
    const fixture = await render();
    vi.useFakeTimers();
    try {
      const el = fixture.nativeElement as HTMLElement;
      submit(fixture);
      vi.advanceTimersByTime(1500);
      submit(fixture);
      vi.advanceTimersByTime(1500); // 3 s since the first Apply, 1.5 s since the second
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="applied"]')).not.toBeNull();
      vi.advanceTimersByTime(600);
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="applied"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['instruments', '0'], ['instruments', '51'], ['instruments', '2.5'],
    ['updatesPerBatch', '0'], ['updatesPerBatch', '1001'], ['updatesPerBatch', '10.1'],
    ['batchIntervalMs', '49'], ['batchIntervalMs', '2001'], ['batchIntervalMs', '99.9'],
  ])('does not apply invalid value %s=%s and shows an error', async (name, value) => {
    const fixture = await render();
    await type(fixture, name, value);
    submit(fixture);
    await fixture.whenStable();
    expect(producer.apply).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector(`[data-testid="err-${name}"]`)).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="apply"]')!.disabled).toBe(true);
  });

  it('an empty field is required', async () => {
    const fixture = await render();
    await type(fixture, 'instruments', '');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="err-instruments"]')!.textContent).toContain('Required');
  });

  it('boundary values are allowed', async () => {
    const fixture = await render();
    await type(fixture, 'instruments', '50');
    await type(fixture, 'updatesPerBatch', '1');
    await type(fixture, 'batchIntervalMs', '2000');
    submit(fixture);
    expect(producer.apply).toHaveBeenCalledWith({ instruments: 50, updatesPerBatch: 1, batchIntervalMs: 2000 });
  });

  it('shows the draft’s nominal rate', async () => {
    const fixture = await render();
    await type(fixture, 'updatesPerBatch', '1000');
    await type(fixture, 'batchIntervalMs', '500');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="draft-rate"]')!.textContent).toContain('2000');
  });
});
