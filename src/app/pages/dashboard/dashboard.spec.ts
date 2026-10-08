import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_CONFIG } from '../../core/producer-config';
import { emptyRows, InstrumentRow } from '../../core/metrics';
import { ProducerService } from '../../core/producer.service';
import { ProducerStatus } from '../../core/worker-protocol';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  const status = signal<ProducerStatus>('idle');
  const rows = signal<InstrumentRow[]>(emptyRows(2));
  const producer = {
    status, rows,
    config: signal({ ...DEFAULT_CONFIG }),
    batches: signal(0),
    updates: signal(0),
    actualRate: signal<number | null>(null),
    error: signal<string | null>(null),
    canToggle: () => status() === 'running' || status() === 'paused',
    toggle: vi.fn(),
  };

  const render = async () => {
    TestBed.configureTestingModule({ imports: [Dashboard], providers: [{ provide: ProducerService, useValue: producer }] });
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const cell = (el: HTMLElement, row: number, col: string) =>
    el.querySelectorAll('tbody tr')[row].querySelector(`[data-col="${col}"]`)!.textContent!.trim();

  beforeEach(() => {
    status.set('idle');
    rows.set(emptyRows(2));
    producer.error.set(null);
    producer.actualRate.set(null);
    producer.toggle.mockClear();
  });

  it('before any data shows dashes and zero volume', async () => {
    const el = await render();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
    for (const col of ['last', 'spread', 'vwap', 'imbalance']) expect(cell(el, 0, col)).toBe('—');
    expect(cell(el, 0, 'volume')).toBe('0');
  });

  it('formats metrics: currency and signed imbalance', async () => {
    rows.set([{ symbol: 'ALFA', lastPrice: 102, trend: 0, spread: 0.04, volume: 40, vwap: 101.5, imbalance: 0.2 }]);
    const el = await render();
    expect(cell(el, 0, 'last')).toBe('$102.00');
    expect(cell(el, 0, 'spread')).toBe('$0.04');
    expect(cell(el, 0, 'volume')).toBe('40');
    expect(cell(el, 0, 'vwap')).toBe('$101.50');
    expect(cell(el, 0, 'imbalance')).toBe('+0.20');
  });

  it('shows the nominal rate: 100 / 500 ms = 200 updates/s', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="rate"]')!.textContent).toContain('200 updates/s');
  });

  it('marks the direction of the last price change', async () => {
    rows.set([
      { ...emptyRows(1)[0], lastPrice: 102, trend: 1 },
      { ...emptyRows(2)[1], lastPrice: 50, trend: -1 },
    ]);
    const el = await render();
    const last = (row: number) => el.querySelectorAll('tbody tr')[row].querySelector('[data-col="last"]')!;
    expect(last(0).classList).toContain('up');
    expect(last(1).classList).toContain('down');
    expect(cell(el, 0, 'last')).toBe('$102.00'); // the arrow is CSS-only, not part of the text
  });

  it('shows the measured rate once available', async () => {
    let el = await render();
    expect(el.querySelector('[data-testid="actual-rate"]')).toBeNull();
    TestBed.resetTestingModule();
    producer.actualRate.set(198.6);
    el = await render();
    expect(el.querySelector('[data-testid="actual-rate"]')!.textContent).toContain('actual 199 updates/s');
  });

  it('the Pause/Resume button depends on state and calls toggle', async () => {
    status.set('running');
    const el = await render();
    const btn = el.querySelector<HTMLButtonElement>('[data-testid="toggle"]')!;
    expect(btn.textContent!.trim()).toBe('Pause');
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(producer.toggle).toHaveBeenCalled();
  });

  it('paused → Resume; loading → disabled', async () => {
    status.set('paused');
    let el = await render();
    expect(el.querySelector('[data-testid="toggle"]')!.textContent!.trim()).toBe('Resume');
    TestBed.resetTestingModule();
    status.set('loading');
    el = await render();
    expect((el.querySelector('[data-testid="toggle"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-testid="status"]')!.textContent).toContain('Loading');
  });

  it('shows the init error', async () => {
    status.set('error');
    producer.error.set('Failed to load the Wasm generator');
    const el = await render();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Wasm generator');
  });
});
