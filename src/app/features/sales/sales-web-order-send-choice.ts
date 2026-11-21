import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import type { SalesOrderView, WebOrderAgreement } from '../../core/api/models';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { WEB_ORDER_AGREEMENTS, type WebOrderSendMode, webOrderSendChoice } from './sales-invoice-actions';

let nextId = 0;

/**
 * The top of the send sheet of a website order staff took: the invoice,
 * because the customer already agreed, or this version for approval. With
 * other figures than the ordered ones the invoice asks how the customer
 * agreed; that one tap is what the history keeps. The host owns both values
 * and the button that sends; this renders nothing for any other document.
 */
@Component({
  selector: 'app-web-order-send-choice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented],
  template: `
    @if (choice(); as c) {
      <div class="wosc">
        <app-segmented label="Wat krijgt de klant?" [variant]="variant()" [options]="modes" [value]="mode()" (changed)="pick($event)" />
        <p class="wosc__lead">{{ mode() === 'invoice'
          ? 'De klant krijgt meteen de factuur-PDF met de betaalgegevens.'
          : 'De klant krijgt de PDF en een link om deze versie goed te keuren of een wijziging voor te stellen.' }}</p>
        @if (c.status) {
          <p class="wosc__status" [attr.title]="c.differences.length ? c.differences.join('\\n') : null">{{ c.status }}</p>
        }
        @if (mode() === 'invoice') {
          @if (c.invoiceBlock) {
            <p class="wosc__block" role="alert">{{ c.invoiceBlock }}</p>
          } @else if (c.needsAgreement) {
            <div class="wosc__agree">
              <span class="wosc__label" [id]="labelId">Klant ging akkoord via</span>
              <div class="chips wosc__chips" role="radiogroup" [attr.aria-labelledby]="labelId">
                @for (option of agreements; track option.code) {
                  <button class="chip" type="button" role="radio" [class.active]="agreedVia() === option.code"
                          [attr.aria-checked]="agreedVia() === option.code" (click)="agreedVia.set(option.code)">{{ option.label }}</button>
                }
              </div>
            </div>
          }
        }
      </div>
    }
  `,
  styles: `
    :host { display:block;min-width:0 }
    .wosc { display:grid;gap:10px;margin-bottom:14px;min-width:0 }
    .wosc__lead { margin:0;font-size:13px;line-height:1.45;color:var(--muted) }
    .wosc__status { margin:0;padding:7px 9px;border-left:3px solid var(--gold);border-radius:8px;background:var(--gold-soft);
      font-size:12.5px;line-height:1.45;color:var(--ink);overflow-wrap:anywhere }
    .wosc__block { margin:0;font-size:13px;font-weight:650;line-height:1.45;color:var(--danger) }
    .wosc__agree { display:grid;gap:6px;min-width:0 }
    .wosc__label { font-size:12px;font-weight:700;color:var(--ink) }
    .wosc__chips { flex-wrap:wrap;overflow:visible;margin-bottom:0;padding-bottom:0 }
  `,
})
export class SalesWebOrderSendChoice {
  readonly view = input.required<SalesOrderView>();
  readonly variant = input<'desk' | 'ios'>('desk');
  readonly mode = model.required<WebOrderSendMode>();
  readonly agreedVia = model<WebOrderAgreement | null>(null);

  readonly choice = computed(() => webOrderSendChoice(this.view()));
  readonly agreements = WEB_ORDER_AGREEMENTS;
  readonly modes: readonly SegmentOption[] = [
    { id: 'invoice', label: 'Factuur' },
    { id: 'approval', label: 'Ter goedkeuring' },
  ];
  readonly labelId = `wosc-agree-${++nextId}`;

  pick(id: string): void {
    if (id === 'invoice' || id === 'approval') this.mode.set(id);
  }
}
