import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DeletedItemsApi, type DeletedItemDetail, type DeletedItemSummary, type DeletedItemType } from '../../core/api/deleted-items-api';
import { messageOf } from '../../core/api/errors';
import { saveBlob } from '../../core/api/download';
import { WorkQueue } from '../../core/api/work-queue';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { DateTimeNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import { containerName } from '../purchasing/container-name';
import {
  DELETED_ITEM_TYPES, countDeletedByType, daysLeft, daysLeftText, deletedAttachmentFilename, deletedFieldLabel, deletedFieldValue,
  deletedItemLabel, deletedItemStatus, filterDeletedItems, perUnit, restoredItemRoute,
} from './deleted-items-state';

/**
 * Verwijderde items: what was deleted in the last 90 days, as a kit table on
 * the desk and an inset list on the phone, with counts per type, who deleted
 * it and how long it can still be restored. The detail sheet is read only
 * until "Document herstellen"; restoring never sends anything.
 */
@Component({
  selector: 'app-deleted-items-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, PageHeader, RouterLink, Sheet, Skeleton, DateTimeNlPipe, EurPipe, NumPipe],
  template: `
    <app-page-header title="Verwijderde items" [subtitle]="subtitle()" [showBell]="false">
      @if (desktop.active()) {
        <label class="wk-search">
          <app-icon name="search" [size]="16" />
          <input type="search" data-page-search placeholder="Zoek nummer of relatie" aria-label="Zoeken op nummer, klant of leverancier"
                 [value]="query()" (input)="query.set($any($event.target).value)" />
          <kbd class="wk-kbd" aria-hidden="true">/</kbd>
        </label>
        <button class="wk-btn wk-btn--icon" type="button" aria-label="Vernieuwen" title="Vernieuwen" [class.is-busy]="loading()"
                [disabled]="loading() || restoringId() !== null" (click)="load()"><app-icon name="refresh" [size]="16" /></button>
      } @else {
        <button class="btn btn--icon-mobile" type="button" aria-label="Vernieuwen" [disabled]="loading() || restoringId() !== null" (click)="load()"><app-icon name="refresh" [size]="18" /></button>
      }
    </app-page-header>
    <main class="content trash-page">
      @if (restored(); as result) {
        <div class="trash-success" role="status"><div><b>{{ result.number }} hersteld</b><span>Het document is weer beschikbaar.</span></div>@if (result.route) { <a class="btn btn--sm" [routerLink]="result.route">Document openen</a> }</div>
      }

      @if (desktop.active()) {
        <nav class="wk-subbar" aria-label="Documenttype">
          <div class="wk-chips trash-chips">
            @for (option of types; track option.value) {
              <button type="button" class="wk-chip" [class.is-on]="type() === option.value" [attr.aria-pressed]="type() === option.value"
                      (click)="type.set(option.value)">{{ option.label }} <span class="trash-n">{{ counts()[option.value] }}</span></button>
            }
          </div>
          <span class="wk-subbar__end" role="status">{{ loading() && !items().length ? 'Laden' : visible().length + ' van ' + items().length }}</span>
        </nav>
        @if (listError() && !items().length) {
          <app-load-error [message]="listError()" [busy]="loading()" (retry)="load()" />
        } @else {
          @if (listError()) { <div class="wk-banner wk-banner--danger wk-banner--inset" role="alert"><span class="wk-banner__text">{{ listError() }}</span>
            <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="loading()" (click)="load()">Opnieuw proberen</button></span></div> }
          <section class="wk-card trash" aria-label="Verwijderde documenten">
            <div class="wk-table">
              <div class="wk-thead" role="row">
                <span class="wk-th">Document</span><span class="wk-th">Relatie</span><span class="wk-th">Verwijderd</span>
                <span class="wk-th">Herstelbaar tot</span><span class="wk-th wk-th--num">Bedrag</span><span class="wk-th"></span>
              </div>
              @if (loading() && !items().length) {
                <app-skeleton kind="table" [rows]="6" />
              }
              <div class="trash-rows" (keydown)="rowKey($event)">
                @for (item of visible(); track item.id) {
                  <button class="wk-tr wk-tr--link trash-row" type="button" [animate.leave]="leaveClass(item)" [disabled]="restoringId() !== null"
                          [attr.aria-label]="label(item.type) + ' ' + item.number + ' bekijken'" (click)="open(item)">
                    <span class="wk-td"><b>{{ docName(item) }}</b>
                      <span class="wk-td__sub">{{ label(item.type) }} · {{ status(item.status) }}@if (docSub(item); as sub) { · {{ sub }} }</span>
                      @if (!item.restoreAllowed) {
                        <span class="wk-td__sub trash-why"><span class="wk-pill tone-warn">Niet herstelbaar</span>@if (item.blockReason) { {{ item.blockReason }} }</span>
                      }
                    </span>
                    <span class="wk-td wk-td--wrap trash-party" [attr.title]="item.partyName || null">{{ item.partyName || 'Geen relatie vermeld' }}</span>
                    <span class="wk-td"><time [attr.datetime]="item.deletedAt">{{ item.deletedAt | dateTimeNl }}</time>
                      @if (item.deletedBy) { <span class="wk-td__sub">door {{ item.deletedBy }}</span> }</span>
                    <span class="wk-td"><time [attr.datetime]="item.expiresAt">{{ dateOnly(item.expiresAt) }}</time>
                      @if (item.restoreAllowed) { <span class="wk-td__sub" [class.trash-soon]="left(item) <= 14">{{ leftText(item) }}</span> }
                      @else { <span class="wk-td__sub">niet herstelbaar</span> }</span>
                    <span class="wk-td wk-td--num trash-amount" [class.trash-amount--zero]="!item.totalEur">@if (item.totalEur !== null) { {{ item.totalEur | eur }} } @else { — }</span>
                    <span class="wk-td trash-chev"><app-icon name="chevron-right" [size]="14" /></span>
                  </button>
                }
              </div>
              @if (!loading() && !visible().length && !listError()) {
                <div class="wk-empty">
                  <div class="wk-empty__icon"><app-icon name="trash" [size]="22" /></div>
                  <h2 class="wk-empty__title">{{ items().length ? 'Geen documenten gevonden' : 'Geen verwijderde items' }}</h2>
                  <p class="wk-empty__text">{{ items().length ? 'Pas je zoekterm of het documenttype aan.' : 'Tijdelijk verwijderde facturen, creditnota’s, offertes en inkooporders blijven hier 90 dagen staan.' }}</p>
                </div>
              }
            </div>
          </section>
        }
      } @else {
        <div class="trash-phone">
          <label class="ios-search"><span class="ios-search__field"><app-icon name="search" [size]="16" />
            <input type="search" data-page-search placeholder="Nummer, klant of leverancier" aria-label="Zoeken op nummer, klant of leverancier"
                   [value]="query()" (input)="query.set($any($event.target).value)" /></span></label>
          <div class="ios-chips trash-phone__chips" role="group" aria-label="Documenttype">
            @for (option of types; track option.value) {
              <button type="button" class="ios-chip" [attr.aria-pressed]="type() === option.value" (click)="type.set(option.value)">{{ option.label }}
                <span class="ios-chip__badge">{{ counts()[option.value] }}</span></button>
            }
          </div>
          @if (listError() && !items().length) {
            <app-load-error [message]="listError()" [busy]="loading()" (retry)="load()" />
          } @else if (loading() && !items().length) {
            <app-skeleton kind="group" [rows]="6" />
          } @else if (!visible().length) {
            <div class="ios-empty">
              <div class="ios-empty__icon"><app-icon name="trash" [size]="26" /></div>
              <h2 class="ios-empty__title">{{ items().length ? 'Geen documenten gevonden' : 'Geen verwijderde items' }}</h2>
              <p class="ios-empty__text">{{ items().length ? 'Pas je zoekterm of het documenttype aan.' : 'Tijdelijk verwijderde facturen, creditnota’s, offertes en inkooporders blijven hier 90 dagen staan.' }}</p>
            </div>
          } @else {
            <div class="ios-group">
              @for (item of visible(); track item.id) {
                <button class="ios-cell" type="button" [animate.leave]="leaveClass(item)" [disabled]="restoringId() !== null" (click)="open(item)">
                  <span class="ios-cell__body">
                    <span class="ios-cell__title ios-cell__title--strong">{{ docName(item) }}</span>
                    <span class="ios-cell__sub trash-wrap">{{ label(item.type) }} · {{ status(item.status) }}@if (docSub(item); as sub) { · {{ sub }} }</span>
                    <span class="ios-cell__sub trash-wrap">{{ item.partyName || 'Geen relatie vermeld' }}</span>
                    <span class="ios-cell__sub">{{ shortDate(item.deletedAt) }}@if (item.deletedBy) { · {{ item.deletedBy }} } · {{ item.restoreAllowed ? leftText(item) : 'niet herstelbaar' }}</span>
                  </span>
                  <span class="ios-cell__trail"><span class="ios-cell__value" [class.trash-amount--zero]="!item.totalEur">@if (item.totalEur !== null) { {{ item.totalEur | eur }} }</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
            </div>
            <p class="ios-section__foot">{{ visible().length }} van {{ items().length }}@if (retentionDays()) { · hersteltermijn {{ retentionDays() }} dagen }</p>
          }
        </div>
      }
    </main>
    @if (selected(); as item) {
      <app-sheet [title]="docName(detail() ?? item)" [wide]="true" [variant]="desktop.active() ? 'default' : 'ios'" (closed)="close()">
        <div body class="deleted-detail">
          <p class="deleted-readonly">@if (docName(detail() ?? item) !== item.number) { {{ item.number }} · }{{ label(item.type) }} · Alleen lezen</p>
          @if (detailLoading()) { <app-skeleton kind="lines" [rows]="4" /> }
          @if (detailError()) { <div class="deleted-error" role="alert"><span>{{ detailError() }}</span><button class="btn btn--sm" type="button" [disabled]="restoringId() !== null || detailLoading()" (click)="open(item)">Opnieuw controleren</button></div> }
          @if (detail(); as data) {
            <dl class="wk-kv deleted-facts">
              <div><dt>Relatie</dt><dd>{{ data.partyName || '—' }}</dd></div><div><dt>Status bij verwijderen</dt><dd>{{ status(data.status) }}</dd></div>
              <div><dt>Verwijderd op</dt><dd>{{ data.deletedAt | dateTimeNl }}@if (data.deletedBy) { <small>door {{ data.deletedBy }}</small> }</dd></div>
              <div><dt>Herstelbaar tot</dt><dd>{{ data.expiresAt | dateTimeNl }} <small>{{ data.restoreAllowed ? leftText(data) : 'niet herstelbaar' }}</small></dd></div>
              @if (data.totalEur !== null) { <div><dt>Documentbedrag</dt><dd>{{ data.totalEur | eur }}</dd></div> }
              @for (field of data.fields; track $index) { <div><dt>{{ fieldLabel(field.label) }}</dt><dd>{{ fieldValue(field.label, field.value) }}</dd></div> }
            </dl>
            @if (data.lines.length) {
              <section class="deleted-lines"><h3>Documentregels</h3>
                @for (line of data.lines; track $index) { <div class="deleted-line"><div><b>{{ line.description }}</b>@if (line.sku) { <small>{{ line.sku }}</small> }</div><div class="deleted-line__values">@if (line.quantity !== null) { <span>{{ line.quantity | num }} {{ line.unit }}</span> }@if (line.unitPriceEur !== null) { <small>{{ line.unitPriceEur | eur }} per {{ per(line.unit) }}</small> }@if (line.totalEur !== null) { <b>{{ line.totalEur | eur }}</b> }</div></div> }
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
    .trash-page { max-width: 1240px; padding-bottom: 32px; }
    .trash { --wk-cols: minmax(0, 1.5fr) minmax(0, 1.3fr) 150px 170px 120px 28px; overflow: clip; }
    .trash-row { width: 100%; min-height: 56px; border-width: 0 0 1px; font: inherit; text-align: left; }
    .trash-row:last-child { border-bottom: 0; }
    .trash-row:hover:not(:disabled) { background: var(--surface-2); }
    .trash-row .wk-td b { font-size: 13.5px; font-weight: 650; }
    .trash-row .wk-td__sub .wk-pill { vertical-align: 1px; }
    .trash-party { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.35; }
    .trash-amount { font-weight: 650; }
    .trash-amount--zero { color: var(--muted); font-weight: 500; }
    .trash-soon { color: var(--warn); font-weight: 600; }
    .trash-chev { color: var(--muted-2); }
    .trash-chips { flex-wrap: nowrap; }
    .trash-n { color: var(--muted); font-weight: 650; }
    .wk-chip.is-on .trash-n { color: var(--rose-dark); }
    .trash-success { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; padding: 12px 14px;
      border: 1px solid var(--rose-line); border-radius: 12px; background: var(--rose-soft); font-size: 13px; line-height: 1.5; }
    .trash-success > div { display: grid; gap: 2px; }
    .trash-phone { --ios-inset: 0px; }
    .trash-phone .ios-search { margin-bottom: 8px; }
    .trash-phone__chips { margin: 0 -12px 8px; padding-inline: 12px; }
    .trash-why { white-space: normal; overflow-wrap: anywhere; }
    .trash-wrap { white-space: normal; overflow-wrap: anywhere; }
    .deleted-attachments li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0}.deleted-attachments li>span{flex:1;min-width:120px;overflow-wrap:anywhere}.deleted-attachments .btn{min-height:44px}.deleted-attachments li>small{flex-basis:100%;color:var(--danger);font-size:11px;line-height:1.6}
    .deleted-error{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:14px;border-radius:12px;line-height:1.5;font-size:12px;background:var(--surface-2);color:var(--danger)}.deleted-error>span{flex:1;min-width:0;overflow-wrap:anywhere}
    .deleted-detail{display:grid;gap:18px}.deleted-detail h3{margin:0 0 10px;font-size:13px}.deleted-readonly{margin:0;font-size:12px;color:var(--muted)}
    .deleted-facts{grid-template-columns:1fr 1fr;column-gap:24px}.deleted-facts>div{grid-template-columns:150px minmax(0,1fr)}.deleted-facts dd small{display:block;font-size:11px;font-weight:500;color:var(--muted)}
    .deleted-line{display:flex;gap:16px;justify-content:space-between;padding:12px 0;border-top:1px solid var(--line);font-size:12.5px}.deleted-line>div{display:grid;gap:5px;min-width:0;overflow-wrap:anywhere}.deleted-line small{font-size:11px;color:var(--muted)}.deleted-line__values{text-align:right;flex-shrink:0;max-width:45%}
    .deleted-note{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;line-height:1.7;margin:0;padding:12px;background:var(--surface-2);border-radius:9px}
    .deleted-attachments{margin:0;padding-left:18px;font-size:12.5px;line-height:1.8;overflow-wrap:anywhere}
    .deleted-block{padding:12px;border:1px solid var(--line);border-radius:9px;font-size:12.5px;line-height:1.6;color:var(--muted)}
    .deleted-detail__actions{display:flex;gap:10px;width:100%}.deleted-detail__actions>span{flex:1}.deleted-detail__actions>.btn{min-height:44px}
    @media (max-width: 1279px) { .trash { --wk-cols: minmax(0, 1.4fr) minmax(0, 1.2fr) 140px 130px 110px 20px; } }
    @media (max-width: 679px) {
      .deleted-facts{grid-template-columns:1fr}.deleted-facts>div{grid-template-columns:120px minmax(0,1fr)}
      .deleted-detail__actions>.btn--primary{flex:1}.deleted-detail__actions>span{display:none}
    }
  `,
})
export class DeletedItemsPage implements OnDestroy {
  readonly desktop = inject(DesktopViewport);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
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
  /** The row being restored: only it collapses when it leaves; a filter or search swaps rows at once. */
  readonly leavingId = signal<number | null>(null);
  private readonly api = inject(DeletedItemsApi);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);
  private listVersion = 0;
  private detailVersion = 0;
  private destroyed = false;

  readonly counts = computed(() => countDeletedByType(this.items()));
  /** "9 documenten · hersteltermijn 90 dagen". */
  readonly subtitle = computed(() => {
    const count = this.items().length;
    const documents = `${count} ${count === 1 ? 'document' : 'documenten'}`;
    const days = this.retentionDays();
    return days ? `${documents} · hersteltermijn ${days} dagen` : documents;
  });
  readonly fieldLabel = deletedFieldLabel;
  readonly fieldValue = deletedFieldValue;
  readonly per = perUnit;

  /** A purchase order by its container name once the snapshot carries it (detail "Naam"; the list after backend B1). */
  docName(item: DeletedItemSummary | DeletedItemDetail): string {
    if (item.type !== 'PURCHASE_ORDER') return item.number;
    const named = (item as { name?: string | null }).name
      ?? ('fields' in item ? item.fields.find((field) => field.label === 'Naam')?.value : null);
    return containerName({ alias: named ?? null, number: item.number });
  }

  /** The PO number under a container name, when it is not already the name. */
  docSub(item: DeletedItemSummary): string | null {
    const name = this.docName(item);
    return name !== item.number ? item.number : null;
  }

  leaveClass(item: DeletedItemSummary): string {
    return item.id === this.leavingId() ? 'mo-leave' : '';
  }

  left(item: DeletedItemSummary): number {
    return daysLeft(item.expiresAt);
  }

  leftText(item: DeletedItemSummary): string {
    return daysLeftText(daysLeft(item.expiresAt));
  }

  dateOnly(value: string): string {
    return deletedFieldValue('', value).split(',')[0];
  }

  shortDate(value: string): string {
    return this.dateOnly(value).slice(0, 5);
  }

  /** ↑/↓ move through the rows (roving focus); Enter opens (the row is a button). */
  rowKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...this.host.nativeElement.querySelectorAll<HTMLElement>('.trash-row')];
    const index = rows.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }

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
    this.restoringId.set(item.id); this.detailError.set(''); this.leavingId.set(item.id);
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
      this.leavingId.set(null);
    } finally { if (!this.destroyed) this.restoringId.set(null); }
  }

  ngOnDestroy(): void { this.destroyed = true; this.listVersion++; this.detailVersion++; }
}
