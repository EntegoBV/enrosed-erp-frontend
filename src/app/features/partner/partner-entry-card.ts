import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Icon } from '../../shared/icon';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { DraftEntry, DraftPart, MeldingDraft, PriceMode } from './partner-draft';
import { count, euro, shortDate, units } from './partner-format';
import { EntryMoney, convertPrice } from './partner-money';
import { PartnerMoneyField } from './partner-money-field';
import { PartnerPhoto, PhotoUrlFn, partnerPhoto, safeColour } from './partner-photo';
import { PartnerStepper } from './partner-stepper';

/**
 * One product of a melding on step 2: Aantal, the average (or the total) with
 * its live Bruto, and on Veiling "+ Teruggekocht op de klok" for the pieces
 * Verhoeven bought back that day. On Terugkoop the pe-card is the buyback.
 */
@Component({
  selector: 'app-partner-entry-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, FormsModule, Icon, PartnerMoneyField, Segmented, PartnerPhoto, PartnerStepper],
  template: `
    @let e = entry();
    @let p = e.product;
    @let kind = draft().kind();
    <article class="pe-card" [attr.aria-label]="p.name + (p.variant ? ' ' + p.variant : '')">
      <header class="pe-card__head">
        <app-partner-photo class="pe-card__photo" [product]="p" [photoUrl]="photoUrl()" />
        <div class="pe-card__title">
          <strong>{{ p.name }}</strong>
          <span class="pe-card__sub">
            @if (p.variant) { <i class="pe-card__dot" [style.background]="colour()" aria-hidden="true"></i> }
            <span class="pe-card__sub-text">{{ sub() }}</span>
          </span>
        </div>
        <button class="pe-card__remove" type="button" [attr.aria-label]="'Weghalen: ' + p.name" (click)="draft().remove(p.productId)">
          <app-icon name="close" [size]="18" />
        </button>
      </header>

      @if (kind !== 'terugkoop') {
        <div class="part">
          <ng-container [ngTemplateOutlet]="fields"
                        [ngTemplateOutletContext]="{ which: 'sale', part: e.sale, priceLabel: 'Gemiddelde prijs', limit: max() }" />
          <div class="sum"><span>Bruto</span><b>{{ eur(money()?.sale?.grossEur) }}</b></div>
          @if (money()?.costsExceedGross) { <p class="msg msg--bad">De kosten zijn hoger dan de opbrengst</p> }
        </div>
      }

      @if (kind === 'veiling' && !e.buybackOpen) {
        <button class="add" type="button" (click)="draft().setBuybackOpen(p.productId, true)">
          <app-icon name="plus" [size]="18" />Teruggekocht op de klok
        </button>
      }

      @if (kind === 'terugkoop' || (kind === 'veiling' && e.buybackOpen)) {
        <div class="part" [class.part--buyback]="kind === 'veiling'">
          @if (kind === 'veiling') {
            <div class="part__head">
              <span>Teruggekocht op de klok</span>
              <button class="part__close" type="button" aria-label="Terugkoop weghalen" (click)="draft().setBuybackOpen(p.productId, false)">
                <app-icon name="close" [size]="16" />
              </button>
            </div>
          }
          <ng-container [ngTemplateOutlet]="fields"
                        [ngTemplateOutletContext]="{ which: 'buyback', part: e.buyback, priceLabel: 'Klokprijs', limit: null }" />
          <div class="sum"><span>Terugkoopkost<small>komt terug op voorraad</small></span><b>{{ eur(money()?.buyback?.grossEur) }}</b></div>
        </div>
      }
    </article>

    <ng-template #fields let-which="which" let-part="part" let-priceLabel="priceLabel" let-limit="limit">
      <div class="pe-row">
        <span class="pe-row__label">Aantal</span>
        <app-partner-stepper [value]="part.quantity" [max]="limit" [invalid]="which === 'sale' && over()"
                             [label]="(which === 'sale' ? 'Aantal ' : 'Aantal teruggekocht ') + entry().product.name"
                             (valueChange)="set(which, { quantity: $event })" />
      </div>
      @if (which === 'sale' && over()) { <p class="msg msg--bad" role="alert">Er liggen maar {{ unitsOf(max()) }}</p> }
      <div class="price">
        <span class="pe-row__label">{{ part.mode === 'unit' ? priceLabel + ' per ' + entry().product.unitOne : 'Totaal' }}</span>
        <div class="price__row">
          <label class="money">
            <span class="money__sign" aria-hidden="true">€</span>
            <input class="money__field" appPartnerMoney #priceField="partnerMoney" placeholder="0,00" enterkeyhint="done"
                   [attr.aria-label]="(part.mode === 'unit' ? priceLabel + ' per ' + entry().product.unitOne : 'Totaal') + ' ' + entry().product.name"
                   [ngModel]="part.price" (ngModelChange)="set(which, { price: $event })" />
          </label>
          <app-segmented class="mode" variant="ios" [label]="priceLabel + ' invullen als'" [options]="modes()"
                         [value]="part.mode" (changed)="setMode(which, part, $event)" />
        </div>
        @if (priceField.unreadable()) { <p class="msg msg--bad" role="alert">Geen bedrag: typ het als 3,20 of 1.250,00</p> }
      </div>
    </ng-template>
  `,
  styles: `
    :host{display:block}
    .pe-card{padding:12px 14px 14px;border-radius:20px;background:var(--surface);box-shadow:0 1px 2px rgb(26 22 20/5%)}
    .pe-card__head{display:grid;grid-template-columns:52px minmax(0,1fr) 44px;align-items:center;gap:12px;margin-bottom:6px}
    .pe-card__photo{width:52px;height:52px;border-radius:12px}
    .pe-card__title{display:grid;gap:2px;min-width:0}
    .pe-card__title strong{overflow:hidden;font-size:16px;font-weight:650;line-height:1.25;text-overflow:ellipsis;white-space:nowrap}
    .pe-card__sub{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;color:var(--muted);font-size:13px;white-space:nowrap;text-overflow:ellipsis}
    .pe-card__sub-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .pe-card__dot{flex:none;width:9px;height:9px;border-radius:50%;background:#c9bfb7;box-shadow:inset 0 0 0 1px rgb(26 22 20/14%)}
    .pe-card__remove{display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}
    .pe-card__remove:hover{color:var(--ink);background:color-mix(in srgb,var(--ink) 5%,transparent)}
    .part{display:grid;gap:10px;padding-top:10px}
    .part--buyback{margin-top:12px;padding:10px 12px 12px;border-radius:16px;background:color-mix(in srgb,#c7851d 8%,var(--surface))}
    .part__head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;color:#7c4a0b;font-size:14px;font-weight:700}
    .part__close{display:grid;place-items:center;width:44px;height:44px;margin:-6px -10px -6px 0;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}
    .pe-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px}
    .pe-row__label{min-width:0;color:var(--ink-2);font-size:15px;font-weight:600}
    .price{display:grid;gap:6px}
    .price__row{display:grid;grid-template-columns:minmax(0,1fr) 156px;align-items:center;gap:8px}
    .mode{height:44px}
    .money{display:flex;align-items:center;gap:6px;min-height:52px;padding:0 14px;border-radius:14px;background:color-mix(in srgb,var(--ink) 6%,var(--surface));cursor:text}
    .money:focus-within{box-shadow:0 0 0 2px color-mix(in srgb,var(--rose) 50%,transparent)}
    .money:has(.money__field[aria-invalid=true]){background:var(--danger-soft)}
    .money__field[aria-invalid=true]{color:var(--danger)}
    .price .msg{margin:0}
    .money__sign{color:var(--muted);font-size:18px;font-weight:600}
    .money__field{flex:1;min-width:0;height:52px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;outline:none}
    .sum{display:flex;align-items:baseline;justify-content:space-between;gap:10px;color:var(--ink-2);font-size:15px}
    .sum small{display:block;color:var(--muted);font-size:13px;font-weight:500}
    .sum b{color:var(--ink);font-size:17px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
    .msg{margin:-4px 0 0;font-size:13.5px;font-weight:600}.msg--bad{color:var(--danger)}
    .add{display:flex;align-items:center;gap:8px;width:100%;min-height:48px;margin-top:10px;padding:0 12px;border:1.5px dashed color-mix(in srgb,#c7851d 45%,transparent);border-radius:14px;background:transparent;color:#8a520c;font:inherit;font-size:15px;font-weight:650;cursor:pointer}
    .add:hover{background:color-mix(in srgb,#c7851d 7%,transparent)}
    @media (max-width: 359.98px){.price__row{grid-template-columns:minmax(0,1fr) 136px}}
  `,
})
export class PartnerEntryCard {
  readonly draft = input.required<MeldingDraft>();
  readonly entry = input.required<DraftEntry>();
  readonly money = input<EntryMoney | null>(null);
  /** The stock there, in sales units: the most a sale can take. */
  readonly max = input<number | null>(null);
  readonly lastSoldOn = input<string | null>(null);
  readonly photoUrl = input<PhotoUrlFn>(partnerPhoto);

  readonly colour = computed(() => safeColour(this.entry().product.colourHex));
  readonly over = computed(() => this.draft().overLimit(this.entry()));
  /** "Rood · 120 stuks op voorraad"; on Terugkoop "Rood · laatst verkocht 10/11". */
  readonly sub = computed(() => {
    const product = this.entry().product;
    const max = this.max();
    const fact = this.draft().kind() === 'terugkoop'
      ? (this.lastSoldOn() ? 'laatst verkocht ' + shortDate(this.lastSoldOn()) : '')
      : (max == null ? '' : units(max, product) + ' op voorraad');
    return [product.variant, fact].filter(Boolean).join(' · ');
  });
  readonly modes = computed<SegmentOption[]>(() => [
    { id: 'unit', label: 'per ' + this.entry().product.unitOne },
    { id: 'total', label: 'totaal' },
  ]);

  set(which: 'sale' | 'buyback', patch: Partial<DraftPart>): void {
    this.draft().updatePart(this.entry().product.productId, which, patch);
  }

  /** Flipping per stuk / totaal keeps what was typed meaning the same, when the quantity allows it. */
  setMode(which: 'sale' | 'buyback', part: DraftPart, mode: string): void {
    const to: PriceMode = mode === 'total' ? 'total' : 'unit';
    if (to === part.mode) return;
    const price = part.price == null ? null : (convertPrice(part, to) ?? part.price);
    this.set(which, { mode: to, price });
  }

  unitsOf(quantity: number | null): string {
    return units(quantity ?? 0, this.entry().product);
  }

  eur(value: number | null | undefined): string {
    return euro(value);
  }

  num(value: number | null | undefined): string {
    return count(value);
  }

  day(iso: string | null): string {
    return shortDate(iso);
  }
}
