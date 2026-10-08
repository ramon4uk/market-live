import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { FakeWorker } from '../testing/fakes';
import { App } from './app';
import { routes } from './app.routes';
import { ProducerService, WORKER_FACTORY } from './core/producer.service';

describe('App', () => {
  const producer = { ensureStarted: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), { provide: ProducerService, useValue: producer }],
    });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders navigation with two pages', async () => {
    const el = await render();
    expect(Array.from(el.querySelectorAll('nav a')).map((a) => a.getAttribute('href'))).toEqual(['/dashboard', '/settings']);
  });

  it('starts the producer once on app startup', async () => {
    producer.ensureStarted.mockClear();
    await render();
    expect(producer.ensureStarted).toHaveBeenCalledTimes(1);
  });
});

describe('App navigation (real ProducerService, fake worker)', () => {
  let workers: FakeWorker[];

  async function boot() {
    workers = [];
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        { provide: WORKER_FACTORY, useValue: () => { const w = new FakeWorker(); workers.push(w); return w; } },
      ],
    });
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const el = fixture.nativeElement as HTMLElement;
    const go = async (url: string) => { await router.navigateByUrl(url); await fixture.whenStable(); };
    const toggle = () => el.querySelector<HTMLButtonElement>('[data-testid="toggle"]')!;
    await go('/dashboard');
    return { el, go, toggle, fixture };
  }

  it('keeps the run and its paused state across pages without creating producers', async () => {
    const { go, toggle, fixture } = await boot();
    const worker = workers[0];
    worker.emit({ type: 'status', runId: 1, status: 'running' });
    worker.emit({ type: 'snapshot', runId: 1, values: new Float64Array(25).fill(1), batches: 3, updates: 300, activeMs: 1500 });
    await fixture.whenStable();

    toggle().click();
    expect(worker.sent.at(-1)).toEqual({ type: 'pause', runId: 1 });
    worker.emit({ type: 'status', runId: 1, status: 'paused' });

    await go('/settings');
    await go('/dashboard');
    await go('/settings');
    await go('/dashboard');

    expect(toggle().textContent!.trim()).toBe('Resume'); // still paused
    expect(TestBed.inject(ProducerService).updates()).toBe(300); // totals preserved
    expect(workers).toHaveLength(1); // a single producer
    expect(worker.sent.filter((m) => m.type === 'start')).toHaveLength(1); // no new run was started
  });

  it('Apply on Settings starts a new run that the Dashboard then shows', async () => {
    const { el, go, fixture } = await boot();
    await go('/settings');
    const field = el.querySelector<HTMLInputElement>('[formControlName="instruments"]')!;
    field.value = '3';
    field.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await go('/dashboard');
    await fixture.whenStable();

    expect(workers).toHaveLength(1);
    expect(workers[0].sent.at(-1)).toMatchObject({ type: 'start', runId: 2, config: { instruments: 3 } });
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
  });
});
