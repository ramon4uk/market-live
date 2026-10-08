import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { STATUS_LABELS } from '../core/status-labels';
import { ProducerStatus } from '../core/worker-protocol';

/** Status indicator (coloured icon and label, deliberately not button-like) showing the producer status. */
@Component({
  selector: 'app-status-pill',
  templateUrl: './status-pill.html',
  styleUrl: './status-pill.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'data-testid': 'status', '[attr.data-status]': 'status()' },
})
export class StatusPill {
  readonly status = input.required<ProducerStatus>();
  protected readonly labels = STATUS_LABELS;
}
