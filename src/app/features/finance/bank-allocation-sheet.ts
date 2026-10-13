import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import type { BankMatch } from '../../core/api/banking-api';
import { BankMovementPanel } from './bank-movement-panel';

/**
 * 'Factuur koppelen' for one bank line. The state machine (suggestions,
 * existing receipts, the duplicate guard, the busy lock) stays in
 * BankMovementPanel; this is its dialog, rendered at page level so no
 * scrolling pane traps it.
 */
@Component({
  selector: 'app-bank-allocation-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe],
  template: `
    @let p = panel();
    @if (p.selected(); as row) {
      <app-sheet variant="ios" title="Banktransactie koppelen" [wide]="true" (closed)="p.closeAllocation()">
        <div body class="fin-sheet fin-alloc">
          <div class="fin-alloc__movement">
            <span>{{ row.amountEur > 0 ? 'Ontvangen op' : 'Betaald vanaf' }} {{ p.accountName(row.account) }}</span>
            <strong>{{ row.amountEur | eur }}</strong>
            <small>{{ p.movementStamp(row) }}{{ row.counterparty ? ' · ' + row.counterparty : '' }}</small>
            @if (row.reference) { <small>{{ row.reference }}</small> }
          </div>
            <div class="fin-choice" role="group" aria-label="Soort koppeling">
              <button class="fin-choice__chip" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.allocationMode() === 'expense'" (click)="p.setAllocationMode('expense')">{{ row.amountEur < 0 ? 'Uitgave of container' : 'Terugbetaling leverancier' }}</button>
              <button class="fin-choice__chip" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.allocationMode() === 'sales'" (click)="p.setAllocationMode('sales')">{{ row.amountEur < 0 ? 'Terugbetaling klant' : 'Verkoopfactuur' }}</button>
              <button class="fin-choice__chip" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.allocationMode() === 'received'" (click)="p.setAllocationMode('received')">{{ row.amountEur < 0 ? 'Ontvangen factuur · Odoo / Peppol' : 'Ontvangen creditnota · Odoo / Peppol' }}</button>
            </div>
          @if (p.allocationMode() === 'received') {
            <h3 class="fin-alloc__label">Zelf een ontvangen {{ row.amountEur < 0 ? 'factuur' : 'creditnota' }} kiezen</h3>
            <p class="fin-hint">Kies een document uit Odoo. We controleren eerst de bedragen en bestaande registraties. Het document blijft bij de kost bewaard.</p>
            <input class="input" type="search" placeholder="Zoek factuurnummer, leverancier of bedrag" aria-label="Zoek ontvangen documenten" [value]="p.receivedSearch()" (input)="p.receivedSearch.set($any($event.target).value)" />
            @if (p.receivedError()) { <p class="fin-error" role="alert">{{ p.receivedError() }} <button class="fin-inline-btn" type="button" [disabled]="p.busy() || p.receivedLoading()" (click)="p.loadReceivedInvoices()">Opnieuw laden</button></p> }
            <div class="fin-alloc__cards fin-received-list" role="group" aria-label="Ontvangen documenten">
              @for (document of p.visibleReceivedInvoices(); track document.id) {
                <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.receivedSelectedId() === document.id" (click)="p.selectReceivedInvoice(document)">
                  <span class="fin-match__kind">{{ p.receivedSource(document) }} · {{ document.registered ? 'Al geregistreerd in ENROSED' : 'Nog niet overgenomen uit Odoo' }}</span>
                  <b>{{ document.reference || document.name || 'Zonder factuurnummer' }} · {{ p.receivedAmount(document) }}</b>
                  <span>{{ document.partner || 'Onbekende leverancier' }} · {{ document.date || 'Geen factuurdatum' }}</span>
                  <small>{{ document.moveType === 'in_refund' ? 'Creditnota leverancier' : 'Leveranciersfactuur' }}{{ document.state === 'draft' ? ' · Concept in Odoo' : '' }}</small>
                  @if (document.unavailableReason) { <small>{{ document.unavailableReason }}</small> }
                </button>
              } @empty { @if (p.receivedLoaded() && !p.receivedLoading()) { <p class="fin-hint">{{ p.receivedSearch() ? 'Geen document gevonden in de geladen facturen. Laad eventueel oudere documenten.' : 'Geen ontvangen document gevonden voor deze richting van de banktransactie.' }}</p> } }
            </div>
            @if (p.receivedLoading()) { <p class="fin-hint" role="status">Ontvangen documenten laden…</p> }
            @if (p.receivedHasMore()) { <button class="btn btn--sm" type="button" [disabled]="p.receivedLoading() || p.busy()" (click)="p.loadReceivedInvoices(true)">Oudere documenten laden</button> }
            @if (p.receivedPreviewLoading()) { <p class="fin-hint" role="status">Factuurbedragen, documenten en bestaande kosten controleren…</p> }
            @if (p.receivedPreview(); as preview) {
              <section class="fin-received-preview" aria-label="Controle voor koppelen">
                <h3 class="fin-alloc__label">Controle voor koppelen</h3>
                <dl class="fin-received-preview__amounts">
                  <div><dt>Factuur excl. btw</dt><dd>{{ preview.netEur | eur }}</dd></div>
                  <div><dt>Btw op document</dt><dd>{{ preview.vatEur | eur }}</dd></div>
                  <div><dt>Factuurtotaal</dt><dd>{{ preview.invoiceTotalEur | eur }}</dd></div>
                  <div><dt>Te koppelen betaling</dt><dd>{{ -preview.paymentAmountEur | eur }}</dd></div>
                  <div><dt>Banktransactie</dt><dd>{{ row.amountEur | eur }}</dd></div>
                  <div><dt>Verschil bank − betaling</dt><dd>{{ preview.differenceEur | eur }}</dd></div>
                </dl>
                <p class="fin-hint">Maximaal € 0,02 verschil. De oorspronkelijke bank- en factuurbedragen blijven behouden.</p>
                @if (preview.actionMessage) { <p class="fin-hint fin-hint--warn">{{ preview.actionMessage }}</p> }
                @if (preview.unavailableReason) { <p class="fin-hint fin-hint--warn">{{ preview.unavailableReason }}</p> }
                @if (preview.companyCostId) { <p class="fin-hint">Deze factuur is al geregistreerd als kost #{{ preview.companyCostId }}. Die registratie wordt hergebruikt.</p> }
                @else if (preview.existingCandidates.length) {
                  <p class="fin-hint">Er bestaan mogelijk al kosten voor deze factuur. Kies de juiste registratie om een dubbele kost te voorkomen.</p>
                  <div class="fin-alloc__cards" role="group" aria-label="Bestaande kost hergebruiken">
                    @for (cost of preview.existingCandidates; track cost.id) {
                      <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.receivedExistingCostId() === cost.id" (click)="p.selectReceivedCost(cost.id)">
                        <b>{{ cost.description }} · {{ cost.totalEur | eur }}</b><span>{{ cost.party }} · {{ cost.date }}</span><small>{{ cost.reference }} · {{ cost.openEur | eur }} open</small>
                      </button>
                    }
                  </div>
                } @else { <p class="fin-hint">Wordt als nieuwe kost geregistreerd. De btw-bedragen worden overgenomen; de fiscale behandeling moet daarna nog worden gecontroleerd.</p> }
                @if (preview.document.attachments.length) {
                  <p class="fin-hint">Documenten die bij de kost worden bewaard:</p>
                  <ul class="fin-received-preview__files">@for (file of preview.document.attachments; track file.id) { <li>{{ file.name }}</li> }</ul>
                } @else { <p class="fin-hint fin-hint--warn">Odoo bevat geen beschikbaar PDF- of XML-document voor deze factuur.</p> }
              </section>
            }
          } @else if (p.allocationMode() === 'expense') {
            <p class="fin-hint">Kies de betalingen die al in ENROSED staan. Je kunt meerdere containerdelen combineren met één kostenbetaling. Er wordt geen nieuwe betaling aangemaakt.</p>
            <input class="input" type="search" placeholder="Zoek tegenpartij, container, mededeling of bedrag" aria-label="Zoek bestaande uitgaven" [value]="p.outgoingSearch()" (input)="p.outgoingSearch.set($any($event.target).value)" />
            <div class="fin-alloc__cards" role="group" aria-label="Bestaande betalingen">
              @for (item of p.visibleOutgoing(); track item.key) {
                <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.outgoingSelected().includes(item.key)" (click)="p.toggleOutgoing(item)">
                  <span class="fin-match__kind">{{ item.kind === 'cost' ? (item.amountEur < 0 ? 'Terugbetaling leverancier' : 'Kostenbetaling') : 'Containerbetaling' }} · {{ item.paidOn }}</span>
                  <b>{{ item.title }} · {{ item.amountEur | eur }}</b><small>{{ item.detail }}</small>
                </button>
              } @empty { <p class="fin-hint">Geen ongekoppelde betaling gevonden. Registreer een nieuwe uitgave via Kosten of Containers en kies daar deze banktransactie.</p> }
            </div>
            <p class="fin-hint" aria-live="polite">{{ p.chosenOutgoing().length }} geselecteerd · {{ -p.outgoingTotal() | eur }} tegenover {{ row.amountEur | eur }} op de bank.
              Verschil bank − betaling: {{ p.outgoingDifference() | eur }}. Maximaal € 0,02; de oorspronkelijke bedragen blijven behouden.
            </p>
          } @else {
          @if (p.matchingLoading()) { <p class="fin-hint" role="status">Voorstellen zoeken…</p> }
          @if (p.matches().length) {
            <h3 class="fin-alloc__label">Voorstellen</h3>
            <div class="fin-alloc__cards" role="group" aria-label="Voorstellen">
              @for (match of p.matches(); track key(match)) {
                <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.isChosen(match)" (click)="p.chooseMatch(match)">
                  <span class="fin-match__kind">{{ match.existingPaymentId ? 'Bestaande betaling koppelen' : row.amountEur < 0 ? (p.isCreditNote(match.salesOrderId) ? 'Nieuwe terugbetaling op creditnota ' + match.number : 'Nieuwe terugbetaling op de factuur') : 'Nieuwe betaling op de factuur' }}</span>
                  <b>{{ match.number }}</b>
                  <span>{{ match.openEur | eur }} {{ row.amountEur < 0 ? (p.isCreditNote(match.salesOrderId) ? 'tegoed' : 'terug te betalen') : 'nog te ontvangen' }}</span>
                  @if (match.receivedAt) { <small>Geboekt {{ p.matchStamp(match) }}{{ match.reference ? ' · ' + match.reference : '' }}</small> }
                </button>
              }
            </div>
          }
          <h3 class="fin-alloc__label">Zelf een factuur kiezen</h3>
          <select class="select" [disabled]="p.busy()" [value]="p.manualInvoice()" (change)="p.chooseInvoice(+$any($event.target).value)" aria-label="Factuur">
            <option value="0">Kies een factuur…</option>
            @for (view of p.selectableInvoices(); track view.order.id) {
              <option [value]="view.order.id" [selected]="view.order.id === p.manualInvoice()">{{ view.order.number }} · {{ p.customerName(view.order.customerId) }} · {{ p.available(view) | eur }} {{ row.amountEur < 0 ? (view.order.docType === 'CREDITNOTA' ? 'tegoed' : 'terug te betalen') : 'open' }}</option>
            }
          </select>
          @if (!p.selectableInvoices().length && !p.matchingLoading()) {
            <p class="fin-hint">{{ row.amountEur < 0 ? 'Geen factuur of creditnota met genoeg tegoed voor deze terugbetaling.' : 'Geen uitgegeven verkoopfactuur gevonden.' }}</p>
          }
          @if (p.manualInvoice()) {
            <div class="fin-alloc__cards">
              @for (match of p.manualMatches(); track key(match)) {
                <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.isChosen(match)" (click)="p.chooseMatch(match, true)">
                  <span class="fin-match__kind">Bestaande betaling koppelen</span>
                  <b>{{ p.matchStamp(match) }}</b><small>{{ match.reference || 'Deze betaling wordt niet opnieuw geboekt.' }}</small>
                </button>
              }
              @if (p.manualNewMatch(); as match) {
                <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.isChosen(match)" (click)="p.chooseMatch(match, true)">
                  <span class="fin-match__kind">{{ row.amountEur < 0 ? (p.isCreditNote(match.salesOrderId) ? 'Nieuwe terugbetaling op creditnota ' + match.number : 'Nieuwe terugbetaling op de factuur') : 'Nieuwe betaling op de factuur' }}</span>
                  <b>{{ match.number }}</b><span>{{ match.openEur | eur }} {{ row.amountEur < 0 ? (p.isCreditNote(match.salesOrderId) ? 'tegoed' : 'terug te betalen') : 'nog te ontvangen' }}</span>
                </button>
              }
            </div>
          }
          @if (p.choice(); as chosen) {
            @if (chosen.existingPaymentId && p.matchDifference(chosen) !== null) { <p class="fin-hint">Verschil bank − bestaande betaling: {{ p.matchDifference(chosen) | eur }}. Maximaal € 0,02; het oorspronkelijke betaalbedrag blijft behouden.</p> }
            @if (p.newBookingDifference(chosen) !== null && p.newBookingDifference(chosen) !== 0) {
              <p class="fin-hint">Afrondingsverschil bank − betaling: {{ p.newBookingDifference(chosen) | eur }}. Het resterende factuurbedrag wordt afgepunt; de oorspronkelijke bedragen blijven behouden.</p>
            }
            @if (!chosen.existingPaymentId && row.amountEur > 0 && row.amountEur > chosen.openEur && p.newBookingDifference(chosen) === null) {
              <p class="fin-hint fin-hint--warn">{{ row.amountEur - chosen.openEur | eur }} meer dan wat openstaat; het wordt als teveel ontvangen geregistreerd.</p>
            }
            @if (!chosen.existingPaymentId && p.chosenInvoiceHasExistingMatches()) {
              <label class="fin-check"><input type="checkbox" [disabled]="p.busy()" [checked]="p.newBookingConfirmed()" (change)="p.newBookingConfirmed.set($any($event.target).checked)" />
                <span>Ik heb de bestaande betalingen gecontroleerd; dit is een andere betaling.</span></label>
            }
          }
          }
          @if (p.error()) { <p class="fin-error" role="alert">{{ p.error() }}</p> }
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" [disabled]="p.busy()" (click)="p.closeAllocation()">Annuleren</button>
          <span class="spacer"></span>
          <button class="btn btn--primary" type="button" [disabled]="p.allocationMode() === 'received' ? !p.canLinkReceived() : p.allocationMode() === 'expense' ? !p.canLinkOutgoing() : !p.canAllocate()" (click)="p.allocationMode() === 'received' ? p.linkReceivedInvoice() : p.allocationMode() === 'expense' ? p.linkOutgoing() : p.allocate()">{{ p.busy() ? 'Koppelen…' : p.allocationMode() === 'received' && !p.receivedPreview()?.companyCostId && !p.receivedExistingCostId() ? 'Registreren en koppelen' : 'Koppelen' }}</button>
        </div>
      </app-sheet>
    }
  `,
})
export class BankAllocationSheet {
  readonly panel = input.required<BankMovementPanel>();

  key(match: BankMatch): string {
    return `${match.salesOrderId}:${match.existingPaymentId ?? 'new'}`;
  }
}
