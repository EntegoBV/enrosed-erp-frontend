import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CompanyCost } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { formatBytes } from '../../shared/format-bytes';
import { Icon } from '../../shared/icon';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { SALES_CHANNELS } from '../sales/sales-channels';
import { categoryChoices } from './cost-categories';
import { inclOf } from './finance-metrics';
import { blankCost } from './finance-sections';
import { FinanceState } from './finance-state';
import { VatChoice } from './vat-choice';
import { duplicateCandidates, knownParties, partyDefaults, partyMemory } from './cost-suggestions';

/** The cost form: book one, correct one, settle one. The amount comes first. */
@Component({
  selector: 'app-cost-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Sheet, DateField, EurPipe, DateNlPipe, Icon, VatChoice],
  template: `
    <app-sheet variant="ios" [title]="draft().id ? 'Kost bewerken' : 'Kost boeken'" [wide]="true" (closed)="close()">
      <div body class="fin-sheet fin-form">
        @if (draft().recurringCostId) {
          <p class="fin-hint fin-field--wide">Automatisch geboekt als vaste kost. Deze boeking mag je hier corrigeren; pas de vaste kost zelf aan om de volgende periodes te veranderen.</p>
        }
        <label class="fin-amount fin-field--wide">
          <span class="fin-field__label req">Bedrag excl. btw</span><i aria-hidden="true">€</i>
          <input type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" [attr.data-initial-focus]="draft().id ? null : ''"
                 [ngModel]="draft().amountExclEur || null" (ngModelChange)="patch({ amountExclEur: +($event || 0) })" />
        </label>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--wide fin-field--stack"><span>Btw</span>
            <app-vat-choice [value]="draft().vatPct" (changed)="patch({ vatPct: $event })" />
            <span class="fin-hint">Incl. btw: <b>{{ inclOf(draft()) | eur }}</b></span></div>
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
          <label class="fin-field"><span>Aan wie</span>
            <input class="input" list="k-parties" autocomplete="off" placeholder="bijv. TICA Trends & Trade" [ngModel]="draft().party" (ngModelChange)="patch({ party: $event })" (change)="applyParty()" (blur)="applyParty()" />
            <datalist id="k-parties">@for (party of parties(); track party) { <option [value]="party"></option> }</datalist></label>
          <label class="fin-field"><span>Factuurnummer</span>
            <input class="input" [ngModel]="draft().reference" (ngModelChange)="patch({ reference: $event })" /></label>
        </div>
        @if (filledFrom(); as party) {
          <p class="fin-hint fin-field--wide">Categorie, btw en kanaal overgenomen van je vorige kost aan {{ party }}.</p>
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
          <label class="fin-field"><span>Hoort bij verkoopkanaal</span>
            <select class="select" [ngModel]="draft().salesChannel ?? ''" (ngModelChange)="patch({ salesChannel: $event || null })">
              <option value="">Algemene kost</option>
              @for (channel of channels; track channel.code) { <option [value]="channel.code">{{ channel.label }}</option> }
            </select></label>
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
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !basics()" (click)="save()">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaar' : 'Boeken' }}</button>
      </div>
    </app-sheet>
  `,
})
export class CostSheet {
  readonly state = inject(FinanceState);
  readonly channels = SALES_CHANNELS;
  readonly inclOf = inclOf;
  readonly draft = linkedSignal<CompanyCost>(() => this.state.costDraft() ?? blankCost(this.state.today()));
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
  /** The server refuses negative amounts, and a cost of nothing is a typo. */
  readonly basics = computed(() => {
    const draft = this.draft();
    return !!draft.date && !!(draft.category ?? '').trim() && !!(draft.description ?? '').trim();
  });
  readonly canSave = computed(() => this.basics() && this.draft().amountExclEur > 0);
  readonly showError = computed(() => this.tried() && !(this.draft().amountExclEur > 0));
  private readonly memory = computed(() => partyMemory(this.state.costs()));
  readonly parties = computed(() => knownParties(this.memory()));
  /** The supplier whose last cost filled in category, VAT and channel. */
  readonly filledFrom = signal<string | null>(null);
  /** Same supplier, same amount, same invoice number or within six weeks: probably booked already. */
  readonly duplicates = computed(() => duplicateCandidates(this.draft(), this.state.costs()));

  patch(changes: Partial<CompanyCost>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  /** A known supplier fills in category, VAT and channel from its last cost, as long as those are still untouched. */
  applyParty(): void {
    const draft = this.draft();
    if (draft.id || this.customCategory()) return;
    const known = partyDefaults(this.memory(), draft.party);
    const fresh = blankCost(this.state.today());
    if (!known || draft.category !== fresh.category || draft.vatPct !== fresh.vatPct || draft.salesChannel) return;
    if (known.category === draft.category && known.vatPct === draft.vatPct && !known.salesChannel) return;
    this.patch({ category: known.category, vatPct: known.vatPct, salesChannel: known.salesChannel });
    this.filledFrom.set(known.party);
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
    const saved = await this.state.saveCost(this.draft());
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
