import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ClosingArticle, ClosingView, Decision, DecisionKind, DecisionWrite, SeparateItem } from '../../core/api/inventory-models';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { ClosingDecisionSheet, DecisionSheetResult, DecisionSheetSpec, followAnchor } from './closing-decision-sheet';
import {
  InvoicedChoice, borderFixed, decisionWriteInvoiced, decisionWritePartnerContainer, decisionWritePartnerQuantity,
  decisionWriteThirdParty, decisionWriteTransit, invoiceBulkWrite, undecidedInvoiceIds,
} from './inventory-closing';

/** The rows of one container (in transit or of a partner) with its decision. */
interface ContainerGroup {
  purchaseOrderId: number;
  first: SeparateItem;
  items: SeparateItem[];
  valueEur: number;
  /** True, false, or null while nobody decided. */
  included: boolean | null;
  decision: Decision | null;
  /** A partner container of which nothing is left in stock: listed, no question. */
  empty: boolean;
}

interface InvoiceGroup {
  salesOrderId: number;
  first: SeparateItem;
  items: SeparateItem[];
  choice: string | null;
  undecided: boolean;
  /** Every row was settled by the movements of step 2: nothing to choose. */
  automatic: boolean;
}

interface Question {
  spec: DecisionSheetSpec;
  save: (result: DecisionSheetResult) => void;
  remove?: () => void;
}

const INVOICE_CHOICES: readonly { value: InvoicedChoice; label: string; help: string | null }[] = [
  { value: 'UIT', label: 'Uit eigen voorraad', help: 'De stuks lagen er op de afsluitdatum nog en zijn meegeteld.' },
  { value: 'BLIJFT', label: 'Blijft eigen voorraad', help: null },
  { value: 'AL_WEG', label: 'Stuks waren al weg', help: 'Ze zitten niet in de getelde voorraad.' },
];
const FACTS_ONLY = 'Dit is een beslissing voor jou en je boekhouder; het ERP toont alleen de feiten.';
const cents = (eur: number | null) => Math.round((eur ?? 0) * 100);

/**
 * Step 4 of the closing, "Afzonderlijk": what is not plainly own stock.
 * Goods in transit, partner containers, invoices that are not afgepunt and
 * goods of third parties each get their facts on the left and the decision
 * on the right; demo pieces are only listed. The ERP gives no advice: every
 * choice is the user's, stored with a reason and emitted as a decision.
 */
@Component({
  selector: 'app-closing-step-separate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, NumPipe, DateNlPipe, ClosingDecisionSheet],
  host: { class: 'inv-step inv-apart' },
  template: `
    <section class="wk-card">
      <div class="wk-card__head">
        <h3 class="wk-card__title">Goederen onderweg op {{ view().closingDate | dateNl }}</h3>
        <span class="wk-card__trail inv-apart__subtotal">Opgenomen {{ view().totals.transitIncludedEur | eur }} · niet opgenomen {{ view().totals.transitExcludedEur | eur }}</span>
      </div>
      <div class="wk-card__body">
        @for (group of transit(); track group.purchaseOrderId) {
          <div class="inv-item" [id]="'inv-apart-container-' + group.purchaseOrderId">
            <div class="inv-item__facts">
              <p class="inv-item__title">{{ name(group.first) }} <span class="wk-amount">{{ group.valueEur | eur }}</span></p>
              <dl class="inv-kv">
                <div><dt>Leverancier</dt><dd>{{ group.first.counterparty || '—' }}</dd></div>
                <div><dt>Incoterm leverancier (fiche)</dt><dd>{{ group.first.supplierIncoterm || 'niet ingevuld' }}</dd></div>
                <div><dt>Transport via leverancier</dt><dd>{{ group.first.transportViaSupplier ? 'ja' : 'nee' }}</dd></div>
                <div><dt>Afvaart</dt><dd>{{ group.first.shippedOn | dateNl }}</dd></div>
                <div><dt>Betaald t/m afsluitdatum</dt><dd>{{ group.first.paidUntilClosingEur | eur }}</dd></div>
              </dl>
              @for (item of group.items; track item.id) {
                <p class="inv-item__row"><span>{{ item.productName }}</span><span>{{ item.quantity | num }} x {{ item.unitValueEur | eur: 4 }}</span><span class="wk-amount">{{ item.valueEur | eur }}</span></p>
              }
              @if (group.decision; as decision) {
                <p class="inv-item__decided">{{ decision.flag ? 'Opgenomen' : 'Niet opgenomen' }}@if (decision.flag && decision.decisionDate) { · eigendom of risico overgegaan op {{ decision.decisionDate | dateNl }} } · {{ decision.reason }} · {{ decision.decidedByName }}</p>
              }
            </div>
            <div class="inv-item__side">
              @if (group.included === null) { <span class="wk-pill tone-danger">Nog te beslissen</span> }
              @if (editable()) {
                <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" [attr.aria-pressed]="group.included === true" (click)="askTransit(group, true)">Opgenomen</button>
                <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" [attr.aria-pressed]="group.included === false" (click)="askTransit(group, false)">Niet opgenomen</button>
              }
            </div>
          </div>
        } @empty {
          <p class="inv-step__quiet">Geen goederen onderweg op de afsluitdatum.</p>
        }
        <p class="inv-step__hint">{{ factsOnly }}</p>
      </div>
    </section>

    <section class="wk-card">
      <div class="wk-card__head">
        <h3 class="wk-card__title">Partnercontainers</h3>
        <span class="wk-card__trail inv-apart__subtotal">Opgenomen {{ view().totals.partnerIncludedEur | eur }} · niet opgenomen {{ view().totals.partnerExcludedEur | eur }}</span>
      </div>
      <div class="wk-card__body">
        @for (group of partner(); track group.purchaseOrderId) {
          <div class="inv-item" [id]="'inv-apart-container-' + group.purchaseOrderId">
            <div class="inv-item__facts">
              <p class="inv-item__title">{{ name(group.first) }}@if (group.first.counterparty) { <small>{{ group.first.counterparty }}</small> }
                @if (!group.empty) { <span class="wk-amount">{{ group.valueEur | eur }}</span> }</p>
              @if (group.first.receivedOn) { <p class="inv-step__quiet">Ontvangen {{ group.first.receivedOn | dateNl }}</p> }
              @if (group.empty) {
                <p class="inv-step__quiet">Geen stuks meer in voorraad</p>
              } @else {
                @for (item of group.items; track item.id) {
                  <p class="inv-item__row"><span>{{ item.productName }}
                      @if (quantityDecision(item); as changed) { <small>aangepast, voorstel {{ item.proposedQuantity | num }} · {{ changed.reason }}</small> }</span>
                    <span>{{ item.quantity | num }} x {{ item.unitValueEur | eur: 4 }}</span><span class="wk-amount">{{ item.valueEur | eur }}</span>
                    @if (editable()) { <button class="wk-link" type="button" [disabled]="busy()" (click)="askQuantity(item)">Aantal aanpassen</button> }
                  </p>
                }
                @if (group.decision; as decision) {
                  <p class="inv-item__decided">{{ decision.flag ? 'Opgenomen' : 'Niet opgenomen' }} · {{ decision.reason }} · {{ decision.decidedByName }}</p>
                }
              }
            </div>
            @if (!group.empty) {
              <div class="inv-item__side">
                @if (group.included === null) { <span class="wk-pill tone-danger">Nog te beslissen</span> }
                @if (editable()) {
                  <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" [attr.aria-pressed]="group.included === true" (click)="askPartner(group, true)">Opgenomen</button>
                  <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" [attr.aria-pressed]="group.included === false" (click)="askPartner(group, false)">Niet opgenomen</button>
                }
              </div>
            }
          </div>
        } @empty {
          <p class="inv-step__quiet">Geen partnercontainers in deze afsluiting.</p>
        }
        <p class="inv-step__hint">{{ factsOnly }}</p>
      </div>
    </section>

    <section class="wk-card">
      <div class="wk-card__head">
        <h3 class="wk-card__title">Gefactureerd, nog niet afgepunt</h3>
        <span class="wk-card__trail inv-apart__subtotal">Uit eigen voorraad {{ view().totals.invoicedOutEur | eur }} · niet in het totaal</span>
      </div>
      <div class="wk-card__body">
        @if (editable() && undecided().length) {
          <div class="inv-apart__bulk">
            <button class="wk-btn" type="button" [disabled]="busy()" (click)="bulk('UIT')">Alle {{ undecided().length }} uit eigen voorraad</button>
            <button class="wk-btn" type="button" [disabled]="busy()" (click)="bulk('AL_WEG')">Alle {{ undecided().length }}: stuks waren al weg</button>
          </div>
        }
        @for (group of invoices(); track group.salesOrderId) {
          <div class="inv-item" [id]="'inv-apart-invoice-' + group.salesOrderId">
            <div class="inv-item__facts">
              <p class="inv-item__title"><a class="wk-link" [routerLink]="['/sales', group.salesOrderId]">Factuur {{ group.first.documentNumber }}</a>
                <small>{{ group.first.documentDate | dateNl }} · {{ group.first.counterparty || 'Geen klant' }}</small></p>
              @for (item of group.items; track item.id) {
                <p class="inv-item__row"><span>{{ item.productName }}</span><span>{{ item.quantity | num }}</span>
                  @if (item.automatic) {
                    <span class="inv-item__auto">Stuks waren al weg · al verwerkt bij de bewegingen van stap 2</span>
                  } @else if (item.valueEur !== null && item.choice === 'UIT') {
                    <span class="wk-amount">{{ item.valueEur | eur }}</span>
                  }
                </p>
              }
              @if (decisionOf('INVOICED', group.salesOrderId); as decision) {
                @if (decision.reason) { <p class="inv-item__decided">{{ decision.reason }} · {{ decision.decidedByName }}</p> }
              }
            </div>
            @if (!group.automatic) {
              <div class="inv-item__side inv-item__side--stack">
                @if (group.undecided) { <span class="wk-pill tone-danger">Nog te beslissen</span> }
                @for (option of invoiceChoices; track option.value) {
                  <button class="wk-btn wk-btn--sm" type="button" [disabled]="!editable() || busy()" [attr.aria-pressed]="group.choice === option.value" [title]="option.help ?? ''" (click)="chooseInvoice(group, option.value)">{{ option.label }}</button>
                }
              </div>
            }
          </div>
        } @empty {
          <p class="inv-step__quiet">Geen facturen die op de afsluitdatum nog niet afgepunt waren.</p>
        }
        @if (invoices().length) {
          <p class="inv-step__quiet">Uit eigen voorraad: de stuks lagen er op de afsluitdatum nog en zijn meegeteld. Stuks waren al weg: ze zitten niet in de getelde voorraad.</p>
        }
        @if (view().olderInvoices.length) {
          <details class="inv-fold">
            <summary>Oudere facturen zonder afpunten ({{ view().olderInvoices.length }})</summary>
            <div class="wk-table inv-older" role="table">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Factuur</span>
                <span class="wk-th" role="columnheader">Datum</span>
                <span class="wk-th" role="columnheader">Klant</span>
                <span class="wk-th wk-th--num" role="columnheader">Aantal</span>
              </div>
              @for (invoice of view().olderInvoices; track invoice.salesOrderId) {
                <div class="wk-tr" role="row">
                  <span class="wk-td" role="cell">{{ invoice.number }}</span>
                  <span class="wk-td" role="cell">{{ invoice.orderDate | dateNl }}</span>
                  <span class="wk-td" role="cell">{{ invoice.customerName || '—' }}</span>
                  <span class="wk-td wk-td--num" role="cell">{{ invoice.quantity | num }}</span>
                </div>
              }
            </div>
            <p class="inv-step__quiet">Ouder dan dit boekjaar en nooit afgepunt. Niet verwerkt in deze afsluiting.</p>
          </details>
        }
        <p class="inv-step__hint">{{ factsOnly }}</p>
      </div>
    </section>

    <section class="wk-card" id="inv-apart-third">
      <div class="wk-card__head">
        <h3 class="wk-card__title">Goederen van derden</h3>
        <span class="wk-card__trail inv-apart__subtotal">{{ thirdQuantity() | num }} stuks · zonder waarde</span>
        @if (editable()) { <button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" (click)="askThird()">Toevoegen</button> }
      </div>
      <div class="wk-card__body">
        @for (item of third(); track item.id) {
          <div class="inv-item">
            <div class="inv-item__facts">
              <p class="inv-item__title">{{ item.productName }} <small>{{ item.quantity | num }} stuks · eigenaar {{ item.counterparty || '—' }}</small></p>
              <p class="inv-item__decided">{{ item.reason }}@if (item.decidedByName) { · {{ item.decidedByName }} }</p>
            </div>
            @if (editable() && item.decisionId !== null) {
              <div class="inv-item__side"><button class="wk-btn wk-btn--sm wk-btn--danger" type="button" [disabled]="busy()" (click)="removeDecision.emit(item.decisionId)">Verwijderen</button></div>
            }
          </div>
        } @empty {
          <p class="inv-step__quiet">Geen goederen van derden.</p>
        }
        <p class="inv-step__hint">{{ factsOnly }}</p>
      </div>
    </section>

    <section class="wk-card">
      <div class="wk-card__head">
        <h3 class="wk-card__title">Demostukken</h3>
        <span class="wk-card__trail inv-apart__subtotal">{{ view().totals.demoValueEur | eur }} · in de eigen voorraad</span>
      </div>
      <div class="wk-card__body">
        @for (article of demo(); track article.productId) {
          <p class="inv-item__row"><span>{{ article.productName }}</span><span>{{ article.ownQuantity | num }}</span>
            <span class="wk-amount">{{ article.ownValueEur | eur }}@if (article.writeDownEur > 0) { <small> na waardevermindering {{ article.writeDownEur | eur }}</small> }</span>
            <a class="wk-link" [routerLink]="[]" [queryParams]="{ stap: 'waarde' }" queryParamsHandling="merge" [fragment]="'inv-product-' + article.productId">Afwaarderen</a>
          </p>
        } @empty {
          <p class="inv-step__quiet">Geen demostukken in voorraad.</p>
        }
      </div>
    </section>

    @if (apartIncluded() > 0) {
      <p class="inv-step__hint">Op opgenomen partnercontainers en goederen onderweg ({{ apartIncluded() | eur }}) is geen lagere marktwaarde ingevoerd; het ERP voorziet daar geen waardevermindering.</p>
    }

    @if (question(); as open) {
      <app-closing-decision-sheet [spec]="open.spec" [busy]="busy()" (save)="open.save($event)" (remove)="open.remove?.()" (closed)="question.set(null)" />
    }
  `,
})
export class ClosingStepSeparate {
  readonly view = input.required<ClosingView>();
  readonly busy = input(false);
  readonly decision = output<DecisionWrite>();
  readonly removeDecision = output<number>();

  readonly question = signal<Question | null>(null);
  readonly invoiceChoices = INVOICE_CHOICES;
  readonly factsOnly = FACTS_ONLY;

  readonly editable = computed(() => this.view().status === 'CONCEPT');
  readonly transit = computed(() => this.containers('ONDERWEG', 'TRANSIT'));
  readonly partner = computed(() => this.containers('PARTNER', 'PARTNER_CONTAINER'));
  readonly undecided = computed(() => undecidedInvoiceIds(this.view()));

  readonly invoices = computed<InvoiceGroup[]>(() => {
    const undecided = new Set(this.undecided());
    const groups = new Map<number, InvoiceGroup>();
    for (const item of this.view().separate) {
      if (item.kind !== 'GEFACTUREERD' || item.salesOrderId === null) continue;
      let group = groups.get(item.salesOrderId);
      if (!group) {
        group = { salesOrderId: item.salesOrderId, first: item, items: [], choice: null, undecided: undecided.has(item.salesOrderId), automatic: true };
        groups.set(item.salesOrderId, group);
      }
      group.items.push(item);
      if (!item.automatic) group.automatic = false;
    }
    for (const group of groups.values()) {
      group.choice = this.decisionOf('INVOICED', group.salesOrderId)?.choice
        ?? (group.undecided ? null : group.items.find((item) => !item.automatic)?.choice ?? null);
    }
    return [...groups.values()];
  });

  readonly third = computed(() => this.view().separate.filter((item) => item.kind === 'DERDEN'));
  readonly thirdQuantity = computed(() => this.third().reduce((sum, item) => sum + item.quantity, 0));
  readonly demo = computed(() => this.view().articles.filter((article) => article.demo && article.ownQuantity > 0));
  readonly apartIncluded = computed(() =>
    (cents(this.view().totals.partnerIncludedEur) + cents(this.view().totals.transitIncludedEur)) / 100);

  constructor() {
    followAnchor();
    /* A new view is the answer to a save: the question is settled. */
    effect(() => {
      this.view();
      this.question.set(null);
    });
  }

  name(item: SeparateItem): string {
    return item.documentName || item.documentNumber || 'Container';
  }

  /** The decision of one kind on a container or an invoice. */
  decisionOf(kind: DecisionKind, id: number): Decision | null {
    return this.view().decisions.find((decision) =>
      decision.kind === kind && (kind === 'INVOICED' ? decision.salesOrderId === id : decision.purchaseOrderId === id)) ?? null;
  }

  quantityDecision(item: SeparateItem): Decision | null {
    return this.view().decisions.find((decision) => decision.kind === 'PARTNER_QUANTITY'
      && decision.purchaseOrderId === item.purchaseOrderId && decision.productId === item.productId) ?? null;
  }

  private containers(kind: SeparateItem['kind'], decisionKind: DecisionKind): ContainerGroup[] {
    const groups = new Map<number, ContainerGroup>();
    for (const item of this.view().separate) {
      if (item.kind !== kind || item.purchaseOrderId === null) continue;
      let group = groups.get(item.purchaseOrderId);
      if (!group) {
        const decision = this.decisionOf(decisionKind, item.purchaseOrderId);
        group = { purchaseOrderId: item.purchaseOrderId, first: item, items: [], valueEur: 0, included: decision?.flag ?? item.included, decision, empty: true };
        groups.set(item.purchaseOrderId, group);
      }
      group.items.push(item);
      group.valueEur = (cents(group.valueEur) + cents(item.valueEur)) / 100;
      if (item.quantity > 0) group.empty = false;
    }
    /* Only a partner container can be listed without pieces; one in transit always asks. */
    if (kind !== 'PARTNER') for (const group of groups.values()) group.empty = false;
    return [...groups.values()];
  }

  /* ---- decisions ---- */

  askTransit(group: ContainerGroup, included: boolean): void {
    const container = this.view().containers.find((row) => row.purchaseOrderId === group.purchaseOrderId) ?? null;
    const fixedDate = container && borderFixed(container) ? container.rateCutoffDate : null;
    const saved = group.decision?.flag === included ? group.decision : null;
    this.question.set({
      spec: included ? {
        title: `Opgenomen · ${this.name(group.first)}`,
        date: {
          label: 'Eigendom of risico overgegaan op', value: fixedDate ?? saved?.decisionDate ?? null,
          readOnly: fixedDate !== null, help: fixedDate !== null ? 'Ligt vast sinds de vorige afsluiting' : undefined,
        },
        reason: { label: 'Waarop steunt dit?', value: saved?.reason ?? '', required: true },
        saveLabel: 'Bewaren',
      } : {
        title: `Niet opgenomen · ${this.name(group.first)}`,
        reason: { label: 'Reden', value: saved?.reason ?? '', required: true },
        saveLabel: 'Bewaren',
      },
      save: (result) => this.decision.emit(decisionWriteTransit(group.purchaseOrderId, included, result.date, result.reason)),
    });
  }

  askPartner(group: ContainerGroup, included: boolean): void {
    const saved = group.decision?.flag === included ? group.decision : null;
    this.question.set({
      spec: {
        title: `${included ? 'Opgenomen' : 'Niet opgenomen'} · ${this.name(group.first)}`,
        reason: { label: 'Reden', value: saved?.reason ?? '', required: true },
        saveLabel: 'Bewaren',
      },
      save: (result) => this.decision.emit(decisionWritePartnerContainer(group.purchaseOrderId, included, result.reason)),
    });
  }

  askQuantity(item: SeparateItem): void {
    const { purchaseOrderId, productId } = item;
    if (purchaseOrderId === null || productId === null) return;
    const saved = this.quantityDecision(item);
    this.question.set({
      spec: {
        title: `Aantal aanpassen · ${item.productName ?? ''}`,
        lead: [`${this.name(item)} · voorstel ${(item.proposedQuantity ?? 0).toLocaleString('nl-BE')}`],
        quantity: { label: 'Aantal', value: item.quantity, min: 0 },
        reason: { label: 'Reden', value: saved?.reason ?? '', required: true },
        saveLabel: 'Bewaren',
        removeLabel: saved ? 'Terug naar het voorstel' : null,
      },
      save: (result) => {
        if (result.quantity !== null) this.decision.emit(decisionWritePartnerQuantity(purchaseOrderId, productId, result.quantity, result.reason));
      },
      remove: saved ? () => this.removeDecision.emit(saved.id) : undefined,
    });
  }

  /** "Uit eigen voorraad" needs no reason and is saved at once; the other two ask why. */
  chooseInvoice(group: InvoiceGroup, choice: InvoicedChoice): void {
    if (!this.editable() || this.busy()) return;
    if (choice === 'UIT') {
      this.decision.emit(decisionWriteInvoiced(group.salesOrderId, 'UIT', null));
      return;
    }
    const option = INVOICE_CHOICES.find((row) => row.value === choice);
    const saved = this.decisionOf('INVOICED', group.salesOrderId);
    this.question.set({
      spec: {
        title: `${option?.label ?? ''} · factuur ${group.first.documentNumber ?? ''}`,
        lead: option?.help ? [option.help] : [],
        reason: { label: 'Reden', value: saved?.choice === choice ? saved.reason ?? '' : '', required: true },
        saveLabel: 'Bewaren',
      },
      save: (result) => this.decision.emit(decisionWriteInvoiced(group.salesOrderId, choice, result.reason)),
    });
  }

  bulk(choice: 'UIT' | 'AL_WEG'): void {
    const count = this.undecided().length;
    if (!count || this.busy()) return;
    if (choice === 'UIT') {
      this.decision.emit(invoiceBulkWrite(this.view(), 'UIT', null));
      return;
    }
    this.question.set({
      spec: {
        title: `Alle ${count}: stuks waren al weg`,
        lead: ['Ze zitten niet in de getelde voorraad. Elke factuur bewaart deze reden.'],
        reason: { label: 'Reden', value: '', required: true },
        saveLabel: 'Bewaren',
      },
      save: (result) => this.decision.emit(invoiceBulkWrite(this.view(), 'AL_WEG', result.reason)),
    });
  }

  askThird(): void {
    const options = [...this.view().articles]
      .sort((a: ClosingArticle, b: ClosingArticle) => a.productName.localeCompare(b.productName, 'nl'))
      .map((article) => ({ id: article.productId, label: article.sku ? `${article.productName} · ${article.sku}` : article.productName }));
    this.question.set({
      spec: {
        title: 'Goederen van derden toevoegen',
        product: { label: 'Product', options },
        quantity: { label: 'Aantal', value: null, min: 1 },
        name: { label: 'Eigenaar', value: '' },
        reason: { label: 'Reden', value: '', required: true },
        saveLabel: 'Toevoegen',
      },
      save: (result) => {
        if (result.productId !== null && result.quantity !== null) {
          this.decision.emit(decisionWriteThirdParty(result.productId, result.quantity, result.name, result.reason));
        }
      },
    });
  }
}
