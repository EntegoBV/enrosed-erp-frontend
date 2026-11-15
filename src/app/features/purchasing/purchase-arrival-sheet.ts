import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import type { ContainerTracking } from '../../core/api/container-tracking-models';
import type { PurchaseArrival, PurchaseOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { messageOf } from '../../core/api/errors';
import { DateField } from '../../shared/date-field';
import { DateNlPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';

/** "di 18/11/2026 · 14:00", "Nog niet gepland". */
export function arrivalText(day: string | null | undefined, hour: string | null | undefined, empty = 'Nog niet gepland'): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return empty;
  const [y, m, d] = day.split('-').map(Number);
  const weekday = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const text = `${weekday} ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  return hour ? `${text} · ${hour}` : text;
}

/** The arrival block of an order, also from a server without it. */
export function orderArrival(view: Pick<PurchaseOrderView, 'arrival'> | null | undefined): PurchaseArrival {
  return {
    containerAt: view?.arrival?.containerAt ?? null,
    containerByHand: view?.arrival?.containerByHand === true,
    warehouseOn: view?.arrival?.warehouseOn ?? null,
    warehouseAt: view?.arrival?.warehouseAt ?? null,
  };
}

const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Aankomst (Emre, 2026-11-15): the container's day and hour at the port, and the day and hour it is expected at
 * the place it is unloaded at (Zaltbommel). With track & trace the container's day follows the source until
 * "Zelf instellen"; then it stays as set until "Track & trace volgen". The sheet saves itself and hands the
 * order as it stands to its parent. Verhoeven sees both in the partner portal.
 */
@Component({
  selector: 'app-purchase-arrival-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, DateField, DateNlPipe],
  template: `
    @let order = view().order;
    <app-sheet title="Aankomst" variant="ios" (closed)="close()">
      <div body class="arr" [attr.inert]="busy() ? '' : null">
        <section class="arr__part" aria-labelledby="arr-container">
          <div class="arr__head">
            <h3 id="arr-container">Container in {{ port() }}</h3>
            @if (tracked()) {
              <span class="arr__tag" [class.arr__tag--hand]="byHand()">{{ byHand() ? 'Met de hand' : 'Track & trace' }}</span>
            }
          </div>
          @if (tracked() && !byHand()) {
            <div class="arr__follow">
              <strong>{{ text(containerOn(), null, 'Datum nog onbekend') }}</strong>
              <span>Track &amp; trace zet deze datum.</span>
            </div>
            <button class="btn arr__switch" type="button" (click)="setByHand(true)">Zelf instellen</button>
          } @else {
            <div class="arr__pair">
              <div class="field">
                <label for="arr-container-day">Dag</label>
                <app-date-field fieldId="arr-container-day" [value]="containerOn()" (valueChange)="containerOn.set($event)" />
              </div>
              <div class="field arr__hour">
                <label for="arr-container-hour">Uur <span class="opt"></span></label>
                <input class="input" id="arr-container-hour" type="time" step="300" [value]="containerAt()"
                       (input)="containerAt.set($any($event.target).value)" (change)="containerAt.set($any($event.target).value)" />
              </div>
            </div>
            @if (tracked()) {
              <p class="arr__note">Track &amp; trace past deze datum niet meer aan.
                @if (sourceArrival(); as source) { Track &amp; trace meldt {{ source | dateNl }}. }
                <button class="linklike" type="button" (click)="setByHand(false)">Track &amp; trace volgen</button></p>
            } @else if (unsavedTracking()) {
              <p class="arr__note">Het track &amp; trace-nummer is nog niet opgeslagen: sla het eerst op om deze datum met de hand vast te zetten.</p>
            }
          }
        </section>

        <section class="arr__part" aria-labelledby="arr-warehouse">
          <div class="arr__head"><h3 id="arr-warehouse">Aankomst {{ placeName() }}</h3></div>
          <div class="arr__pair">
            <div class="field">
              <label for="arr-warehouse-day">Dag</label>
              <app-date-field fieldId="arr-warehouse-day" [value]="warehouseOn()" (valueChange)="warehouseOn.set($event)" />
            </div>
            <div class="field arr__hour">
              <label for="arr-warehouse-hour">Uur</label>
              <input class="input" id="arr-warehouse-hour" type="time" step="300" [value]="warehouseAt()"
                     (input)="warehouseAt.set($any($event.target).value)" (change)="warehouseAt.set($any($event.target).value)" />
            </div>
          </div>
          @if (beforePort()) { <p class="arr__note arr__note--warn">Let op: dat is vóór de aankomst van de container in {{ port() }}.</p> }
          @if (partnerSees()) { <p class="arr__note">Verhoeven ziet dit in het partnerportaal.</p> }
        </section>

        @if (problem(); as text) { <p class="arr__problem" role="alert">{{ text }}</p> }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !!problem() || !changed()" (click)="save(order.id)">
          {{ busy() ? 'Bezig…' : 'Opslaan' }}
        </button>
      </div>
    </app-sheet>
  `,
  styles: `
    .arr{display:grid;gap:18px;min-width:0}
    .arr__part{display:grid;gap:10px;min-width:0}
    .arr__part + .arr__part{padding-top:16px;border-top:1px solid var(--line)}
    .arr__head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
    .arr__head h3{margin:0;font-size:15px;font-weight:650;min-width:0;overflow-wrap:anywhere}
    .arr__tag{flex:none;padding:2px 9px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:12px;font-weight:600}
    .arr__tag--hand{background:var(--rose-soft);color:var(--rose)}
    .arr__follow{display:grid;gap:2px}
    .arr__follow strong{font-size:15px;font-variant-numeric:tabular-nums}
    .arr__follow span{color:var(--muted);font-size:13px}
    .arr__switch{justify-self:start}
    .arr__pair{display:grid;grid-template-columns:minmax(0,1fr) 136px;gap:10px;align-items:end}
    .arr__hour .input{font-variant-numeric:tabular-nums}
    .arr__note{margin:0;color:var(--muted);font-size:13px;line-height:1.45}
    .arr__note .linklike{font-size:13px}
    .arr__note--warn{color:#8a5a10}
    .arr__problem{margin:0;padding:10px 12px;border-radius:12px;background:var(--warn-soft);color:#7c450b;font-size:13px;line-height:1.45}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {.arr{padding:0 16px}}
  `,
})
export class PurchaseArrivalSheet implements OnInit {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);

  readonly view = input.required<PurchaseOrderView>();
  /** Where the container is unloaded ("Lossen op"): Zaltbommel for the main warehouse. */
  readonly placeName = input('Zaltbommel');
  /** The order's tracking row, when the page has it: names the source's date beside a date by hand. */
  readonly trackingRow = input<ContainerTracking | null>(null);
  /**
   * The track & trace reference as SAVED (an editor's draft may hold one that is not): the server decides "by hand"
   * from the stored reference, so the sheet does too. Undefined: the view's own reference (the phone view saves
   * nothing else).
   */
  readonly savedTrackingReference = input<string | null | undefined>(undefined);
  /** Whether the partner portal shows this place (the main warehouse, or the partner's own container). */
  readonly partnerSees = input(true);
  readonly saved = output<PurchaseOrderView>();
  readonly closed = output<void>();

  private readonly start = computed(() => {
    const view = this.view();
    const arrival = orderArrival(view);
    return {
      containerOn: view.order.expectedArrival ?? '',
      containerAt: arrival.containerAt ?? '',
      byHand: arrival.containerByHand,
      warehouseOn: arrival.warehouseOn ?? '',
      warehouseAt: arrival.warehouseAt ?? '',
    };
  });

  /* The draft starts from the order as opened (ngOnInit); a later answer of the page does not overwrite typing. */
  readonly containerOn = signal('');
  readonly containerAt = signal('');
  readonly byHand = signal(false);
  readonly warehouseOn = signal('');
  readonly warehouseAt = signal('');
  readonly busy = signal(false);

  readonly tracked = computed(() => {
    const saved = this.savedTrackingReference();
    return !!(saved === undefined ? this.view().order.trackingReference : saved)?.trim();
  });
  /** The draft has a reference the server does not have yet. */
  readonly unsavedTracking = computed(() => !this.tracked() && !!this.view().order.trackingReference?.trim());
  readonly port = computed(() => this.view().order.destinationPort?.trim() || 'Rotterdam');
  readonly sourceArrival = computed(() => {
    const row = this.trackingRow();
    return row?.sourceArrival && row.sourceArrival !== this.containerOn() ? row.sourceArrival : null;
  });

  /** The warehouse day lies before the day at the port: allowed (a hand slip is likelier), said quietly. */
  readonly beforePort = computed(() => {
    const port = this.containerOn();
    const warehouse = this.warehouseOn();
    return !!port && !!warehouse && warehouse < port;
  });

  readonly problem = computed(() => {
    const containerAt = this.containerAt().trim();
    const warehouseAt = this.warehouseAt().trim();
    if (containerAt && !HOUR.test(containerAt.slice(0, 5))) return 'Het uur van de container is geen geldig uur.';
    if (warehouseAt && !HOUR.test(warehouseAt.slice(0, 5))) return `Het uur in ${this.placeName()} is geen geldig uur.`;
    if (containerAt && !this.containerOn() && (!this.tracked() || this.byHand())) return 'Kies ook de dag waarop de container aankomt.';
    if (warehouseAt && !this.warehouseOn()) return `Kies ook de dag van de aankomst in ${this.placeName()}.`;
    return null;
  });

  readonly changed = computed(() => {
    const start = this.start();
    return this.containerOn() !== start.containerOn || this.hour(this.containerAt()) !== start.containerAt
      || (this.tracked() && this.byHand() !== start.byHand)
      || this.warehouseOn() !== start.warehouseOn || this.hour(this.warehouseAt()) !== start.warehouseAt;
  });

  ngOnInit(): void {
    const start = this.start();
    this.containerOn.set(start.containerOn);
    this.containerAt.set(start.containerAt);
    this.byHand.set(start.byHand);
    this.warehouseOn.set(start.warehouseOn);
    this.warehouseAt.set(start.warehouseAt);
  }

  text(day: string | null | undefined, hour: string | null | undefined, empty?: string): string {
    return arrivalText(day, hour, empty);
  }

  /** No closing while the save runs: its answer must still reach the page (the draft and its baseline). */
  close(): void {
    if (!this.busy()) this.closed.emit();
  }

  setByHand(value: boolean): void {
    this.byHand.set(value);
    if (!value) {
      /* Following again: the day stays until the source's date replaces it, an hour does not come along. */
      this.containerOn.set(this.start().containerOn);
      this.containerAt.set('');
    }
  }

  async save(id: number): Promise<void> {
    if (this.busy() || this.problem()) return;
    this.busy.set(true);
    try {
      const following = this.tracked() && !this.byHand();
      const fresh = await this.sourcing.setArrival(id, {
        /* Following: the day the sheet opened with (the server keeps its stored day anyway). */
        containerOn: (following ? this.start().containerOn : this.containerOn()) || null,
        containerAt: following ? null : this.hour(this.containerAt()) || null,
        containerByHand: this.tracked() && this.byHand(),
        warehouseOn: this.warehouseOn() || null,
        warehouseAt: this.warehouseOn() ? this.hour(this.warehouseAt()) || null : null,
      });
      this.ui.toast('Aankomst opgeslagen');
      this.saved.emit(fresh);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Aankomst opslaan mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /** "08:30:00" from some browsers reads "08:30". */
  private hour(value: string): string {
    const text = value.trim();
    return text.length >= 5 ? text.slice(0, 5) : text;
  }
}
