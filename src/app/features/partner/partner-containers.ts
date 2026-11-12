import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PartnerHead } from './partner-head';

/**
 * Containers (all of Enrosed's, without any price, amount or supplier): the
 * calendar of what comes when and the containers with their products. This
 * is the tab's place; the screen itself is built in the next stage (FP2).
 */
@Component({
  selector: 'app-partner-containers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PartnerHead],
  template: `
    <app-partner-head title="Containers" />
    <p class="soon">Hier zie je binnenkort welke containers eraan komen en wat erin zit.</p>
  `,
  styles: `
    :host{display:block;padding-bottom:24px}
    .soon{margin:0;padding:24px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--muted);text-align:center}
  `,
})
export class PartnerContainers {}
