import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { messageOf } from '../../core/api/errors';
import { FinanceApi } from '../../core/api/finance-api';
import { CompanyCost } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { SALES_CHANNELS, channelLabel } from '../sales/sales-channels';
import { COST_CATEGORIES, categoryChoices, categoryLabel } from './cost-categories';
import { costSummary, costsInPeriod, inclOf } from './cost-metrics';

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = TODAY.slice(0, 4);
const MONTH_START = TODAY.slice(0, 8) + '01';
const QUARTER_START = `${YEAR}-${String(Math.floor((Number(TODAY.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
const LAST_YEAR = String(Number(YEAR) - 1);

type PresetId = 'month' | 'quarter' | 'year' | 'lastYear' | 'all';

interface Preset { id: PresetId; label: string; from: string; to: string }

const PRESETS: readonly Preset[] = [
  { id: 'month', label: 'Deze maand', from: MONTH_START, to: TODAY },
  { id: 'quarter', label: 'Dit kwartaal', from: QUARTER_START, to: TODAY },
  { id: 'year', label: 'Dit jaar', from: `${YEAR}-01-01`, to: TODAY },
  { id: 'lastYear', label: LAST_YEAR, from: `${LAST_YEAR}-01-01`, to: `${LAST_YEAR}-12-31` },
  { id: 'all', label: 'Alles', from: '', to: '' },
];

function blank(): CompanyCost {
  return { id: null, date: TODAY, category: 'ANDERE', description: '', party: '', amountExclEur: 0, vatPct: 21, reference: '', paidOn: null, salesChannel: null, notes: '' };
}

/**
 * The company's own costs: the fair, the accountant, rent, the TICA
 * stand. Booked by date and category, excluding VAT, so the result
 * analysis can set them against the sales per channel.
 */
@Component({
  selector: 'app-costs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, Sheet, DateField, EurPipe, NumPipe, PctPipe, DateNlPipe],
  template: `
    <app-page-header [showBack]="true" backTo="/more" title="Kosten" subtitle="Beurs, boekhouder, huur, TICA-stand: wat we zelf uitgeven">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="open(null)">+ Kost</button>
    </app-page-header>

    <div class="content costs">
      <div class="costs__period" role="group" aria-label="Periode">
        @for (preset of presets; track preset.id) {
          <button class="costs__chip" type="button" [class.on]="presetId() === preset.id" (click)="applyPreset(preset.id)">{{ preset.label }}</button>
        }
        <span class="costs__range">
          <app-date-field fieldId="costs-from" [value]="from()" (valueChange)="setRange($event, to())" />
          <i>tot</i>
          <app-date-field fieldId="costs-to" [value]="to()" (valueChange)="setRange(from(), $event)" />
        </span>
      </div>

      <div class="costs__kpis">
        <article class="card costs__kpi costs__kpi--dark"><small>Kosten excl. btw</small><strong>{{ summary().exclEur | eur: 0 }}</strong><span>{{ summary().count }} {{ summary().count === 1 ? 'kost' : 'kosten' }} in de periode</span></article>
        <article class="card costs__kpi"><small>Incl. btw</small><strong>{{ summary().inclEur | eur: 0 }}</strong><span>{{ summary().vatEur | eur: 0 }} btw</span></article>
        <article class="card costs__kpi" [class.costs__kpi--warn]="summary().unpaidCount > 0"><small>Nog te betalen</small><strong>{{ summary().unpaidEur | eur: 0 }}</strong><span>{{ summary().unpaidCount }} open, incl. btw</span></article>
        <article class="card costs__kpi"><small>Grootste post</small><strong>{{ summary().byCategory[0] ? categoryLabel(summary().byCategory[0].category) : '—' }}</strong><span>{{ summary().byCategory[0] ? (summary().byCategory[0].sharePct | pct: 0) + ' van de kosten' : 'nog niets geboekt' }}</span></article>
      </div>

      @if (summary().byCategory.length) {
        <section class="card costs__cats" aria-label="Kosten per categorie">
          <header><span class="section-kicker">Per categorie</span><h2>Waar het geld naartoe gaat</h2></header>
          <ul>
            @for (row of summary().byCategory; track row.category) {
              <li>
                <span class="costs__cat-bar"><i [style.width.%]="row.sharePct"></i></span>
                <b>{{ categoryLabel(row.category) }}</b>
                <small>{{ row.count }} {{ row.count === 1 ? 'kost' : 'kosten' }}</small>
                <strong>{{ row.exclEur | eur: 0 }}</strong>
                <em>{{ row.sharePct | pct: 0 }}</em>
              </li>
            }
          </ul>
        </section>
      }

      @if (loading()) {
        <p class="costs__state">Laden…</p>
      } @else if (!inPeriod().length) {
        <div class="empty card"><div class="empty__title">Geen kosten in deze periode</div><p>Boek de beurs, de boekhouder of de huur met de knop + Kost.</p></div>
      } @else {
        @for (group of byMonth(); track group.month) {
          <section class="card costs__month" [attr.aria-label]="group.label">
            <header><h2>{{ group.label }}</h2><strong>{{ group.exclEur | eur: 0 }}</strong></header>
            <div class="list">
              @for (cost of group.costs; track cost.id) {
                <button class="list-item costs__row" type="button" (click)="open(cost)">
                  <span class="costs__date">{{ cost.date | dateNl }}</span>
                  <span class="costs__cat" [attr.data-cat]="cost.category">{{ categoryLabel(cost.category) }}</span>
                  <span class="list-item__body">
                    <span class="list-item__title">{{ cost.description }}</span>
                    <span class="list-item__meta">{{ meta(cost) }}</span>
                  </span>
                  <span class="list-item__end costs__amount">
                    <b>{{ cost.amountExclEur | eur }}</b>
                    <small>{{ inclOf(cost) | eur }} incl.</small>
                    <em [class.costs__paid]="cost.paidOn" [class.costs__open]="!cost.paidOn">{{ cost.paidOn ? 'betaald ' + (cost.paidOn | dateNl) : 'open' }}</em>
                  </span>
                  <span class="list-item__chev">›</span>
                </button>
              }
            </div>
          </section>
        }
      }
    </div>

    <button class="fab" type="button" (click)="open(null)">+ Kost</button>

    @if (editing()) {
      <app-sheet [title]="draft().id ? 'Kost bewerken' : 'Kost boeken'" (closed)="editing.set(false)">
        <div body><div class="form-grid">
          <div class="field"><label class="req" for="k-date">Datum</label>
            <app-date-field fieldId="k-date" [value]="draft().date" (valueChange)="patch({ date: $event })" /></div>
          <div class="field"><label class="req" for="k-cat">Categorie</label>
            <select class="select" id="k-cat" [ngModel]="categoryChoice()" (ngModelChange)="pickCategory($event)">
              @for (category of categories(); track category.code) { <option [value]="category.code">{{ category.label }}</option> }
              <option value="__other__">Eigen categorie…</option>
            </select>
            @if (customCategory()) {
              <input class="input mt-8" aria-label="Eigen categorie" placeholder="bijv. OPLEIDING" [ngModel]="draft().category" (ngModelChange)="patch({ category: ($event || '').toUpperCase() })" />
            }</div>
          <div class="field span-2"><label class="req" for="k-desc">Omschrijving</label>
            <input class="input" id="k-desc" placeholder="bijv. Standhuur TICA oktober" [ngModel]="draft().description" (ngModelChange)="patch({ description: $event })" /></div>
          <div class="field"><label for="k-party">Aan wie</label>
            <input class="input" id="k-party" placeholder="bijv. TICA Trends & Trade" [ngModel]="draft().party" (ngModelChange)="patch({ party: $event })" /></div>
          <div class="field"><label for="k-ref">Factuurnummer <span class="opt"></span></label>
            <input class="input" id="k-ref" [ngModel]="draft().reference" (ngModelChange)="patch({ reference: $event })" /></div>
          <div class="field"><label class="req" for="k-amount">Bedrag excl. btw</label>
            <span class="costs__money"><i>€</i><input class="input num right" id="k-amount" type="number" min="0" step="0.01" inputmode="decimal"
                   [ngModel]="draft().amountExclEur || null" (ngModelChange)="patch({ amountExclEur: +($event || 0) })" /></span></div>
          <div class="field"><label for="k-vat">Btw</label>
            <span class="costs__money">
              <span class="costs__quick" role="group" aria-label="Btw kiezen">
                <button type="button" [class.on]="draft().vatPct === 21" (click)="patch({ vatPct: 21 })">21</button>
                <button type="button" [class.on]="draft().vatPct === 6" (click)="patch({ vatPct: 6 })">6</button>
                <button type="button" [class.on]="!draft().vatPct" (click)="patch({ vatPct: 0 })">0</button>
              </span>
              <input class="input num right" id="k-vat" type="number" min="0" max="100" step="0.5" inputmode="decimal"
                     [ngModel]="draft().vatPct ?? 0" (ngModelChange)="patch({ vatPct: +($event || 0) })" /><i>%</i></span>
            <span class="hint">Incl. btw: {{ inclOf(draft()) | eur }}</span></div>
          <div class="field"><label for="k-paid">Betaald op <span class="opt"></span></label>
            <app-date-field fieldId="k-paid" [value]="draft().paidOn ?? ''" (valueChange)="patch({ paidOn: $event || null })" />
            @if (!draft().paidOn) { <button class="linklike mt-8" type="button" (click)="patch({ paidOn: today })">Vandaag betaald</button> }</div>
          <div class="field"><label for="k-channel">Hoort bij verkoopkanaal <span class="opt"></span></label>
            <select class="select" id="k-channel" [ngModel]="draft().salesChannel ?? ''" (ngModelChange)="patch({ salesChannel: $event || null })">
              <option value="">Algemene kost</option>
              @for (channel of channels; track channel.code) { <option [value]="channel.code">{{ channel.label }}</option> }
            </select>
            <span class="hint">Een standhuur bij TICA telt dan mee in het resultaat van dat kanaal.</span></div>
          <div class="field span-2"><label for="k-notes">Notities <span class="opt"></span></label>
            <textarea class="textarea" id="k-notes" rows="3" [ngModel]="draft().notes" (ngModelChange)="patch({ notes: $event })"></textarea></div>
        </div></div>
        <div foot style="display:contents">
          @if (draft().id) { <button class="btn btn--danger" type="button" [disabled]="saving()" (click)="remove()">Verwijderen</button> }
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="editing.set(false)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="saving() || !canSave()" (click)="save()">{{ saving() ? 'Bezig…' : draft().id ? 'Bewaren' : 'Boeken' }}</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: block; }
    .costs { display: grid; gap: 14px; padding-bottom: 92px; }
    .costs__period { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .costs__chip { padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 650; cursor: pointer; }
    .costs__chip.on { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); }
    .costs__range { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
    .costs__range i { color: var(--muted); font-size: 12px; font-style: normal; }
    .costs__kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
    .costs__kpi { display: grid; gap: 2px; padding: 12px 14px; }
    .costs__kpi small { color: var(--muted); font-size: 10px; font-weight: 780; letter-spacing: .07em; text-transform: uppercase; }
    .costs__kpi strong { font-size: 22px; letter-spacing: -.02em; line-height: 1.1; }
    .costs__kpi span { color: var(--muted); font-size: 11.5px; }
    .costs__kpi--dark { border-color: #302a27; background: #272220; color: #fff; }
    .costs__kpi--dark small, .costs__kpi--dark span { color: rgb(255 255 255 / 62%); }
    .costs__kpi--warn strong { color: var(--warn); }
    .costs__cats { padding: 14px 16px; }
    .costs__cats header h2 { font-size: 16px; }
    .costs__cats ul { display: grid; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; }
    .costs__cats li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-areas: 'name amount pct' 'meta amount pct' 'bar bar bar'; column-gap: 12px; align-items: center; font-size: 13px; }
    .costs__cats b { grid-area: name; }
    .costs__cats small { grid-area: meta; color: var(--muted); font-size: 11px; }
    .costs__cats strong { grid-area: amount; font-variant-numeric: tabular-nums; }
    .costs__cats em { grid-area: pct; min-width: 40px; color: var(--muted); font-size: 11.5px; font-style: normal; text-align: right; }
    .costs__cat-bar { grid-area: bar; display: block; height: 5px; margin: 4px 0 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
    .costs__cat-bar i { display: block; height: 100%; border-radius: 999px; background: var(--rose); }
    .costs__month { overflow: hidden; }
    .costs__month header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
    .costs__month h2 { font-size: 14px; text-transform: capitalize; }
    .costs__month header strong { font-variant-numeric: tabular-nums; }
    .costs__row { display: grid; grid-template-columns: 78px auto minmax(0, 1fr) auto 16px; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .costs__row:last-child { border-bottom: 0; }
    .costs__row:hover { background: var(--surface-2); }
    .costs__row .list-item__body { display: grid; min-width: 0; }
    .costs__row .list-item__title, .costs__row .list-item__meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .costs__date { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .costs__cat { padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); font-size: 10.5px; font-weight: 750; letter-spacing: .03em; text-transform: uppercase; white-space: nowrap; }
    .costs__cat[data-cat='TICA'], .costs__cat[data-cat='BEURS'] { background: var(--rose-soft); color: var(--rose-dark); }
    .costs__amount { display: grid; justify-items: end; }
    .costs__amount b { font-variant-numeric: tabular-nums; }
    .costs__amount small { color: var(--muted); font-size: 11px; }
    .costs__amount em { font-size: 10.5px; font-style: normal; font-weight: 700; }
    .costs__paid { color: var(--ok); }
    .costs__open { color: var(--warn); }
    .costs__state { color: var(--muted); }
    .costs__money { display: inline-flex; align-items: center; gap: 6px; }
    .costs__money .input { width: 120px; }
    .costs__money i { color: var(--muted); font-style: normal; }
    .costs__quick { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); }
    .costs__quick button { min-width: 34px; padding: 4px 8px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    .costs__quick button.on { background: var(--rose); color: #fff; }
    @media (max-width: 679px) {
      .costs__range { margin-left: 0; flex-basis: 100%; }
      .costs__row { grid-template-columns: auto minmax(0, 1fr) auto 16px; grid-template-areas: 'cat body amount chev' 'date body amount chev'; }
      .costs__date { grid-area: date; }
      .costs__cat { grid-area: cat; justify-self: start; }
      .costs__row .list-item__body { grid-area: body; }
      .costs__amount { grid-area: amount; }
      .costs__row .list-item__chev { grid-area: chev; }
    }
  `,
})
export class CostsPage {
  private readonly finance = inject(FinanceApi);
  private readonly ui = inject(Ui);

  readonly presets = PRESETS;
  readonly channels = SALES_CHANNELS;
  readonly today = TODAY;
  readonly categoryLabel = categoryLabel;
  readonly channelLabel = channelLabel;
  readonly inclOf = inclOf;

  readonly costs = signal<CompanyCost[]>([]);
  readonly loading = signal(true);
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly draft = signal<CompanyCost>(blank());
  readonly presetId = signal<PresetId>('year');
  readonly from = signal(`${YEAR}-01-01`);
  readonly to = signal(TODAY);
  readonly customCategory = signal(false);

  readonly inPeriod = computed(() => costsInPeriod(this.costs(), this.from(), this.to()));
  readonly summary = computed(() => costSummary(this.inPeriod()));
  readonly categories = computed(() => categoryChoices(this.costs().map((cost) => cost.category)));
  readonly categoryChoice = computed(() => {
    if (this.customCategory()) return '__other__';
    const code = (this.draft().category ?? '').toUpperCase();
    return this.categories().some((category) => category.code === code) ? code : '__other__';
  });
  readonly canSave = computed(() => {
    const draft = this.draft();
    return !!draft.date && !!(draft.category ?? '').trim() && !!(draft.description ?? '').trim() && draft.amountExclEur >= 0;
  });
  readonly byMonth = computed(() => {
    const groups = new Map<string, CompanyCost[]>();
    for (const cost of this.inPeriod()) {
      const key = cost.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), cost]);
    }
    return [...groups.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([month, costs]) => ({
        month,
        label: new Date(`${month}-01T00:00:00`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' }),
        exclEur: Math.round(costs.reduce((sum, cost) => sum + (cost.amountExclEur || 0), 0) * 100) / 100,
        costs: [...costs].sort((left, right) => right.date.localeCompare(left.date) || (right.id ?? 0) - (left.id ?? 0)),
      }));
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.costs.set(await this.finance.costs());
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kosten laden mislukt'), 'err');
    } finally {
      this.loading.set(false);
    }
  }

  /** Who, which invoice and which channel, on one line. */
  meta(cost: CompanyCost): string {
    return [cost.party, cost.reference, cost.salesChannel ? channelLabel(cost.salesChannel) : null]
      .filter((part): part is string => !!part).join(' · ') || '—';
  }

  applyPreset(id: PresetId): void {
    const preset = PRESETS.find((row) => row.id === id);
    if (!preset) return;
    this.presetId.set(id);
    this.from.set(preset.from);
    this.to.set(preset.to);
  }

  setRange(from: string, to: string): void {
    this.from.set(from);
    this.to.set(to);
    const match = PRESETS.find((preset) => preset.from === from && preset.to === to);
    this.presetId.set(match?.id ?? 'all');
    if (!match) this.presetId.set('all' as PresetId);
  }

  open(cost: CompanyCost | null): void {
    this.draft.set(cost ? { ...cost } : blank());
    this.customCategory.set(false);
    this.editing.set(true);
  }

  patch(changes: Partial<CompanyCost>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
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

  async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    try {
      const draft = this.draft();
      const body: CompanyCost = { ...draft, party: draft.party || null, reference: draft.reference || null, notes: draft.notes || null };
      const saved = draft.id ? await this.finance.updateCost(draft.id, body) : await this.finance.createCost(body);
      this.costs.update((rows) => draft.id ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]);
      this.ui.toast(draft.id ? 'Kost bewaard' : 'Kost geboekt', 'ok');
      this.editing.set(false);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  remove(): void {
    const draft = this.draft();
    if (!draft.id) return;
    this.ui.confirm({
      title: 'Kost verwijderen',
      message: `${draft.description} van ${draft.date} verdwijnt uit de boeken.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, async () => {
      try {
        await this.finance.deleteCost(draft.id!);
        this.costs.update((rows) => rows.filter((row) => row.id !== draft.id));
        this.editing.set(false);
        this.ui.toast('Kost verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      }
    });
  }
}
