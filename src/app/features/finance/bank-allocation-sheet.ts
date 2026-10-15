import type { PaymentNode } from './container-payment-tree';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, inject, input, viewChild } from '@angular/core';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { BankMovementPanel } from './bank-movement-panel';
import type { BankAllocationTarget } from './bank-allocation-targets';

/** One bank payment, local documents first. Rendered at page level with the other finance sheets. */
@Component({
  selector: 'app-bank-allocation-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe],
  styleUrl: './bank-allocation-sheet.scss',
  template: `
    @let p = panel();
    @if (p.selected(); as row) {
      <app-sheet variant="ios" title="Banktransactie koppelen" [wide]="true" (closed)="p.closeAllocation()">
        <div body class="fin-sheet fin-alloc">
          <div class="bank-alloc-movement">
            <div><span>{{ row.amountEur > 0 ? 'Ontvangen van' : 'Betaald aan' }}</span><strong>{{ row.counterparty || 'Onbekende tegenpartij' }}</strong><small>{{ p.movementStamp(row) }} · {{ p.accountName(row.account) }}</small></div>
            <b>{{ row.amountEur | eur }}</b>
            @if (row.reference) { <p>{{ row.reference }}</p> }
          </div>
          @if (p.localBankProblem()) { <p class="fin-error" role="alert">{{ p.localBankProblem() }}</p> }
          <div class="bank-alloc-tabs" role="group" aria-label="Wat koppel je aan deze banktransactie?">
            <button type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.allocationStep() === 'documents'" (click)="p.setAllocationStep('documents')">Factuur of uitgave</button>
            <button type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.allocationStep() === 'payments'" (click)="p.setAllocationStep('payments')">Bestaande betaling</button>
            <button type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.allocationStep() === 'new'" (click)="p.setAllocationStep('new')">Nog te registreren</button>
          </div>
          @if (p.allocationStep() !== 'new') {
            @if (p.localLoading()) { <p class="fin-hint" role="status">Facturen en uitgaven bijwerken…</p> }
            @if (p.localError()) { <p class="fin-error" role="alert">{{ p.localError() }} <button class="fin-inline-btn" type="button" [disabled]="p.localLoading() || p.busy()" (click)="p.loadLocalDocuments()">Opnieuw laden</button></p> }
          }
          @if (p.allocationStep() === 'documents') {
            @if (!p.localDocument()) {
            <p class="fin-hint">Kies een factuur, uitgave of inkooptermijn die al in ENROSED staat. De bankbetaling wordt daarop afgepunt.</p>
            <label class="bank-alloc-search"><span>Zoek in ENROSED</span><input class="input" type="search" placeholder="Leverancier, klant, factuurnummer, datum of bedrag" [value]="p.localSearch()" (input)="p.localSearch.set($any($event.target).value)" /></label>
            <div class="fin-choice" role="group" aria-label="Documentsoort">
              <button class="fin-choice__chip" type="button" [attr.aria-pressed]="p.localKind() === 'all'" (click)="p.localKind.set('all')">Alles</button>
              <button class="fin-choice__chip" type="button" [attr.aria-pressed]="p.localKind() === 'cost'" (click)="p.localKind.set('cost')">{{ row.amountEur < 0 ? 'Uitgaven' : 'Creditnota leverancier' }}</button>
              <button class="fin-choice__chip" type="button" [attr.aria-pressed]="p.localKind() === 'sales'" (click)="p.localKind.set('sales')">{{ row.amountEur < 0 ? 'Terugbetaling klant' : 'Verkoopfacturen' }}</button>
              @if (row.amountEur < 0) { <button class="fin-choice__chip" type="button" [attr.aria-pressed]="p.localKind() === 'purchase'" (click)="p.localKind.set('purchase')">Inkoop</button> }
            </div>
            <div class="bank-alloc-list" role="group" aria-label="Facturen en uitgaven in ENROSED">
              @for (document of p.visibleLocalDocuments(); track document.key) {
                <button class="bank-alloc-document" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.localSelectedKey() === document.key" (click)="selectDocument(document)">
                  <span class="bank-alloc-document__identity"><small>{{ document.label }}{{ document.estimated ? ' · verwacht bedrag' : '' }}</small><b>{{ document.title }}</b><span>{{ document.party }}{{ document.reference && document.reference !== document.title ? ' · ' + document.reference : '' }}</span><small>{{ document.date || 'Volgens betaalafspraak' }}</small></span>
                  <span class="bank-alloc-document__amount"><b>{{ p.abs(document.openBankEur) | eur }}</b><small>{{ document.openBankEur ? 'nog open' : 'al betaald' }}</small><small>totaal {{ document.totalEur | eur }}</small></span>
                </button>
              } @empty { @if (!p.localLoading()) { <p class="fin-hint">Geen factuur of uitgave gevonden. Pas je zoekterm aan, of kies <button class="fin-inline-btn" type="button" (click)="p.setAllocationStep('new')">Nog te registreren</button>.</p> } }
            </div>
            @if (p.visibleLocalDocuments().length < p.localMatches().length) { <button class="btn btn--sm" type="button" (click)="p.localShown.set(p.localShown() + 60)">Meer tonen · nog {{ p.localMatches().length - p.visibleLocalDocuments().length }}</button> }
            }
            @if (p.localDocument(); as document) {
              @if (p.localPreview(); as preview) {
                <section class="bank-alloc-preview" aria-label="Gekozen document controleren">
                  <div class="bank-alloc-preview__title"><div><small>{{ document.label }}</small><h3 #selectionHeading tabindex="-1">{{ document.title }}</h3><p>{{ document.party }} · {{ document.reference }}</p></div><button class="fin-inline-btn" type="button" [disabled]="p.busy()" (click)="p.localSelectedKey.set(null)">Andere kiezen</button></div>
                  @if (document.kind === 'purchase') {
                    @if (p.localPurchaseInvoices(); as invoices) {
                      <!-- The container's invoices (and invoice files without data), the terms they cover and the term's payments on the bank. -->
                      <div class="bank-alloc-purchase-docs bank-alloc-purchase-docs--list">
                        @for (invoice of invoices; track invoice.key) {
                          <span class="bank-alloc-purchase-docs__line">{{ invoice.text }}@if (invoice.documentId != null) { <button class="fin-inline-btn" type="button" [disabled]="p.busy()" (click)="p.openPurchaseFile(document.id, invoice.documentId, invoice.name)">Bestand ↗</button> }</span>
                        } @empty { <span>Nog geen factuur bij deze container</span> }
                        @if (p.localPurchaseTermsLine(); as terms) { <small>{{ terms }}</small> }
                        @for (payment of p.localPurchasePayments(); track payment.id) {
                          <small>{{ paymentLine(payment) }}</small>
                          @for (part of payment.parts; track part.id) { <small class="bank-alloc-purchase-docs__part">{{ partLine(part) }}</small> }
                        }
                      </div>
                    } @else {
                      @if (p.localPurchaseFilesLoading()) { <p class="fin-hint" role="status">Inkoopfacturen laden…</p> }
                      @if (p.localPurchaseFilesError()) { <p class="fin-hint fin-hint--warn">{{ p.localPurchaseFilesError() }} <button class="fin-inline-btn" type="button" (click)="p.loadLocalPurchaseFiles(document.id)">Opnieuw laden</button></p> }
                      @if (p.localPurchaseFiles().length) { <div class="bank-alloc-purchase-docs"><span>Facturen bij deze container</span>@for (file of p.localPurchaseFiles(); track file.id) { <button class="fin-inline-btn" type="button" [disabled]="p.busy()" (click)="p.openPurchaseInvoice(file)">{{ file.label || file.originalFilename }} ↗</button> }</div> }
                    }
                    @if (p.localLargerPayment(); as larger) { <p class="fin-hint fin-hint--warn">Er staat al een betaling van {{ larger.amountEur | eur }}; koppel een deel via Bestaande betaling.</p> }
                    <p class="fin-hint">Dit bedrag komt uit de bestelafspraak. Controleer de factuur en vul de werkelijke betaling in. De wisselkoers wordt niet uit het bestelbudget afgeleid.</p>
                    <div class="bank-alloc-purchase-fields">
                      <label><span>Betaalde valuta</span><select class="select" [disabled]="p.busy()" [value]="p.purchaseCurrency()" (change)="p.changePurchaseCurrency($any($event.target).value)"><option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option></select></label>
                      <label><span>Betaald bedrag in {{ p.purchaseCurrency() }}</span><input class="input" inputmode="decimal" [disabled]="p.busy()" [value]="p.purchaseAmountInput()" (input)="p.purchaseAmountInput.set($any($event.target).value)" /></label>
                      @if (p.localInspectionOffered()) {
                        <label class="bank-alloc-purchase-fields__wide"><span>Waarvan inspectie via leverancier <span class="opt"></span></span><input class="input" inputmode="decimal" [disabled]="p.busy()" [value]="p.purchaseInspectionInput()" (input)="p.purchaseInspectionInput.set($any($event.target).value)" /></label>
                      }
                    </div>
                    @if (p.localInspectionOffered() && p.purchaseInspectionInput()) { <p class="fin-hint">Wordt een eigen betaling bij Inspectie & andere kosten op dezelfde banktransactie; de banktransactie is het betaalbewijs van beide.</p> }
                    @if (p.purchaseCurrency() !== 'EUR') { <p class="fin-hint">Werkelijk afgeschreven: {{ p.abs(row.amountEur) | eur }}. Vul het bijbehorende bedrag op de betaling in {{ p.purchaseCurrency() }} in.</p> }
                  }
                  <dl class="bank-alloc-amounts">
                    @if (document.kind === 'cost') { <div><dt>Factuurtotaal</dt><dd>{{ document.totalEur | eur }}</dd></div><div><dt>Nog open op de kost</dt><dd>{{ preview.openEur | eur }}</dd></div> }
                    <div><dt>Banktransactie</dt><dd>{{ row.amountEur | eur }}</dd></div>
                    <div><dt>{{ preview.paymentKind === 'new' ? 'Toe te passen betaling' : 'Geregistreerde betaling' }}</dt><dd>@if (preview.paymentEur !== null) { {{ preview.paymentEur | eur }} } @else { — }</dd></div>
                    @if (preview.paymentKind === 'new') { <div><dt>{{ document.estimated ? 'Daarna nog verwacht' : 'Daarna nog open' }}</dt><dd>{{ preview.remainingEur | eur }}</dd></div> }
                    <div><dt>Verschil bank − betaling</dt><dd>@if (preview.differenceEur !== null) { {{ preview.differenceEur | eur }} } @else { — }</dd></div>
                    @if (preview.paymentLinked !== null) { <div><dt>Bestaande bankkoppeling</dt><dd>{{ preview.paymentLinked ? 'Al gekoppeld' : 'Nog geen' }}</dd></div> }
                  </dl>
                  @if (preview.explanation) { <p class="fin-hint" [class.fin-hint--warn]="!p.allocationReady()">{{ preview.explanation }}</p> }
                  @if (preview.paymentKind === 'choose-existing' && p.localRecordedCostPayments().length) {
                    <h4>Geregistreerde betalingen op deze kost</h4>
                    <ul class="bank-alloc-recorded-payments">@for (payment of p.localRecordedCostPayments(); track $index) {
                      @let difference = p.localRecordedPaymentDifference(payment);
                      <li><strong>{{ -payment.amountEur | eur }}</strong><span>{{ payment.paidOn }} · {{ payment.bankStatementLineId != null ? 'Al gekoppeld aan een banktransactie' : 'Nog zonder bankkoppeling' }}</span><small>Verschil met bank: @if (difference !== null) { {{ difference | eur }} } @else { — }</small></li>
                    }</ul>
                  }
                  @if (preview.differenceEur && !preview.explanation) { <p class="fin-hint">Een afrondingsverschil tot € 0,02 is toegestaan. Oorspronkelijke bedragen blijven behouden.</p> }
                  @if (!preview.eligible && document.kind !== 'purchase' && !preview.explanation) { <p class="fin-hint fin-hint--warn">{{ document.openBankEur ? 'De bankbetaling is groter dan het openstaande bedrag. Je kunt maximaal € 0,02 meer afpunten.' : 'Dit document is al betaald. Kies een passende bestaande betaling om die te hergebruiken.' }}</p> }
                  @if (!preview.eligible && document.kind === 'purchase') { <p class="fin-hint fin-hint--warn">Vul een geldig betaalbedrag in. Het EUR-bedrag mag maximaal € 0,02 afwijken van de banktransactie.</p> }
                  @if (p.localExistingPayments().length || p.localExistingSales().length) {
                    <h4>Deze betaling staat mogelijk al in ENROSED</h4>
                    <div class="fin-alloc__cards">
                      @for (payment of p.localExistingPayments(); track payment.key) { <button class="fin-match" type="button" [disabled]="p.busy()" (click)="p.reuseLocalPayment(payment)"><b>Bestaande betaling · {{ payment.amountEur | eur }}</b><small>{{ payment.paidOn }} · {{ payment.detail }}</small><span>Deze betaling hergebruiken ›</span></button> }
                      @for (payment of p.localExistingSales(); track payment.existingPaymentId) { <button class="fin-match" type="button" [disabled]="p.busy()" (click)="p.reuseLocalSales(payment)"><b>Bestaande betaling · {{ payment.number }}</b><small>{{ p.matchStamp(payment) }} · {{ payment.reference }}</small><span>Deze betaling hergebruiken ›</span></button> }
                    </div>
                  }
                  @if (preview.eligible && preview.overpaidEur > 0 && document.kind === 'sales') { <p class="fin-hint fin-hint--warn">{{ preview.overpaidEur | eur }} meer dan wat openstaat. Dit wordt als te veel ontvangen geregistreerd.</p> }
                  @if (preview.eligible && (p.localPossibleDuplicate() || (preview.overpaidEur > 0 && document.kind === 'sales'))) {
                    <label class="fin-check"><input type="checkbox" [disabled]="p.busy()" [checked]="p.localNewConfirmed()" (change)="p.localNewConfirmed.set($any($event.target).checked)" /><span>{{ p.localPossibleDuplicate() ? 'Ik heb de bestaande betalingen gecontroleerd; dit is een nieuwe betaling.' : 'Ik wil dit hogere ontvangen bedrag op de factuur registreren.' }}</span></label>
                    @if (p.localPossibleDuplicate() && !p.localExistingPayments().length && !p.localExistingSales().length) { <p class="fin-hint">Een passende betaling heeft mogelijk nog een eerdere handmatige bankkoppeling. Open de oorspronkelijke banktransactie en maak daar de koppeling los als je deze betaling wilt hergebruiken.</p> }
                  }
                </section>
              }
            }
          } @else if (p.allocationStep() === 'new') {
            @if (row.amountEur < 0) {
              <div class="bank-alloc-create"><div><b>Factuur of bon zelf registreren</b><p>Boek een nieuwe uitgave met deze bankbetaling. Je kunt de factuur of een foto meteen toevoegen.</p></div><button class="btn" type="button" [disabled]="p.busy()" (click)="p.newCostFromBank()">Uitgave registreren</button></div>
            }
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
          } @else {
            <p class="fin-hint">Deze betalingen zijn al geboekt. Hergebruik ze om de banktransactie te koppelen zonder een extra betaling aan te maken. Meerdere containerdelen kunnen samen één bankbetaling vormen.</p>
            <label class="bank-alloc-search"><span>Zoek bestaande betalingen</span><input class="input" type="search" placeholder="Factuur, tegenpartij, container, datum of bedrag" [value]="p.outgoingSearch()" (input)="p.outgoingSearch.set($any($event.target).value)" /></label>
            <div class="bank-alloc-list" role="group" aria-label="Bestaande betalingen">
              @for (payment of p.visibleExistingSales(); track payment.existingPaymentId) {
                <button class="bank-alloc-document" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.allocationMode() === 'sales' && p.isChosen(payment)" (click)="p.reuseLocalSales(payment)"><span class="bank-alloc-document__identity"><small>{{ row.amountEur < 0 ? 'Terugbetaling klant' : 'Ontvangst klant' }}</small><b>{{ payment.number }}</b><span>{{ payment.reference }}</span><small>{{ p.matchStamp(payment) }}</small></span><span class="bank-alloc-document__amount"><b>{{ p.existingSalesAmount(payment) | eur }}</b><small>hergebruiken</small></span></button>
              }
              @for (payment of p.visibleOutgoing(); track payment.key) {
                <button class="bank-alloc-document" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.allocationMode() === 'expense' && p.outgoingSelected().includes(payment.key)" (click)="p.toggleExistingPayment(payment)"><span class="bank-alloc-document__identity"><small>{{ payment.kind === 'cost' ? (payment.amountEur < 0 ? 'Terugbetaling leverancier' : 'Kostenbetaling') : 'Inkoopbetaling' }}</small><b>{{ payment.title }}</b><span>{{ payment.detail }}</span><small>{{ payment.paidOn }}</small></span><span class="bank-alloc-document__amount"><b>{{ -payment.amountEur | eur }}</b><small>{{ p.outgoingSelected().includes(payment.key) ? 'geselecteerd' : 'hergebruiken' }}</small></span></button>
              }
              @if (!p.visibleExistingSales().length && !p.visibleOutgoing().length) { <p class="fin-hint">Geen vrije bestaande betaling gevonden. Kies een factuur of uitgave om daarop een betaling vast te leggen.</p> }
            </div>
            @if (p.allocationMode() === 'expense' && p.outgoingPart(); as part) {
              <!-- One container payment: it follows the transaction. A larger transaction first asks what the surplus is. -->
              <section class="bank-alloc-preview"><h3>{{ part.carve ? 'Deel van een bestaande betaling' : part.withIds.length ? 'Goederen + inspectie op deze transactie' : 'Bestaande betaling' }}</h3>
                @if (part.foreign; as foreign) {
                  <!-- USD/CNY: the transaction is the whole payment (its euro and day follow) unless the part it paid is named in the payment's currency. -->
                  <label class="bank-alloc-search bank-alloc-foreign"><span>Alleen een deel? Deel in {{ foreign.currency }} (optioneel)</span>
                    <input class="input num" type="text" inputmode="decimal" autocomplete="off" [disabled]="p.busy()" [value]="p.outgoingForeignInput()"
                           (input)="p.outgoingForeignInput.set($any($event.target).value)" /></label>
                  @if (p.outgoingForeignWarning(); as warning) { <p class="fin-hint fin-hint--warn">{{ warning }}</p> }
                  @else if (!part.carve && !p.outgoingForeignInput().trim()) { <p class="fin-hint">Leeg: de hele betaling neemt het eurobedrag van de transactie over; de koers volgt.</p> }
                }
                @if (part.carve) {
                  <p class="fin-hint">{{ p.outgoingCarveText() }}</p>
                }
                @if (part.higher) {
                  <p class="fin-hint fin-hint--warn"><b>{{ p.outgoingSurplusText() }}</b></p>
                  <div class="bank-alloc-choices" role="group" [attr.aria-label]="p.outgoingSurplusText()">
                    <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.outgoingSurplus() === 'ADJUST'" (click)="p.chooseOutgoingSurplus('ADJUST')">
                      <b>Bedrag aanpassen naar {{ p.abs(row.amountEur) | eur }}</b><span>De betaling volgt de transactie</span></button>
                    @if (p.outgoingInspectionOffered()) {
                      <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.outgoingSurplus() === 'INSPECTION'" (click)="p.chooseOutgoingSurplus('INSPECTION')">
                        <b>Rest als inspectie via leverancier</b><span>{{ p.abs(row.amountEur) - part.row.amountEur | eur }} als eigen betaling op dezelfde transactie</span></button>
                    }
                    <button class="fin-match" type="button" [disabled]="p.busy()" (click)="p.toggleExistingPayment(part.row)"><b>Annuleren</b><span>Deze betaling niet koppelen</span></button>
                  </div>
                }
                @if (p.outgoingChange().length) {
                  <div class="bank-alloc-change" role="table" aria-label="Wat verandert">
                    <div class="bank-alloc-change__row bank-alloc-change__row--head" role="row"><span role="columnheader">Wat verandert</span><span role="columnheader">Betaling nu</span><span role="columnheader">Na koppelen</span></div>
                    @for (change of p.outgoingChange(); track change.label) {
                      <div class="bank-alloc-change__row" role="row" [class.is-changed]="change.changed"><span role="rowheader">{{ change.label }}</span><span role="cell">{{ change.now }}</span><span role="cell">{{ change.after }}</span></div>
                    }
                  </div>
                }
              </section>
            } @else if (p.allocationMode() === 'expense' && p.chosenOutgoing().length) {
              <section class="bank-alloc-preview"><h3>{{ p.chosenOutgoing().length }} bestaande {{ p.chosenOutgoing().length === 1 ? 'betaling' : 'betalingen' }}</h3><dl class="bank-alloc-amounts"><div><dt>Banktransactie</dt><dd>{{ row.amountEur | eur }}</dd></div><div><dt>Bestaande betalingen</dt><dd>{{ -p.outgoingTotal() | eur }}</dd></div><div><dt>Verschil</dt><dd>{{ p.outgoingDifference() | eur }}</dd></div></dl><p class="fin-hint">Maximaal € 0,02 verschil. De betalingen en oorspronkelijke bedragen blijven behouden.</p></section>
            } @else { @if (p.choice(); as payment) {
              <section class="bank-alloc-preview"><h3>{{ payment.number }} · bestaande betaling</h3><dl class="bank-alloc-amounts"><div><dt>Banktransactie</dt><dd>{{ row.amountEur | eur }}</dd></div><div><dt>Bestaande betaling</dt><dd>{{ p.existingSalesAmount(payment) | eur }}</dd></div><div><dt>Verschil</dt><dd>{{ p.matchDifference(payment) | eur }}</dd></div></dl><p class="fin-hint">De bestaande ontvangst of terugbetaling wordt hergebruikt.</p></section>
            } }
          }
          @if (p.error()) { <p class="fin-error" role="alert">{{ p.error() }}</p> }
        </div>
        <div foot class="bank-alloc-footer">
          @if (p.allocationBlockedReason(); as reason) { <p id="bank-allocation-reason" class="bank-alloc-footer__reason" role="status">{{ reason }}</p> }
          <div class="bank-alloc-footer__actions"><button class="btn" type="button" [disabled]="p.busy()" (click)="p.closeAllocation()">Annuleren</button><span class="spacer"></span>
          <button class="btn btn--primary" type="button" [disabled]="!p.allocationReady()" [attr.aria-describedby]="p.allocationBlockedReason() ? 'bank-allocation-reason' : null" (click)="p.submitAllocation()">{{ p.allocationActionLabel() }}</button></div>
        </div>
      </app-sheet>
    }
  `,
})
export class BankAllocationSheet {
  readonly panel = input.required<BankMovementPanel>();
  private readonly injector = inject(Injector);
  private readonly selectionHeading = viewChild<ElementRef<HTMLElement>>('selectionHeading');
  /** '03/09 · Aanbetaling 30% · € 10.000,00 · op de bank · KBC'. */
  paymentLine(payment: PaymentNode): string {
    return [payment.paidOn.slice(8, 10) + '/' + payment.paidOn.slice(5, 7), payment.label,
      payment.amountEur.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' }), payment.bank,
      payment.firstPaidOn ? 'eerste ' + payment.firstPaidOn.slice(8, 10) + '/' + payment.firstPaidOn.slice(5, 7) : ''].filter(Boolean).join(' · ');
  }
  partLine(part: PaymentNode['parts'][number]): string {
    return `${part.paidOn.slice(8, 10)}/${part.paidOn.slice(5, 7)} · ${part.amountEur.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })} · ${part.bank}`;
  }
  selectDocument(document: BankAllocationTarget): void {
    this.panel().chooseLocalDocument(document);
    afterNextRender(() => this.selectionHeading()?.nativeElement.focus(), { injector: this.injector });
  }
}
