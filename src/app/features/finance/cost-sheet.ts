import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
import { exclFromIncl } from './cost-amount';
import { categoryChoices } from './cost-categories';
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

/** The categories that stand for a fair: the fair itself is then the cost's channel. */
const FAIR_CATEGORIES = new Set(['BEURS', 'TICA']);
/** The regimes with an invoice behind them: the date field reads 'Factuurdatum'. */
const INVOICE_REGIMES = new Set(['BE', 'EU_GOODS', 'EU_SERVICES', 'NON_EU_SERVICES', 'FOREIGN_VAT', 'EXEMPT']);
const storedIncl = (cost: CompanyCost): number => (Number.isFinite(cost.amountInclEur as number) && (cost.amountInclEur as number) > 0 ? cost.amountInclEur as number : 0);

/** The cost form: book one, correct one, settle one. The amount comes first. */
@Component({
  selector: 'app-cost-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Sheet, DateField, EurPipe, DateNlPipe, Icon, VatChoice, Segmented, PartyField, CostRegimeFields, BankTransactionPicker],
  template: `
    <app-sheet variant="ios" [title]="draft().id ? 'Kost bewerken' : 'Kost boeken'" [wide]="true" (closed)="close()">
      <div body class="fin-sheet fin-form">
        @if (pendingNote(); as note) { <p class="fin-hint fin-field--wide">{{ note }}</p> }
        @if (draft().recurringCostId) {
          <p class="fin-hint fin-field--wide">Automatisch geboekt als vaste kost. Deze boeking mag je hier corrigeren; pas de vaste kost zelf aan om de volgende periodes te veranderen.</p>
        }
        <div class="fin-amount-mode fin-field--wide">
          <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Bedrag" [options]="modes()" [value]="mode()" (changed)="setMode($any($event))" />
        </div>
        <label class="fin-amount fin-field--wide">
          <span class="fin-sr">{{ amountLabel() }}</span><i aria-hidden="true">€</i>
          <input type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" [attr.data-initial-focus]="draft().id ? null : ''"
                 [ngModel]="amount() || null" (ngModelChange)="setAmount(+($event || 0))" />
        </label>
        @if (amountNote(); as note) { <p class="fin-hint fin-field--wide">{{ note }}</p> }
        @if (investmentSuggested()) {
          <div class="fin-amount-mode fin-field--wide"><button class="fin-choice__chip" type="button" (click)="bookAsInvestment()">Boven € 250 excl.: als investering boeken?</button></div>
        }
        <div class="fin-group" [class.ios-group]="!state.desk()">
          @if (vatShown()) {
            <div class="fin-field fin-field--wide fin-field--stack"><span>Btw</span>
              <app-vat-choice [value]="draft().vatPct" (changed)="setVat($event)" />
              <span class="fin-hint">
                @if (reverseCharge()) { btw verlegd {{ draft().vatPct ?? 0 }} % · <b>{{ vatOf(draft()) | eur }}</b> · niet aan de leverancier, wel in de aangifte }
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
            <app-date-field fieldId="k-date" [value]="draft().date" (valueChange)="patch({ date: $event })" /></div>
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
            <app-party-field fieldId="k-party" placeholder="bijv. TICA Trends & Trade" [value]="draft().party ?? ''" [candidates]="state.partySuggestions()" [maxlength]="200"
                             (valueChange)="typeParty($event)" (picked)="pickParty($event)" (committed)="commitParty()" />
            @if (newParty()) { <span class="fin-hint">Nieuw: komt na het boeken in de lijst Aan wie.</span> }</div>
          <label class="fin-field"><span>Factuurnummer</span>
            <input class="input" [ngModel]="draft().reference" (ngModelChange)="patch({ reference: $event })" /></label>
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
            <div class="fin-field fin-field--wide"><app-bank-transaction-picker direction="OUTGOING" [amount]="cashTotalOf(draft())" [selected]="selectedBank()" [disabled]="state.saving()" (selectedChange)="chooseBank($event)" /></div>
            @if (selectedBank()) { <p class="fin-hint fin-field--wide">Datum en rekening komen van de bank. Het totaal inclusief btw moet gelijk zijn aan de transactie.</p> }
            @else {
            <label class="fin-field fin-field--switch fin-field--wide"><span>Ook als bankbeweging noteren<small>Een uitgaande beweging met een verwijzing naar deze kost</small></span>
              <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [checked]="toBank()" (change)="toBank.set($any($event.target).checked)" /></label>
            @if (toBank()) {
              <div class="fin-field fin-field--wide fin-field--stack"><span>Rekening</span>
                @if (state.accountOptions().length) {
                  <div class="fin-choice" role="group" aria-label="Rekening">
                    @for (option of state.accountOptions(); track option.key) {
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
      </div>
      <div foot style="display:contents">
        @if (draft().id && state.desk()) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteCost(draft())">Verwijderen</button> }
        @if (regimeProblem(); as problem) { <span class="fin-foot-note">{{ problem }}</span> }
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !basics() || bankBlocked() || !!regimeProblem()" (click)="save()">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaar' : 'Boeken' }}</button>
      </div>
    </app-sheet>
  `,
})
export class CostSheet {
  readonly state = inject(FinanceState);
  readonly cashTotalOf = cashTotalOf;
  readonly vatOf = vatOf;
  readonly draft = linkedSignal<CompanyCost>(() => this.state.costDraft() ?? blankCost(this.state.today()));
  /** Excl. for a new cost; incl. when the cost being edited was entered that way. */
  readonly mode = signal<AmountMode>(storedIncl(this.draft()) ? 'incl' : 'excl');
  /** The figure in the field: what was typed, in the active mode. */
  readonly amount = computed(() => (this.mode() === 'incl' ? storedIncl(this.draft()) : this.draft().amountExclEur));
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
  /** 'Afgeleid van het land · controleer' after a party prefill; gone once a regime is picked. */
  readonly derivedHint = signal('');
  readonly regimeProblem = computed(() => regimeProblem(this.draft()));

  /* channels and fairs: the select lists both, the chips only the fairs */
  readonly channels = computed(() => this.state.channelChoices().filter((channel) => channel.hint !== 'Beurs'));
  readonly fairChoices = computed(() => this.state.channelChoices().filter((channel) => channel.hint === 'Beurs'));
  readonly channelCode = computed(() => (this.draft().salesChannel ?? '').trim().toUpperCase());
  readonly fairCategory = computed(() => FAIR_CATEGORIES.has((this.draft().category ?? '').trim().toUpperCase()));
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
  readonly canSave = computed(() => this.basics() && this.amount() > 0 && !this.bankBlocked() && !this.regimeProblem());
  readonly showError = computed(() => this.tried() && !(this.amount() > 0));

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
  readonly selectedBank = signal<BankStatementLine | null>(null);
  readonly toBank = signal(this.preference.on);
  /** The remembered account, or the only one, as soon as the accounts are in. */
  readonly account = linkedSignal(() => {
    const options = this.state.accountOptions();
    return options.some((option) => option.key === this.preference.accountKey) ? this.preference.accountKey : options.length === 1 ? options[0].key : '';
  });
  readonly future = computed(() => (this.draft().paidOn ?? '') > this.state.today());
  readonly accountHint = computed(() => this.state.accountHint(this.account(), this.draft().paidOn ?? this.state.today()));
  /** The switch is on without an account (once the accounts are known) or with a date still ahead. */
  readonly bankBlocked = computed(() => this.becomingPaid() && !this.selectedBank() && this.toBank() && ((!this.account() && !!this.state.loadedAt()) || this.future()));

  patch(changes: Partial<CompanyCost>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  /* ---- amount: the typed figure is kept, the other side follows */

  setAmount(value: number): void {
    if (this.importVat()) this.patch({ amountInclEur: value, amountExclEur: 0 });
    else if (this.mode() === 'incl') this.patch({ amountInclEur: value, amountExclEur: exclFromIncl(value, this.draft().vatPct) });
    else this.patch({ amountExclEur: value, amountInclEur: null });
  }

  /** Every VAT-rate change goes through here: in incl. mode the excl. amount follows the stored total. */
  setVat(vatPct: number | null): void {
    const incl = storedIncl(this.draft());
    if (this.mode() === 'incl' && incl) this.patch({ vatPct, amountExclEur: exclFromIncl(incl, vatPct) });
    else this.patch({ vatPct });
  }

  /** Excl. → incl. converts the figure; incl. → excl. keeps the excl. amount and drops the entered total. */
  setMode(mode: AmountMode): void {
    if (mode === this.mode()) return;
    const draft = this.draft();
    if (mode === 'incl') this.patch({ amountInclEur: draft.amountExclEur > 0 ? cashTotalOf(draft) : null });
    else this.patch({ amountInclEur: null });
    this.mode.set(mode);
  }

  /* ---- regime */

  /** A patch from the Btw-regeling fields; a new regime also refits the amount block. A pick or 'Klopt' settles the regime, so the 'afgeleid' line goes. */
  applyRegime(patch: Partial<RegimeFields>): void {
    const before = this.draft().vatRegime;
    this.patch(patch);
    if ('vatRegime' in patch || patch.vatRegimeConfirmed) this.derivedHint.set('');
    if (!('vatRegime' in patch)) return;
    const regime = patch.vatRegime ?? null;
    if (regime !== before) this.fitAmountTo(regime, before);
  }

  /**
   * The amount block follows the regime: reverse charge and the regimes
   * without VAT are excl.-only, import VAT is one incl. figure, and an
   * invoice with VAT gets its rate back when the previous regime had none.
   */
  private fitAmountTo(regime: VatRegime | null, before: VatRegime | null): void {
    const figure = this.amount();
    if (regime === 'IMPORT_VAT_PAID') {
      this.patch({ amountExclEur: 0, amountInclEur: figure > 0 ? figure : null, vatPct: null });
      this.mode.set('incl');
      return;
    }
    if (before === 'IMPORT_VAT_PAID') {
      this.patch({ amountExclEur: figure, amountInclEur: null });
      this.mode.set('excl');
    }
    if (regime && NO_VAT_REGIMES.has(regime)) {
      this.patch({ amountInclEur: null, vatPct: null });
      this.mode.set('excl');
      return;
    }
    const rate = this.draft().vatPct;
    if (regime && REVERSE_CHARGE.has(regime)) {
      this.patch({ amountInclEur: null, vatPct: (rate ?? 0) > 0 ? rate : 21 });
      this.mode.set('excl');
      return;
    }
    if (!((rate ?? 0) > 0) && (!before || NO_VAT_REGIMES.has(before) || before === 'IMPORT_VAT_PAID')) this.setVat(21);
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
   */
  applyParty(): void {
    const draft = this.draft();
    if (draft.id || this.customCategory()) return;
    const known = this.state.partyDefaultsFor(draft.party);
    if (!known) return;
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
    let regime = false;
    const current = this.draft();
    if (current.vatRegime === fresh.vatRegime && current.vatRegimeConfirmed && (current.supplierCountry ?? 'BE') === 'BE') {
      const prefill = regimePrefill(partyRegimeOf(known.name, this.state.costPartyFor(known.name), this.state.costs()), current.category);
      if (prefill) {
        this.applyRegime(prefill.patch);
        this.derivedHint.set(prefill.derived ?? '');
        if (prefill.derived) this.regimeOpen.set(true);
        regime = true;
      }
    }
    if (filled || regime) this.filledFrom.set({ party: known, regime });
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
    this.state.costFiles.set([]);
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
    /* The switch was on screen: remember its state either way, then book, and note the line when it was on. */
    const bank = this.becomingPaid() ? this.selectedBank() : null;
    const toBank = this.becomingPaid() && !bank && this.toBank();
    if (this.becomingPaid()) this.state.rememberPayToBank({ on: this.toBank(), accountKey: this.account() || this.preference.accountKey });
    const saved = await this.state.saveCost({ ...this.draft(), ...(bank ? { paidOn: bankTransactionDay(bank) } : {}) }, { bankAccountKey: toBank ? this.account() || null : null, bankTransaction: bank });
    if (saved?.id && files.length) void this.state.attach(saved.id, files);
    if (saved) this.state.costFiles.set([]);
  }

  pickCategory(value: string): void {
    if (value === '__other__') {
      this.customCategory.set(true);
      this.patch({ category: '' });
      return;
    }
    this.customCategory.set(false);
    this.patch({ category: value });
  }
}
