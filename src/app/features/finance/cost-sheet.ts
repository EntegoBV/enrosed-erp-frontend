import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FinanceApi, type CostOdooSource } from '../../core/api/finance-api';
import { messageOf } from '../../core/api/errors';
import { CompanyCost, VatRegime } from '../../core/api/models';
import type { BankStatementLine } from '../../core/api/banking-api';
import { BankTransactionPicker } from '../../shared/bank-transaction-picker';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { DateField } from '../../shared/date-field';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { SALES_CHANNELS } from '../sales/sales-channels';
import { exclFromIncl, fitAmountToRegime } from './cost-amount';
import type { AmountKind } from './cost-amount';
import { categoryChoices } from './cost-categories';
import { FAIR_REGIME_QUESTION, isFairCategory } from './cost-countries';
import { paymentTotals } from './cost-payments';
import { CostRegimeFields, NO_VAT_REGIMES, depreciationYearsFor, partyRegimeOf, regimePrefill, regimeProblem } from './cost-regime-fields';
import type { RegimeFields } from './cost-regime-fields';
import { REVERSE_CHARGE, cashTotalOf, suggestInvestment, vatOf } from './finance-metrics';
import { blankCost } from './finance-sections';
import { FinanceState, PartyPrefill, formatEuro } from './finance-state';
import { PartyField } from './party-field';
import { rankParties } from './party-suggestions';
import type { PartyCandidate } from './party-suggestions';
import { VatChoice } from './vat-choice';
import { duplicateCandidates } from './cost-suggestions';

type AmountMode = 'excl' | 'incl';

/** The regimes with an invoice behind them: the date field reads 'Factuurdatum'. */
const INVOICE_REGIMES = new Set(['BE', 'EU_GOODS', 'EU_SERVICES', 'NON_EU_SERVICES', 'FOREIGN_VAT', 'EXEMPT']);
const storedIncl = (cost: CompanyCost): number => (Number.isFinite(cost.amountInclEur as number) && (cost.amountInclEur as number) !== 0 ? cost.amountInclEur as number : 0);

/** The cost form: book one, correct one, settle one. The amount comes first. */
@Component({
  selector: 'app-cost-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Sheet, DateField, EurPipe, DateNlPipe, Icon, VatChoice, Segmented, PartyField, CostRegimeFields, BankTransactionPicker],
  template: `
    <app-sheet variant="ios" [title]="draft().id ? 'Kost bewerken' : 'Kost boeken'" [wide]="true" (closed)="close()">
      <div body class="fin-sheet fin-form">
        @if (bankCreatePending()) {
          @if (state.costBankCreateConflict(); as conflict) {
            <p class="fin-error fin-field--wide" role="alert">{{ conflict }} <button class="fin-inline-btn" type="button" [disabled]="state.saving()" (click)="state.reviewCostBankConflict()">Banktransactie vernieuwen en bekijken</button></p>
          } @else { <p class="fin-hint fin-field--wide" role="status">De vorige registratie is nog niet bevestigd. Bevestig hieronder opnieuw met dezelfde gegevens; er wordt geen tweede kost aangemaakt.</p> }
        }
        <fieldset [disabled]="bankCreatePending()" style="display:contents" aria-label="Kostgegevens">
        @if (bankOrigin(); as bank) {
          <p class="fin-hint fin-field--wide">Nieuwe kost bij {{ bank.amountEur | eur }} op {{ state.accountLabel(bank.account) }}. Datum en mededeling zijn overgenomen van de bank: controleer de factuurdatum en het factuurnummer. Kies de btw-regeling en het percentage volgens je factuur of bon.</p>
        }
        @if (pendingNote(); as note) { <p class="fin-hint fin-field--wide">{{ note }}</p> }
        @if (draft().recurringCostId) {
          <p class="fin-hint fin-field--wide">Automatisch geboekt als vaste kost. Deze boeking mag je hier corrigeren; pas de vaste kost zelf aan om de volgende periodes te veranderen.</p>
        }
        @if (sourceLoading()) { <p class="fin-hint fin-field--wide" role="status">Bron van deze factuur controleren…</p> }
        @if (sourceError()) { <p class="fin-error fin-field--wide" role="alert">{{ sourceError() }} <button class="fin-inline-btn" type="button" (click)="loadSource()">Opnieuw proberen</button></p> }
        @if (source(); as original) { <p class="fin-hint fin-field--wide">Overgenomen uit Odoo · {{ original.snapshot.document.moveType === 'in_refund' ? 'Creditnota leverancier' : 'Leveranciersfactuur' }}. De oorspronkelijke factuurgegevens en bedragen blijven behouden. Btw op document: {{ original.snapshot.vatEur | eur }}; totaal: {{ original.snapshot.totalEur | eur }}.</p> }
        @if (!sourceLocked()) { <div class="fin-amount-mode fin-field--wide">
          <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Bedrag" [options]="modes()" [value]="mode()" (changed)="setMode($any($event))" />
        </div> }
        <label class="fin-amount fin-field--wide">
          <span class="fin-sr">{{ amountLabel() }}</span><i aria-hidden="true">€</i>
          <input type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" [attr.data-initial-focus]="draft().id ? null : ''"
                 [readOnly]="sourceLocked()" [ngModel]="amount() || null" (ngModelChange)="setAmount(+($event || 0))" />
        </label>
        @if (amountNote(); as note) { <p class="fin-hint fin-field--wide">{{ note }}</p> }
        @if (investmentSuggested()) {
          <div class="fin-amount-mode fin-field--wide"><button class="fin-choice__chip" type="button" (click)="bookAsInvestment()">Boven € 250 excl.: als investering boeken?</button></div>
        }
        <div class="fin-group" [class.ios-group]="!state.desk()">
          @if (vatShown() && (!sourceLocked() || reverseCharge())) {
            <div class="fin-field fin-field--wide fin-field--stack"><span>Btw</span>
              @if (bankOrigin()) {
                <input class="input" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="Kies het percentage" aria-label="Btw-percentage volgens factuur"
                  [ngModel]="draft().vatPct" (ngModelChange)="setVat($event === null || $event === '' ? null : +$event)" />
              } @else { <app-vat-choice [value]="draft().vatPct" (changed)="setVat($event)" /> }
              <span class="fin-hint">
                @if (bankOrigin() && draft().vatPct == null) { Het bankbedrag bevat geen btw-informatie. Neem het percentage over van je factuur. }
                @else if (reverseCharge()) { btw verlegd {{ draft().vatPct ?? 0 }} % · <b>{{ vatOf(draft()) | eur }}</b> · niet aan de leverancier, wel in de aangifte }
                @else if (foreignVat()) { Buitenlandse btw <b>{{ vatOf(draft()) | eur }}</b> · niet aftrekbaar · telt als kost }
                @else if (mode() === 'incl') { Excl. btw: <b>{{ draft().amountExclEur | eur }}</b> · btw <b>{{ vatOf(draft()) | eur }}</b> }
                @else { Incl. btw: <b>{{ cashTotalOf(draft()) | eur }}</b> }
              </span></div>
          }
          <details app-cost-regime-fields class="fin-disclosure fin-field--wide" [(open)]="regimeOpen" [value]="draft()" [category]="draft().category" [amountExclEur]="draft().amountExclEur"
                   [countries]="state.countryChoices()" [date]="draft().date" [note]="derivedHint()" (changed)="applyRegime($event)"></details>
        </div>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field fin-field--wide"><span class="req">Omschrijving</span>
            <input class="input" placeholder="bijv. Standhuur TICA oktober" [ngModel]="draft().description" (ngModelChange)="patch({ description: $event })" /></label>
          <div class="fin-field"><span class="req">{{ dateLabel() }}</span>
            @if (sourceLocked()) { <span>{{ draft().date | dateNl }}</span> } @else { <app-date-field fieldId="k-date" [value]="draft().date" (valueChange)="patch({ date: $event })" /> }</div>
          @if (state.cashRound()) {
            <div class="fin-field"><span>Vervalt op</span><app-date-field fieldId="k-due" [value]="draft().dueDate ?? ''" (valueChange)="patch({ dueDate: $event || null })" />
              <small class="fin-hint">Leeg = de kostdatum telt in de kaslijn</small></div>
          }
          <label class="fin-field"><span class="req">Categorie</span>
            <select class="select" [ngModel]="categoryChoice()" (ngModelChange)="pickCategory($event)">
              @for (category of categories(); track category.code) { <option [value]="category.code">{{ category.label }}</option> }
              <option value="__other__">Eigen categorie…</option>
            </select>
            @if (customCategory()) { <input class="input" aria-label="Eigen categorie" placeholder="bijv. OPLEIDING" [ngModel]="draft().category" (ngModelChange)="patch({ category: ($event || '').toUpperCase() })" /> }</label>
          @if (fairCategory()) {
            <div class="fin-field fin-field--wide fin-field--stack"><span>Beurs</span>
              <div class="fin-choice" role="group" aria-label="Beurs">
                @for (fair of fairChips(); track fair.code) {
                  <button class="fin-choice__chip" type="button" [attr.aria-pressed]="!otherFair() && channelCode() === fair.code" (click)="pickFair(fair.code)">{{ fair.label }}</button>
                }
                <button class="fin-choice__chip" type="button" [attr.aria-pressed]="otherFair()" (click)="otherFair.set(true)">Andere…</button>
              </div>
              @if (otherFair()) {
                <div class="fin-fair-add">
                  <input class="input" maxlength="120" autocomplete="off" placeholder="Naam van de beurs" aria-label="Nieuwe beurs"
                         [ngModel]="fairLabel()" (ngModelChange)="fairLabel.set($event)" (keydown.enter)="addFair()" />
                  <button [class]="state.desk() ? 'wk-btn' : 'ios-capsule ios-capsule--tinted'" type="button" [disabled]="!fairLabel().trim() || state.saving()" (click)="addFair()">Toevoegen</button>
                </div>
                <span class="fin-hint">Komt in de lijst Beurzen en blijft beschikbaar voor volgende kosten.</span>
              }
            </div>
          }
          <label class="fin-field"><span>Hoort bij verkoopkanaal</span>
            <select class="select" [ngModel]="draft().salesChannel ?? ''" (ngModelChange)="patch({ salesChannel: $event || null })">
              <option value="">Algemene kost</option>
              @for (channel of channels(); track channel.code) { <option [value]="channel.code">{{ channel.label }}</option> }
              @if (fairChoices().length) {
                <optgroup label="Beurzen">@for (fair of fairChoices(); track fair.code) { <option [value]="fair.code">{{ fair.label }}</option> }</optgroup>
              }
            </select></label>
          <div class="fin-field fin-field--combo"><span><label for="k-party">Aan wie</label></span>
            @if (sourceLocked()) { <span>{{ draft().party }}</span> } @else { <app-party-field fieldId="k-party" placeholder="bijv. TICA Trends & Trade" [value]="draft().party ?? ''" [candidates]="state.partySuggestions()" [maxlength]="200"
                             (valueChange)="typeParty($event)" (picked)="pickParty($event)" (committed)="commitParty()" /> }
            @if (newParty()) { <span class="fin-hint">Nieuw: komt na het boeken in de lijst Aan wie.</span> }</div>
          <label class="fin-field"><span>Factuurnummer</span>
            <input class="input" [readOnly]="sourceLocked()" [ngModel]="draft().reference" (ngModelChange)="patch({ reference: $event })" /></label>
        </div>
        @if (filledFrom(); as filled) {
          <p class="fin-hint fin-field--wide">Categorie, btw en {{ filled.regime ? 'btw-regeling' : 'kanaal' }} overgenomen {{ filled.party.stored ? 'uit de lijst Aan wie voor' : 'van je vorige kost aan' }} {{ filled.party.name }}.</p>
        }
        @if (forwarderHint()) {
          <p class="fin-hint fin-field--wide">Een expediteursfactuur boek je per soort lijn: zeevracht (vrijgesteld), diensten met 21 % (België), betaalde invoer-btw, invoerrechten (niet in de aangifte, horen bij de goederen). Gebruik Dupliceren voor de volgende lijn.</p>
        }
        @if (duplicates().length) {
          <p class="fin-hint fin-hint--warn fin-field--wide" role="status"><b>Lijkt al geboekt:</b>
            @for (other of duplicates().slice(0, 2); track other.id; let last = $last) { {{ other.description }} van {{ other.date | dateNl }}, {{ other.amountExclEur | eur }} excl.{{ other.reference ? ' (' + other.reference + ')' : '' }}{{ last ? '.' : ';' }} }</p>
        }
        <div class="fin-group" [class.ios-group]="!state.desk()">
          @if (payments().length) {
            <div class="fin-field fin-field--switch fin-field--wide"><span>Betalingen<small>{{ paidSummary() }}</small><small>Betalingen beheer je in het detail van de kost.</small></span></div>
            @if (singleMovable()) {
              <div class="fin-field"><span>Betaald op</span><app-date-field fieldId="k-paid" [value]="draft().paidOn ?? payments()[0].paidOn" (valueChange)="patch({ paidOn: $event || null })" /></div>
            }
          } @else {
            <label class="fin-field fin-field--switch fin-field--wide"><span>Betaald<small>{{ draft().paidOn ? 'Op ' + (draft().paidOn ?? '') : 'Nog open: staat bij Te betalen' }}</small></span>
              <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [checked]="!!draft().paidOn" (change)="togglePaid($any($event.target).checked)" /></label>
            @if (draft().paidOn) {
              <div class="fin-field"><span>Betaald op</span>@if (selectedBank() && becomingPaid()) { <span>{{ draft().paidOn }}</span> } @else { <app-date-field fieldId="k-paid" [value]="draft().paidOn ?? ''" (valueChange)="patch({ paidOn: $event || null })" /> }</div>
            }
          }
          @if (becomingPaid()) {
            <div class="fin-field fin-field--wide"><app-bank-transaction-picker [direction]="cashTotalOf(draft()) < 0 ? 'INCOMING' : 'OUTGOING'" [amount]="abs(cashTotalOf(draft()))" [selected]="selectedBank()" [disabled]="state.saving()" (selectedChange)="chooseBank($event)" /></div>
            @if (selectedBank()) { <p class="fin-hint fin-field--wide">Datum en rekening komen van de bank. Het totaal inclusief btw mag maximaal € 0,02 afwijken. Het factuurbedrag blijft behouden.</p> }
            @else {
            <label class="fin-field fin-field--switch fin-field--wide"><span>Ook als bankbeweging noteren<small>Een uitgaande beweging met een verwijzing naar deze kost</small></span>
              <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [checked]="toBank()" (change)="toBank.set($any($event.target).checked)" /></label>
            @if (toBank()) {
              <div class="fin-field fin-field--wide fin-field--stack"><span>Rekening</span>
                @if (state.manualAccountOptions().length) {
                  <div class="fin-choice" role="group" aria-label="Rekening">
                    @for (option of state.manualAccountOptions(); track option.key) {
                      <button class="fin-choice__chip" type="button" [attr.aria-pressed]="account() === option.key" (click)="account.set(option.key)">{{ option.label }}</button>
                    }
                  </div>
                } @else {
                  <span class="fin-hint">{{ state.loadedAt() ? 'Nog geen rekening: vul eerst een saldo in bij Bank.' : 'Rekeningen laden…' }}</span>
                }
                @if (future()) { <span class="fin-hint fin-hint--warn">Een bankbeweging kan niet in de toekomst liggen.</span> }
                @else if (accountHint(); as hint) { <span class="fin-hint">{{ hint }}</span> }
              </div>
            }
            }
          }
        </div>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field fin-field--wide fin-field--stack"><span>Notities</span>
            <textarea class="textarea" rows="2" [ngModel]="draft().notes" (ngModelChange)="patch({ notes: $event })"></textarea></label>
        </div>

        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--wide fin-field--stack fin-docs" (dragover)="dragOver($event)" (dragleave)="dropping.set(false)" (drop)="drop($event)">
            <span class="fin-docs__head">Factuur of bon
              @if (draft().id) { <a class="wk-link" routerLink="/files" [queryParams]="{ view: 'cost', doel: draft().id }" (click)="close()">In Documenten &amp; media ›</a> }</span>
            @for (asset of attached(); track asset.id) {
              <div class="fin-doc">
                <button class="fin-doc__open" type="button" (click)="state.openAttachment(asset)" [title]="asset.originalFilename">
                  <app-icon [name]="asset.kind === 'IMAGE' ? 'image' : 'document'" [size]="18" /><span><b>{{ asset.name }}</b><small>{{ size(asset.sizeBytes) }}</small></span>
                </button>
                @if (asset.archived) { <span class="wk-pill wk-pill--outline">gearchiveerd</span> }
                <a class="fin-doc__icon" routerLink="/files" [queryParams]="{ view: 'cost', doel: draft().id, bestand: asset.id }" aria-label="Toon in Documenten & media" (click)="close()"><app-icon name="link" [size]="15" /></a>
                <button class="fin-doc__icon" type="button" aria-label="Document losmaken" [disabled]="state.detaching().has(asset.id)" (click)="state.detach(asset, draft().id!)"><app-icon name="close" [size]="15" /></button>
              </div>
            }
            @for (file of pending(); track file.name + file.size) {
              <div class="fin-doc fin-doc--pending">
                <span class="fin-doc__open"><app-icon name="upload" [size]="18" /><span><b>{{ file.name }}</b><small>gaat mee bij het boeken</small></span></span>
                <button class="fin-doc__icon" type="button" aria-label="Niet opladen" (click)="unqueue(file)"><app-icon name="close" [size]="15" /></button>
              </div>
            }
            @if (state.desk()) {
              <div class="fin-dropzone" [class.is-over]="dropping()">
                <span>{{ state.uploading() ? 'Opladen…' : 'Sleep een factuur of bon hierheen' }}</span>
                <label class="wk-btn wk-btn--sm"><app-icon name="plus" [size]="14" />Document<input class="fin-hidden" type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt" (change)="pick($event)" /></label>
              </div>
            } @else {
              <div class="fin-doc-buttons">
                <label class="ios-capsule ios-capsule--tinted"><app-icon name="camera" [size]="18" />Foto maken<input class="fin-hidden" type="file" accept="image/*" capture="environment" (change)="pick($event)" /></label>
                <label class="ios-capsule ios-capsule--tinted"><app-icon name="document" [size]="18" />Bestand kiezen<input class="fin-hidden" type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt" (change)="pick($event)" /></label>
              </div>
            }
            <span class="fin-hint">In de bibliotheek onder Kosten / {{ draft().date.slice(0, 4) }}</span>
          </div>
        </div>
        @if (showError()) { <p class="fin-error fin-field--wide" role="alert">Vul een bedrag groter dan 0 in.</p> }
        @if (draft().id && !state.desk()) {
          <div class="ios-group fin-field--wide"><button class="ios-cell ios-cell--danger" type="button" [disabled]="state.saving()" (click)="state.deleteCost(draft())">Verwijderen</button></div>
        }
        </fieldset>
      </div>
      <div foot style="display:contents">
        @if (draft().id && state.desk()) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteCost(draft())">Verwijderen</button> }
        @if (regimeProblem(); as problem) { <span class="fin-foot-note">{{ problem }}</span> }
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !basics() || bankBlocked() || !!regimeProblem() || (bankCreatePending() && !!state.costBankCreateConflict())" (click)="save()">{{ state.saving() ? 'Bezig…' : bankCreatePending() ? 'Registratie bevestigen' : draft().id ? 'Bewaar' : 'Boeken' }}</button>
      </div>
    </app-sheet>
  `,
})
export class CostSheet {
  readonly state = inject(FinanceState);
  private readonly financeApi = inject(FinanceApi);
  readonly source = signal<CostOdooSource | null>(null);
  readonly sourceLoading = signal(false);
  readonly sourceError = signal('');
  readonly sourceLocked = computed(() => !!this.source() || this.sourceLoading() || !!this.sourceError());
  private readonly sourceCostId = computed(() => this.draft().id);
  constructor() {
    effect(() => {
      this.sourceCostId();
      untracked(() => { this.source.set(null); this.sourceError.set(''); this.sourceLoading.set(false); void this.loadSource(); });
    });
  }
  async loadSource(): Promise<void> {
    const id = this.draft().id;
    if (!id || this.sourceLoading()) return;
    this.sourceLoading.set(true); this.sourceError.set('');
    try { const source = await this.financeApi.costOdooSource(id); if (this.draft().id === id) this.source.set(source); }
    catch (failure) { if (this.draft().id === id) this.sourceError.set(messageOf(failure, 'De factuurbron kon niet worden gecontroleerd. Probeer opnieuw voor je bewaart.')); }
    finally { if (this.draft().id === id) this.sourceLoading.set(false); }
  }
  readonly cashTotalOf = cashTotalOf;
  readonly abs = Math.abs;
  readonly vatOf = vatOf;
  readonly draft = linkedSignal<CompanyCost>(() => this.state.costDraft() ?? blankCost(this.state.today()));
  /** Excl. for a new cost; incl. when the cost being edited was entered that way. */
  readonly mode = signal<AmountMode>(storedIncl(this.draft()) ? 'incl' : 'excl');
  /** The figure in the field: what was typed, in the active mode. */
  readonly amount = computed(() => (this.mode() === 'incl' ? storedIncl(this.draft()) : this.draft().amountExclEur));
  /** The total in the field was typed (or stored) incl. btw, not converted by the mode switch: a regime without VAT on the invoice keeps it whole. */
  private typedIncl = storedIncl(this.draft()) > 0;
  /** The excl. amount is such a kept total; a regime with VAT on the invoice takes it back as the total, unless a new figure was typed. */
  private totalKept = false;
  readonly customCategory = signal(false);
  /** Files chosen before the cost exists (the '+' photo, a drop); they go up right after the booking. */
  readonly pending = signal<File[]>(this.state.costFiles());
  readonly dropping = signal(false);
  readonly tried = signal(false);
  readonly attached = computed(() => this.state.attachmentsFor(this.draft().id));
  readonly categories = computed(() => categoryChoices([...this.state.costs().map((cost) => cost.category), ...this.state.recurring().map((row) => row.category)]));
  readonly categoryChoice = computed(() => {
    if (this.customCategory()) return '__other__';
    const code = (this.draft().category ?? '').toUpperCase();
    return this.categories().some((category) => category.code === code) ? code : '__other__';
  });
  readonly pendingNote = computed(() => {
    const files = this.pending();
    if (!files.length || this.draft().id) return '';
    const photos = files.every((file) => file.type.startsWith('image/'));
    if (files.length === 1) return `1 ${photos ? 'foto' : 'bestand'} gaat mee bij het boeken`;
    return `${files.length} ${photos ? "foto's" : 'bestanden'} gaan mee bij het boeken`;
  });

  /* the regime: it decides what the amount block shows */
  readonly regime = computed(() => this.draft().vatRegime);
  readonly reverseCharge = computed(() => REVERSE_CHARGE.has(this.regime() ?? ''));
  readonly foreignVat = computed(() => this.regime() === 'FOREIGN_VAT');
  readonly noVat = computed(() => NO_VAT_REGIMES.has(this.regime() ?? ''));
  readonly importVat = computed(() => this.regime() === 'IMPORT_VAT_PAID');
  /** The rate stays on screen for a Belgian, foreign-VAT or reverse-charge invoice; the others carry none, or only VAT. */
  readonly vatShown = computed(() => !this.noVat() && !this.importVat());
  readonly amountLabel = computed(() => {
    if (this.importVat()) return 'Betaalde invoer-btw';
    if (this.regime() === 'NO_INVOICE') return 'Bedrag op de bon';
    if (this.noVat()) return 'Bedrag';
    return this.mode() === 'incl' ? 'Bedrag incl. btw' : 'Bedrag excl. btw';
  });
  /** 'Excl. btw | Incl. btw' for an invoice with VAT; the other regimes have one figure, named in a single segment. */
  readonly modes = computed<SegmentOption[]>(() => (this.reverseCharge() || this.noVat() || this.importVat()
    ? [{ id: this.mode(), label: this.amountLabel() }]
    : [{ id: 'excl', label: 'Excl. btw' }, { id: 'incl', label: 'Incl. btw' }]));
  readonly dateLabel = computed(() => (this.importVat() ? 'Datum douanedocument' : INVOICE_REGIMES.has(this.regime() ?? '') ? 'Factuurdatum' : 'Datum'));
  readonly amountNote = computed(() => {
    if (this.regime() === 'NO_INVOICE') return 'Staat ons btw-nummer op de bon (max. € 100)? Kies dan België.';
    if (this.importVat()) return 'De douaneaangifte is het bewijsstuk, niet de factuur van de expediteur · zet het aangiftenummer bij Factuurnummer';
    return '';
  });
  readonly investmentSuggested = computed(() => suggestInvestment(this.draft()));
  readonly forwarderHint = computed(() => (this.draft().category ?? '').trim().toUpperCase() === 'TRANSPORT' && (this.regime() === 'EXEMPT' || this.importVat()));
  /** Open at first paint when the form was asked for it or the regime is still derived or unknown; the user takes over from there. */
  readonly regimeOpen = signal(this.state.costSheetFocus() === 'regime' || !this.draft().vatRegimeConfirmed || this.draft().vatRegime == null);
  /** 'Afgeleid van het land · controleer' after a party prefill, or the question a fair invoice raises; gone once a regime is picked or 'Klopt' is tapped. */
  readonly derivedHint = signal('');
  /** The regime was picked or confirmed by hand: no name or category prefills it any more, also when it reads like the blank default again. */
  private regimeTouched = false;
  readonly regimeProblem = computed(() => {
    const draft = this.draft(), problem = regimeProblem(draft);
    if (problem) return problem;
    if (this.bankOrigin() && !draft.vatRegimeConfirmed) return 'Controleer en bevestig de btw-regeling van je factuur of bon';
    if (this.bankOrigin() && this.vatShown() && draft.vatPct == null) return 'Kies het btw-percentage volgens je factuur';
    return null;
  });

  /* channels and fairs: the select lists both, the chips only the fairs */
  readonly channels = computed(() => this.state.channelChoices().filter((channel) => channel.hint !== 'Beurs'));
  readonly fairChoices = computed(() => this.state.channelChoices().filter((channel) => channel.hint === 'Beurs'));
  readonly channelCode = computed(() => (this.draft().salesChannel ?? '').trim().toUpperCase());
  /** A category that stands for a fair: the fair itself is then the cost's channel. */
  readonly fairCategory = computed(() => isFairCategory(this.draft().category));
  /** The active fairs, plus the cost's own channel when it is a fair that was switched off or a code nobody knows. */
  readonly fairChips = computed(() => {
    const current = this.channelCode();
    const chips = this.state.fairs().filter((fair) => fair.active || fair.code.trim().toUpperCase() === current)
      .map((fair) => ({ code: fair.code.trim().toUpperCase(), label: fair.label }));
    if (current && !chips.some((chip) => chip.code === current) && !SALES_CHANNELS.some((channel) => channel.code === current)) chips.push({ code: current, label: this.state.channelName(current) });
    return chips;
  });
  readonly otherFair = signal(false);
  readonly fairLabel = signal('');

  /** The server refuses negative amounts, and a cost of nothing is a typo. */
  readonly basics = computed(() => {
    const draft = this.draft();
    return !!draft.date && !!(draft.category ?? '').trim() && !!(draft.description ?? '').trim();
  });
  readonly canSave = computed(() => this.basics() && (this.amount() > 0 || (!!this.source() && this.amount() < 0)) && !this.sourceLoading() && !this.sourceError() && !this.bankBlocked() && !this.regimeProblem());
  readonly showError = computed(() => this.tried() && !(this.amount() > 0 || (!!this.source() && this.amount() < 0)));

  /* "Aan wie" */
  /** The name was left as typed (blur or Enter), so the 'Nieuw' hint may show; typing or picking clears it. */
  readonly partyCommitted = signal(false);
  /** A typed name that is not in the Aan wie list: the server adds it on booking. Quiet while a known name still matches the prefix. */
  readonly newParty = computed(() => {
    const name = (this.draft().party ?? '').trim();
    if (!name || this.state.costPartyFor(name)) return false;
    return this.partyCommitted() || rankParties(name, this.state.partySuggestions(), 1).length === 0;
  });
  /** The name whose defaults filled in category, VAT and channel, and whether its regime came along. */
  readonly filledFrom = signal<{ party: PartyPrefill; regime: boolean } | null>(null);
  /** Same supplier, same amount, same invoice number or within six weeks: probably booked already. */
  readonly duplicates = computed(() => duplicateCandidates(this.draft(), this.state.costs()));

  /* payments: a cost with rows is settled in its detail, the form only reads them */
  readonly payments = computed(() => this.draft().payments ?? []);
  /** 'n betalingen · € x betaald · nog € y', or settled, or over the top. */
  readonly paidSummary = computed(() => {
    const payments = this.payments();
    const totals = paymentTotals(cashTotalOf(this.draft()), payments);
    const head = `${payments.length} ${payments.length === 1 ? 'betaling' : 'betalingen'}`;
    if (totals.overpaidEur > 0) return `${head} · te veel betaald ${formatEuro(totals.overpaidEur)}`;
    if (totals.paid) return `${head} · volledig betaald`;
    return `${head} · ${formatEuro(totals.paidEur)} betaald · nog ${formatEuro(totals.openEur)}`;
  });
  /** One payment that is not on the bank: its date may still move through 'Betaald op'. */
  readonly singleMovable = computed(() => this.payments().length === 1 && this.payments()[0].bankStatementLineId == null);

  /* "Ook als bankbeweging noteren": only when the cost becomes paid in this save */
  private readonly preference = this.state.payToBank();
  readonly before = computed(() => (this.draft().id ? this.state.costs().find((row) => row.id === this.draft().id) ?? null : null));
  readonly becomingPaid = computed(() => !!this.draft().paidOn && !this.payments().length && (!this.draft().id || !this.before()?.paidOn));
  readonly bankOrigin = this.state.costBankTransaction;
  readonly selectedBank = signal<BankStatementLine | null>(this.bankOrigin());
  readonly bankCreatePending = computed(() => !this.draft().id && this.state.costBankCreatePending()?.line.id === this.selectedBank()?.id && !!this.state.costBankCreatePending());
  readonly toBank = signal(this.bankOrigin() ? false : this.preference.on);
  /** The remembered account, or the only one, as soon as the accounts are in. */
  readonly account = linkedSignal(() => {
    const options = this.state.manualAccountOptions();
    return options.some((option) => option.key === this.preference.accountKey) ? this.preference.accountKey : options.length === 1 ? options[0].key : '';
  });
  readonly future = computed(() => (this.draft().paidOn ?? '') > this.state.today());
  readonly accountHint = computed(() => this.state.accountHint(this.account(), this.draft().paidOn ?? this.state.today()));
  /** The switch is on without an account (once the accounts are known) or with a date still ahead. */
  readonly bankBlocked = computed(() => this.becomingPaid() && !this.selectedBank() && this.toBank() && ((!this.account() && !!this.state.loadedAt()) || this.future()));

  patch(changes: Partial<CompanyCost>): void {
    this.draft.update((draft) => ({ ...draft, ...changes, ...(this.sourceLocked() ? {
      date: draft.date, party: draft.party, reference: draft.reference, amountExclEur: draft.amountExclEur, amountInclEur: draft.amountInclEur,
    } : {}) }));
  }

  /* ---- amount: the typed figure is kept, the other side follows */

  setAmount(value: number): void {
    if (this.sourceLocked()) return;
    if (this.importVat()) this.patch({ amountInclEur: value, amountExclEur: 0 });
    else if (this.mode() === 'incl') this.patch({ amountInclEur: value, amountExclEur: exclFromIncl(value, this.draft().vatPct) });
    else this.patch({ amountExclEur: value, amountInclEur: null });
    this.typedIncl = !this.importVat() && this.mode() === 'incl';
    this.totalKept = false;
  }

  /** Every VAT-rate change goes through here: in incl. mode the excl. amount follows the stored total. */
  setVat(vatPct: number | null): void {
    const incl = storedIncl(this.draft());
    if (this.mode() === 'incl' && incl) this.patch({ vatPct, amountExclEur: exclFromIncl(incl, vatPct) });
    else this.patch({ vatPct });
  }

  /** Excl. → incl. converts the figure; incl. → excl. keeps the excl. amount and drops the entered total. */
  setMode(mode: AmountMode): void {
    if (this.sourceLocked()) return;
    if (mode === this.mode()) return;
    const draft = this.draft();
    if (mode === 'incl') this.patch({ amountInclEur: draft.amountExclEur > 0 ? cashTotalOf(draft) : null });
    else this.patch({ amountInclEur: null });
    this.mode.set(mode);
    this.typedIncl = false;
    this.totalKept = false;
  }

  /* ---- regime */

  /** A patch from the Btw-regeling fields; a new regime also refits the amount block. A pick or 'Klopt' settles the regime, so the 'afgeleid' line goes and no prefill follows. */
  applyRegime(patch: Partial<RegimeFields>): void {
    if ('vatRegime' in patch || patch.vatRegimeConfirmed) this.regimeTouched = true;
    this.writeRegime(patch);
  }

  /** Regime fields into the draft, from the user or from a prefill. */
  private writeRegime(patch: Partial<RegimeFields>): void {
    const before = this.draft().vatRegime;
    this.patch(patch);
    if ('vatRegime' in patch || patch.vatRegimeConfirmed) this.derivedHint.set('');
    if (!('vatRegime' in patch)) return;
    const regime = patch.vatRegime ?? null;
    if (regime !== before) this.fitAmountTo(regime, before);
  }

  /**
   * The amount block follows the regime (cost-amount.fitAmountToRegime):
   * reverse charge and the regimes without VAT are excl.-only, import VAT is
   * one incl. figure, and an invoice with VAT gets its rate back when the
   * previous regime had none. A total typed incl. btw stays whole when the
   * regime puts no VAT on the invoice.
   */
  private fitAmountTo(regime: VatRegime | null, before: VatRegime | null): void {
    if (this.sourceLocked()) return;
    const kindOf = (code: VatRegime | null): AmountKind => (code === 'IMPORT_VAT_PAID' ? 'import' : code && NO_VAT_REGIMES.has(code) ? 'none' : code && REVERSE_CHARGE.has(code) ? 'reverse' : 'invoice');
    const draft = this.draft();
    const next = fitAmountToRegime({ amountExclEur: draft.amountExclEur, amountInclEur: draft.amountInclEur ?? null, vatPct: draft.vatPct, mode: this.mode(), typedIncl: this.typedIncl, totalKept: this.totalKept },
      kindOf(regime), before ? kindOf(before) : null);
    // A bank statement proves the gross amount, never a VAT rate. Keep that choice explicit.
    if (this.bankOrigin() && draft.vatPct == null && (kindOf(regime) === 'invoice' || kindOf(regime) === 'reverse')) {
      next.vatPct = null;
      if (next.mode === 'incl' && next.amountInclEur != null) next.amountExclEur = next.amountInclEur;
    }
    this.patch({ amountExclEur: next.amountExclEur, amountInclEur: next.amountInclEur, vatPct: next.vatPct });
    this.mode.set(next.mode);
    this.typedIncl = next.typedIncl;
    this.totalKept = next.totalKept;
  }

  /** The chip under the amount: book as an investment and show the depreciation fields. */
  bookAsInvestment(): void {
    const draft = this.draft();
    this.applyRegime({ costKind: 'INVESTMENT', depreciationYears: depreciationYearsFor(draft.category), depreciationStart: draft.date });
    this.regimeOpen.set(true);
  }

  /* ---- Aan wie */

  typeParty(name: string): void {
    this.partyCommitted.set(false);
    this.patch({ party: name });
  }

  pickParty(candidate: PartyCandidate): void {
    this.partyCommitted.set(false);
    this.patch({ party: candidate.name });
    this.applyParty();
  }

  commitParty(): void {
    this.partyCommitted.set(true);
    this.applyParty();
  }

  /**
   * A known name fills in category, VAT and channel (its stored defaults,
   * else its last cost), as long as those are still untouched; its regime
   * and country come along while the draft still holds the Belgian default,
   * derived from the country (unconfirmed) when the name has no regime yet.
   * A fair invoice to a name that says nothing about itself keeps that
   * default but asks, unconfirmed (prefillRegime).
   */
  applyParty(): void {
    const draft = this.draft();
    if (draft.id || this.customCategory()) return;
    const known = this.state.partyDefaultsFor(draft.party);
    /* A name the form has never seen says nothing either: a fair invoice to it gets the question too. */
    if (!known) { this.prefillRegime(draft.party ?? ''); return; }
    const fresh = blankCost(this.state.today());
    let filled = false;
    if (draft.category === fresh.category && draft.vatPct === fresh.vatPct && !draft.salesChannel) {
      const category = known.category ?? draft.category;
      const vatPct = known.vatPct ?? draft.vatPct;
      if (category !== draft.category || vatPct !== draft.vatPct || known.salesChannel) {
        this.patch({ category, salesChannel: known.salesChannel });
        this.setVat(vatPct);
        filled = true;
      }
    }
    const regime = this.prefillRegime(known.name);
    if (filled || regime) this.filledFrom.set({ party: known, regime });
  }

  /**
   * What a known name gives the regime, only while nobody picked or confirmed
   * one and the draft still holds the blank Belgian default. The fair
   * question leaves that default in place (unconfirmed), so a later name or
   * category may still answer it or take it back. Returns whether a regime
   * was taken over.
   */
  private prefillRegime(name: string): boolean {
    const current = this.draft();
    const fresh = blankCost(this.state.today());
    const asked = this.fairAsked();
    if (this.regimeTouched || current.vatRegime !== fresh.vatRegime || (current.supplierCountry ?? 'BE') !== 'BE' || !(current.vatRegimeConfirmed || asked)) return false;
    const prefill = regimePrefill(partyRegimeOf(name, this.state.costPartyFor(name), this.state.costs()), current.category, { fairQuestion: true });
    if (!prefill) {
      if (asked) this.withdrawFairQuestion();
      return false;
    }
    if (asked && prefill.derived === FAIR_REGIME_QUESTION) return false;
    this.writeRegime(prefill.patch);
    this.derivedHint.set(prefill.derived ?? '');
    if (prefill.derived) this.regimeOpen.set(true);
    return !!prefill.patch.vatRegime;
  }

  /** The fair question stands on the draft: the Belgian default, unconfirmed, nobody answered yet. */
  private fairAsked(): boolean {
    return this.derivedHint() === FAIR_REGIME_QUESTION && !this.draft().vatRegimeConfirmed;
  }

  private withdrawFairQuestion(): void {
    this.patch({ vatRegimeConfirmed: true });
    this.derivedHint.set('');
  }

  /** The category changed: a fair category raises the fair question under any name that does not answer it, any other category takes it back. */
  private recheckFairQuestion(): void {
    const draft = this.draft();
    if (draft.id) return;
    if (!isFairCategory(draft.category)) {
      if (this.fairAsked()) this.withdrawFairQuestion();
      return;
    }
    if (!this.customCategory()) this.prefillRegime(this.state.partyDefaultsFor(draft.party)?.name ?? draft.party ?? '');
  }

  /* ---- fairs */

  pickFair(code: string): void {
    this.otherFair.set(false);
    this.patch({ salesChannel: code });
  }

  /** 'Andere…': a fair by name, into the list and onto this cost. */
  async addFair(): Promise<void> {
    const label = this.fairLabel().trim();
    if (!label || this.state.saving()) return;
    const fair = await this.state.createFair(label);
    if (!fair) return;
    this.fairLabel.set('');
    this.pickFair(fair.code.trim().toUpperCase());
  }

  togglePaid(paid: boolean): void {
    this.patch({ paidOn: paid ? this.state.today() : null });
  }

  close(): void {
    if (!this.bankCreatePending()) this.state.costFiles.set([]);
    this.state.costBankTransaction.set(null);
    this.state.costDraft.set(null);
  }

  pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    this.add(files);
  }

  private add(files: File[]): void {
    if (!files.length) return;
    const id = this.draft().id;
    if (id) void this.state.attach(id, files);
    else this.pending.update((queue) => [...queue, ...files]);
  }

  dragOver(event: DragEvent): void {
    if (!event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    this.dropping.set(true);
  }

  drop(event: DragEvent): void {
    this.dropping.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    this.add(files);
  }

  unqueue(file: File): void {
    this.pending.update((queue) => queue.filter((row) => row !== file));
  }

  size(bytes: number): string {
    return formatBytes(bytes);
  }

  chooseBank(line: BankStatementLine | null): void {
    this.selectedBank.set(line);
    if (line) this.patch({ paidOn: bankTransactionDay(line) });
  }
  async save(): Promise<void> {
    this.tried.set(true);
    if (!this.canSave()) return;
    const files = this.pending();
    this.state.costFiles.set([...files]);
    /* The switch was on screen: remember its state either way, then book, and note the line when it was on. */
    const bank = this.becomingPaid() ? this.selectedBank() : null;
    const toBank = this.becomingPaid() && !bank && this.toBank();
    if (this.becomingPaid() && !bank && !this.bankOrigin()) this.state.rememberPayToBank({ on: this.toBank(), accountKey: this.account() || this.preference.accountKey });
    const saved = await this.state.saveCost({ ...this.draft(), ...(bank ? { paidOn: bankTransactionDay(bank) } : {}) }, { bankAccountKey: toBank ? this.account() || null : null, bankTransaction: bank });
    if (saved?.id && files.length) void this.state.attach(saved.id, files);
    if (saved) this.state.costFiles.set([]);
  }

  pickCategory(value: string): void {
    if (value === '__other__') {
      this.customCategory.set(true);
      this.patch({ category: '' });
    } else {
      this.customCategory.set(false);
      this.patch({ category: value });
    }
    this.recheckFairQuestion();
  }
}
