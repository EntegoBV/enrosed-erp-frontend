import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, Injector, afterNextRender, computed, effect, inject,
  input, signal, untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { InventoryApi, refusalCode, refusalDetails } from '../../core/api/inventory-api';
import type { BookingCheck, CountLine, CountLineWrite, CountView } from '../../core/api/inventory-models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu } from '../../shared/context-menu';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { DateNlPipe, DateTimeNlPipe, NumPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import {
  COUNT_CHIPS, canConfirmEqual, conflictText, countProgress, countSections, differenceText, filterLines, lineState,
  rebaseWrite, sameReasonWrites,
} from './inventory-count';
import type { CountChip, CountLineState } from './inventory-count';
import { inventoryUnit } from './inventory-unit';
import { StockCountAddSheet } from './stock-count-add-sheet';
import { StockCountBookingSheet, countTime } from './stock-count-booking-sheet';
import { StockCountDocuments, StockCountReasonSheet } from './stock-count-reason-sheet';
import type { CountReasonChoice } from './stock-count-reason-sheet';

/** The whole session is read again this often while the page is visible (4.3). */
const RELOAD_MS = 20_000;

/** What a line save was for: it decides what happens once the server answered. */
type SaveIntent = 'count' | 'wipe' | 'reason' | 'documents' | 'rebase';

/** 409 REGEL_GEWIJZIGD: the other phone's line, and the write this phone tried. */
interface CountConflict {
  line: CountLine;
  write: CountLineWrite;
  intent: SaveIntent;
  /** The fields in list order at the moment of saving, for the focus after "Vervang". */
  order: number[];
}

type ReasonTarget = { lineId: number } | { bulk: number[] };

const whole = (value: number) => value.toLocaleString('nl-BE');

/**
 * One count session of a location: the list to count on a phone (expected,
 * counted, difference, reason), the same data as a table on a desk, and the
 * way to the booking. Nothing here touches stock: every count is saved per
 * line with its revision, a second phone that was first is shown as a
 * question, and only "Telling boeken" writes the differences. The rules
 * (what is to count, how a difference reads, which write goes out) are in
 * inventory-count.ts. Sheets, the menu and the conflict dialog render at
 * host level; styles are in styles/inventory-count.scss (.inv-*).
 */
@Component({
  selector: 'app-stock-count-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, PageHeader, Skeleton, Icon, Sheet, ContextMenu, NumPipe, DateNlPipe, DateTimeNlPipe,
    StockCountDocuments, StockCountReasonSheet, StockCountBookingSheet, StockCountAddSheet],
  host: {
    '(window:focus)': 'refresh()',
    '(document:visibilitychange)': 'refresh()',
    '(window:beforeprint)': 'beforePrint()',
    '(window:afterprint)': 'printing.set(false)',
  },
  template: `
    <app-page-header [showBack]="true" backTo="/stock/inventaris" [showBell]="false" [title]="title()" [subtitle]="subtitle()">
      @if (view()) {
        <button class="btn btn--sm inv-count__more" type="button" aria-label="Meer" (click)="openMenu($event)"><app-icon name="more" [size]="20" /></button>
      }
    </app-page-header>

    <div class="content inv-count" [class.inv-count--desk]="table()" [class.content--with-action-bar]="isOpen()">
      @if (view(); as v) {
        @let p = progress();
        <div class="inv-count__sticky">
          @if (table()) {
            <div class="wk-strip inv-count__strip" aria-label="Voortgang">
              <div class="wk-strip__item"><span class="wk-strip__label">Geteld</span><span class="wk-strip__value">{{ p.counted | num }} / {{ p.total | num }}</span></div>
              <div class="wk-strip__item"><span class="wk-strip__label">Verschillen</span><span class="wk-strip__value">{{ p.differences | num }}</span></div>
              <div class="wk-strip__item"><span class="wk-strip__label">Zonder reden</span>
                <span class="wk-strip__value" [class.wk-amount--warn]="p.missingReasons > 0">{{ p.missingReasons | num }}</span></div>
              <div class="inv-count__tools">
                @if (isOpen()) { <button class="wk-btn" type="button" (click)="addOpen.set(true)"><app-icon name="plus" [size]="16" /> Product toevoegen</button> }
                <button class="wk-btn" type="button" (click)="print()">Tellijst afdrukken</button>
              </div>
            </div>
          } @else {
            <div class="ios-figures ios-figures--3 inv-count__figures" aria-label="Voortgang">
              <div><small>Geteld</small><strong>{{ p.counted | num }} / {{ p.total | num }}</strong></div>
              <div><small>Verschillen</small><strong>{{ p.differences | num }}</strong></div>
              <div><small>Zonder reden</small><strong [class.inv-count__figure--stop]="p.missingReasons > 0">{{ p.missingReasons | num }}</strong></div>
            </div>
          }
        </div>

        @if (v.status === 'GEBOEKT') {
          <div class="alert alert--ok inv-count__closed" role="status">
            <span>Geboekt door {{ v.bookedByName || 'onbekend' }} op {{ v.bookedAt | dateNl }}. Deze telling kan niet meer gewijzigd worden.</span>
            <a class="inv-count__back" routerLink="/stock/inventaris">Terug naar Jaarinventaris</a>
          </div>
        } @else if (v.status === 'GEANNULEERD') {
          <div class="alert alert--info inv-count__closed" role="status">
            <span>Deze telling is geannuleerd. Er is niets geboekt.</span>
            <a class="inv-count__back" routerLink="/stock/inventaris">Terug naar Jaarinventaris</a>
          </div>
        }

        <div class="inv-count__lead">
          @if (correction()) {
            <p>@if (correctedAt(); as at) { Je corrigeert de geboekte telling van {{ at | dateNl }}. } @else { Je corrigeert de geboekte telling. }
              Voeg alleen de producten toe die je opnieuw telt; de rest blijft zoals geboekt.</p>
          } @else {
            <p>Tel alles wat er ligt: ook demostukken, stuks van partnercontainers en goederen van iemand anders. Kapotte stuks tel je niet mee; kies bij het verschil de reden 'Beschadigd of stuk'.</p>
            <p>Displayproducten tel je in displays.</p>
          }
        </div>

        @if (v.warnings.unbookedContainers.length || v.warnings.unshippedInvoices.length) {
          <div [class]="bannerClass()" role="status">
            <span>
              Eerst afwerken: {{ firstText() }}. Een verschil dat daardoor komt, boek je niet met de telling.
              <span class="inv-banner__links">
                @for (container of v.warnings.unbookedContainers; track container.purchaseOrderId) {
                  <a [routerLink]="['/purchasing', container.purchaseOrderId]">Container {{ container.displayName || container.number }}</a>
                }
                @for (invoice of v.warnings.unshippedInvoices; track invoice.salesOrderId) {
                  <a [routerLink]="['/sales', invoice.salesOrderId]">Factuur {{ invoice.number }}</a>
                }
              </span>
            </span>
          </div>
        }
        @if (v.warnings.olderUnshippedInvoiceCount > 0) {
          <p class="inv-count__quiet">{{ olderText() }}</p>
        }
        @for (level of v.warnings.orphanLevels; track level.productId) {
          <p class="inv-count__quiet">Voorraadstand van een verwijderd product (id {{ level.productId }}, {{ level.quantity | num }} stuks) wordt niet geteld.</p>
        }

        <div class="inv-count__filter">
          @if (table()) {
            <div class="wk-search inv-count__search">
              <app-icon name="search" [size]="16" />
              <input type="search" placeholder="Zoek naam of SKU…" aria-label="Zoek naam of SKU" autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" />
              <button class="wk-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="14" /></button>
            </div>
            <div class="wk-chips" role="group" aria-label="Toon">
              @for (option of chips(); track option.key) {
                <button class="wk-chip" type="button" [attr.aria-pressed]="chip() === option.key" (click)="chip.set(option.key)">{{ option.label }} <span class="inv-count__chipn">{{ option.count | num }}</span></button>
              }
            </div>
          } @else {
            <div class="ios-search">
              <div class="ios-search__field">
                <app-icon name="search" [size]="18" />
                <input type="search" placeholder="Zoek naam of SKU…" aria-label="Zoek naam of SKU" autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" />
                <button class="ios-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="16" /></button>
              </div>
            </div>
            <div class="ios-chips" role="group" aria-label="Toon">
              @for (option of chips(); track option.key) {
                <button class="ios-chip" type="button" [attr.aria-pressed]="chip() === option.key" (click)="chip.set(option.key)">{{ option.label }} <span class="inv-count__chipn">{{ option.count | num }}</span></button>
              }
            </div>
          }
        </div>

        @if (!sections().length) {
          <p class="inv-count__empty">{{ emptyText() }}</p>
        } @else if (table()) {
          <div class="wk-table inv-table" role="table" aria-label="Tellijst">
            <div class="wk-thead" role="row">
              <span class="wk-th" role="columnheader">Product</span>
              <span class="wk-th inv-col--wide" role="columnheader">SKU</span>
              <span class="wk-th inv-col--wide" role="columnheader">Eenheid</span>
              <span class="wk-th wk-th--num" role="columnheader">Volgens systeem</span>
              <span class="wk-th" role="columnheader">Geteld</span>
              <span class="wk-th" role="columnheader">Verschil</span>
              <span class="wk-th" role="columnheader">Reden</span>
              <span class="wk-th inv-col--wide" role="columnheader">Door</span>
              <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
            </div>
            @for (section of sections(); track section.category) {
              <div class="wk-group" role="row">
                <span class="wk-group__label" role="cell">{{ section.category }} <span class="wk-group__count">· {{ sectionProgress(section.category) }}</span></span>
              </div>
              @for (line of section.lines; track line.id) {
                <ng-container *ngTemplateOutlet="deskLine; context: { $implicit: line }" />
              }
            }
          </div>
        } @else {
          @for (section of sections(); track section.category) {
            <section class="ios-section">
              <div class="ios-section__head"><h2>{{ section.category }}</h2><span class="ios-section__trail">{{ sectionProgress(section.category) }}</span></div>
              <div class="ios-group">
                @for (line of section.lines; track line.id) {
                  <ng-container *ngTemplateOutlet="phoneLine; context: { $implicit: line }" />
                }
              </div>
            </section>
          }
        }

        @if (isOpen()) {
          @if (table()) {
            <p class="inv-count__add"><button class="wk-btn" type="button" (click)="addOpen.set(true)"><app-icon name="plus" [size]="16" /> Product toevoegen</button></p>
          } @else {
            <div class="ios-group inv-count__add"><button class="ios-cell ios-cell--action" type="button" (click)="addOpen.set(true)">Product toevoegen</button></div>
          }
        }
      } @else if (loadError(); as message) {
        <div class="alert alert--danger" role="alert">
          <span>{{ message }}</span>
          <button class="btn btn--sm" type="button" (click)="load()">Opnieuw</button>
        </div>
        <p class="inv-count__quiet"><a class="inv-count__back" routerLink="/stock/inventaris">Terug naar Jaarinventaris</a></p>
      } @else {
        <div aria-busy="true"><app-skeleton kind="stats" [rows]="3" /><app-skeleton kind="list" [rows]="8" /></div>
      }
    </div>

    <!-- phone: one line of the list -->
    <ng-template #phoneLine let-line>
      @let st = state(line);
      <div class="ios-cell ios-cell--tall inv-line" [id]="'inv-line-' + line.id" [class.inv-line--gone]="isOrphan(line)">
        <span class="ios-cell__body">
          <span class="ios-cell__title ios-cell__title--2">{{ line.productName }}</span>
          <span class="ios-cell__sub">{{ line.sku || 'Geen SKU' }}</span>
          @if (isOrphan(line)) {
            <span class="inv-line__note">Product verwijderd: wordt niet geboekt</span>
          } @else if (st === 'TE_TELLEN') {
            <span class="ios-cell__sub inv-line__system">{{ systemText(line) }}@if (displayHint(line); as hint) { · {{ hint }} }</span>
            @if (isOpen()) {
              @if (!canConfirm(line)) { <span class="inv-line__note inv-line__note--stop">Staat onder nul: tel dit product</span> }
              <span class="inv-line__entry">
                <label class="sr-only" [for]="'inv-count-field-' + line.id">Geteld, {{ line.productName }}</label>
                <input #field class="input inv-line__field" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="done"
                       placeholder="Geteld" [id]="'inv-count-field-' + line.id" [disabled]="saving().has(line.id)"
                       (keydown.enter)="$event.preventDefault(); saveField(line, field)" />
                <button class="btn btn--primary inv-line__save" type="button" [disabled]="saving().has(line.id)" (click)="saveField(line, field)">Bewaar</button>
                @if (canConfirm(line)) {
                  <button class="btn inv-line__equal" type="button" [disabled]="saving().has(line.id)" (click)="confirmEqual(line)">Klopt</button>
                }
              </span>
            }
          } @else {
            @if (st === 'KLOPT') {
              <span class="inv-line__result inv-line__result--ok"><app-icon name="tick" [size]="16" /> {{ line.countedQuantity | num }} · klopt</span>
            } @else {
              <span class="inv-line__result">Geteld {{ line.countedQuantity | num }} · {{ difference(line) }}</span>
              <span class="inv-line__reason">
                @if (!isOpen()) {
                  {{ reasonText(line) || 'Geen reden' }}
                } @else if (line.reasonCode) {
                  <button class="inv-line__link" type="button" (click)="openReason(line)">{{ reasonText(line) }}</button>
                } @else {
                  <button class="inv-chip inv-chip--stop" type="button" (click)="openReason(line)">Reden kiezen</button>
                }
              </span>
            }
            <span class="ios-cell__sub">{{ countedBy(line) }}</span>
            @if (line.moved) {
              <span class="inv-line__moved"><span class="inv-chip inv-chip--warn">Voorraad gewijzigd na het tellen</span>
                <span class="ios-cell__sub">Sinds je telde: nu {{ line.liveQuantity | num }} volgens systeem</span></span>
            }
            @if (line.openDocuments.length) {
              <app-stock-count-documents [line]="line" [editable]="isOpen()" [disabled]="saving().has(line.id)" (confirmed)="confirmDocuments(line, $event)" />
            }
            @if (isOpen()) {
              <button class="inv-line__link inv-line__wipe" type="button" [disabled]="saving().has(line.id)" (click)="wipe(line)">Aantal wissen</button>
            }
          }
        </span>
      </div>
    </ng-template>

    <!-- desk: the same line as a table row, with a second row for what needs words -->
    <ng-template #deskLine let-line>
      @let st = state(line);
      @let gone = isOrphan(line);
      <div class="wk-tr inv-row" role="row" [id]="'inv-line-' + line.id" [class.inv-row--gone]="gone">
        <span class="wk-td wk-td--wrap" role="cell">{{ line.productName }}
          <span class="wk-td__sub inv-col--narrow">{{ line.sku || 'Geen SKU' }} · {{ unit(line).singular }}@if (displayHint(line); as hint) { · {{ hint }} }</span></span>
        <span class="wk-td wk-td--wrap inv-col--wide" role="cell">{{ line.sku || '—' }}</span>
        <span class="wk-td inv-col--wide" role="cell">{{ unit(line).singular }}@if (displayHint(line); as hint) { <span class="wk-td__sub">{{ hint }}</span> }</span>
        <span class="wk-td wk-td--num" role="cell">{{ systemQuantity(line) | num }}</span>
        <span class="wk-td inv-row__count" role="cell">
          @if (gone) {
            —
          } @else if (st !== 'TE_TELLEN') {
            <strong>{{ line.countedQuantity | num }}</strong>
          } @else if (isOpen()) {
            <label class="sr-only" [for]="'inv-count-field-' + line.id">Geteld, {{ line.productName }}</label>
            <input #field class="inv-row__field" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
                   [id]="'inv-count-field-' + line.id" [disabled]="saving().has(line.id)"
                   (keydown.enter)="$event.preventDefault(); saveField(line, field)" />
            <button class="wk-btn wk-btn--sm wk-btn--primary" type="button" [disabled]="saving().has(line.id)" (click)="saveField(line, field)">Bewaar</button>
          }
        </span>
        <span class="wk-td" role="cell" [class.inv-row__diff]="st === 'VERSCHIL_ZONDER_REDEN' || st === 'VERSCHIL_MET_REDEN'">
          @if (!gone && st !== 'TE_TELLEN') {
            @if (st === 'KLOPT') { <app-icon class="inv-row__tick" name="tick" [size]="14" /> } {{ difference(line) }}
            <span class="wk-td__sub inv-col--narrow">{{ countedBy(line) }}</span>
          }
        </span>
        <span class="wk-td" role="cell">
          @if (gone || st === 'TE_TELLEN' || st === 'KLOPT') {
          } @else if (!isOpen()) {
            {{ reasonText(line) || 'Geen reden' }}
          } @else if (line.reasonCode) {
            <button class="wk-link inv-row__reason" type="button" [title]="reasonText(line)" (click)="openReason(line)">{{ reasonText(line) }}</button>
          } @else {
            <button class="inv-chip inv-chip--stop" type="button" (click)="openReason(line)">Reden kiezen</button>
          }
        </span>
        <span class="wk-td inv-col--wide" role="cell">@if (!gone && line.countedQuantity !== null) { {{ line.countedByName }} <span class="wk-td__sub">{{ time(line) }}</span> }</span>
        <span class="wk-td inv-row__actions" role="cell">
          @if (!gone && isOpen()) {
            @if (st !== 'TE_TELLEN') {
              <button class="wk-btn wk-btn--sm wk-btn--ghost" type="button" [disabled]="saving().has(line.id)" (click)="wipe(line)">Aantal wissen</button>
            } @else if (canConfirm(line)) {
              <button class="wk-btn wk-btn--sm" type="button" [disabled]="saving().has(line.id)" (click)="confirmEqual(line)">Klopt</button>
            }
          }
        </span>
      </div>
      @if (gone || (st === 'TE_TELLEN' && isOpen() && !canConfirm(line)) || (st !== 'TE_TELLEN' && (line.moved || line.openDocuments.length))) {
        <div class="wk-tr wk-tr--sub inv-row__sub" role="row">
          <span class="wk-td wk-td--wrap inv-row__more" role="cell">
            @if (gone) {
              <span class="inv-line__note">Product verwijderd: wordt niet geboekt</span>
            } @else if (st === 'TE_TELLEN') {
              <span class="inv-line__note inv-line__note--stop">Staat onder nul: tel dit product</span>
            } @else {
              @if (line.moved) {
                <span class="inv-line__moved"><span class="inv-chip inv-chip--warn">Voorraad gewijzigd na het tellen</span>
                  <span>Sinds je telde: nu {{ line.liveQuantity | num }} volgens systeem</span></span>
              }
              @if (line.openDocuments.length) {
                <app-stock-count-documents [line]="line" [editable]="isOpen()" [disabled]="saving().has(line.id)" (confirmed)="confirmDocuments(line, $event)" />
              }
            }
          </span>
        </div>
      }
    </ng-template>

    @if (isOpen()) {
      <div class="action-bar inv-count__bar">
        <div class="action-bar__total">
          <div class="action-bar__label">Nog te tellen</div>
          <div class="action-bar__value">{{ progress().total - progress().counted | num }}</div>
        </div>
        <button class="btn btn--primary" type="button" (click)="openBooking()">Controleren en boeken</button>
      </div>
    }

    <!-- Only while printing: the count list as a plain table (blank sheet while open, record to sign once booked). -->
    @if (printing()) {
      @if (view(); as v) {
        <div class="inv-print">
          <p class="inv-print__head">Tellijst {{ v.locationName }} · {{ v.countYear }} · afgedrukt {{ printedAt() | dateTimeNl }}</p>
          <table class="inv-print__table">
            <thead><tr><th>Product</th><th>SKU</th><th>Eenheid</th><th class="inv-print__num">Volgens systeem</th><th class="inv-print__num">Geteld</th><th>Reden</th><th>Door</th></tr></thead>
            <tbody>
              @for (section of printSections(); track section.category) {
                <tr class="inv-print__group"><th colspan="7">{{ section.category }}</th></tr>
                @for (line of section.lines; track line.id) {
                  <tr>
                    <td>{{ line.productName }}</td>
                    <td class="inv-print__sku">{{ line.sku }}</td>
                    <td>{{ unit(line).singular }}</td>
                    <td class="inv-print__num">{{ systemQuantity(line) | num }}</td>
                    <td class="inv-print__num">@if (line.countedQuantity !== null) { {{ line.countedQuantity | num }} }</td>
                    <td>{{ reasonText(line) }}</td>
                    <td>{{ line.countedByName }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>
          <div class="inv-print__foot">
            <p>Geteld door <span class="inv-print__rule"></span> Handtekening <span class="inv-print__rule"></span></p>
            <p>Geteld door <span class="inv-print__rule"></span> Handtekening <span class="inv-print__rule"></span></p>
          </div>
        </div>
      }
    }

    @if (bookingOpen()) {
      @if (view(); as v) {
        <app-stock-count-booking-sheet [view]="v" [check]="check()" [checking]="checking()" [failed]="checkFailed()" [busy]="working()"
                                       [looked]="looked()" [rebased]="rebasedLines()"
                                       (reload)="loadCheck()" (showUncounted)="showUncounted()" (add)="addProduct($event)"
                                       (reason)="openReasonById($event)" (sameReason)="reasonTarget.set({ bulk: $event })"
                                       (documents)="confirmDocumentsById($event.lineId, $event.confirmed)" (keep)="keepMoved($event)"
                                       (rebase)="rebase($event)" (book)="askBook()" (closed)="bookingOpen.set(false)" />
      }
    }
    @if (reasonTarget(); as target) {
      @if (view(); as v) {
        <app-stock-count-reason-sheet [line]="reasonLine()" [bulkCount]="bulkCount()" [reasons]="v.reasons" [busy]="working() || reasonBusy()"
                                      (save)="saveReason($event)" (documents)="confirmDocumentsById(reasonLineId(), $event)" (closed)="closeReason()" />
      }
    }
    @if (addOpen()) {
      <app-stock-count-add-sheet [listed]="listedProductIds()" [busy]="working()" (pick)="addProduct($event)" (closed)="addOpen.set(false)" />
    }
    @if (conflict(); as clash) {
      <app-sheet title="Hier is al geteld" (closed)="keepTheirs()">
        <div body><p class="inv-conflict">{{ conflictMessage(clash) }}</p></div>
        <div foot style="display:contents">
          <button class="btn" type="button" data-initial-focus [disabled]="working()" (click)="keepTheirs()">{{ keepLabel(clash) }}</button>
          <button class="btn btn--primary" type="button" [disabled]="working()" (click)="replaceTheirs()">{{ replaceLabel(clash) }}</button>
        </div>
      </app-sheet>
    }
    @if (menu(); as point) {
      <app-context-menu [items]="menuItems()" [title]="title()" [anchor]="point.anchor" cancelLabel="Annuleren"
                        (pick)="pickMenu($event)" (closed)="menu.set(null)" />
    }
  `,
})
export class StockCountPage {
  private readonly api = inject(InventoryApi);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly injector = inject(Injector);
  private readonly changes = inject(ChangeDetectorRef);
  readonly desktop = inject(DesktopViewport);

  /**
   * The table needs room for nine columns: it shows from 1024 px of window
   * (the full sidebar's breakpoint). Narrower desks and phones get the list.
   */
  private readonly wideQuery = typeof matchMedia === 'function' ? matchMedia('(min-width: 1024px)') : null;
  readonly table = signal(this.wideQuery?.matches ?? false);

  /** Route parameter: the session. */
  readonly id = input.required<string>();
  /** Query `boeken=1` opens the booking sheet at once ("Lege locatie bevestigen"). */
  readonly boeken = input<string>();

  readonly view = signal<CountView | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly chip = signal<CountChip>('TE_TELLEN');
  readonly query = signal('');
  /** Line ids with a save under way. */
  readonly saving = signal<ReadonlySet<number>>(new Set());
  /** A session-wide call under way: adding a product, booking, cancelling, the same reason for many. */
  readonly working = signal(false);
  /** When the corrected count was booked; read once for the instruction line of a correction. */
  readonly correctedAt = signal<string | null>(null);

  readonly bookingOpen = signal(false);
  readonly check = signal<BookingCheck | null>(null);
  readonly checking = signal(false);
  readonly checkFailed = signal(false);
  readonly looked = signal<ReadonlySet<number>>(new Set());
  private readonly rebasedIds = signal<readonly number[]>([]);

  readonly reasonTarget = signal<ReasonTarget | null>(null);
  readonly addOpen = signal(false);
  readonly conflict = signal<CountConflict | null>(null);
  readonly menu = signal<{ anchor: MenuPoint | null } | null>(null);
  readonly printing = signal(false);
  readonly printedAt = signal('');

  private countId = 0;
  private checkRun = 0;
  private reloading = false;
  /** The field to go to once the reason sheet of a just saved difference closes. */
  private focusAfterReason: number | null = null;

  readonly isOpen = computed(() => this.view()?.status === 'OPEN');
  readonly correction = computed(() => (this.view()?.correctsCountId ?? null) !== null);
  private readonly orphanIds = computed(() => new Set((this.view()?.warnings.orphanLevels ?? []).map((level) => level.productId)));
  /** Lines of a product that was deleted meanwhile count for nothing and are never booked (4.2). */
  private readonly liveLines = computed(() => {
    const gone = this.orphanIds();
    return (this.view()?.lines ?? []).filter((line) => !gone.has(line.productId));
  });
  readonly progress = computed(() => countProgress(this.liveLines()));
  private readonly categoryProgress = computed(() =>
    new Map(countSections(this.liveLines()).map((section) => [section.category, `${whole(section.counted)} / ${whole(section.total)} geteld`])));
  readonly chips = computed(() => COUNT_CHIPS.map((option) => ({ ...option, count: this.onChip(option.key, '').length })));
  readonly sections = computed(() => countSections(this.onChip(this.chip(), this.query())));
  readonly printSections = computed(() => countSections(this.liveLines()));
  readonly listedProductIds = computed(() => new Set((this.view()?.lines ?? []).map((line) => line.productId)));

  readonly title = computed(() => {
    const view = this.view();
    return !view ? 'Telling' : `${this.correction() ? 'Correctie telling' : 'Telling'} ${view.locationName}`;
  });
  readonly subtitle = computed(() => {
    const view = this.view();
    if (!view) return '';
    const p = this.progress();
    return `${view.countYear} · ${whole(p.counted)} van ${whole(p.total)} geteld · ${whole(p.differences)} verschillen`;
  });
  readonly bannerClass = computed(() => this.table() ? 'wk-banner wk-banner--warn wk-banner--inset inv-banner' : 'ios-banner inv-banner');
  readonly firstText = computed(() => {
    const warnings = this.view()?.warnings;
    const containers = warnings?.unbookedContainers.length ?? 0;
    const invoices = warnings?.unshippedInvoices.length ?? 0;
    return [
      containers ? `${whole(containers)} ontvangen ${containers === 1 ? 'container' : 'containers'} nog niet bijgeboekt` : '',
      invoices ? `${whole(invoices)} ${invoices === 1 ? 'factuur' : 'facturen'} nog niet afgepunt` : '',
    ].filter(Boolean).join(' · ');
  });
  readonly olderText = computed(() => {
    const count = this.view()?.warnings.olderUnshippedInvoiceCount ?? 0;
    return count === 1 ? '1 oudere factuur is nooit afgepunt; de telling houdt er geen rekening mee.'
      : `${whole(count)} oudere facturen zijn nooit afgepunt; de telling houdt er geen rekening mee.`;
  });
  readonly emptyText = computed(() => {
    if (this.query().trim()) return 'Geen product gevonden met deze zoekopdracht.';
    if (!this.view()?.lines.length) {
      return this.correction() ? 'Nog geen producten. Voeg de producten toe die je opnieuw telt.' : 'Deze telling heeft geen producten.';
    }
    switch (this.chip()) {
      case 'TE_TELLEN': return this.isOpen() ? 'Alles is geteld. Controleer en boek de telling.' : 'Niets meer te tellen.';
      case 'GETELD': return 'Nog niets geteld.';
      case 'VERSCHILLEN': return 'Geen verschillen.';
      case 'GEWIJZIGD': return 'Geen voorraad gewijzigd na het tellen.';
      default: return 'Geen producten.';
    }
  });

  readonly reasonLineId = computed(() => {
    const target = this.reasonTarget();
    return target && 'lineId' in target ? target.lineId : null;
  });
  readonly reasonLine = computed(() => this.lineById(this.reasonLineId()));
  readonly bulkCount = computed(() => {
    const target = this.reasonTarget();
    return target && 'bulk' in target ? target.bulk.length : 0;
  });
  /** A reason save of one line is under way. */
  readonly reasonBusy = computed(() => {
    const id = this.reasonLineId();
    return id !== null && this.saving().has(id);
  });
  readonly rebasedLines = computed(() =>
    this.rebasedIds().map((id) => this.lineById(id)).filter((line): line is CountLine => !!line && !line.moved));
  readonly menuItems = computed<ContextMenuItem[]>(() => [
    ...(this.isOpen() ? [{ id: 'add', label: 'Product toevoegen', iconName: 'plus' }] : []),
    { id: 'print', label: 'Tellijst afdrukken', iconName: 'document' },
    ...(this.isOpen() ? [{ id: 'cancel', label: 'Telling annuleren', iconName: 'trash', danger: true, divider: true }] : []),
  ]);

  constructor() {
    /* The unit words ("bowls") come with the catalog's list; until it arrives a unit reads "stuks". */
    void this.catalog.unitNames().catch(() => undefined);
    effect(() => {
      const id = Number(this.id());
      untracked(() => void this.open(id));
    });
    const timer = setInterval(() => void this.refresh(), RELOAD_MS);
    const onWide = (event: MediaQueryListEvent) => this.table.set(event.matches);
    this.wideQuery?.addEventListener('change', onWide);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.wideQuery?.removeEventListener('change', onWide);
    });
  }

  /* ------------------------------------------------------------- loading */

  private async open(id: number): Promise<void> {
    this.countId = id;
    this.view.set(null);
    this.bookingOpen.set(false);
    this.reasonTarget.set(null);
    this.conflict.set(null);
    this.addOpen.set(false);
    this.query.set('');
    this.looked.set(new Set());
    this.rebasedIds.set([]);
    this.correctedAt.set(null);
    await this.load();
    const view = this.view();
    if (!view || this.countId !== id) return;
    /* A full count opens on what is left to do, a correction and a closed session on everything. */
    this.chip.set(view.status === 'OPEN' && view.correctsCountId === null ? 'TE_TELLEN' : 'ALLES');
    if (view.correctsCountId !== null) void this.loadCorrectedAt(view);
    if (this.boeken() === '1' && view.status === 'OPEN') this.openBooking();
  }

  async load(): Promise<void> {
    const id = this.countId;
    this.loadError.set(null);
    try {
      const view = await this.api.count(id);
      if (this.countId === id) this.view.set(view);
    } catch (failure) {
      if (this.countId === id) this.loadError.set(messageOf(failure, 'De telling kon niet worden geladen.'));
    }
  }

  /** The 20-second and on-focus reload: quiet, only while the session is open and the page is in view. */
  async refresh(): Promise<void> {
    const id = this.countId;
    if (this.reloading || !this.isOpen() || document.visibilityState !== 'visible') return;
    this.reloading = true;
    try {
      const fresh = await this.api.count(id);
      if (this.countId === id) this.mergeView(fresh);
    } catch {
      /* The next round tries again; what is on screen stays. */
    } finally {
      this.reloading = false;
    }
  }

  private async loadCorrectedAt(view: CountView): Promise<void> {
    try {
      const overview = await this.api.countOverview(view.countYear);
      if (this.countId !== view.id) return;
      this.correctedAt.set(overview.counts.find((count) => count.id === view.correctsCountId)?.bookedAt ?? null);
    } catch {
      /* The line then reads without the date. */
    }
  }

  /**
   * A reload can be older than a save that answered while it was under way:
   * per line the higher revision stays, and a line added here meanwhile is kept.
   */
  private mergeView(fresh: CountView): void {
    const current = this.view();
    if (!current || current.id !== fresh.id) {
      this.view.set(fresh);
      return;
    }
    const mine = new Map(current.lines.map((line) => [line.id, line]));
    const lines = fresh.lines.map((line) => {
      const local = mine.get(line.id);
      mine.delete(line.id);
      return local && local.revision > line.revision ? local : line;
    });
    this.view.set({ ...fresh, lines: [...lines, ...mine.values()] });
  }

  private mergeLine(line: CountLine): void {
    this.view.update((view) => {
      if (!view) return view;
      const known = view.lines.some((row) => row.id === line.id);
      return { ...view, lines: known ? view.lines.map((row) => (row.id === line.id ? line : row)) : [...view.lines, line] };
    });
  }

  /* ---------------------------------------------------------- line texts */

  private lineById(id: number | null): CountLine | null {
    return id === null ? null : this.view()?.lines.find((line) => line.id === id) ?? null;
  }

  private onChip(chip: CountChip, query: string): CountLine[] {
    /* A deleted product's line is listed under "Alles" only: it is never to count and never a difference. */
    return filterLines(chip === 'ALLES' ? this.view()?.lines ?? [] : this.liveLines(), chip, query);
  }

  state(line: CountLine): CountLineState {
    return lineState(line);
  }

  isOrphan(line: CountLine): boolean {
    return this.orphanIds().has(line.productId);
  }

  canConfirm(line: CountLine): boolean {
    return canConfirmEqual(line);
  }

  unit(line: CountLine) {
    return inventoryUnit(line);
  }

  /** The figure the count was (or will be) compared with: frozen once counted, live before. */
  systemQuantity(line: CountLine): number {
    return line.countedQuantity !== null && line.expectedQuantity !== null ? line.expectedQuantity : line.liveQuantity;
  }

  systemText(line: CountLine): string {
    const unit = inventoryUnit(line);
    const quantity = this.systemQuantity(line);
    return `Volgens systeem ${whole(quantity)} ${quantity === 1 ? unit.singular : unit.plural}`;
  }

  displayHint(line: CountLine): string {
    const unit = inventoryUnit(line);
    return unit.isDisplay && unit.piecesPerDisplay ? `1 display = ${whole(unit.piecesPerDisplay)} ${unit.piece.other}` : '';
  }

  difference(line: CountLine): string {
    return differenceText(line.difference ?? 0);
  }

  reasonText(line: CountLine): string {
    return [line.reasonLabel, line.reasonNote].filter(Boolean).join(' · ');
  }

  countedBy(line: CountLine): string {
    return [line.countedByName, countTime(line.countedAt)].filter(Boolean).join(' ');
  }

  time(line: CountLine): string {
    return countTime(line.countedAt);
  }

  sectionProgress(category: string): string {
    return this.categoryProgress().get(category) ?? '';
  }

  /* -------------------------------------------------------------- saving */

  /** Enter or "Bewaar": never while typing and never on blur. */
  saveField(line: CountLine, field: HTMLInputElement): void {
    const raw = field.value.trim();
    if (!raw || this.saving().has(line.id)) return;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      this.ui.toast('Vul een geheel aantal van 0 of meer in.', 'err');
      field.select();
      return;
    }
    void this.saveCount(line, Number(raw));
  }

  /** "Klopt": the system figure is what lies there. */
  confirmEqual(line: CountLine): void {
    if (!canConfirmEqual(line) || this.saving().has(line.id)) return;
    void this.saveCount(line, line.liveQuantity);
  }

  private saveCount(line: CountLine, quantity: number): Promise<void> {
    return this.save(line, { countedQuantity: quantity, reasonCode: line.reasonCode, reasonNote: line.reasonNote, revision: line.revision },
      'count', this.fieldOrder());
  }

  wipe(line: CountLine): void {
    void this.save(line, { countedQuantity: null, reasonCode: null, reasonNote: null, revision: line.revision }, 'wipe');
  }

  confirmDocuments(line: CountLine, confirmed: boolean): void {
    /* The same count goes along, so the server changes the statement only (4.3). */
    void this.save(line, {
      countedQuantity: line.countedQuantity, reasonCode: line.reasonCode, reasonNote: line.reasonNote, revision: line.revision,
      documentsConfirmed: confirmed,
    }, 'documents');
  }

  confirmDocumentsById(lineId: number | null, confirmed: boolean): void {
    const line = this.lineById(lineId);
    if (line) this.confirmDocuments(line, confirmed);
  }

  /** "Ja, herreken het verschil": the same count against the level of now (4.4). */
  rebase(lineId: number): void {
    const line = this.lineById(lineId);
    if (line) void this.save(line, rebaseWrite(line), 'rebase');
  }

  /** "Nee, klopt zo": looked at on this phone; nothing is sent. */
  keepMoved(lineId: number): void {
    this.looked.update((ids) => new Set(ids).add(lineId));
  }

  /** The ids of the lines that show a field now, in list order. */
  private fieldOrder(): number[] {
    return this.sections().flatMap((section) => section.lines)
      .filter((line) => line.countedQuantity === null && !this.isOrphan(line)).map((line) => line.id);
  }

  /**
   * One line write and what follows from it. A stale revision becomes the
   * conflict question; every other refusal is shown as the server words it.
   */
  private async save(line: CountLine, write: CountLineWrite, intent: SaveIntent, order: number[] = []): Promise<void> {
    const countId = this.countId;
    this.markSaving(line.id, true);
    let saved: CountLine;
    try {
      saved = await this.api.saveCountLine(countId, line.id, write);
    } catch (failure) {
      if (this.countId !== countId) return;
      const theirs = refusalCode(failure) === 'REGEL_GEWIJZIGD' ? refusalDetails<{ line: CountLine }>(failure)?.line : null;
      if (theirs) {
        this.conflict.set({ line: theirs, write, intent, order });
        return;
      }
      this.ui.toast(messageOf(failure, 'Bewaren is niet gelukt. Probeer opnieuw.'), 'err');
      if (refusalCode(failure) === 'TELLING_GESLOTEN') this.sessionClosed();
      return;
    } finally {
      this.markSaving(line.id, false);
    }
    if (this.countId !== countId) return;
    this.mergeLine(saved);
    this.afterSave(saved, intent, order);
  }

  private afterSave(saved: CountLine, intent: SaveIntent, order: number[]): void {
    switch (intent) {
      case 'count': {
        const next = this.nextField(saved.id, order);
        /* A difference asks for its reason at once; the count itself is already saved. */
        if (lineState(saved) === 'VERSCHIL_ZONDER_REDEN') {
          this.focusAfterReason = next;
          this.reasonTarget.set({ lineId: saved.id });
        } else {
          this.focusField(next);
        }
        break;
      }
      case 'reason':
        this.closeReason();
        break;
      case 'rebase':
        this.rebasedIds.update((ids) => (ids.includes(saved.id) ? ids : [...ids, saved.id]));
        break;
      default:
        break;
    }
    if (this.bookingOpen()) void this.loadCheck();
  }

  private markSaving(lineId: number, on: boolean): void {
    this.saving.update((ids) => {
      const next = new Set(ids);
      if (on) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }

  /** The next line after `lineId` in the list as it stood that still has a field. */
  private nextField(lineId: number, order: number[]): number | null {
    const from = order.indexOf(lineId);
    const after = from < 0 ? order : [...order.slice(from + 1), ...order.slice(0, from)];
    return after.find((id) => id !== lineId && this.lineById(id)?.countedQuantity === null) ?? null;
  }

  /** After the render, and after a closing sheet handed the focus back. */
  private focusField(lineId: number | null, scroll = false): void {
    if (lineId === null) return;
    afterNextRender(() => setTimeout(() => {
      if (scroll) document.getElementById(`inv-line-${lineId}`)?.scrollIntoView({ block: 'center' });
      document.getElementById(`inv-count-field-${lineId}`)?.focus({ preventScroll: scroll });
    }), { injector: this.injector });
  }

  /* -------------------------------------------------------------- reason */

  openReason(line: CountLine): void {
    this.focusAfterReason = null;
    this.reasonTarget.set({ lineId: line.id });
  }

  openReasonById(lineId: number): void {
    const line = this.lineById(lineId);
    if (line) this.openReason(line);
  }

  /** "Later", the cross, or after a save: the line keeps "Reden kiezen" until a reason is stored. */
  closeReason(): void {
    this.reasonTarget.set(null);
    const next = this.focusAfterReason;
    this.focusAfterReason = null;
    if (!this.bookingOpen()) this.focusField(next);
  }

  saveReason(choice: CountReasonChoice): void {
    const target = this.reasonTarget();
    if (!target) return;
    if ('bulk' in target) {
      void this.saveSameReason(target.bulk, choice);
      return;
    }
    const line = this.lineById(target.lineId);
    /* The count goes along unchanged, so the difference cannot move (4.3). */
    if (line) {
      void this.save(line, {
        countedQuantity: line.countedQuantity, reasonCode: choice.reasonCode, reasonNote: choice.reasonNote, revision: line.revision,
      }, 'reason');
    }
  }

  /**
   * "Zelfde reden voor alle": one write per line with its own revision. A
   * line that answers 409 (counted again meanwhile) is skipped and stays in
   * the list of the booking sheet.
   */
  private async saveSameReason(lineIds: readonly number[], choice: CountReasonChoice): Promise<void> {
    const countId = this.countId;
    const ids = new Set(lineIds);
    const lines = this.liveLines().filter((line) => ids.has(line.id) && lineState(line) === 'VERSCHIL_ZONDER_REDEN');
    let saved = 0;
    let skipped = 0;
    this.working.set(true);
    try {
      for (const { lineId, write } of sameReasonWrites(lines, choice.reasonCode, choice.reasonNote)) {
        try {
          const line = await this.api.saveCountLine(countId, lineId, write);
          if (this.countId !== countId) return;
          this.mergeLine(line);
          saved++;
        } catch (failure) {
          if (this.countId !== countId) return;
          if (refusalCode(failure) === 'TELLING_GESLOTEN') {
            this.ui.toast(messageOf(failure, 'Deze telling is gesloten.'), 'err');
            this.sessionClosed();
            return;
          }
          if ((failure as { status?: number } | null)?.status === 409) {
            skipped++;
            continue;
          }
          this.ui.toast(messageOf(failure, 'Bewaren is niet gelukt. Probeer opnieuw.'), 'err');
          break;
        }
      }
    } finally {
      this.working.set(false);
    }
    this.reasonTarget.set(null);
    if (skipped) {
      this.ui.toast(`Reden bewaard bij ${whole(saved)} van ${whole(saved + skipped)} verschillen. `
        + `${whole(skipped)} ${skipped === 1 ? 'is' : 'zijn'} intussen gewijzigd en ${skipped === 1 ? 'staat' : 'staan'} nog in de lijst.`, 'err');
    } else if (saved) {
      this.ui.toast(`Reden bewaard bij ${whole(saved)} ${saved === 1 ? 'verschil' : 'verschillen'}.`);
    }
    void this.refresh();
    if (this.bookingOpen()) void this.loadCheck();
  }

  /* ------------------------------------------------------------ conflict */

  conflictMessage(clash: CountConflict): string {
    return conflictText(clash.line, clash.write.countedQuantity);
  }

  replaceLabel(clash: CountConflict): string {
    return clash.write.countedQuantity === null ? 'Toch wissen' : `Vervang door ${whole(clash.write.countedQuantity)}`;
  }

  keepLabel(clash: CountConflict): string {
    return clash.line.countedQuantity === null ? 'Laat leeg' : `Laat ${whole(clash.line.countedQuantity)} staan`;
  }

  /** "Vervang door {m}": the same write again, with the revision of the line the server sent. */
  replaceTheirs(): void {
    const clash = this.conflict();
    if (!clash) return;
    this.conflict.set(null);
    this.mergeLine(clash.line);
    void this.save(clash.line, { ...clash.write, revision: clash.line.revision }, clash.intent, clash.order);
  }

  /** "Laat {n} staan": take over the other phone's line. */
  keepTheirs(): void {
    const clash = this.conflict();
    if (!clash) return;
    this.conflict.set(null);
    this.mergeLine(clash.line);
    if (clash.intent === 'reason') this.closeReason();
    else if (clash.intent === 'count') this.focusField(this.nextField(clash.line.id, clash.order));
    if (this.bookingOpen()) void this.loadCheck();
  }

  /* ------------------------------------------------------ adding a product */

  async addProduct(productId: number): Promise<void> {
    const countId = this.countId;
    if (this.working()) return;
    this.working.set(true);
    try {
      const line = await this.api.addCountLine(countId, productId);
      if (this.countId !== countId) return;
      this.mergeLine(line);
      this.addOpen.set(false);
      if (this.bookingOpen()) void this.loadCheck();
      else this.reveal(line);
    } catch (failure) {
      if (this.countId !== countId) return;
      this.ui.toast(messageOf(failure, 'Het product kon niet worden toegevoegd.'), 'err');
      if (refusalCode(failure) === 'TELLING_GESLOTEN') this.sessionClosed();
    } finally {
      this.working.set(false);
    }
  }

  /** Brings a line into the list as shown and puts the cursor in its field. */
  private reveal(line: CountLine): void {
    this.query.set('');
    if (!filterLines([line], this.chip(), '').length) this.chip.set('ALLES');
    this.focusField(line.id, true);
  }

  /* -------------------------------------------------------------- booking */

  openBooking(): void {
    this.check.set(null);
    this.rebasedIds.set([]);
    this.bookingOpen.set(true);
    void this.loadCheck();
  }

  /** Reads the check again; the one on screen stays until the new one is there. */
  async loadCheck(): Promise<void> {
    const countId = this.countId;
    const run = ++this.checkRun;
    this.checking.set(true);
    this.checkFailed.set(false);
    try {
      const check = await this.api.bookingCheck(countId);
      if (this.countId !== countId || run !== this.checkRun) return;
      this.check.set(check);
    } catch (failure) {
      if (this.countId !== countId || run !== this.checkRun) return;
      this.ui.toast(messageOf(failure, 'De controle kon niet worden geladen.'), 'err');
      if (refusalCode(failure) === 'TELLING_GESLOTEN') this.sessionClosed();
      else if (!this.check()) this.checkFailed.set(true);
    } finally {
      if (run === this.checkRun) this.checking.set(false);
    }
  }

  /** "Niet geteld met voorraad": back to the list on "Te tellen". */
  showUncounted(): void {
    this.bookingOpen.set(false);
    this.query.set('');
    this.chip.set('TE_TELLEN');
  }

  askBook(): void {
    const view = this.view();
    const check = this.check();
    if (!view || !check) return;
    this.ui.confirm({
      title: 'Telling boeken?',
      message: `De verschillen worden in de voorraad van ${escapeHtml(view.locationName)} geboekt. `
        + `Een fout herstel je daarna met 'Telling corrigeren'.`,
      confirmLabel: 'Telling boeken',
    }, () => void this.book(check.checkToken));
  }

  private async book(checkToken: string): Promise<void> {
    const countId = this.countId;
    if (this.working()) return;
    this.working.set(true);
    try {
      const booked = await this.api.bookCount(countId, checkToken);
      if (this.countId !== countId) return;
      this.view.set(booked);
      this.bookingOpen.set(false);
      this.chip.set('ALLES');
      this.ui.toast(`Telling geboekt. De voorraad van ${booked.locationName} is bijgewerkt.`);
    } catch (failure) {
      if (this.countId !== countId) return;
      /* TELLING_GEWIJZIGD, EERST_AFPUNTEN, EERST_BIJBOEKEN and the others: the server's words, then look again. */
      this.ui.toast(messageOf(failure, 'De telling kon niet worden geboekt.'), 'err');
      if (refusalCode(failure) === 'TELLING_GESLOTEN') {
        this.sessionClosed();
      } else {
        void this.refresh();
        void this.loadCheck();
      }
    } finally {
      this.working.set(false);
    }
  }

  /** Somebody else booked or cancelled this session: close what is open and show it as it is. */
  private sessionClosed(): void {
    this.bookingOpen.set(false);
    this.reasonTarget.set(null);
    this.addOpen.set(false);
    this.conflict.set(null);
    void this.load().then(() => {
      if (this.view()?.status !== 'OPEN') this.chip.set('ALLES');
    });
  }

  /* ----------------------------------------------------------------- menu */

  openMenu(event: MouseEvent): void {
    const button = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.set({ anchor: this.desktop.active() ? { x: button.left, y: button.bottom + 4 } : null });
  }

  pickMenu(item: ContextMenuItem): void {
    this.menu.set(null);
    if (item.id === 'add') this.addOpen.set(true);
    else if (item.id === 'print') this.print();
    else if (item.id === 'cancel') this.askCancel();
  }

  private askCancel(): void {
    this.ui.confirm({
      title: 'Telling annuleren?',
      message: 'Alle ingevulde aantallen van deze telling vervallen. Er is niets geboekt.',
      confirmLabel: 'Telling annuleren',
      danger: true,
    }, () => void this.cancel());
  }

  private async cancel(): Promise<void> {
    const countId = this.countId;
    if (this.working()) return;
    this.working.set(true);
    try {
      const cancelled = await this.api.cancelCount(countId);
      if (this.countId !== countId) return;
      this.view.set(cancelled);
      this.chip.set('ALLES');
      this.ui.toast('Telling geannuleerd. Er is niets geboekt.');
    } catch (failure) {
      if (this.countId !== countId) return;
      this.ui.toast(messageOf(failure, 'De telling kon niet worden geannuleerd.'), 'err');
      if (refusalCode(failure) === 'TELLING_GESLOTEN') this.sessionClosed();
    } finally {
      this.working.set(false);
    }
  }

  /* ---------------------------------------------------------------- print */

  /** "Tellijst afdrukken": the browser fires beforeprint, which draws the list. */
  print(): void {
    /* After the menu closed: a phone would otherwise print its sheet. */
    setTimeout(() => window.print());
  }

  /** Also for the browser's own print command: the list must be in the page before the snapshot is taken. */
  beforePrint(): void {
    this.printedAt.set(new Date().toISOString());
    this.printing.set(true);
    this.changes.detectChanges();
  }
}
