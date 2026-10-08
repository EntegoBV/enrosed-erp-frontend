import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ClosingView, DecisionWrite, Notice } from '../../core/api/inventory-models';
import { DateTimeNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { ClosingDecisionSheet, DecisionSheetResult, DecisionSheetSpec, followAnchor, noticeAnchor } from './closing-decision-sheet';
import { decisionWriteVatConfirmation } from './inventory-closing';

interface Question {
  spec: DecisionSheetSpec;
  save: (result: DecisionSheetResult) => void;
}

/**
 * Step 5 of the closing, "Afsluiten": what still stops it, the totals, for a
 * correction everything that differs from the version it replaces, the
 * user's statement about recoverable VAT, the two files and "Definitief
 * maken". A final closing shows its three hashes and the way to a
 * correction. It emits; the shell freezes, downloads and starts versions.
 */
@Component({
  selector: 'app-closing-step-finalize',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, NumPipe, DateTimeNlPipe, ClosingDecisionSheet],
  host: { class: 'inv-step inv-final' },
  template: `
    @if (blockers().length || warnings().length) {
      <section class="wk-card">
        <div class="wk-card__body inv-final__notices">
          @if (blockers().length) {
            <h3 class="inv-final__title inv-final__title--stop">Nog te doen ({{ blockers().length }})</h3>
            <ul class="inv-final__list">
              @for (notice of blockers(); track $index) {
                <li><a class="inv-final__notice" [routerLink]="[]" [queryParams]="{ stap: notice.segment }" queryParamsHandling="merge" [fragment]="anchor(notice)">{{ notice.message }}</a></li>
              }
            </ul>
          }
          @if (warnings().length) {
            <h3 class="inv-final__title">Aandachtspunten ({{ warnings().length }})</h3>
            <ul class="inv-final__list">
              @for (notice of warnings(); track $index) {
                <li><a class="inv-final__notice" [routerLink]="[]" [queryParams]="{ stap: notice.segment }" queryParamsHandling="merge" [fragment]="anchor(notice)">{{ notice.message }}</a></li>
              }
            </ul>
          }
        </div>
      </section>
    }

    <section class="wk-card">
      <div class="wk-card__head"><h3 class="wk-card__title">Totalen</h3></div>
      <div class="wk-card__body">
        <dl class="wk-equation inv-final__totals">
          <div><dt>Aanschafwaarde eigen voorraad</dt><dd>{{ totals().costValueEur | eur }}</dd></div>
          <div><dt><span class="wk-equation__op">−</span>Waardeverminderingen</dt><dd>{{ totals().writeDownEur | eur }}</dd></div>
          <div class="is-total"><dt><span class="wk-equation__op">=</span>Eigen voorraad na waardevermindering</dt><dd>{{ totals().ownValueEur | eur }}</dd></div>
          <div class="is-sub"><dt>Waarvan demostukken</dt><dd>{{ totals().demoValueEur | eur }}</dd></div>
          <div><dt><span class="wk-equation__op">+</span>Partnercontainers, opgenomen</dt><dd>{{ totals().partnerIncludedEur | eur }}</dd></div>
          <div><dt><span class="wk-equation__op">+</span>Goederen onderweg, opgenomen</dt><dd>{{ totals().transitIncludedEur | eur }}</dd></div>
          <div class="is-total is-grand"><dt><span class="wk-equation__op">=</span>Totaal voorraadwaarde</dt><dd>{{ totals().totalValueEur | eur }}</dd></div>
          <div class="is-sub"><dt>Waarvan geschat</dt><dd>{{ totals().estimatedEur | eur }}</dd></div>
        </dl>
        <dl class="inv-kv inv-final__outside">
          <div><dt>Partnercontainers, niet opgenomen</dt><dd>{{ totals().partnerExcludedEur | eur }}</dd></div>
          <div><dt>Goederen onderweg, niet opgenomen</dt><dd>{{ totals().transitExcludedEur | eur }}</dd></div>
          <div><dt>Gefactureerd, uit eigen voorraad gehaald</dt><dd>{{ totals().invoicedOutEur | eur }}</dd></div>
          <div><dt>Eigen voorraad (aantal)</dt><dd>{{ totals().ownQuantity | num }}</dd></div>
          <div><dt>Zonder gewaardeerde partij (aantal)</dt><dd>{{ totals().unvaluedQuantity | num }}</dd></div>
        </dl>
      </div>
    </section>

    @if (view().versionChanges; as changes) {
      <section class="wk-card">
        <div class="wk-card__head"><h3 class="wk-card__title">Wijzigingen tegenover versie {{ changes.againstVersionNo }}</h3></div>
        <div class="wk-card__body inv-final__changes">
          @if (!changes.articles.length && !changes.lots.length && !changes.movements.length && !changes.openingLayers.length) {
            <p class="inv-step__text">Geen verschillen.</p>
          } @else {
            <p class="inv-step__text">Totaal voorraadwaarde {{ changes.totalBeforeEur | eur }} → {{ changes.totalAfterEur | eur }}</p>
            @if (changes.articles.length) {
              <h4 class="inv-final__sub">Producten ({{ changes.articles.length }})</h4>
              @for (row of changes.articles; track row.productId) {
                <p class="inv-final__change"><strong>{{ row.productName }}</strong>
                  @if (row.quantityBefore !== row.quantityAfter) { <span>Aantal {{ count(row.quantityBefore) }} → {{ count(row.quantityAfter) }}</span> }
                  @if (row.costValueBeforeEur !== row.costValueAfterEur) { <span>Aanschafwaarde {{ money(row.costValueBeforeEur) }} → {{ money(row.costValueAfterEur) }}</span> }
                  @if (row.writeDownBeforeEur !== row.writeDownAfterEur) { <span>Waardevermindering {{ money(row.writeDownBeforeEur) }} → {{ money(row.writeDownAfterEur) }}</span> }
                </p>
              }
            }
            @if (changes.lots.length) {
              <h4 class="inv-final__sub">Partijen ({{ changes.lots.length }})</h4>
              @for (row of changes.lots; track row.purchaseOrderId + ':' + row.productId) {
                <p class="inv-final__change"><strong>{{ row.displayName }} · {{ row.productName }}</strong>
                  <span>Waarde per stuk {{ money(row.unitValueBeforeEur, 4) }} → {{ money(row.unitValueAfterEur, 4) }}</span></p>
              }
            }
            @if (changes.movements.length) {
              <h4 class="inv-final__sub">Bewegingen ({{ changes.movements.length }})</h4>
              @for (row of changes.movements; track row.movementId) {
                <p class="inv-final__change"><strong>{{ row.productName }} · {{ row.locationName }}@if (row.reference) { · {{ row.reference }} }</strong>
                  <span>Effect {{ effectText(row.effectBefore) }} → {{ effectText(row.effectAfter) }}</span></p>
              }
            }
            @if (changes.openingLayers.length) {
              <h4 class="inv-final__sub">Beginwaarden ({{ changes.openingLayers.length }})</h4>
              @for (row of changes.openingLayers; track row.openingLayerId) {
                <p class="inv-final__change"><strong>{{ row.productName }}@if (row.source) { · {{ row.source }} }</strong>
                  <span>{{ layerText(row.quantityBefore, row.unitValueBeforeEur) }} → {{ layerText(row.quantityAfter, row.unitValueAfterEur) }}</span></p>
              }
            }
          }
        </div>
      </section>
    }

    <section class="wk-card" id="inv-vat">
      <div class="wk-card__body inv-final__confirm">
        <label class="inv-check inv-check--tall">
          <input type="checkbox" [checked]="!!vat()" [disabled]="!editable() || busy()" (change)="toggleVat($event)" />
          <span>Ik bevestig dat de betalingen onder Leverancier, Douane &amp; transport en Inspectie &amp; andere kosten zonder aftrekbare btw zijn ingevoerd (bedragen exclusief btw).</span>
        </label>
        @if (vat(); as confirmed) { <p class="inv-step__quiet">Bevestigd door {{ confirmed.decidedByName }} op {{ confirmed.decidedAt | dateTimeNl }}</p> }
        <p class="inv-step__quiet">Niet zeker? Kijk de betalingen na in stap 3, Containers. Een betaling met btw die je terugkrijgt pas je aan op de container; de btw boek je als aparte betaling onder 'Bijkomende kosten'.</p>
      </div>
    </section>

    @if (editable()) {
      <div class="inv-final__actions">
        <button class="wk-btn" type="button" [disabled]="busy()" (click)="download.emit('pdf')">Concept-PDF</button>
        <button class="wk-btn" type="button" [disabled]="busy()" (click)="download.emit('xlsx')">Concept-Excel</button>
        <span class="inv-final__spacer"></span>
        @if (blockers().length) { <span class="inv-final__todo">Nog {{ blockers().length }} te doen</span> }
        <button class="wk-btn wk-btn--primary" type="button" [disabled]="busy() || blockers().length > 0 || !view().canFinalize" (click)="askFinalize()">Definitief maken</button>
      </div>
    } @else {
      <section class="wk-card">
        <div class="wk-card__head"><h3 class="wk-card__title">Controle</h3></div>
        <div class="wk-card__body">
          <dl class="inv-kv inv-final__hashes">
            <div><dt>Ondertekend door</dt><dd>{{ view().signerName || '—' }}</dd></div>
            <div><dt>Definitief gemaakt</dt><dd>{{ view().finalizedAt | dateTimeNl }}@if (view().finalizedByName) { · {{ view().finalizedByName }} }</dd></div>
            <div><dt>Gegevens (SHA-256)</dt><dd class="inv-hash">{{ view().dataSha256 }}</dd></div>
            <div><dt>PDF (SHA-256)</dt><dd class="inv-hash">{{ view().pdfSha256 || '—' }}</dd></div>
            <div><dt>Excel (SHA-256)</dt><dd class="inv-hash">{{ view().xlsxSha256 || '—' }}</dd></div>
          </dl>
        </div>
      </section>
      <div class="inv-final__actions">
        <button class="wk-btn" type="button" [disabled]="busy()" (click)="download.emit('pdf')">PDF</button>
        <button class="wk-btn" type="button" [disabled]="busy()" (click)="download.emit('xlsx')">Excel</button>
        <span class="inv-final__spacer"></span>
        @if (view().canCorrect) { <button class="wk-btn" type="button" [disabled]="busy()" (click)="askCorrection()">Corrigeren (nieuwe versie)</button> }
      </div>
    }

    @if (question(); as open) {
      <app-closing-decision-sheet [spec]="open.spec" [busy]="busy()" (save)="open.save($event)" (closed)="question.set(null)" />
    }
  `,
})
export class ClosingStepFinalize {
  readonly view = input.required<ClosingView>();
  readonly busy = input(false);
  readonly decision = output<DecisionWrite>();
  readonly removeDecision = output<number>();
  readonly finalize = output<{ signerName: string }>();
  readonly startVersion = output<{ reason: string }>();
  readonly download = output<'pdf' | 'xlsx'>();

  readonly question = signal<Question | null>(null);

  private readonly eur = new EurPipe();

  readonly editable = computed(() => this.view().status === 'CONCEPT');
  readonly totals = computed(() => this.view().totals);
  readonly blockers = computed(() => this.view().notices.filter((notice) => notice.severity === 'BLOCKER'));
  readonly warnings = computed(() => this.view().notices.filter((notice) => notice.severity !== 'BLOCKER'));
  /** The user's statement that no payment in the value holds recoverable VAT. */
  readonly vat = computed(() =>
    this.view().decisions.find((decision) => decision.kind === 'VAT_CONFIRMATION' && decision.flag === true) ?? null);

  constructor() {
    followAnchor();
    /* A new view is the answer to a save (or the figures moved): the sheet is done. */
    effect(() => {
      this.view();
      this.question.set(null);
    });
  }

  anchor(notice: Notice): string | undefined {
    return noticeAnchor(notice) ?? undefined;
  }

  count(value: number | null): string {
    return value === null ? '—' : value.toLocaleString('nl-BE');
  }

  money(value: number | null, decimals = 2): string {
    return value === null ? '—' : this.eur.transform(value, decimals);
  }

  /** What a movement did to the closing quantity in one version; null = it was not listed there. */
  effectText(value: number | null): string {
    if (value === null) return 'niet in de lijst';
    return value > 0 ? `+${value.toLocaleString('nl-BE')}` : value.toLocaleString('nl-BE');
  }

  layerText(quantity: number | null, unitValueEur: number | null): string {
    return quantity === null ? 'niet gebruikt' : `${quantity.toLocaleString('nl-BE')} x ${this.money(unitValueEur, 4)}`;
  }

  /** The box follows the saved decision, not the click. */
  toggleVat(event: Event): void {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    const saved = this.vat();
    box.checked = !!saved;
    if (!this.editable() || this.busy() || wanted === !!saved) return;
    if (wanted) this.decision.emit(decisionWriteVatConfirmation());
    else if (saved) this.removeDecision.emit(saved.id);
  }

  askFinalize(): void {
    const view = this.view();
    const lead = ['Aantallen, waarden, partijen, waardeverminderingen en beslissingen worden vastgelegd en kunnen daarna niet meer wijzigen. Een correctie wordt een nieuwe versie; deze blijft bewaard.'];
    const laterYear = view.supersedesId === null ? null : view.notices.find((notice) => notice.code === 'LATER_JAAR_AFGESLOTEN') ?? null;
    if (laterYear) lead.push(laterYear.message);
    this.question.set({
      spec: {
        title: `Jaarinventaris ${view.closingYear} definitief maken?`, lead,
        name: { label: 'Naam ondertekenaar', value: '' },
        saveLabel: 'Definitief maken',
      },
      save: (result) => this.finalize.emit({ signerName: result.name }),
    });
  }

  askCorrection(): void {
    this.question.set({
      spec: {
        title: 'Corrigeren (nieuwe versie)',
        lead: ['Deze versie blijft bewaard en leesbaar. De nieuwe versie start als concept met dezelfde beslissingen en wordt opnieuw berekend.'],
        reason: { label: 'Waarom is een correctie nodig?', value: '', required: true },
        saveLabel: 'Nieuwe versie starten',
      },
      save: (result) => this.startVersion.emit({ reason: result.reason }),
    });
  }
}
