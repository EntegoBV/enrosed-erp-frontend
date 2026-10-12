import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CompanyCost } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { SALES_CHANNELS } from '../sales/sales-channels';
import { exclFromIncl } from './cost-amount';
import { categoryChoices } from './cost-categories';
import { inclOf, vatOf } from './finance-metrics';
import { blankCost } from './finance-sections';
import { FinanceState, PartyPrefill } from './finance-state';
import { PartyField } from './party-field';
import { rankParties } from './party-suggestions';
import type { PartyCandidate } from './party-suggestions';
import { VatChoice } from './vat-choice';
import { duplicateCandidates } from './cost-suggestions';

type AmountMode = 'excl' | 'incl';

/** The categories that stand for a fair: the fair itself is then the cost's channel. */
const FAIR_CATEGORIES = new Set(['BEURS', 'TICA']);
const storedIncl = (cost: CompanyCost): number => (Number.isFinite(cost.amountInclEur as number) && (cost.amountInclEur as number) > 0 ? cost.amountInclEur as number : 0);

/** The cost form: book one, correct one, settle one. The amount comes first. */
@Component({
  selector: 'app-cost-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Sheet, DateField, EurPipe, DateNlPipe, Icon, VatChoice, Segmented, PartyField],
  template: `
    <app-sheet variant="ios" [title]="draft().id ? 'Kost bewerken' : 'Kost boeken'" [wide]="true" (closed)="close()">
      <div body class="fin-sheet fin-form">
        @if (pendingNote(); as note) { <p class="fin-hint fin-field--wide">{{ note }}</p> }
        @if (draft().recurringCostId) {
          <p class="fin-hint fin-field--wide">Automatisch geboekt als vaste kost. Deze boeking mag je hier corrigeren; pas de vaste kost zelf aan om de volgende periodes te veranderen.</p>
        }
        <div class="fin-amount-mode fin-field--wide">
          <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Bedrag" [options]="modes" [value]="mode()" (changed)="setMode($any($event))" />
        </div>
        <label class="fin-amount fin-field--wide">
          <span class="fin-sr">{{ mode() === 'incl' ? 'Bedrag incl. btw' : 'Bedrag excl. btw' }}</span><i aria-hidden="true">€</i>
          <input type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" [attr.data-initial-focus]="draft().id ? null : ''"
                 [ngModel]="amount() || null" (ngModelChange)="setAmount(+($event || 0))" />
        </label>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--wide fin-field--stack"><span>Btw</span>
            <app-vat-choice [value]="draft().vatPct" (changed)="setVat($event)" />
            @if (mode() === 'incl') {
              <span class="fin-hint">Excl. btw: <b>{{ draft().amountExclEur | eur }}</b> · btw <b>{{ vatOf(draft()) | eur }}</b></span>
            } @else {
              <span class="fin-hint">Incl. btw: <b>{{ inclOf(draft()) | eur }}</b></span>
            }</div>
        </div>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field fin-field--wide"><span class="req">Omschrijving</span>
            <input class="input" placeholder="bijv. Standhuur TICA oktober" [ngModel]="draft().description" (ngModelChange)="patch({ description: $event })" /></label>
          <div class="fin-field"><span class="req">Datum</span>
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
        @if (filledFrom(); as party) {
          <p class="fin-hint fin-field--wide">Categorie, btw en kanaal overgenomen {{ party.stored ? 'uit de lijst Aan wie voor' : 'van je vorige kost aan' }} {{ party.name }}.</p>
        }
        @if (duplicates().length) {
          <p class="fin-hint fin-hint--warn fin-field--wide" role="status"><b>Lijkt al geboekt:</b>
            @for (other of duplicates().slice(0, 2); track other.id; let last = $last) { {{ other.description }} van {{ other.date | dateNl }}, {{ other.amountExclEur | eur }} excl.{{ other.reference ? ' (' + other.reference + ')' : '' }}{{ last ? '.' : ';' }} }</p>
        }
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <label class="fin-field fin-field--switch fin-field--wide"><span>Betaald<small>{{ draft().paidOn ? 'Op ' + (draft().paidOn ?? '') : 'Nog open: staat bij Te betalen' }}</small></span>
            <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [checked]="!!draft().paidOn" (change)="togglePaid($any($event.target).checked)" /></label>
          @if (draft().paidOn) {
            <div class="fin-field"><span>Betaald op</span><app-date-field fieldId="k-paid" [value]="draft().paidOn ?? ''" (valueChange)="patch({ paidOn: $event || null })" /></div>
          }
          @if (becomingPaid()) {
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
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !basics() || bankBlocked()" (click)="save()">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaar' : 'Boeken' }}</button>
      </div>
    </app-sheet>
  `,
})
export class CostSheet {
  readonly state = inject(FinanceState);
  readonly inclOf = inclOf;
  readonly vatOf = vatOf;
  readonly modes: SegmentOption[] = [{ id: 'excl', label: 'Excl. btw' }, { id: 'incl', label: 'Incl. btw' }];
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
  readonly canSave = computed(() => this.basics() && this.amount() > 0 && !this.bankBlocked());
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
  /** The name whose defaults filled in category, VAT and channel. */
  readonly filledFrom = signal<PartyPrefill | null>(null);
  /** Same supplier, same amount, same invoice number or within six weeks: probably booked already. */
  readonly duplicates = computed(() => duplicateCandidates(this.draft(), this.state.costs()));

  /* "Ook als bankbeweging noteren": only when the cost becomes paid in this save */
  private readonly preference = this.state.payToBank();
  readonly before = computed(() => (this.draft().id ? this.state.costs().find((row) => row.id === this.draft().id) ?? null : null));
  readonly becomingPaid = computed(() => !!this.draft().paidOn && (!this.draft().id || !this.before()?.paidOn));
  readonly toBank = signal(this.preference.on);
  /** The remembered account, or the only one, as soon as the accounts are in. */
  readonly account = linkedSignal(() => {
    const options = this.state.accountOptions();
    return options.some((option) => option.key === this.preference.accountKey) ? this.preference.accountKey : options.length === 1 ? options[0].key : '';
  });
  readonly future = computed(() => (this.draft().paidOn ?? '') > this.state.today());
  readonly accountHint = computed(() => this.state.accountHint(this.account(), this.draft().paidOn ?? this.state.today()));
  /** The switch is on without an account (once the accounts are known) or with a date still ahead. */
  readonly bankBlocked = computed(() => this.becomingPaid() && this.toBank() && ((!this.account() && !!this.state.loadedAt()) || this.future()));

  patch(changes: Partial<CompanyCost>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  /* ---- amount: the typed figure is kept, the other side follows */

  setAmount(value: number): void {
    if (this.mode() === 'incl') this.patch({ amountInclEur: value, amountExclEur: exclFromIncl(value, this.draft().vatPct) });
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
    if (mode === 'incl') this.patch({ amountInclEur: draft.amountExclEur > 0 ? inclOf(draft) : null });
    else this.patch({ amountInclEur: null });
    this.mode.set(mode);
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

  /** A known name fills in category, VAT and channel (its stored defaults, else its last cost), as long as those are still untouched. */
  applyParty(): void {
    const draft = this.draft();
    if (draft.id || this.customCategory()) return;
    const known = this.state.partyDefaultsFor(draft.party);
    const fresh = blankCost(this.state.today());
    if (!known || draft.category !== fresh.category || draft.vatPct !== fresh.vatPct || draft.salesChannel) return;
    const category = known.category ?? draft.category;
    const vatPct = known.vatPct ?? draft.vatPct;
    if (category === draft.category && vatPct === draft.vatPct && !known.salesChannel) return;
    this.patch({ category, salesChannel: known.salesChannel });
    this.setVat(vatPct);
    this.filledFrom.set(known);
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

  async save(): Promise<void> {
    this.tried.set(true);
    if (!this.canSave()) return;
    const files = this.pending();
    /* The switch was on screen: remember its state either way, then book, and note the line when it was on. */
    const toBank = this.becomingPaid() && this.toBank();
    if (this.becomingPaid()) this.state.rememberPayToBank({ on: this.toBank(), accountKey: this.account() || this.preference.accountKey });
    const saved = await this.state.saveCost(this.draft(), { bankAccountKey: toBank ? this.account() || null : null });
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
