import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formatImbalance, formatPrice, formatVolume } from '../../core/format';
import { nominalRate } from '../../core/producer-config';
import { ProducerService } from '../../core/producer.service';
import { StatusPill } from '../../shared/status-pill';

@Component({
  selector: 'app-dashboard',
  imports: [StatusPill],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly producer = inject(ProducerService);

  protected readonly price = formatPrice;
  protected readonly volume = formatVolume;
  protected readonly imbalance = formatImbalance;
  protected readonly rate = computed(() => nominalRate(this.producer.config()));
}
