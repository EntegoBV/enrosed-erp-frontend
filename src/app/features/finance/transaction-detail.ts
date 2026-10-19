import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { BankPurchasePaymentPart, BankStatementLine } from '../../core/api/banking-api';
import type { PurchaseDocument } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { invoiceCoverage, invoiceLine, primaryInvoice } from '../purchasing/purchase-invoices';
import { surplusQuestion } from '../purchasing/purchase-payment-links';
import { BankAllocationSteps } from './bank-allocation-steps';
import { KEEP_LABEL, changePreview } from './bank-change-preview';
import type { ChangePreview, KeepAs, LinkTarget } from './bank-change-preview';
import { BankMovementPanel } from './bank-movement-panel';
import { legDistance, lineStatus, vatPeriodLabel } from './bank-suggestions';
import type { LineSuggestion } from './bank-suggestions';
import { CLASSIFICATION_LABEL } from './cash-forecast';
import { dayMonth as ddmm } from './cash-format';
import { ContainerSplit } from './container-split';
import { dayMonth, signedEur as signedMoney } from './finance-format';
import { containerName } from '../purchasing/container-name';
import { SERVER_PENDING } from './finance-state';

const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const WEEKDAY_LONG = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const PAYEE_LABEL: Readonly<Record<string, string>> = { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' };
const STATUS_LABEL: Readonly<Record<string, string>> = { CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen' };
const cents = (value: number): number => Math.round(value * 100);
type View = 'auto' | 'search' | 'containers';

/** One part on a linked line, as "Gekoppeld aan" lists it. */
interface LinkedPart { key: string; title: string; sub: string | null; amountEur: number; open: () => void; others: { text: string; lineId: number }[]; }

/**
 * One bank transaction with its own address (line=): the desk inspector
 * (424 px) and the phone sheet (spec-bank-forecast §3.5). By its status it
 * shows the best match with "Wat verandert" (Suggestie), the three ways to
 * link it (Te koppelen), what it is linked to with the invoice, the container
 * and the proof (Gekoppeld), or what it was booked as (Geboekt als). It is a
 * BankMovementPanel, so the linking state machine of the old allocation
 * sheet (and its tests) carry over unchanged.
 */
@Component({
  selector: 'app-transaction-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, Icon, EurPipe, Sheet, BankAllocationSteps, ContainerSplit],
  styleUrl: './bank-movement-panel.scss',
  host: { style: 'display: contents' },
  template: `
    @if (state.desk()) {
      <div class="fin-txd">
        <header class="wk-inspector__head fin-txd__head">
          <span class="fin-txd__position">{{ positionText() }}</span>
          @if (position(); as pos) {
            <button class="wk-kbd fin-txd__step" type="button" title="Vorige (K)" aria-label="Vorige transactie" [disabled]="pos.index === 0" (click)="step(-1)">K</button>
            <button class="wk-kbd fin-txd__step" type="button" title="Volgende (J)" aria-label="Volgende transactie" [disabled]="pos.index >= pos.total - 1" (click)="step(1)">J</button>
          }
          <span class="fin-txd__spacer"></span>
          <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" aria-label="Sluiten" (click)="state.closeInspector()"><app-icon name="close" [size]="16" /></button>
        </header>
        <ng-container *ngTemplateOutlet="body" />
        <footer class="wk-inspector__foot fin-txd__foot"><ng-container *ngTemplateOutlet="foot" /></footer>
      </div>
    } @else {
      <app-sheet variant="ios" title="Transactie" closeLabel="Transactie sluiten" (closed)="state.closeInspector()">
        <div body class="fin-txd fin-txd--phone"><ng-container *ngTemplateOutlet="body" /></div>
        <div foot class="fin-txd__foot fin-txd__foot--phone"><ng-container *ngTemplateOutlet="foot" /></div>
      </app-sheet>
    }

    <ng-template #body>
      @if (line(); as row) {
        <section class="wk-section fin-txd__hero">
          <span class="fin-txd__dir">{{ row.amountEur > 0 ? 'Ontvangen van' : 'Betaald aan' }}</span>
          <div class="fin-txd__who"><h2 class="fin-txd__party">{{ titleOf(row) }}</h2>
            <strong class="fin-txd__amount" [class.wk-amount--in]="row.amountEur > 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</strong></div>
          @if (cleanSub(row); as clean) { <span class="fin-txd__meta fin-txd__clean">{{ clean }}</span> }
          <span class="fin-txd__meta">{{ meta(row) }}</span>
          @if (row.reference) { <code class="fin-txd__ref">{{ row.reference }}</code> }
          <span class="fin-txd__pills"><span [class]="'wk-pill ' + statusTone(row)">{{ statusLabel(row) }}</span>
            @if (row.sourceReconciled) { <span class="wk-pill tone-ok">Afgepunt in Odoo ✓</span> }
            @if (!state.officialBankLine(row)) { <span class="wk-pill tone-grey">Historische registratie</span> }</span>
          <span class="fin-txd__saldo">{{ saldoAfter(row) }}</span>
          <!-- The phone row has no ⋯ any more: every line action (Intrekken too) is here, the sheet's own ⋯ at the top right (critique B6). -->
          @if (!state.desk()) { <button class="ios-circle fin-txd__more" type="button" [attr.aria-label]="'Meer acties voor ' + titleOf(row)" (click)="lineMenu(row, null)"><app-icon name="more" [size]="20" /></button> }
        </section>

        @switch (status()) {
          @case ('BOOKED') {
            <section class="wk-section">
              <h3 class="wk-section__title">Geboekt als {{ classLabel(row) }}</h3>
              @if (row.classification === 'INTERNAL_TRANSFER') { <p class="fin-txd__line">{{ transferText(row) }}</p> }
              @if (row.classification === 'VAT' && row.vatPeriod) { <p class="fin-txd__line">{{ vatLabel(row.vatPeriod) }}</p> }
              @if (row.ticaSettlementId && row.ticaSettlementAmountEur != null) {
                <p class="fin-txd__line">Afrekening {{ row.ticaSettlementAmountEur | eur }} · bankverschil {{ row.amountEur - row.ticaSettlementAmountEur | eur }}</p>
              }
              @if (row.classificationNote) { <p class="fin-txd__line">{{ row.classificationNote }}</p> }
              @if (row.classifiedBy || row.classifiedAt) { <p class="fin-hint">Geboekt door {{ row.classifiedBy || 'onbekend' }}{{ row.classifiedAt ? ' op ' + stampShort(row.classifiedAt) : '' }}</p> }
            </section>
          }
          @case ('LINKED') {
            <section class="wk-section">
              <h3 class="wk-section__title">Gekoppeld aan</h3>
              @for (part of linkedParts(); track part.key) {
                <button class="fin-txd__part" type="button" (click)="part.open()"><span><b>{{ part.title }}</b>@if (part.sub) { <small>{{ part.sub }}</small> }</span><span class="fin-txd__part-amount">{{ part.amountEur | eur }}</span></button>
                @for (other of part.others; track other.lineId) { <button class="wk-link fin-txd__other" type="button" (click)="state.openLine(other.lineId)">{{ other.text }} ›</button> }
              } @empty { <p class="fin-hint">{{ row.allocationLabel || 'Gekoppeld' }}</p> }
              @if (linkedParts().length) {
                <p class="fin-txd__sum" [class.is-off]="!sumMatches()">{{ sumMatches() ? 'Samen gelijk aan de transactie ' + eur(abs(row.amountEur)) + ' ✓' : 'Verschil ' + signed(sumDifference()) }}</p>
              }
            </section>
            @if (invoiceRows().length || linkedOrder()) {
              <section class="wk-section">
                <h3 class="wk-section__title">Factuur</h3>
                @for (invoice of invoiceRows(); track invoice.text) { <p class="fin-txd__line">{{ invoice.text }}@if (invoice.coverage) { <small>{{ invoice.coverage }}</small> }</p> }
                @empty { <p class="fin-txd__line">Nog geen factuur bij deze container</p> }
              </section>
            }
            @if (linkedOrder(); as view) {
              <section class="wk-section">
                <h3 class="wk-section__title">Container</h3>
                <button class="fin-txd__part" type="button" (click)="state.inspectRelated({ kind: 'container', id: view.order.id })"><span><b>{{ containerLine(view) }}</b><small>nog open {{ (view.reconciliation?.totals?.remainingEur ?? 0) | eur }}</small></span><app-icon name="chevron-right" [size]="14" /></button>
              </section>
            }
            @if (linkedPurchases().length) {
              <section class="wk-section">
                <h3 class="wk-section__title">Betaalbewijs</h3>
                <p class="fin-hint">Een gekoppelde banktransactie is al het bewijs; een bestand is optioneel.</p>
                @for (file of proofFiles(); track file.id) { <button class="wk-link fin-txd__file" type="button" (click)="openProof(file)"><app-icon name="document" [size]="14" />{{ file.label || file.originalFilename }}</button> }
              </section>
            }
            <section class="wk-section">
              <h3 class="wk-section__title">Geschiedenis</h3>
              <p class="fin-hint fin-txd__history">{{ record(row) }}</p>
            </section>
          }
          @default {
            @if (view() === 'containers') {
              <section class="wk-section">
                <h3 class="wk-section__title">Verdelen over containers <button class="wk-link" type="button" (click)="view.set('auto')">Terug</button></h3>
                <app-container-split [line]="row" [hint]="supplierHint()" (done)="view.set('auto')" />
              </section>
            } @else if (best(); as match) {
              <section class="wk-section">
                <h3 class="wk-section__title">Beste match @if (suggestion()?.exact) { <span class="wk-pill tone-ok">exact</span> }</h3>
                <div class="fin-txd__match">
                  <div class="fin-txd__match-head"><b>{{ match.title }}</b><button class="wk-link" type="button" (click)="openTarget(match)">Openen ›</button></div>
                  <dl class="fin-txd__compare">
                    @for (row of compareRows(); track row.label) { <div><dt>{{ row.label }}</dt><dd [class.is-ok]="row.ok">{{ row.value }}</dd></div> }
                  </dl>
                  @if (reasons().length) { <div class="fin-txd__reasons">@for (reason of reasons(); track reason) { <span class="wk-pill wk-pill--outline">{{ reason }}</span> }</div> }
                </div>
                @if (preview(); as change) { <ng-container *ngTemplateOutlet="whatChanges; context: { $implicit: change, target: match, row: row }" /> }
                @if (isNewTarget(match)) {
                  <details class="fin-txd__details"><summary>Details</summary><app-bank-allocation-steps [panel]="this" only="preview" /></details>
                }
              </section>
              @if (alternatives().length) {
                <section class="wk-section">
                  <h3 class="wk-section__title">Andere mogelijkheden <button class="wk-link" type="button" (click)="searchAll()">Zoek in ENROSED ›</button></h3>
                  @for (other of alternatives(); track $index) {
                    <button class="fin-txd__part" type="button" (click)="choose(other.target)"><span><b>{{ other.target.title }}</b><small>{{ other.reasons.join(' · ') }}</small></span>
                      <span class="fin-txd__part-amount">{{ amountOf(other.target) | eur }}@if (!isNewTarget(other.target)) { <small>volgt bank</small> }</span></button>
                  }
                </section>
              }
            } @else {
              <section class="wk-section fin-txd__steps">
                @if (pattern(); as hint) {
                  <p class="fin-hint fin-txd__pattern"><span>{{ hint }}</span><button class="wk-btn wk-btn--sm wk-btn--primary btn btn--primary" type="button" (click)="bookPattern(row)">Boeken</button></p>
                }
                <app-bank-allocation-steps [panel]="this" />
                @if (engineTarget(); as target) {
                  @if (enginePreview(); as change) { <ng-container *ngTemplateOutlet="whatChanges; context: { $implicit: change, target: target, row: row }" /> }
                }
              </section>
            }
            @if (view() !== 'containers') {
              <section class="wk-section fin-txd__offer">
                <div><b>Splitsen</b><small>Goederen + inspectie, of meerdere betalingen.</small></div>
                <span class="fin-txd__offer-actions"><button class="wk-btn wk-btn--sm" type="button" (click)="splitPayments()">Splitsen…</button>
                  @if (row.amountEur < 0) {
                    <!-- An older server books every part on the first container: the split waits for the 2026-10-16 round (cashRound). -->
                    <button class="wk-btn wk-btn--sm" type="button" [disabled]="!state.cashRound()" [attr.title]="state.cashRound() ? null : serverPending" (click)="openSplit(null)">Verdelen over containers…</button>
                  }</span>
              </section>
              <section class="wk-section fin-txd__offer">
                <div><b>Geen factuur of kost?</b><small>Overboeking, bankkosten, btw, lening, privé</small></div>
                <button class="wk-btn wk-btn--sm" type="button" (click)="state.bookAsLine.set(row)">Boeken als…</button>
              </section>
            }
          }
        }
      } @else {
        <p class="wk-empty__text fin-insp-missing">Deze transactie staat niet (meer) in de lijst.</p>
      }
    </ng-template>

    <!--
      "Wat verandert" (spec §3.6) of one target: the best match, or the one existing payment picked under
      "Bestaande betaling". Rows, the switch "Betaling volgt de bank", the rest of a smaller purchase payment, the
      choice for a larger one, and "Betaling houden" when the switch is off.
    -->
    <ng-template #whatChanges let-change let-target="target" let-row="row">
      <div class="fin-txd__change">
        <h4>Wat verandert</h4>
        @let asking = surplusAsked(change, target);
        @if (!asking) {
          <div class="bank-alloc-change" role="table" aria-label="Wat verandert">
            <div class="bank-alloc-change__row bank-alloc-change__row--head" role="row"><span role="columnheader"></span><span role="columnheader">Betaling nu</span><span role="columnheader">Na koppelen</span></div>
            @for (item of change.rows; track item.label) {
              <div class="bank-alloc-change__row" role="row" [class.is-changed]="item.changed"><span role="rowheader">{{ item.label }}</span><span role="cell">{{ item.now }}</span><span role="cell">{{ item.after }}</span></div>
            }
          </div>
        }
        @if (followableFor(target)) {
          <label class="fin-switch-row"><input [class.fin-switch]="state.desk()" [class.ios-switch]="!state.desk()" type="checkbox" [checked]="follow()" [disabled]="change.mode === 'lower' && target.kind === 'purchase-existing'" (change)="follow.set($any($event.target).checked)" />
            <span><b>Betaling volgt de bank</b><small>{{ asking ? 'Kies hieronder wat er met het verschil gebeurt.' : change.followText }}</small></span></label>
        }
        @if (change.restText) { <p class="fin-hint">{{ change.restText }}</p> }
        @if (change.mode === 'higher' && target.kind === 'purchase-existing' && target.currency === 'EUR' && follow()) {
          <!-- Nothing chosen beforehand (Emre, 2026-10-16: one transfer paid three containers, 'Bedrag aanpassen' was the trap): the split first. -->
          <div class="fin-txd__radios" role="radiogroup" [attr.aria-label]="surplusQuestion(change.differenceEur)">
            <b>{{ surplusQuestion(change.differenceEur) }}</b>
            @if (state.cashRound()) {
              <label><input type="radio" name="surplus" [checked]="false" (change)="openSplit(target)" /><span>Verdelen over containers<small>Deze transactie betaalde ook andere containers</small></span></label>
            }
            <label><input type="radio" name="surplus" [checked]="surplus() === 'ADJUST'" (change)="surplus.set('ADJUST')" /><span>Bedrag aanpassen naar {{ eur(abs(row.amountEur)) }}</span></label>
            @if (target.hasInspectionAfspraak) { <label><input type="radio" name="surplus" [checked]="surplus() === 'INSPECTION'" (change)="surplus.set('INSPECTION')" /><span>Rest als inspectie via leverancier</span></label> }
          </div>
        }
        @if (!follow() && change.keepAllowed && state.cashRound()) {
          <label class="fin-txd__keep">Betaling houden, verschil {{ eur(change.differenceEur) }} als
            <select class="select" [value]="keepAs()" (change)="keepAs.set($any($event.target).value)"><option value="BANKKOSTEN">Bankkosten</option><option value="KOERSVERSCHIL">Koersverschil</option></select></label>
        } @else if (change.blockedText || (!follow() && change.keepAllowed)) { <p class="fin-hint fin-hint--warn">{{ change.blockedText || keepOnlyEqual }}</p> }
      </div>
    </ng-template>

    <ng-template #foot>
      @if (line(); as row) {
        @switch (status()) {
          @case ('BOOKED') {
            @if (row.ticaSettlementId) { <button class="wk-btn btn" type="button" (click)="state.openTicaSettlement(row.ticaSettlementId)">TICA-afrekening ›</button> }
            @else { <button class="wk-btn btn" type="button" [disabled]="state.linking() !== null" (click)="state.unclassifyLine(row)">Ongedaan maken</button> }
            <button class="wk-btn btn" type="button" (click)="next()">Volgende</button>
          }
          @case ('LINKED') {
            @if (linkedPurchases().length >= 2) { <button class="wk-btn btn" type="button" [disabled]="state.linking() !== null" (click)="adjustSplit(row)">Splitsing aanpassen</button> }
            <button class="wk-btn wk-btn--danger btn" type="button" [disabled]="state.linking() !== null" (click)="state.unlinkLine(row)">Koppeling losmaken</button>
            <button class="wk-btn btn" type="button" (click)="openLinked(row)">Openen</button>
          }
          @default {
            @if (view() === 'containers') {
              <button class="wk-btn btn" type="button" (click)="view.set('auto')">Terug</button>
            } @else if (best(); as match) {
              <button class="wk-btn wk-btn--primary btn btn--primary" type="button" [disabled]="!canLinkBest()" (click)="linkBest(row, match)">{{ state.linking() === row.id ? 'Koppelen…' : primaryLabel() }}</button>
              <button class="wk-btn btn" type="button" (click)="next()">Volgende</button>
            } @else {
              @if (!engineTarget() && allocationBlockedReason(); as reason) { <p class="fin-txd__reason" role="status">{{ reason }}</p> }
              <button class="wk-btn wk-btn--primary btn btn--primary" type="button" [disabled]="engineTarget() ? !canLinkEngine() : !allocationReady()" (click)="submitEngine(row)">{{ engineTarget() ? (state.linking() === row.id ? 'Koppelen…' : enginePreview()?.primaryLabel ?? 'Koppelen') : allocationActionLabel() }}</button>
              <button class="wk-btn btn" type="button" (click)="next()">Volgende</button>
            }
          }
        }
      }
    </ng-template>
  `,
})
export class TransactionDetail extends BankMovementPanel {
  /** The cleaned reference above the raw one, only when cleaning changed something: a clean reference is not read twice. */
  cleanSub(row: BankStatementLine): string {
    const sub = this.textOf(row).sub;
    return sub && sub !== (row.reference ?? '').replace(/\s+/g, ' ').trim() ? sub : '';
  }
  private readonly injector = inject(Injector);
  private readonly purchases = inject(SourcingApi);
  readonly lineId = input.required<number>();
  /** The list the detail was opened from, for "Transactie {i} van {n} te koppelen" and J / K. */
  readonly order = input<readonly number[]>([]);

  readonly view = signal<View>('auto');
  readonly follow = signal(true);
  readonly keepAs = signal<KeepAs>('BANKKOSTEN');
  /** A larger transaction on a purchase payment: nothing chosen beforehand (null), the link waits for the answer. */
  readonly surplus = signal<'ADJUST' | 'INSPECTION' | null>(null);
  /** "Verdelen over containers" chosen as that answer: the split starts on this payment's container and payment. */
  readonly splitFrom = signal<{ orderId: number; paymentId: number } | null>(null);
  readonly surplusQuestion = surplusQuestion;
  /** Another candidate picked under "Andere mogelijkheden"; the best match otherwise. */
  readonly chosen = signal<LinkTarget | null>(null);
  readonly proofFiles = signal<PurchaseDocument[]>([]);
  readonly keepOnlyEqual = 'Betaling houden kan alleen als de bedragen gelijk zijn (± € 0,02).';
  readonly serverPending = SERVER_PENDING;

  readonly line = computed(() => this.state.bankStatements().find((row) => row.id === this.lineId()) ?? null);
  readonly suggestion = computed<LineSuggestion | undefined>(() => { const row = this.line(); return row ? this.suggestionOf(row) : undefined; });
  readonly status = computed(() => { const row = this.line(); return row ? lineStatus(row, this.suggestion()) : 'OPEN'; });
  /** The best match to link with one button: a document, term or payment (never a cost pattern: that one registers a cost). */
  readonly best = computed<LinkTarget | null>(() => {
    if (this.view() === 'search' || this.status() !== 'SUGGESTED') return null;
    const chosen = this.chosen();
    if (chosen) return this.enriched(chosen);
    const target = this.suggestion()?.target;
    return target && target.kind !== 'cost-pattern' ? this.enriched(target) : null;
  });
  readonly reasons = computed(() => {
    const chosen = this.chosen();
    if (!chosen) return this.suggestion()?.reasons ?? [];
    return this.suggestion()?.others.find((other) => other.target === chosen)?.reasons ?? [];
  });
  readonly alternatives = computed(() => {
    const suggestion = this.suggestion();
    if (!suggestion || suggestion.target.kind === 'cost-pattern') return suggestion?.others ?? [];
    const all = [{ target: suggestion.target, reasons: suggestion.reasons }, ...suggestion.others];
    const best = this.chosen() ?? suggestion.target;
    return all.filter((row) => row.target !== best).slice(0, 3);
  });
  /** A cost pattern: the hint above the three ways ("Kost · Telefoon & internet · zoals de vorige 3 keer"). */
  readonly pattern = computed(() => { const target = this.suggestion()?.target; return target?.kind === 'cost-pattern' ? target.label : null; });
  readonly preview = computed(() => {
    const row = this.line(), target = this.best();
    return row && target ? changePreview(target, { amountEur: row.amountEur, day: this.state.lineDay(row), accountLabel: this.accountName(row.account) },
      this.effectiveFollow(target), this.keepAs(), this.surplus() ?? 'ADJUST') : null;
  });
  /** The switch as the server can carry it out: an existing cost payment or receipt follows the bank only from the 2026-10-16 round on (linkLine's rule). */
  private effectiveFollow(target: LinkTarget): boolean {
    return this.follow() && (target.kind === 'purchase-existing' || this.state.cashRound());
  }
  /** Follow the bank can be switched for an existing payment (cost and receipt only when the server knows it). */
  followableFor(target: LinkTarget | null): boolean {
    return !!target && (target.kind === 'purchase-existing' || ((target.kind === 'cost-existing' || target.kind === 'sales-existing') && this.state.cashRound()));
  }
  readonly primaryLabel = computed(() => this.preview()?.primaryLabel ?? 'Koppelen');
  /** What may be linked as the preview stands (the best match and "Bestaande betaling" alike). */
  private linkAllowed(target: LinkTarget, preview: ChangePreview): boolean {
    if (this.state.linking() !== null || preview.blockedText || this.surplusAsked(preview, target)) return false;
    if (!this.state.cashRound() && (target.kind === 'cost-existing' || target.kind === 'sales-existing') && preview.mode !== 'equal') return false;
    if (!this.state.cashRound() && target.kind === 'purchase-existing' && !this.follow() && preview.mode !== 'equal') return false;
    return true;
  }
  readonly canLinkBest = computed(() => {
    const target = this.best(), preview = this.preview(), row = this.line();
    if (!target || !preview || !row || !this.linkAllowed(target, preview)) return false;
    if (this.isNewTarget(target)) return this.localDocument()?.key === this.targetKey(target) && this.canLinkLocal();
    return true;
  });
  readonly compareRows = computed(() => {
    const target = this.best(), row = this.line();
    if (!target || !row) return [];
    const rows: { label: string; value: string; ok?: boolean }[] = [];
    const line = Math.abs(row.amountEur);
    if (target.kind === 'term-new') {
      rows.push({ label: 'Afspraak termijn', value: euro.format(target.payable.plannedEur) });
      if (target.payable.paidEur) rows.push({ label: 'Al betaald', value: euro.format(target.payable.paidEur) });
      const view = this.state.purchaseViews().find((item) => item.order.id === target.orderId);
      const invoice = target.payable.invoiceNumber ? view?.invoices?.find((item) => item.number === target.payable.invoiceNumber) : undefined;
      if (target.payable.invoiceNumber) rows.push({ label: 'Factuur', value: invoice ? `${invoice.number} · ${euro.format(invoice.amountEur ?? invoice.amount)}` : target.payable.invoiceNumber });
    } else if (target.kind === 'cost-new' || target.kind === 'sales-new') {
      rows.push({ label: target.kind === 'cost-new' ? 'Nog open op de kost' : 'Nog open op de factuur', value: euro.format(target.openEur) });
    } else {
      rows.push({ label: 'Betaling', value: `${euro.format(target.amountEur)} op ${dayMonth(target.kind === 'sales-existing' ? target.receivedOn : target.paidOn)}` });
    }
    const other = this.amountOf(target);
    rows.push({ label: 'Deze transactie', value: euro.format(line) });
    const difference = (cents(line) - cents(other)) / 100;
    rows.push({ label: 'Verschil', value: signedMoney(difference) + (Math.abs(cents(difference)) <= 2 ? ' ✓' : ''), ok: Math.abs(cents(difference)) <= 2 });
    return rows;
  });
  /**
   * A single existing payment chosen in "Bestaande betaling" (Te koppelen): it follows the bank too, through the best
   * match's "Wat verandert" and call (§3.6). A purchase payment goes this way as one payment alone; round 2's own
   * table stays for what §3.6 does not cover: a USD/CNY part named in its own currency, the goods with their inspection.
   */
  readonly engineTarget = computed<LinkTarget | null>(() => {
    if (this.allocationStep() !== 'payments') return null;
    if (this.allocationMode() === 'sales') {
      const choice = this.choice();
      if (!choice?.existingPaymentId) return null;
      const payment = this.state.incomingPayments().find((row) => row.id === choice.existingPaymentId);
      return payment ? { kind: 'sales-existing', salesOrderId: choice.salesOrderId, paymentId: payment.id, title: `Factuur ${choice.number}`, amountEur: Math.abs(payment.amountEur),
        receivedOn: payment.receivedAt.slice(0, 10), account: payment.bankAccount ? this.accountName(payment.bankAccount) : null } : null;
    }
    const chosen = this.chosenOutgoing();
    if (chosen.length !== 1) return null;
    if (chosen[0].kind === 'purchase') return this.purchaseEngineTarget(chosen[0].id);
    const cost = this.state.costs().find((row) => row.id === chosen[0].ownerId);
    const payment = cost?.payments?.find((row) => row.id === chosen[0].id);
    return cost && payment ? { kind: 'cost-existing', costId: cost.id!, costPaymentId: payment.id!, title: `Kost · ${cost.description}`, amountEur: Math.abs(payment.amountEur),
      paidOn: payment.paidOn, account: payment.account ? this.accountName(payment.account) : null, proofCount: this.state.attachmentsFor(cost.id).length } : null;
  });
  readonly enginePreview = computed(() => {
    const row = this.line(), target = this.engineTarget();
    return row && target ? changePreview(target, { amountEur: row.amountEur, day: this.state.lineDay(row), accountLabel: this.accountName(row.account) },
      this.effectiveFollow(target), this.keepAs(), this.surplus() ?? 'ADJUST') : null;
  });
  readonly canLinkEngine = computed(() => {
    const target = this.engineTarget(), preview = this.enginePreview();
    return !!target && !!preview && this.linkAllowed(target, preview);
  });
  /** Which existing payment the engine shows: another one starts again from "Betaling volgt de bank" (as choose() does). */
  private readonly engineKey = computed(() => {
    const target = this.engineTarget();
    if (!target) return '';
    return target.kind === 'purchase-existing' || target.kind === 'sales-existing' ? `${target.kind}:${target.paymentId}`
      : target.kind === 'cost-existing' ? `${target.kind}:${target.costPaymentId}` : target.kind;
  });
  /** Round 2's own surplus choices and table step aside while the detail shows §3.6 for the chosen payment. */
  override ownsChange(): boolean { return this.engineTarget()?.kind === 'purchase-existing'; }
  /** One purchase payment as the best match would have it (bank-suggestions' target, enriched the same way). */
  private purchaseEngineTarget(paymentId: number): LinkTarget | null {
    const part = this.outgoingPart();
    if (!part || part.row.id !== paymentId || part.withIds.length || part.refused || (part.foreign && this.outgoingForeignInput().trim())) return null;
    const payment = this.state.payments().find((row) => row.id === paymentId);
    if (!payment) return null;
    const order = containerName({ id: payment.orderId, number: payment.orderNumber, alias: payment.orderAlias });
    const groupSize = payment.groupId != null ? this.state.payments().filter((row) => row.groupId === payment.groupId).length : 1;
    return this.enriched({ kind: 'purchase-existing', orderId: payment.orderId, paymentId: payment.id, title: `Inkoop · ${order}${payment.label ? ' · ' + payment.label : ''}`,
      amountEur: payment.amountEur, paidOn: payment.paidOn, currency: payment.currency ?? 'EUR', amount: payment.amount ?? payment.amountEur, account: null, proofCount: 0,
      hasInspectionAfspraak: false, groupSize });
  }

  /* ---- linked */
  readonly linkedPurchases = computed(() => { const row = this.line(); return row ? this.state.payments().filter((payment) => payment.bankStatementLineId === row.id) : []; });
  readonly linkedParts = computed<LinkedPart[]>(() => {
    const row = this.line();
    if (!row) return [];
    const parts: LinkedPart[] = [];
    for (const payment of this.linkedPurchases()) {
      const group = payment.groupId != null ? this.state.payments().filter((item) => item.groupId === payment.groupId).sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id - b.id) : [];
      const index = group.findIndex((item) => item.id === payment.id);
      const payee = PAYEE_LABEL[payment.payee ?? 'SUPPLIER'];
      parts.push({ key: `p${payment.id}`, amountEur: payment.amountEur, open: () => this.state.inspectRelated({ kind: 'container', id: payment.orderId }),
        title: group.length > 1 ? `Deel ${index + 1} van ${group.length} · ${payment.label || payee}` : `${this.orderName(payment)} · ${payee}${payment.label ? ' · ' + payment.label : ''}`,
        sub: group.length > 1 ? `${this.orderName(payment)} · ${payee}` : null,
        others: group.filter((item) => item.id !== payment.id && item.bankStatementLineId != null).map((item) => {
          const other = this.state.bankStatements().find((line) => line.id === item.bankStatementLineId);
          return { lineId: item.bankStatementLineId!, text: `andere delen: ${other ? this.accountName(other.account) : 'op de bank'} ${ddmm(item.paidOn)} ${euro.format(item.amountEur)}` };
        }) });
    }
    for (const cost of this.state.costs()) {
      const payments = (cost.payments ?? []).filter((payment) => payment.bankStatementLineId === row.id);
      for (const payment of payments) parts.push({ key: `c${payment.id}`, title: `Kost · ${cost.description}`, sub: cost.party, amountEur: payment.amountEur, others: [],
        open: () => this.state.inspectRelated({ kind: 'cost', id: cost.id! }) });
      if (!payments.length && cost.bankStatementLineId === row.id) parts.push({ key: `k${cost.id}`, title: `Kost · ${cost.description}`, sub: cost.party, amountEur: cost.cashTotalEur ?? 0, others: [],
        open: () => this.state.inspectRelated({ kind: 'cost', id: cost.id! }) });
    }
    if (row.salesOrderId) {
      const view = this.state.salesOrders().find((item) => item.order.id === row.salesOrderId);
      parts.push({ key: `s${row.salesOrderId}`, title: `Factuur ${view?.order.number ?? '#' + row.salesOrderId}`, sub: view ? this.customerName(view.order.customerId) : null,
        amountEur: Math.abs(row.allocatedAmountEur ?? row.amountEur), others: [], open: () => this.state.openInvoice(row.salesOrderId!) });
    }
    return parts;
  });
  private readonly partsCents = computed(() => this.linkedParts().reduce((sum, part) => sum + cents(Math.abs(part.amountEur)), 0));
  readonly sumMatches = computed(() => { const row = this.line(); return !!row && Math.abs(this.partsCents() - Math.abs(cents(row.amountEur))) <= 2; });
  readonly sumDifference = computed(() => { const row = this.line(); return row ? (Math.abs(cents(row.amountEur)) - this.partsCents()) / 100 : 0; });
  /** The one container the line paid (several: none, each part opens its own). */
  readonly linkedOrder = computed(() => {
    const orders = [...new Set(this.linkedPurchases().map((payment) => payment.orderId))];
    return orders.length === 1 ? this.state.purchaseViews().find((view) => view.order.id === orders[0]) ?? null : null;
  });
  /** The primary invoice per payee of the linked container(s), with round 2's "Geldt voor alle betalingen van …"; a sales invoice. */
  readonly invoiceRows = computed(() => {
    const row = this.line();
    const rows: { text: string; coverage: string | null }[] = [];
    if (row?.salesOrderId) {
      const view = this.state.salesOrders().find((item) => item.order.id === row.salesOrderId);
      if (view) rows.push({ text: `Factuur ${view.order.number} · ${euro.format(view.paymentSummary?.invoiceTotalEur ?? view.priced?.totals?.totalInclVat ?? 0)}`, coverage: null });
    }
    for (const orderId of new Set(this.linkedPurchases().map((payment) => payment.orderId))) {
      const view = this.state.purchaseViews().find((item) => item.order.id === orderId);
      for (const payee of [...new Set(this.linkedPurchases().filter((payment) => payment.orderId === orderId).map((payment) => payment.payee ?? 'SUPPLIER'))]) {
        const invoice = primaryInvoice(view?.invoices ?? [], payee);
        if (!invoice) continue;
        const branch = view ? this.state.containerTree(view).find((item) => item.payee === payee) : undefined;
        const nodes = branch ? [...branch.terms.flatMap((term) => term.payments), ...branch.payments] : [];
        rows.push({ text: invoiceLine(invoice), coverage: invoice.paymentIds !== undefined
          ? invoiceCoverage(invoice, nodes.map((node) => ({ parts: node.parts.length ? node.parts : [{ id: node.id }] })), PAYEE_LABEL[payee]).text : null });
      }
    }
    return rows;
  });

  /* ---- position in the list it came from */
  readonly position = computed(() => {
    const order = this.order(), index = order.indexOf(this.lineId());
    return index < 0 || order.length < 2 ? null : { index, total: order.length };
  });
  readonly positionText = computed(() => {
    const pos = this.position();
    return pos ? `Transactie ${pos.index + 1} van ${pos.total}${this.state.location().link === 'unlinked' ? ' te koppelen' : ''}` : 'Transactie';
  });

  /**
   * Where a container split starts: the payment 'Verdelen over containers'
   * was chosen for, else the best match's container on its payment or term,
   * else the counterparty's supplier.
   */
  readonly supplierHint = computed(() => {
    const counterparty = this.line()?.counterparty ?? '';
    const from = this.splitFrom();
    if (from) return { orderId: from.orderId, paymentId: from.paymentId, counterparty };
    const target = this.suggestion()?.target;
    if (target?.kind === 'purchase-existing') return { orderId: target.orderId, paymentId: target.paymentId, counterparty };
    if (target?.kind === 'term-new') return { orderId: target.orderId, termKey: target.payable.key, counterparty };
    return { orderId: null, counterparty };
  });
  /** A larger transaction on one euro purchase payment that follows the bank, and nothing chosen yet: the question waits for its answer. */
  surplusAsked(change: ChangePreview, target: LinkTarget): boolean {
    return change.mode === 'higher' && target.kind === 'purchase-existing' && target.currency === 'EUR' && this.follow() && this.surplus() === null;
  }
  /** "Verdelen over containers": from a larger transaction's choice (that payment ticked), or the offer below (the best match's container). */
  openSplit(target: LinkTarget | null): void {
    this.splitFrom.set(target?.kind === 'purchase-existing' ? { orderId: target.orderId, paymentId: target.paymentId } : null);
    this.view.set('containers');
  }
  override containerSplitOffered(): boolean { return this.state.cashRound(); }
  override openContainerSplit(payment: { id: number; ownerId: number }): void {
    this.splitFrom.set({ orderId: payment.ownerId, paymentId: payment.id });
    this.view.set('containers');
  }

  constructor() {
    super();
    /* The detail runs the old sheet's state machine on its own line: opened on arrival, closed when the line is linked or gone. */
    effect(() => {
      const row = this.line();
      untracked(() => {
        if (!row || this.allocated(row)) { if (this.selected()) this.closeAllocation(); return; }
        if (this.selected()?.id !== row.id) {
          this.view.set('auto'); this.chosen.set(null); this.follow.set(true); this.surplus.set(null); this.splitFrom.set(null); this.keepAs.set('BANKKOSTEN');
          void this.openAllocation(row);
        }
      });
    });
    /* A best match on a document or term is chosen in the state machine too, so its preview, duplicate check and fields apply. */
    effect(() => {
      const target = this.best();
      const loaded = this.localDocuments().length;
      untracked(() => {
        if (!target || !this.isNewTarget(target) || !loaded || this.selected()?.id !== this.lineId()) return;
        const key = this.targetKey(target);
        if (this.localSelectedKey() === key) return;
        const document = this.localDocuments().find((row) => row.key === key);
        if (document) { this.allocationStep.set('documents'); this.chooseLocalDocument(document); }
      });
    });
    /* Another payment picked under "Bestaande betaling": the switch on, "Bedrag aanpassen", Bankkosten (as for a best match). */
    effect(() => {
      if (!this.engineKey()) return;
      untracked(() => { this.follow.set(true); this.surplus.set(null); this.keepAs.set('BANKKOSTEN'); });
    });
    /* The proof files of the linked purchase payments (round 2's list). */
    effect(() => {
      const ids = this.linkedPurchases().map((payment) => payment.id);
      const orders = [...new Set(this.linkedPurchases().map((payment) => payment.orderId))];
      untracked(() => {
        this.proofFiles.set([]);
        for (const orderId of orders) void this.sourcingDocuments(orderId).then((docs) => this.proofFiles.update((files) =>
          [...files, ...docs.filter((doc) => doc.paymentId != null && ids.includes(doc.paymentId))]));
      });
    });
  }

  private async sourcingDocuments(orderId: number): Promise<PurchaseDocument[]> {
    try { return await this.purchases.documents(orderId); } catch { return []; }
  }
  async openProof(file: PurchaseDocument): Promise<void> {
    await this.openPurchaseFile(file.orderId, file.id, file.originalFilename);
  }

  /** A suggestion's target with what the bank side knows: the account, the proof, the inspection Afspraak. */
  private enriched(target: LinkTarget): LinkTarget {
    if (target.kind !== 'purchase-existing') return target;
    const payment = this.state.payments().find((row) => row.id === target.paymentId);
    const view = this.state.purchaseViews().find((row) => row.order.id === target.orderId);
    const separate = view?.reconciliation?.streams.find((stream) => stream.payee === 'SEPARATE');
    const offered = (payment?.payee ?? 'SUPPLIER') === 'SUPPLIER' && target.currency === 'EUR' && (!!view?.order.inspectionViaSupplier || (separate?.plannedEur ?? 0) > 0);
    return { ...target, hasInspectionAfspraak: offered, proofCount: this.proofFiles().filter((file) => file.paymentId === target.paymentId).length };
  }
  isNewTarget(target: LinkTarget): boolean { return target.kind === 'cost-new' || target.kind === 'sales-new' || target.kind === 'term-new'; }
  targetKey(target: LinkTarget): string {
    return target.kind === 'cost-new' ? `cost:${target.costId}` : target.kind === 'sales-new' ? `sales:${target.salesOrderId}` : target.kind === 'term-new' ? target.payable.key : '';
  }
  amountOf(target: LinkTarget): number {
    return target.kind === 'cost-new' || target.kind === 'sales-new' ? target.openEur : target.kind === 'term-new' ? target.payable.remainingEur : target.amountEur;
  }
  /** "Boeken" beside a cost pattern: the cost registration prefilled from the latest cost of that pattern (the row's action). */
  bookPattern(row: BankStatementLine): void {
    const target = this.suggestion()?.target;
    if (target?.kind === 'cost-pattern') this.state.bookPattern(row, target.costId);
  }
  choose(target: LinkTarget): void { this.chosen.set(target); this.follow.set(true); this.surplus.set(null); }
  searchAll(): void { this.view.set('search'); this.setAllocationStep('documents'); this.localSelectedKey.set(null); }
  splitPayments(): void { this.view.set('search'); this.setAllocationStep('payments'); }

  openTarget(target: LinkTarget): void {
    if (target.kind === 'cost-new' || target.kind === 'cost-existing') this.state.inspectRelated({ kind: 'cost', id: target.costId });
    else if (target.kind === 'sales-new' || target.kind === 'sales-existing') this.state.openInvoice(target.salesOrderId);
    else this.state.inspectRelated({ kind: 'container', id: target.orderId });
  }

  /** "Koppelen" on the best match: the link of §3.6 with its follow choice; a new container term takes the fields of "Details". */
  async linkBest(row: BankStatementLine, target: LinkTarget): Promise<void> {
    if (!this.canLinkBest()) return;
    const parts = target.kind === 'term-new' ? this.termParts(row, target) : undefined;
    const failure = await this.state.linkLine(row, target, { follow: this.follow(), keepAs: this.keepAs(), surplus: this.surplus() ?? 'ADJUST', parts,
      confirmNew: target.kind === 'cost-new' && this.localNewConfirmed() });
    if (!failure) this.afterLink();
  }
  /** The purchase payment(s) of a new term from the state machine's fields (currency, amount, the inspection paid with it). */
  private termParts(row: BankStatementLine, target: Extract<LinkTarget, { kind: 'term-new' }>): BankPurchasePaymentPart[] {
    const amount = this.parsedAmount(), currency = this.purchaseCurrency();
    const inspection = target.payable.payee === 'SUPPLIER' ? this.purchaseInspection() : null;
    const base = this.state.termPart(row, target);
    if (amount === null) return [base];
    if (inspection !== null) {
      return [{ ...base, amount: Math.round((amount - inspection) * 100) / 100, currency, amountEur: currency === 'EUR' ? null : Math.abs(row.amountEur) },
        { ...base, payee: 'SEPARATE', instalmentDue: null, amount: inspection, currency, amountEur: null, inspectionViaSupplier: true, label: `${base.label} · inspectie` }];
    }
    return [{ ...base, amount, currency, amountEur: currency === 'EUR' ? null : Math.abs(row.amountEur) }];
  }
  private parsedAmount(): number | null {
    const text = this.purchaseAmountInput().trim().replace(/\./g, '').replace(',', '.');
    const value = Number(text);
    return text && Number.isFinite(value) && value > 0 ? value : null;
  }
  /** The footer of "Te koppelen": one existing cost payment or receipt follows the bank; anything else is the old sheet's submit. */
  async submitEngine(row: BankStatementLine): Promise<void> {
    const target = this.engineTarget();
    if (!target) { await this.submitAllocation(); return; }
    if (!this.canLinkEngine()) return;
    const failure = await this.state.linkLine(row, target, { follow: this.effectiveFollow(target), keepAs: this.keepAs(), surplus: this.surplus() ?? 'ADJUST' });
    if (!failure) this.afterLink();
  }
  /** On a phone the sheet moves on to the next transaction still to link. */
  private afterLink(): void {
    if (!this.state.desk()) this.next(true);
  }
  next(unlinkedOnly = false): void {
    const order = this.order().length ? this.order() : this.state.bankStatements().filter((line) => this.state.officialBankLine(line) && !this.state.archivedBankLine(line))
      .sort((a, b) => Date.parse(b.bookedAt) - Date.parse(a.bookedAt) || b.id - a.id).map((line) => line.id);
    const index = order.indexOf(this.lineId());
    const rest = [...order.slice(index + 1), ...order.slice(0, Math.max(0, index))];
    const nextId = rest.find((id) => { const line = this.state.bankStatements().find((item) => item.id === id); return !!line && (!unlinkedOnly || !this.allocated(line)); });
    if (nextId != null) this.state.go({ line: nextId }); else this.state.closeInspector();
  }
  step(delta: number): void {
    const pos = this.position();
    if (!pos) return;
    const id = this.order()[pos.index + delta];
    if (id != null) this.state.go({ line: id });
  }
  /**
   * S, C, U, O and L while this transaction is open (CostsPage sends them
   * here, whatever list is behind it): S opens "Splitsen", L links the best
   * match with the switches as they stand; the rest act as on its row.
   */
  override handle(command: string): boolean {
    const row = this.line();
    if (!row) return false;
    const open = this.status() !== 'LINKED' && this.status() !== 'BOOKED';
    if (command === 'split' && open) { this.splitPayments(); return true; }
    const match = this.best();
    if (command === 'link' && match) { if (this.canLinkBest()) void this.linkBest(row, match); return true; }
    return super.handle(command);
  }
  /** "Splitsing aanpassen": unlink, then reopen "Bestaande betaling" with the parts selected. */
  adjustSplit(row: BankStatementLine): void {
    const keys = this.linkedPurchases().map((payment) => `purchase:${payment.id}`);
    this.state.unlinkLine(row);
    const stop = effect(() => {
      const current = this.line();
      if (!current || this.allocated(current) || this.selected()?.id !== current.id) return;
      untracked(() => { this.view.set('search'); this.setAllocationStep('payments'); this.allocationMode.set('expense'); this.outgoingSelected.set(keys); });
      stop.destroy();
    }, { injector: this.injector });
  }

  /* ---- words */
  meta(row: BankStatementLine): string {
    const day = WEEKDAY_LONG.format(new Date(`${this.state.lineDay(row)}T12:00:00Z`)).replace(/\./g, '');
    return this.imported(row) ? `${this.accountName(row.account)} · via Odoo · ${day}` : `${this.accountName(row.account)} · handmatig · ${day} · ${this.clock(row)}`;
  }
  saldoAfter(row: BankStatementLine): string {
    const balance = this.state.running().get(`bank:${row.id}`);
    if (balance?.accountAfterEur != null) return `Saldo na deze transactie ${euro.format(balance.accountAfterEur)}`;
    return balance?.unknownBefore ? `Saldo onbekend vóór ${ddmm(balance.unknownBefore)}` : 'Saldo onbekend · vul eerst een saldo in';
  }
  classLabel(row: BankStatementLine): string { return row.classification ? CLASSIFICATION_LABEL[row.classification] : ''; }
  transferText(row: BankStatementLine): string {
    const other = row.transferLineId != null ? this.state.bankStatements().find((line) => line.id === row.transferLineId) : undefined;
    if (!other) return 'Andere kant staat niet in Enrosed';
    const amount = `${other.amountEur > 0 ? '+' : '−'} ${euro.format(Math.abs(other.amountEur))}`;
    return `⇄ ${this.accountName(other.account)} ${amount} · ${legDistance(this.state.lineDay(row), this.state.lineDay(other))}`;
  }
  vatLabel(period: string): string { return vatPeriodLabel(period); }
  stampShort(instant: string): string {
    const date = new Date(instant);
    return Number.isFinite(date.getTime()) ? `${date.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Brussels' })} ${date.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}` : '';
  }
  containerLine(view: { order: { id?: number; number: string; alias?: string | null; status: string; expectedArrival?: string | null; receivedOn?: string | null } }): string {
    const arrival = view.order.receivedOn ?? view.order.expectedArrival;
    return [containerName(view.order), STATUS_LABEL[view.order.status] ?? view.order.status, arrival ? `aankomst ${dayMonth(arrival)}` : ''].filter(Boolean).join(' · ');
  }
  eur(value: number): string { return euro.format(value); }
  /** "− € 95,58" / "+ € 0,01": the sign before the euro. */
  signed(value: number): string { return signedMoney(value); }
  /** A container payment's container by its name (alias, else number). */
  orderName(payment: { orderId: number; orderNumber?: string | null; orderAlias?: string | null }): string {
    return containerName({ id: payment.orderId, number: payment.orderNumber, alias: payment.orderAlias });
  }
  keepWord(value: KeepAs): string { return KEEP_LABEL[value]; }
}
