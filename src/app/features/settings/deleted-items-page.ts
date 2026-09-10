import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DeletedItemsApi, type DeletedItemDetail, type DeletedItemSummary, type DeletedItemType } from '../../core/api/deleted-items-api';
import { messageOf } from '../../core/api/errors';
import { saveBlob } from '../../core/api/download';
import { WorkQueue } from '../../core/api/work-queue';
import { PageHeader } from '../../shared/page-header';
import { DateTimeNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import { DELETED_ITEM_TYPES, deletedAttachmentFilename, deletedItemLabel, deletedItemStatus, filterDeletedItems, restoredItemRoute } from './deleted-items-state';

@Component({
  selector: 'app-deleted-items-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, RouterLink, Sheet, DateTimeNlPipe, EurPipe, NumPipe],
  template: `
    <app-page-header title="Verwijderde items" subtitle="Instellingen · Beheer" [showBack]="true" backTo="/settings" [showBell]="false" />
    <main class="content deleted-page">
      <a class="deleted-back" routerLink="/settings">‹ Instellingen</a>
      <section class="deleted-intro">
        <div><h2>Tijdelijk verwijderd</h2><p>Bekijk een document en herstel het zolang de hersteltermijn loopt.</p></div>
        @if (retentionDays() !== null) { <span class="deleted-retention">Hersteltermijn: {{ retentionDays() | num }} dagen</span> }
      </section>
      @if (restored(); as result) {
        <div class="deleted-success" role="status"><div><b>{{ result.number }} hersteld</b><span>Het document is weer beschikbaar.</span></div>@if (result.route) { <a class="btn btn--sm" [routerLink]="result.route">Document openen</a> }</div>
      }
      <section class="card deleted-browser" aria-label="Verwijderde documenten">
        <div class="deleted-tools">
          <label class="deleted-search"><span class="sr-only">Zoeken op nummer, klant of leverancier</span><input class="input" type="search" placeholder="Nummer, klant of leverancier" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
          <button class="btn btn--sm" type="button" [disabled]="loading() || restoringId() !== null" (click)="load()">{{ loading() ? 'Laden…' : 'Vernieuwen' }}</button>
          <div class="deleted-filters" role="group" aria-label="Documenttype">
            @for (option of types; track option.value) { <button type="button" [attr.aria-pressed]="type() === option.value" [class.is-selected]="type() === option.value" (click)="type.set(option.value)">{{ option.label }}</button> }
          </div>
        </div>
        @if (listError()) { <div class="deleted-error" role="alert"><span>{{ listError() }}</span><button class="btn btn--sm" type="button" [disabled]="loading()" (click)="load()">Opnieuw laden</button></div> }
        <p class="deleted-count" role="status">{{ loading() ? 'Documenten laden…' : visible().length + ' van ' + items().length + ' documenten' }}</p>
        <div class="deleted-list">
          @for (item of visible(); track item.id) {
            <button class="deleted-row" type="button" [disabled]="restoringId() !== null" (click)="open(item)" [attr.aria-label]="label(item.type) + ' ' + item.number + ' bekijken'">
              <span class="deleted-identity"><small>{{ label(item.type) }} · {{ status(item.status) }}</small><b>{{ item.number }}</b><span>{{ item.partyName || 'Geen relatie vermeld' }}</span></span>
              <span class="deleted-dates"><span><small>Verwijderd</small><time [attr.datetime]="item.deletedAt">{{ item.deletedAt | dateTimeNl }}</time></span><span><small>Herstelbaar tot</small><time [attr.datetime]="item.expiresAt">{{ item.expiresAt | dateTimeNl }}</time></span></span>
              <span class="deleted-amount">@if (item.totalEur !== null) { <b>{{ item.totalEur | eur }}</b> }@if (!item.restoreAllowed) { <small>Herstellen niet beschikbaar</small> }</span><span class="deleted-chevron" aria-hidden="true">›</span>
            </button>
          } @empty {
            @if (!loading() && !listError()) { <div class="deleted-empty"><h3>{{ items().length ? 'Geen documenten gevonden' : 'Geen verwijderde items' }}</h3><p>{{ items().length ? 'Pas je zoekterm of het documenttype aan.' : 'Tijdelijk verwijderde facturen, offertes en inkooporders verschijnen hier.' }}</p></div> }
          }
        </div>
      </section>
    </main>
    @if (selected(); as item) {
      <app-sheet [title]="item.number" [wide]="true" (closed)="close()">
        <div body class="deleted-detail">
          <p class="deleted-readonly">{{ label(item.type) }} · Alleen lezen</p>
          @if (detailLoading()) { <p role="status">Document laden…</p> }
          @if (detailError()) { <div class="deleted-error" role="alert"><span>{{ detailError() }}</span><button class="btn btn--sm" type="button" [disabled]="restoringId() !== null || detailLoading()" (click)="open(item)">Opnieuw controleren</button></div> }
          @if (detail(); as data) {
            <dl class="deleted-facts">
              <div><dt>Relatie</dt><dd>{{ data.partyName || '—' }}</dd></div><div><dt>Status bij verwijderen</dt><dd>{{ status(data.status) }}</dd></div>
              <div><dt>Verwijderd op</dt><dd>{{ data.deletedAt | dateTimeNl }}@if (data.deletedBy) { <small>door {{ data.deletedBy }}</small> }</dd></div>
              <div><dt>Herstelbaar tot</dt><dd>{{ data.expiresAt | dateTimeNl }}</dd></div>
              @if (data.totalEur !== null) { <div><dt>Documentbedrag</dt><dd>{{ data.totalEur | eur }}</dd></div> }
              @for (field of data.fields; track $index) { <div><dt>{{ field.label }}</dt><dd>{{ field.value || '—' }}</dd></div> }
            </dl>
            @if (data.lines.length) {
              <section class="deleted-lines"><h3>Documentregels</h3>
                @for (line of data.lines; track $index) { <div class="deleted-line"><div><b>{{ line.description }}</b>@if (line.sku) { <small>{{ line.sku }}</small> }</div><div class="deleted-line__values">@if (line.quantity !== null) { <span>{{ line.quantity | num }} {{ line.unit }}</span> }@if (line.unitPriceEur !== null) { <small>{{ line.unitPriceEur | eur }} per {{ line.unit || 'eenheid' }}</small> }@if (line.totalEur !== null) { <b>{{ line.totalEur | eur }}</b> }</div></div> }
              </section>
            }
            @if (data.notes) { <section><h3>Notities</h3><p class="deleted-note">{{ data.notes }}</p></section> }
            @if (data.attachments.length) { <section><h3>Bijlagen</h3><ul class="deleted-attachments">@for (file of data.attachments; track file.id) { <li><span>{{ file.name }}</span>@if (file.url) { <button class="btn btn--sm" type="button" [disabled]="attachmentBusy()[file.id] || restoringId() !== null" [attr.aria-label]="file.name + ' downloaden'" (click)="downloadAttachment(file.id)">{{ attachmentBusy()[file.id] ? 'Downloaden…' : 'Downloaden' }}</button> }@if (attachmentErrors()[file.id]) { <small role="alert">{{ attachmentErrors()[file.id] }}</small> }</li> }</ul></section> }
            @if (!data.restoreAllowed) { <p class="deleted-block" role="status">{{ data.blockReason || 'Dit document kan momenteel niet worden hersteld.' }}</p> }
          }
        </div>
        <div foot class="deleted-detail__actions"><button class="btn" type="button" [disabled]="restoringId() !== null" (click)="close()">Sluiten</button><span></span><button class="btn btn--primary" type="button" [disabled]="!detail()?.restoreAllowed || detailLoading() || restoringId() !== null" (click)="confirmRestore()">{{ restoringId() !== null ? 'Herstellen…' : 'Document herstellen' }}</button></div>
      </app-sheet>
    }
  `,
  styles: `
    .deleted-attachments li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0}.deleted-attachments li>span{flex:1;min-width:120px;overflow-wrap:anywhere}.deleted-attachments .btn{min-height:44px}.deleted-attachments li>small{flex-basis:100%;color:var(--danger);font-size:11px;line-height:1.6}
    .deleted-page{max-width:1180px;padding-bottom:32px}.deleted-back{display:inline-block;margin-bottom:16px;color:var(--muted);font-size:12px}.deleted-intro{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 0 20px}.deleted-intro h2{font-size:22px;margin:0 0 7px}.deleted-intro p{margin:0;font-size:13px;color:var(--muted);line-height:1.6}.deleted-retention{border:1px solid var(--line);border-radius:99px;padding:8px 12px;font-size:11px;white-space:nowrap;color:var(--muted)}.deleted-tools{display:flex;flex-wrap:wrap;gap:10px;padding:16px 16px 8px}.deleted-search{flex:1;min-width:180px}.deleted-search input{width:100%;min-height:44px}.deleted-tools>.btn{min-height:44px}.deleted-filters{display:flex;flex:1 1 100%;gap:5px;flex-wrap:wrap}.deleted-filters button{border:1px solid transparent;background:var(--surface-2);border-radius:9px;padding:9px 12px;min-height:40px;font:inherit;font-size:12px;color:var(--muted);cursor:pointer}.deleted-filters .is-selected{background:var(--rose-soft);color:var(--rose-dark);border-color:var(--rose-line)}button:focus-visible,a:focus-visible{outline:2px solid var(--rose);outline-offset:3px}.deleted-count{margin:4px 16px 12px;font-size:11px;color:var(--muted)}.deleted-list{border-top:1px solid var(--line)}.deleted-row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(100px,.55fr) 12px;align-items:center;gap:18px;padding:18px;width:100%;background:transparent;border:0;border-bottom:1px solid var(--line);font:inherit;text-align:left;cursor:pointer;color:var(--ink)}.deleted-row:last-child{border-bottom:0}.deleted-row:hover{background:var(--surface-2)}.deleted-identity{display:grid;gap:5px;min-width:0;overflow-wrap:anywhere}.deleted-identity>b{font-size:14px}.deleted-identity>span{font-size:12px}.deleted-identity>small,.deleted-dates small,.deleted-amount>small{font-size:10px;color:var(--muted);line-height:1.5}.deleted-dates{display:flex;gap:22px}.deleted-dates>span{display:grid;gap:5px}.deleted-dates time{font-size:11px;line-height:1.5}.deleted-amount{display:grid;gap:6px;text-align:right}.deleted-amount>b{font-size:14px;white-space:nowrap}.deleted-chevron{font-size:20px;color:var(--muted)}.deleted-empty{padding:38px 20px;text-align:center}.deleted-empty h3{font-size:17px;margin:0 0 10px}.deleted-empty p{font-size:13px;color:var(--muted);line-height:1.6;margin:0}.deleted-success,.deleted-error{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:14px;border-radius:12px;line-height:1.5;font-size:12px}.deleted-success{background:var(--rose-soft);border:1px solid var(--rose-line);margin-bottom:14px}.deleted-success>div{display:grid;gap:3px}.deleted-success b{overflow-wrap:anywhere}.deleted-error{background:var(--surface-2);color:var(--danger);margin:12px 16px}.deleted-error>span{flex:1;min-width:0;overflow-wrap:anywhere}.deleted-detail{display:grid;gap:18px}.deleted-detail h3{margin:0 0 10px;font-size:13px}.deleted-readonly{margin:0;font-size:11px;color:var(--muted)}.deleted-facts{display:grid;grid-template-columns:1fr 1fr;gap:15px 24px;margin:0}.deleted-facts>div{min-width:0}.deleted-facts dt{font-size:10px;color:var(--muted);margin-bottom:5px}.deleted-facts dd{margin:0;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.deleted-facts dd small{display:block;font-size:10px;color:var(--muted)}.deleted-line{display:flex;gap:16px;justify-content:space-between;padding:12px 0;border-top:1px solid var(--line);font-size:12px}.deleted-line>div{display:grid;gap:5px;min-width:0;overflow-wrap:anywhere}.deleted-line small{font-size:10px;color:var(--muted)}.deleted-line__values{text-align:right;flex-shrink:0;max-width:45%}.deleted-note{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7;margin:0;padding:12px;background:var(--surface-2);border-radius:9px}.deleted-attachments{margin:0;padding-left:18px;font-size:12px;line-height:1.8;overflow-wrap:anywhere}.deleted-block{padding:12px;border:1px solid var(--line);border-radius:9px;font-size:12px;line-height:1.6;color:var(--muted)}.deleted-detail__actions{display:flex;gap:10px;width:100%}.deleted-detail__actions>span{flex:1}.deleted-detail__actions>.btn{min-height:44px}.deleted-detail .deleted-error{margin:0}@media(max-width:679px){.deleted-page{padding-bottom:96px}.deleted-intro{align-items:flex-start;flex-direction:column;gap:10px}.deleted-intro h2{font-size:21px}.deleted-tools{padding:12px 12px 8px;gap:8px}.deleted-search{min-width:0}.deleted-search input{font-size:16px}.deleted-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px}.deleted-filters button{padding:8px 4px;font-size:10px}.deleted-row{grid-template-columns:minmax(0,1fr) auto 10px;gap:12px;padding:16px 14px}.deleted-identity{grid-column:1}.deleted-dates{grid-column:1/3;grid-row:2;justify-content:space-between;gap:12px}.deleted-amount{grid-column:2;grid-row:1;max-width:125px}.deleted-chevron{grid-column:3;grid-row:1/3}.deleted-amount>b{font-size:13px}.deleted-dates time{font-size:10px}.deleted-success,.deleted-error{flex-wrap:wrap}.deleted-facts{gap:14px 18px}.deleted-detail__actions>.btn--primary{flex:1}.deleted-detail__actions>span{display:none}}
  `,
})
export class DeletedItemsPage implements OnDestroy {
  readonly types = DELETED_ITEM_TYPES;
  readonly label = deletedItemLabel;
  readonly status = deletedItemStatus;
  readonly items = signal<DeletedItemSummary[]>([]);
  readonly query = signal('');
  readonly type = signal<DeletedItemType | ''>('');
  readonly visible = computed(() => filterDeletedItems(this.items(), this.query(), this.type()));
  readonly retentionDays = signal<number | null>(null);
  readonly loading = signal(false);
  readonly listError = signal('');
  readonly selected = signal<DeletedItemSummary | null>(null);
  readonly detail = signal<DeletedItemDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');
  readonly attachmentBusy = signal<Record<number, boolean>>({});
  readonly attachmentErrors = signal<Record<number, string>>({});
  readonly restoringId = signal<number | null>(null);
  readonly restored = signal<{ number: string; route: string | null } | null>(null);
  private readonly api = inject(DeletedItemsApi);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);
  private listVersion = 0;
  private detailVersion = 0;
  private destroyed = false;

  constructor() { void this.load(); }

  async load(): Promise<void> {
    if (this.loading() || this.restoringId() !== null) return;
    const version = ++this.listVersion;
    this.loading.set(true); this.listError.set('');
    try {
      const result = await this.api.list();
      if (this.destroyed || version !== this.listVersion) return;
      this.items.set(result.items);
      this.retentionDays.set(Number.isFinite(result.retentionDays) && result.retentionDays > 0 ? result.retentionDays : null);
    } catch (failure) {
      if (!this.destroyed && version === this.listVersion) this.listError.set(messageOf(failure, 'Verwijderde items konden niet worden geladen.'));
    } finally { if (!this.destroyed && version === this.listVersion) this.loading.set(false); }
  }

  async open(item: DeletedItemSummary): Promise<void> {
    if (this.restoringId() !== null) return;
    const version = ++this.detailVersion;
    this.selected.set(item); this.detail.set(null); this.detailError.set(''); this.detailLoading.set(true);
    this.attachmentBusy.set({}); this.attachmentErrors.set({});
    try {
      const detail = await this.api.detail(item.id);
      if (this.destroyed || version !== this.detailVersion) return;
      this.detail.set(detail);
      this.items.update(items => items.map(row => row.id === detail.id ? detail : row));
    } catch (failure) {
      if (!this.destroyed && version === this.detailVersion) this.detailError.set(messageOf(failure, 'Het verwijderde document kon niet worden geladen.'));
    } finally { if (!this.destroyed && version === this.detailVersion) this.detailLoading.set(false); }
  }

  close(): void {
    if (this.restoringId() !== null) return;
    this.detailVersion++; this.selected.set(null); this.detail.set(null); this.detailError.set(''); this.detailLoading.set(false);
    this.attachmentBusy.set({}); this.attachmentErrors.set({});
  }

  async downloadAttachment(attachmentId: number): Promise<void> {
    const item = this.detail();
    const file = item?.attachments.find(attachment => attachment.id === attachmentId);
    if (!item || !file?.url || !Number.isSafeInteger(attachmentId) || attachmentId <= 0
      || this.attachmentBusy()[attachmentId] || this.restoringId() !== null) return;
    const version = this.detailVersion;
    this.attachmentBusy.update(busy => ({ ...busy, [attachmentId]: true }));
    this.attachmentErrors.update(errors => ({ ...errors, [attachmentId]: '' }));
    try {
      /* Only authenticated IDs define the endpoint; never navigate a URL from document data. */
      const blob = await this.api.attachment(item.id, attachmentId);
      if (!this.destroyed && version === this.detailVersion) saveBlob(blob, deletedAttachmentFilename(file.name));
    } catch (failure) {
      if (!this.destroyed && version === this.detailVersion) this.attachmentErrors.update(errors => ({
        ...errors, [attachmentId]: messageOf(failure, 'Downloaden is niet gelukt. Probeer opnieuw.'),
      }));
    } finally {
      if (!this.destroyed && version === this.detailVersion) this.attachmentBusy.update(busy => ({ ...busy, [attachmentId]: false }));
    }
  }

  confirmRestore(): void {
    const item = this.detail();
    if (!item?.restoreAllowed || this.detailLoading() || this.restoringId() !== null || this.ui.confirmRequest() !== null) return;
    this.ui.confirm({ title: `${this.label(item.type)} herstellen`,
      message: `<b>${escapeHtml(item.number)}</b> van <b>${escapeHtml(item.partyName || 'onbekende relatie')}</b> herstellen?<br><br>Het document wordt weer beschikbaar. Er wordt niets verstuurd.`,
      confirmLabel: 'Herstellen' }, () => { void this.restore(item); });
  }

  private async restore(item: DeletedItemDetail): Promise<void> {
    if (this.destroyed || this.detail()?.id !== item.id || !this.detail()?.restoreAllowed || this.restoringId() !== null) return;
    /* A refresh started before restoring must not reinsert the removed row. */
    this.listVersion++; this.loading.set(false);
    this.restoringId.set(item.id); this.detailError.set('');
    try {
      const result = await this.api.restore(item.id);
      if (this.destroyed) return;
      this.items.update(items => items.filter(row => row.id !== item.id));
      this.restored.set({ number: item.number, route: restoredItemRoute(item, result) });
      this.detailVersion++; this.selected.set(null); this.detail.set(null);
      this.ui.toast(`${item.number} hersteld`);
      void this.work.refresh(true);
    } catch (failure) {
      if (!this.destroyed) this.detailError.set(messageOf(failure, 'Herstellen is niet gelukt. Controleer het document en probeer opnieuw.'));
    } finally { if (!this.destroyed) this.restoringId.set(null); }
  }

  ngOnDestroy(): void { this.destroyed = true; this.listVersion++; this.detailVersion++; }
}
