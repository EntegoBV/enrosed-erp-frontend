import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SalesOrderView, SalesSplitCommitRequest, SalesSplitEligibility, SalesSplitLine, SalesSplitPreview, SalesSplitRequest, SalesSplitResult } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { EurPipe, NumPipe, WeekNlPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { WeekField } from '../../shared/week-field';
import { salesSplitBlockReason, salesSplitPreviewMatches, salesSplitRequest, type SalesSplitQuantities, type SalesSplitOverrides, type SalesSplitUnavailable } from './sales-split-state';
import { salesLineUnavailable, salesLineRequestedQuantity } from './sales-line-availability';

type SplitLane = 'current' | 'later';

@Component({
  selector: 'app-sales-split-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, FormsModule, AuthImage, WeekField, EurPipe, NumPipe, WeekNlPipe],
  template: `
    <app-sheet title="Order splitsen" [wide]="true" (closed)="close()">
      <div body class="split">
        <p class="split__intro"><b>{{ eligibility()?.sourceNumber || view().order.number }}</b><span>Verplaats producten naar de nalevering. Wat je verplaatst, gaat van de oorspronkelijke order af.</span></p>
        @if (dirty()) { <p class="split__notice" role="status">Sla eerst je wijzigingen op. Splitsen gebruikt de opgeslagen order.</p> }
        @if (error()) { <div class="split__error" role="alert">{{ error() }} @if (!eligibility() && !loading()) { <button type="button" class="btn btn--sm" [disabled]="dirty() || saving()" (click)="load()">Opnieuw laden</button> }</div> }
        @if (loading()) { <p class="split__loading" role="status">Producten en afspraken controleren…</p> }
        @if (eligibility(); as data) {
          @if (!data.allowed) { <p class="split__notice" role="status">{{ data.reason || 'Deze order kan niet worden gesplitst.' }}</p> }
          @else if (preview(); as review) {
            <div class="split__review-heading"><span class="split__eyebrow">Controleer de verdeling</span><h3>Controleer beide delen.</h3><p>Productprijzen en staffelkortingen blijven behouden. De bedragen hieronder verwerken je keuzes voor vracht en extra korting.</p></div>
            <div class="split__review">
              @for (lane of lanes; track lane.key) {
                @let part = lane.key === 'current' ? review.current : review.later;
                <section class="split__amounts" [class.split__amounts--later]="lane.key === 'later'">
                  <span class="split__eyebrow">{{ lane.key === 'current' ? 'Deel 1' : 'Deel 2 · wacht op voorraad' }}</span>
                  <h4>{{ lane.title }}</h4><p>{{ part.quantity | num }} actieve stuks @if (lane.key === 'later' && deliveryWeek()) { <span>· {{ deliveryWeek() | weekNl }}</span> }</p>
                  @if (part.unavailableQuantity) { <p class="split__notice">{{ part.unavailableQuantity | num }} stuks bewaard als tijdelijk niet beschikbaar. Niet meegerekend.</p> }
                  <dl><div><dt>Producten</dt><dd>{{ part.goodsEur | eur }}</dd></div><div><dt>Extra korting</dt><dd>{{ discount(lane.key) | num:2 }}%</dd></div><div><dt>Vracht</dt><dd>{{ part.freightEur | eur }}</dd></div><div><dt>Handling</dt><dd>{{ part.handlingEur | eur }}</dd></div><div><dt>Extra regels</dt><dd>{{ part.extraLinesEur | eur }}</dd></div><div><dt>Excl. btw</dt><dd>{{ part.totalExclVatEur | eur }}</dd></div><div><dt>Btw</dt><dd>{{ part.vatEur | eur }}</dd></div><div class="split__amount-total"><dt>Incl. btw</dt><dd>{{ part.totalInclVatEur | eur }}</dd></div></dl>
                </section>
              }
            </div>
            <p class="split__conserved"><span>Samen · incl. btw</span><b>{{ review.current.totalInclVatEur + review.later.totalInclVatEur | eur }}</b></p>
            <div class="split__difference"><span>Oorspronkelijk incl. btw <b>{{ review.original.totalInclVatEur | eur }}</b></span><span>Verschil excl. btw <b>{{ review.deltaExclVatEur | eur }}</b></span><span>Verschil incl. btw <b>{{ review.deltaInclVatEur | eur }}</b></span></div>
            @if (review.excludedQuantity) { <p class="split__notice">{{ review.excludedQuantity | num }} eerder bestelde stuks zijn tijdelijk op 0 gezet. Ze blijven zichtbaar op de oorspronkelijke order.</p> }
            @for (warning of review.warnings; track $index) { <p class="split__notice">{{ warning }}</p> }
            <p class="split__hint">Beide delen blijven concepten. Splitsen verstuurt geen document en boekt geen voorraad uit.</p>
          } @else {
            <p class="split__drag-hint">Sleep een product naar het andere deel, of gebruik de knoppen op de kaart.</p>
            <div class="split__lanes">
              @for (lane of lanes; track lane.key) {
                <section class="split__lane" [class.split__lane--later]="lane.key === 'later'" [class.split__lane--over]="dragOver() === lane.key" [attr.data-split-lane]="lane.key" (dragover)="allowDrop($event, lane.key)" (dragleave)="leaveDrop($event)" (drop)="drop($event, lane.key)">
                  <div class="split__lane-head"><span class="split__eyebrow">{{ lane.key === 'current' ? 'Deel 1' : 'Deel 2 · wacht op voorraad' }}</span><h3>{{ lane.title }}</h3><p><b>{{ laneQuantity(lane.key) | num }}</b> stuks</p></div>
                  <div class="split__cards">
                    @for (line of laneLines(lane.key); track line.lineId) {
                      <article class="split__card" [attr.data-split-line]="line.lineId" [draggable]="desktopDrag && !locked()" (dragstart)="startDrag($event, line)" (dragend)="endDrag()">
                        <div class="split__product">@if (photo(line.productId); as url) { <img [appAuthSrc]="url" alt="" /> }<div><b>{{ line.description }}</b>@if (sku(line.productId); as code) { <small>{{ code }}</small> }<small>Besteld: {{ line.quantity | num }} stuks @if (line.piecesPerCarton) { · {{ line.piecesPerCarton | num }} per doos }</small></div></div>
                        <div class="split__allocation"><span>In dit deel</span><b>{{ lane.key === 'current' ? remaining(line) : laterQuantity(line) | num }} stuks</b></div>
                        <div class="split__quantity"><label [for]="'split-' + lane.key + '-' + line.lineId">Later leveren</label><div class="split__stepper"><button type="button" [disabled]="locked() || laterQuantity(line) <= 0" [attr.aria-label]="'Minder later leveren: ' + line.description" (click)="step(line, -1)">−</button><input class="input" type="number" inputmode="numeric" min="0" [max]="line.quantity" [step]="line.piecesPerCarton || 1" [id]="'split-' + lane.key + '-' + line.lineId" [ngModel]="quantities()[line.lineId] ?? 0" [attr.aria-invalid]="quantityErrors()[line.lineId] ? 'true' : null" [attr.aria-describedby]="quantityErrors()[line.lineId] ? 'split-error-' + lane.key + '-' + line.lineId : null" [disabled]="locked()" (ngModelChange)="setQuantity(line, $event)" /><button type="button" [disabled]="locked() || laterQuantity(line) >= line.quantity" [attr.aria-label]="'Meer later leveren: ' + line.description" (click)="step(line, 1)">+</button></div></div>
                        @if (quantityErrors()[line.lineId]; as fieldError) { <p class="split__field-error" [id]="'split-error-' + lane.key + '-' + line.lineId">{{ fieldError }}</p> }
                        <button class="split__move" type="button" [disabled]="locked()" (click)="move(line, lane.key === 'current' ? 'later' : 'current')">{{ lane.key === 'current' ? 'Alles later' : 'Alles terug' }} <span aria-hidden="true">{{ lane.key === 'current' ? '→' : '←' }}</span></button>
                        <button class="split__pause" type="button" [disabled]="locked()" (click)="toggleUnavailable(line)">Tijdelijk niet beschikbaar</button>
                      </article>
                    } @empty { <div class="split__empty"><b>{{ lane.key === 'later' ? 'Wat komt later?' : 'Dit deel is leeg' }}</b><span>{{ lane.key === 'later' ? 'Verplaats producten of vul een aantal in bij Later leveren.' : 'Laat ook producten op de oorspronkelijke order staan.' }}</span></div> }
                  </div>
                  <fieldset class="split__pricing" [disabled]="locked()"><legend>Vracht en korting</legend><label [for]="'split-' + lane.key + '-freight'">Vracht excl. btw (€) @if (freightRequired()) { · verplicht }</label><input class="input" type="number" inputmode="decimal" min="0" step="0.01" [id]="'split-' + lane.key + '-freight'" [required]="freightRequired()" [placeholder]="freightRequired() ? 'Vul een bedrag in' : lane.key === 'current' ? 'Bestaand vrachtbedrag' : '0,00'" [ngModel]="freight(lane.key)" (ngModelChange)="setOverride(lane.key, 'FreightEur', $event)" /><label [for]="'split-' + lane.key + '-discount'">Extra korting (%)</label><input class="input" type="number" inputmode="decimal" min="0" max="100" step="0.01" [id]="'split-' + lane.key + '-discount'" [placeholder]="(view().order.extraDiscountPct || 0) + '% behouden'" [ngModel]="extraDiscount(lane.key)" (ngModelChange)="setOverride(lane.key, 'ExtraDiscountPct', $event)" /><small>@if (freightRequired()) { De vracht was nog niet bepaald. Vul voor beide delen een bedrag in, ook bij € 0,00. Laat extra korting leeg om die te behouden. } @else { Leeg = behouden. } De productprijzen en staffelkortingen blijven vast.</small></fieldset>
                </section>
              }
            </div>
            @if (unavailableLines().length) {
              <section class="split__unavailable" aria-label="Tijdelijk niet beschikbare producten"><header><span class="split__eyebrow">Blijft zichtbaar op de oorspronkelijke order</span><h3>Tijdelijk niet beschikbaar</h3><p>Deze producten staan op 0 en tellen niet mee in de bedragen of levering.</p></header>
                @for (line of unavailableLines(); track line.lineId) {
                  <article class="split__card split__card--unavailable" [attr.data-split-unavailable]="line.lineId"><div class="split__product">@if (photo(line.productId); as url) { <img [appAuthSrc]="url" alt="" /> }<div><b>{{ line.description }}</b><small>0 stuks · niet meegerekend@if (requestedQuantity(line); as requested) { · {{ requested | num }} stuks bewaard }</small></div></div>
                    @if (wasUnavailable(line)) { <p class="split__hint">Dit product stond al op 0. Herstel het eerst in de oorspronkelijke order als je het wilt verdelen.</p> }
                    @else { <button class="split__move" type="button" [disabled]="locked()" (click)="toggleUnavailable(line)">Terug in de verdeling</button> }
                  </article>
                }
              </section>
            }
            <fieldset class="split__week" [disabled]="locked()"><legend>Verwachte leverweek nalevering <span>optioneel</span></legend><app-week-field [value]="deliveryWeek()" (valueChange)="setWeek($event)" /></fieldset>
            <p class="split__hint">{{ laneQuantity('current') + laneQuantity('later') | num }} actieve stuks verdeeld.@if (newlyUnavailableQuantity()) { {{ newlyUnavailableQuantity() | num }} stuks tijdelijk op 0. } Je controleert de bedragen in de volgende stap.</p>
          }
        }
      </div>
      <div foot class="split__actions">
        <button class="btn" type="button" [disabled]="saving()" (click)="preview() && !uncertain() ? edit() : close()">{{ preview() && !uncertain() ? 'Verdeling aanpassen' : 'Sluiten' }}</button>
        @if (preview()) { <button class="btn btn--primary" type="button" [disabled]="saving() || dirty() || externalBusy()" (click)="confirm()">{{ saving() ? 'Splitsen…' : uncertain() ? 'Opnieuw proberen' : 'Order splitsen' }}</button> }
        @else { <button class="btn btn--primary" type="button" [disabled]="locked() || !eligibility()?.allowed || dirty()" (click)="check()">{{ checking() ? 'Controleren…' : 'Verdeling controleren' }}</button> }
      </div>
    </app-sheet>
  `,
  styles: `
    .split__pause{width:100%;min-height:42px;padding:9px;border:0;background:transparent;color:var(--muted);font:inherit;font-size:11px}.split__pause:hover{color:var(--ink)}.split__unavailable{margin-top:16px;padding:16px;border:1px dashed var(--line);border-radius:18px;background:var(--surface-2);display:grid;gap:10px}.split__unavailable h3{font-size:16px;margin:6px 0}.split__unavailable header>p{font-size:12px;line-height:1.6;color:var(--muted)}.split__card--unavailable{border-style:dashed}.split__card--unavailable img{opacity:.65}
    :host{display:contents}.split{min-width:0}.split__intro{display:grid;gap:7px;margin:0 0 20px;line-height:1.6}.split__intro>b{font-size:13px;overflow-wrap:anywhere}.split__intro>span,.split__hint,.split__drag-hint{font-size:12px;color:var(--muted);line-height:1.7}.split__lanes,.split__review{display:grid;grid-template-columns:1fr 1fr;gap:14px}.split__lane{min-width:0;padding:14px;border:1px solid var(--line);border-radius:18px;background:var(--surface-2);transition:background .16s,border-color .16s}.split__lane--later{background:color-mix(in srgb,var(--accent) 5%,var(--surface));border-color:color-mix(in srgb,var(--accent) 20%,var(--line))}.split__lane--over{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,var(--surface))}.split__lane-head{margin:0 0 14px}.split__eyebrow{display:block;font-size:9px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--muted)}.split h3{font-size:18px;line-height:1.3;margin:6px 0}.split__lane-head>p{font-size:12px;margin:7px 0 0;color:var(--muted)}.split__lane-head>p>b{color:var(--ink);font-size:17px;font-variant-numeric:tabular-nums}.split__cards{display:grid;gap:10px}.split__card{animation:split-card-enter .2s ease-out;min-width:0;border-radius:13px;border:1px solid var(--line);padding:12px;background:var(--surface);box-shadow:0 3px 14px #00000004}.split__product{display:flex;gap:10px;align-items:center}.split__product>img{width:46px;height:56px;flex:none;border-radius:8px;object-fit:contain;background:#fff}.split__product>div{min-width:0;display:grid;gap:4px}.split__product b{font-size:12px;line-height:1.45;overflow-wrap:anywhere}.split__product small{font-size:9px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.split__allocation{display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:12px 0;color:var(--muted)}.split__allocation>b{color:var(--ink);font-variant-numeric:tabular-nums}.split__quantity{display:flex;align-items:center;gap:9px;justify-content:space-between}.split__quantity>label{font-size:11px;color:var(--muted)}.split__stepper{display:flex;align-items:center;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface)}.split__stepper>button{border:0;background:transparent;color:var(--ink);min-height:42px;width:34px;cursor:pointer;font-size:18px}.split__stepper>button:disabled{opacity:.35;cursor:default}.split__stepper>input{width:58px;min-width:0;border:0;border-inline:1px solid var(--line);border-radius:0;text-align:center;font-size:16px;padding:7px 2px;box-shadow:none;appearance:textfield;-moz-appearance:textfield}.split__stepper>input::-webkit-inner-spin-button,.split__stepper>input::-webkit-outer-spin-button{appearance:none;margin:0}.split__move{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:42px;margin-top:10px;border:0;border-radius:9px;padding:8px 11px;background:var(--surface-2);color:var(--accent);font:inherit;font-size:11px;font-weight:650;cursor:pointer}.split__move:disabled{opacity:.45;cursor:default}.split__empty{display:grid;gap:7px;place-content:center;min-height:180px;padding:24px 13px;text-align:center;color:var(--muted);border:1px dashed var(--line-strong);border-radius:12px}.split__empty>b{font-size:13px}.split__empty>span{font-size:11px;line-height:1.7}.split__week{margin:18px 0 0;padding:14px;border:1px solid var(--line);border-radius:12px;min-width:0}.split__week>legend{font-size:11px;font-weight:650;padding:0 5px}.split__week>legend>span{font-weight:400;color:var(--muted)}.split__hint{margin:15px 0 0}.split__notice{padding:12px 14px;margin:14px 0 0;border-radius:11px;background:var(--surface-2);font-size:12px;line-height:1.7}.split__error{padding:12px 14px;margin-bottom:16px;background:var(--surface-2);border-radius:11px;color:var(--danger);font-size:12px;line-height:1.7}.split__field-error{margin:8px 0 0;font-size:11px;line-height:1.6;color:var(--danger)}.split__error>.btn{margin-top:8px;display:block}.split__loading{font-size:13px;color:var(--muted)}.split__review-heading{margin-bottom:18px}.split__review-heading>p{font-size:12px;color:var(--muted);line-height:1.7}.split__amounts{border:1px solid var(--line);border-radius:15px;padding:16px;min-width:0}.split__amounts--later{background:var(--surface-2)}.split__amounts>h4{font-size:15px;margin:7px 0}.split__amounts>p{font-size:11px;color:var(--muted);line-height:1.7}.split__amounts dl{margin:18px 0 0;display:grid;gap:11px}.split__amounts dl>div{display:flex;justify-content:space-between;gap:12px;font-size:11px}.split__amounts dt{color:var(--muted)}.split__amounts dd{margin:0;font-variant-numeric:tabular-nums;text-align:right}.split__amounts .split__amount-total{border-top:1px solid var(--line);padding-top:13px;font-size:14px;font-weight:700}.split__amount-total dt{color:var(--ink)}.split__conserved{display:flex;justify-content:space-between;gap:12px;padding:16px 2px;border-bottom:1px solid var(--line);font-size:13px}.split__conserved>b{font-variant-numeric:tabular-nums}.split__pricing{display:grid;gap:8px;margin:14px 0 0;padding:12px;border:1px solid var(--line);border-radius:12px;min-width:0}.split__pricing>legend{font-size:10px;font-weight:650;padding:0 4px}.split__pricing>label{font-size:10px;color:var(--muted);margin-top:2px}.split__pricing>.input{width:100%;min-width:0;font-size:16px;min-height:42px}.split__pricing>small{font-size:10px;color:var(--muted);line-height:1.7}.split__difference{display:grid;gap:9px;margin:0 0 16px}.split__difference>span{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-size:11px}.split__difference b{font-variant-numeric:tabular-nums;color:var(--ink)}.split__actions{display:flex;justify-content:space-between;gap:12px;width:100%}.split__actions>.btn{min-height:44px}.split__drag-hint{display:none;margin:0 0 12px}@media(hover:hover) and (pointer:fine){.split__drag-hint{display:block}.split__card[draggable=true]{cursor:grab}.split__card[draggable=true]:active{cursor:grabbing}}@media(max-width:640px){.split__lanes,.split__review{grid-template-columns:1fr}.split__lane{padding:13px}.split__lane-head{display:grid;grid-template-columns:1fr auto;gap:5px 10px}.split__lane-head>.split__eyebrow{grid-column:1/-1}.split__lane-head>h3{margin:0;font-size:17px}.split__lane-head>p{margin:0}.split__empty{min-height:120px}.split__quantity>label,.split__move{font-size:12px}.split__stepper>button{width:40px}.split__stepper>input{width:65px}.split__actions{gap:9px}.split__actions>.btn{font-size:12px;padding-inline:12px}.split__actions>.btn--primary{flex:1}.split__amounts dl{gap:10px}.split__amounts dl>div{font-size:12px}}@keyframes split-card-enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.split__lane{transition:none}.split__card{animation:none}}
  `,
})
export class SalesSplitSheet implements OnDestroy {
  readonly view = input.required<SalesOrderView>();
  readonly dirty = input(false);
  readonly externalBusy = input(false);
  readonly saved = output<SalesSplitResult>();
  readonly closed = output<void>();
  readonly busyChange = output<boolean>();
  readonly eligibility = signal<SalesSplitEligibility | null>(null);
  readonly quantities = signal<SalesSplitQuantities>({});
  readonly unavailable = signal<SalesSplitUnavailable>({});
  readonly quantityErrors = signal<Record<number, string>>({});
  readonly overrides = signal<SalesSplitOverrides>({});
  readonly deliveryWeek = signal('');
  readonly preview = signal<SalesSplitPreview | null>(null);
  readonly loading = signal(false);
  readonly checking = signal(false);
  readonly saving = signal(false);
  readonly uncertain = signal(false);
  readonly error = signal('');
  readonly dragOver = signal<SplitLane | null>(null);
  readonly locked = computed(() => this.loading() || this.checking() || this.saving() || this.uncertain() || this.dirty() || this.externalBusy());
  readonly originalQuantity = computed(() => this.eligibility()?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0);
  readonly freightRequired = computed(() => this.view().order.freight === 'TE_BEPALEN');
  readonly desktopDrag = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  readonly lanes: { key: SplitLane; title: string }[] = [{ key: 'current', title: 'Oorspronkelijke order' }, { key: 'later', title: 'Nalevering' }];
  private readonly api = inject(SalesApi);
  private version = 0;
  private destroyed = false;
  private draggedLineId: number | null = null;
  private checkedRequest: SalesSplitRequest | null = null;
  private commitRequest: SalesSplitCommitRequest | null = null;
  private reloadAfterSave = false;

  constructor() { effect(() => { this.view(); untracked(() => { void this.load(); }); }); }

  async load(): Promise<void> {
    if (this.destroyed) return;
    if (this.saving()) {
      this.version++; this.reloadAfterSave = true; this.preview.set(null); this.eligibility.set(null); return;
    }
    const view = this.view(), id = view.order.id, version = ++this.version;
    this.eligibility.set(null); this.quantities.set({}); this.unavailable.set({}); this.quantityErrors.set({}); this.overrides.set({}); this.deliveryWeek.set(''); this.preview.set(null);
    this.checkedRequest = null; this.commitRequest = null; this.uncertain.set(false); this.error.set(''); this.checking.set(false);
    const blocked = salesSplitBlockReason(view);
    if (blocked) { this.error.set(blocked); this.loading.set(false); return; }
    if (this.dirty()) { this.loading.set(false); return; }
    this.loading.set(true);
    try {
      const eligibility = await this.api.splitEligibility(id);
      if (!this.current(version, id)) return;
      if (eligibility.sourceId !== id) throw new Error('De ordergegevens komen niet overeen. Laad opnieuw.');
      this.eligibility.set(eligibility);
      this.quantities.set(Object.fromEntries(eligibility.lines.map(line => [line.lineId, 0])));
    } catch (failure) { if (this.current(version, id)) this.error.set(messageOf(failure, failure instanceof Error ? failure.message : 'De order kon niet worden gecontroleerd.')); }
    finally { if (this.current(version, id)) this.loading.set(false); }
  }

  wasUnavailable(line: SalesSplitLine): boolean { return salesLineUnavailable(line); }
  isUnavailable(line: SalesSplitLine): boolean { return this.wasUnavailable(line) || this.unavailable()[line.lineId] === true; }
  requestedQuantity(line: SalesSplitLine): number | null { return this.wasUnavailable(line) ? salesLineRequestedQuantity(line) : line.quantity; }
  unavailableLines(): SalesSplitLine[] { return this.eligibility()?.lines.filter(line => this.isUnavailable(line)) ?? []; }
  newlyUnavailableQuantity(): number { return this.unavailableLines().reduce((sum, line) => sum + (this.wasUnavailable(line) ? 0 : line.quantity), 0); }
  toggleUnavailable(line: SalesSplitLine): void {
    if (this.locked() || this.wasUnavailable(line) || !this.eligibility()?.lines.some(item => item.lineId === line.lineId)) return;
    this.invalidatePreview(); this.unavailable.update(values => ({ ...values, [line.lineId]: !values[line.lineId] }));
    this.quantityErrors.update(errors => { const next = { ...errors }; delete next[line.lineId]; return next; });
  }
  laterQuantity(line: SalesSplitLine): number { if (this.isUnavailable(line)) return 0; const value = this.quantities()[line.lineId]; return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
  remaining(line: SalesSplitLine): number { return this.isUnavailable(line) ? 0 : Math.max(0, line.quantity - this.laterQuantity(line)); }
  laneLines(lane: SplitLane): SalesSplitLine[] { return this.eligibility()?.lines.filter(line => lane === 'current' ? this.remaining(line) > 0 : this.laterQuantity(line) > 0) ?? []; }
  laneQuantity(lane: SplitLane): number { return this.eligibility()?.lines.reduce((sum, line) => sum + (lane === 'current' ? this.remaining(line) : this.laterQuantity(line)), 0) ?? 0; }
  photo(productId: number): string | null { return this.view().priced.lines.find(line => line.productId === productId)?.photoUrl ?? null; }
  sku(productId: number): string | null { return this.view().priced.lines.find(line => line.productId === productId)?.sku ?? null; }

  setQuantity(line: SalesSplitLine, value: number | null): void {
    if (this.locked() || this.isUnavailable(line) || !this.eligibility()?.lines.some(item => item.lineId === line.lineId)) return;
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > line.quantity)) {
      this.quantityErrors.update(errors => ({ ...errors, [line.lineId]: `Vul voor ${line.description} een geheel aantal van 0 tot ${line.quantity} in.` }));
      this.invalidatePreview(); return;
    }
    this.quantityErrors.update(errors => { const next = { ...errors }; delete next[line.lineId]; return next; });
    this.invalidatePreview(); this.quantities.update(values => ({ ...values, [line.lineId]: value }));
  }
  step(line: SalesSplitLine, direction: -1 | 1): void { this.setQuantity(line, Math.max(0, Math.min(line.quantity, this.laterQuantity(line) + direction * (line.piecesPerCarton || 1)))); }
  move(line: SalesSplitLine, target: SplitLane): void { this.setQuantity(line, target === 'later' ? line.quantity : 0); }
  setWeek(value: string): void { if (!this.locked()) { this.invalidatePreview(); this.deliveryWeek.set(value); } }
  freight(lane: SplitLane): number | null { return this.overrides()[lane === 'current' ? 'currentFreightEur' : 'laterFreightEur'] ?? null; }
  extraDiscount(lane: SplitLane): number | null { return this.overrides()[lane === 'current' ? 'currentExtraDiscountPct' : 'laterExtraDiscountPct'] ?? null; }
  discount(lane: SplitLane): number { return this.extraDiscount(lane) ?? this.view().order.extraDiscountPct ?? 0; }
  setOverride(lane: SplitLane, kind: 'FreightEur' | 'ExtraDiscountPct', value: number | null): void {
    if (this.locked()) return;
    this.invalidatePreview(); this.overrides.update(values => ({ ...values, [lane + kind]: value }));
  }
  private invalidatePreview(): void { this.version++; this.preview.set(null); this.checkedRequest = null; this.commitRequest = null; this.error.set(Object.values(this.quantityErrors())[0] ?? ''); }

  startDrag(event: DragEvent, line: SalesSplitLine): void {
    const control = event.target instanceof Element ? event.target.closest('button,input,select,a,textarea') : null;
    if (!this.desktopDrag || this.locked() || control || !event.dataTransfer) { event.preventDefault(); return; }
    this.draggedLineId = line.lineId; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(line.lineId));
  }
  allowDrop(event: DragEvent, lane: SplitLane): void { if (this.draggedLineId !== null && !this.locked()) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; this.dragOver.set(lane); } }
  leaveDrop(event: DragEvent): void { if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) this.dragOver.set(null); }
  drop(event: DragEvent, lane: SplitLane): void { if (this.draggedLineId !== null && !this.locked()) { event.preventDefault(); const line = this.eligibility()?.lines.find(item => item.lineId === this.draggedLineId); if (line) this.move(line, lane); } this.endDrag(); }
  endDrag(): void { this.draggedLineId = null; this.dragOver.set(null); }

  async check(): Promise<void> {
    const eligibility = this.eligibility();
    if (!eligibility?.allowed || this.locked() || this.destroyed) return;
    const quantityError = Object.values(this.quantityErrors())[0];
    if (quantityError) { this.error.set(quantityError); return; }
    let request: SalesSplitRequest;
    try { request = salesSplitRequest(eligibility, this.quantities(), this.deliveryWeek(), this.overrides(), this.freightRequired(), this.unavailable()); }
    catch (failure) { this.error.set(failure instanceof Error ? failure.message : 'Controleer de aantallen.'); return; }
    const version = ++this.version, id = eligibility.sourceId;
    this.checking.set(true); this.error.set(''); this.preview.set(null); this.commitRequest = null;
    try {
      const preview = await this.api.previewSplit(id, request);
      if (!this.current(version, id) || this.dirty()) return;
      if (!salesSplitPreviewMatches(preview, eligibility, request)) throw new Error('De controle komt niet overeen met de aantallen of het oorspronkelijke bedrag. Controleer opnieuw.');
      this.checkedRequest = request; this.preview.set(preview);
    } catch (failure) { if (this.current(version, id)) this.error.set(messageOf(failure, failure instanceof Error ? failure.message : 'De verdeling kon niet worden gecontroleerd.')); }
    finally { if (this.current(version, id)) this.checking.set(false); }
  }

  edit(): void { if (!this.saving() && !this.uncertain()) this.invalidatePreview(); }

  async confirm(): Promise<void> {
    const preview = this.preview(), eligibility = this.eligibility();
    if (!preview || !eligibility?.allowed || !this.checkedRequest || this.saving() || this.checking() || this.dirty() || this.externalBusy() || this.destroyed || Object.keys(this.quantityErrors()).length) return;
    if (!salesSplitPreviewMatches(preview, eligibility, this.checkedRequest)) return;
    const id = eligibility.sourceId, version = this.version;
    if (this.view().order.id !== id) return;
    this.commitRequest ??= { ...this.checkedRequest, previewToken: preview.previewToken, requestId: crypto.randomUUID() };
    this.saving.set(true); this.busyChange.emit(true); this.error.set('');
    try {
      const result = await this.api.splitOrder(id, this.commitRequest);
      if (!this.current(version, id)) return;
      if (result.current.order.id !== id || result.later.order.id === id || !result.groupId) throw new Error('Het resultaat kon niet worden bevestigd. Probeer dezelfde aanvraag opnieuw.');
      this.uncertain.set(false); this.saved.emit(result);
    } catch (failure) {
      if (this.current(version, id)) {
        const status = (failure as { status?: number })?.status;
        const uncertain = !status || status >= 500;
        if (!uncertain) this.invalidatePreview();
        this.uncertain.set(uncertain);
        this.error.set(uncertain ? 'Het resultaat kon niet worden bevestigd. Opnieuw proberen controleert dezelfde aanvraag en maakt geen dubbele splitsing.' : messageOf(failure, 'Splitsen is niet gelukt. Controleer de verdeling opnieuw.'));
      }
    } finally {
      if (!this.destroyed) {
        this.saving.set(false); this.busyChange.emit(false);
        if (this.reloadAfterSave) { this.reloadAfterSave = false; await this.load(); }
      }
    }
  }

  close(): void { if (!this.saving()) { this.version++; this.closed.emit(); } }
  private current(version: number, id: number): boolean { return !this.destroyed && version === this.version && this.view().order.id === id; }
  ngOnDestroy(): void { this.destroyed = true; this.version++; }
}
