import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { BillDocumentReading, BillOverview, BillProposal, PurchaseOrderView } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { messageOf } from '../../core/api/errors';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { DateNlPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { normalizedVesselImo } from './container-tracking-model';

/**
 * Track & trace from the bill of lading (Emre, 2026-11-15: "moet ook met bill of lading kunnen"). The server reads
 * the B/L documents in the order's dossier; this sheet shows what one bill says (number, container, ship and voyage,
 * route, on-board day), lists what taking it over changes on the order (reference, departure, linked ship) and takes
 * it over. It loads and saves itself, as the Aankomst sheet does, and hands the order as it stands to its parent.
 *
 * The server works every proposal out and works it out again on the apply: the sheet only shows and sends the
 * document id. A ship the ERP has not linked before has no IMO number (there is no keyless way to look one up by
 * name): the user types it once, after that the ERP knows the ship by its name.
 *
 * Not read through viewChild by its hosts: orderId is a required input.
 */
@Component({
  selector: 'app-purchase-bill-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Skeleton, LoadError, DateNlPipe],
  template: `
    <app-sheet title="Bill of lading" variant="ios" (closed)="close()">
      <div body class="bl" [attr.inert]="busy() ? '' : null">
        @if (loading()) {
          <div role="status" aria-label="Bill of lading lezen"><app-skeleton kind="lines" [rows]="6" /></div>
        } @else if (failure(); as text) {
          <app-load-error title="De bill of lading kon niet worden gelezen" [message]="text" (retry)="load()" />
        } @else if (overview(); as data) {
          @let doc = reading();
          @if (doc) {
            @if (readable().length > 1) {
              <div class="bl__docs" role="group" aria-label="Welke bill of lading">
                @for (item of readable(); track item.documentId) {
                  <button class="bl__doc" type="button" [attr.aria-pressed]="item.documentId === doc.documentId" (click)="choose(item.documentId)">
                    <b>{{ nameOf(item) }}</b>
                    <span>{{ item.draft ? 'Concept' : 'Definitief' }}@if (item.vessel) { · {{ item.vessel }} }</span>
                  </button>
                }
              </div>
            } @else {
              <p class="bl__source"><b>{{ nameOf(doc) }}</b><span class="bl__tag" [class.bl__tag--draft]="doc.draft">{{ doc.draft ? 'Concept' : 'Definitief' }}</span></p>
            }

            <dl class="bl__facts">
              @if (billText(doc); as text) { <div><dt>B/L</dt><dd>{{ text }}</dd></div> }
              @if (doc.containers?.length) { <div><dt>Container</dt><dd>{{ doc.containers.join(', ') }}</dd></div> }
              @if (shipText(doc.vessel, doc.voyage); as text) { <div><dt>Schip</dt><dd>{{ text }}</dd></div> }
              @if (doc.portOfLoading || doc.portOfDischarge) { <div><dt>Route</dt><dd>{{ doc.portOfLoading || '—' }} → {{ doc.portOfDischarge || '—' }}</dd></div> }
              @if (doc.onBoard) { <div><dt>Aan boord</dt><dd>{{ doc.onBoard | dateNl }}</dd></div> }
              @else if (doc.issuedOn) { <div><dt>Uitgegeven</dt><dd>{{ doc.issuedOn | dateNl }}</dd></div> }
            </dl>

            @if (proposal(); as plan) {
              <section class="bl__part" aria-labelledby="bl-changes">
                <h3 id="bl-changes">Wat verandert</h3>
                @if (nothing(); as line) {
                  <p class="bl__note">{{ line }}</p>
                } @else {
                  <dl class="bl__facts">
                    @if (plan.referenceChanges && plan.reference) {
                      <div><dt>Referentie</dt><dd><span class="bl__was">{{ data.current.trackingReference || '—' }}</span><span class="bl__now"><span aria-hidden="true">→ </span><span class="sr-only">wordt </span>{{ plan.reference }}</span></dd></div>
                    }
                    @if (plan.shippedOnChanges && plan.shippedOn) {
                      <div><dt>Vertrek</dt><dd><span class="bl__was">{{ data.current.shippedOn ? (data.current.shippedOn | dateNl) : '—' }}</span><span class="bl__now"><span aria-hidden="true">→ </span><span class="sr-only">wordt </span>{{ plan.shippedOn | dateNl }}</span></dd></div>
                    }
                    @if (linkImo(); as imo) { <div><dt>Schip</dt><dd>wordt gekoppeld · IMO {{ imo }}</dd></div> }
                    @if (plan.billShipChanges) { <div><dt>Schip op de B/L</dt><dd>{{ billShipText(doc, plan, data) }}</dd></div> }
                  </dl>
                }
              </section>

              @if (imoVessel(); as vessel) {
                <div class="field bl__imo">
                  <label for="bl-imo">IMO-nummer van {{ vessel }} <span class="opt"></span></label>
                  <input class="input" id="bl-imo" type="text" inputmode="numeric" autocomplete="off" maxlength="16" placeholder="7 cijfers"
                         [value]="imoText()" (input)="imoText.set($any($event.target).value)" (blur)="imoLeft.set(true)"
                         [attr.aria-invalid]="imoWarn() ? 'true' : null" aria-describedby="bl-imo-hint" />
                  @if (imoWarn()) { <span class="hint bl__bad" role="alert">Dit is geen geldig IMO-nummer: zeven cijfers.</span> }
                  <span class="hint" id="bl-imo-hint">Eén keer invullen; daarna kent het ERP dit schip.</span>
                  <a class="bl__find" [href]="finderUrl(vessel)" target="_blank" rel="noopener noreferrer">Zoek {{ vessel }} op VesselFinder</a>
                </div>
              }

              @if (plan.portNote || plan.warnings?.length) {
                <ul class="bl__warns">
                  @if (plan.portNote) { <li>{{ plan.portNote }}</li> }
                  @for (warning of plan.warnings; track $index) { <li>{{ warning }}</li> }
                </ul>
              }
            }
          } @else if (!unread().length) {
            <p class="bl__note">Nog geen bill of lading in het dossier.</p>
          }

          @if (unread().length) {
            <ul class="bl__unread" [attr.aria-label]="doc ? 'Niet gelezen documenten' : 'Documenten in het dossier'">
              @for (item of unread(); track item.documentId) { <li><b>{{ nameOf(item) }}</b> · {{ item.note || 'Dit document kan niet gelezen worden.' }}</li> }
            </ul>
          }

          <input #file type="file" hidden accept=".pdf,application/pdf" (change)="upload($event)" />
          @if (doc) {
            <button class="linklike bl__add" type="button" (click)="file.click()">Andere B/L toevoegen</button>
          } @else {
            <button class="btn bl__upload" type="button" (click)="file.click()">{{ busy() === 'upload' ? 'Bezig…' : 'B/L of telex release toevoegen' }}</button>
          }
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" [disabled]="!!busy()" (click)="close()">{{ reading() ? 'Annuleren' : 'Sluiten' }}</button>
        @if (reading()) {
          <button class="btn btn--primary" type="button" [disabled]="!!busy() || !canApply()" (click)="apply()">{{ busy() === 'apply' ? 'Bezig…' : 'Overnemen' }}</button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .bl{display:grid;gap:16px;min-width:0}
    .bl__docs{display:grid;gap:6px}
    .bl__doc{display:grid;gap:2px;width:100%;min-height:48px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .bl__doc[aria-pressed=true]{border-color:var(--rose-line);background:var(--rose-soft)}
    .bl__doc:focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    .bl__doc b,.bl__source b{min-width:0;font-size:14px;font-weight:650;overflow-wrap:anywhere}
    .bl__doc span{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
    .bl__doc[aria-pressed=true] span{color:var(--rose-dark)}
    .bl__source{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0}
    .bl__tag{flex:none;padding:2px 9px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:12px;font-weight:600}
    .bl__tag--draft{background:var(--warn-soft);color:#7c450b}
    .bl__facts{display:grid;margin:0}
    .bl__facts>div{display:grid;grid-template-columns:104px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13.5px}
    .bl__facts>div:last-child{border-bottom:0}
    .bl__facts dt{color:var(--muted)}
    .bl__facts dd{min-width:0;margin:0;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .bl__was{margin-right:6px;color:var(--muted);font-weight:500}
    /* "→ new" stays together when the old value fills the line. */
    .bl__now{display:inline-block}
    .bl__part{display:grid;gap:4px;min-width:0;padding-top:14px;border-top:1px solid var(--line)}
    .bl__part h3{margin:0;font-size:15px;font-weight:650}
    .bl__note{margin:0;color:var(--muted);font-size:13px;line-height:1.45}
    .bl__imo{margin:0}
    .bl__imo .bl__bad{color:var(--danger)}
    .bl__find{align-self:start;font-size:13px}
    .bl__warns,.bl__unread{display:grid;gap:4px;margin:0;padding:0;list-style:none;font-size:13px;line-height:1.45}
    .bl__warns{color:#8a5a10}
    .bl__unread{color:var(--muted)}
    .bl__unread b{color:var(--ink-2);font-weight:600;overflow-wrap:anywhere}
    .bl__add{justify-self:start;font-size:13px}
    .bl__upload{justify-self:start}
    /* Phone: the value under its title, rows a finger can press. */
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      .bl{padding:0 16px}
      .bl__doc{min-height:56px;padding:10px 14px;border-radius:14px}
      .bl__doc b,.bl__source b{font-size:16px}
      .bl__doc span{font-size:13.5px}
      .bl__facts>div{grid-template-columns:minmax(0,1fr);gap:1px;font-size:15px}
      .bl__facts dt{font-size:13px}
      .bl__add,.bl__find{display:flex;align-items:center;min-height:44px;font-size:15px}
      .bl__upload{justify-self:stretch;min-height:50px}
    }
  `,
})
export class PurchaseBillSheet {
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);

  readonly orderId = input.required<number>();
  /** The bill was taken over: the order as it stands after the tracking check that follows it. */
  readonly applied = output<PurchaseOrderView>();
  /** After each file this sheet put in the dossier, so the page can read its documents again. */
  readonly uploaded = output<void>();
  readonly closed = output<void>();

  readonly overview = signal<BillOverview | null>(null);
  readonly loading = signal(false);
  readonly failure = signal<string | null>(null);
  readonly busy = signal<'apply' | 'upload' | null>(null);
  /** The bill the user chose; null: the one the server names as best. */
  private readonly picked = signal<number | null>(null);
  readonly imoText = signal('');
  /** The IMO field was left once: only then does text that is no IMO number get its line (not while typing). */
  readonly imoLeft = signal(false);
  private loadVersion = 0;

  readonly readable = computed(() => (this.overview()?.documents ?? []).filter((doc) => doc.readable));
  /** In the dossier but without a reading: a scan, no PDF, no bill recognised. */
  readonly unread = computed(() => (this.overview()?.documents ?? []).filter((doc) => !doc.readable));
  /** The bill on screen: the one chosen, else the server's best, else the first that reads. */
  readonly reading = computed<BillDocumentReading | null>(() => {
    const docs = this.readable();
    const best = this.overview()?.bestDocumentId ?? null;
    return docs.find((doc) => doc.documentId === this.picked()) ?? docs.find((doc) => doc.documentId === best) ?? docs[0] ?? null;
  });
  readonly proposal = computed<BillProposal | null>(() => {
    const doc = this.reading();
    return doc ? (this.overview()?.proposals ?? []).find((item) => item.documentId === doc.documentId) ?? null : null;
  });

  /** The bill names a ship the ERP has no IMO number for: its name, for the field. */
  readonly imoVessel = computed(() => {
    const plan = this.proposal();
    return plan && !plan.imo ? plan.vessel?.trim() || null : null;
  });
  /** The typed IMO as its seven digits; null while empty or no IMO number. */
  readonly typedImo = computed(() => this.imoVessel() ? normalizedVesselImo(this.imoText()) : null);
  /** Text that is no IMO number: nothing is taken over until it is put right or emptied, or it would go unsaid. */
  private readonly imoWrong = computed(() => !!this.imoVessel() && !!this.imoText().trim() && !this.typedImo());
  readonly imoWarn = computed(() => this.imoWrong() && (this.imoLeft() || this.imoText().replace(/\D/g, '').length >= 7));
  /** The ship the apply links: the one the ERP knows under the bill's name, or the IMO typed (not the one linked now). */
  readonly linkImo = computed(() => {
    const plan = this.proposal();
    if (!plan) return null;
    if (plan.imoFrom === 'KNOWN' && plan.shipChanges && plan.imo) return plan.imo;
    const typed = this.typedImo();
    return typed && typed !== (this.overview()?.current.vesselImo ?? null) ? typed : null;
  });
  private readonly changes = computed(() => {
    const plan = this.proposal();
    return !!plan && (plan.referenceChanges || plan.shippedOnChanges || plan.shipChanges || plan.billShipChanges);
  });
  readonly canApply = computed(() => !!this.proposal() && !this.imoWrong() && (this.changes() || !!this.linkImo()));
  /** Nothing to take over, in one line instead of an empty list. */
  readonly nothing = computed(() => {
    const plan = this.proposal();
    if (!plan || this.changes() || this.linkImo()) return null;
    const vessel = this.imoVessel();
    if (!vessel) return 'Alles klopt al met deze B/L.';
    const typed = this.typedImo();
    return typed ? `IMO ${typed} is al aan deze container gekoppeld.` : `Vul het IMO-nummer in om ${vessel} te koppelen.`;
  });

  constructor() {
    effect(() => {
      this.orderId();
      untracked(() => void this.load());
    });
  }

  nameOf(doc: BillDocumentReading): string {
    return doc.label?.trim() || doc.filename;
  }

  /** "Evergreen · EGLV143650155115". */
  billText(doc: BillDocumentReading): string {
    return [doc.carrier?.trim(), doc.billNumber?.trim()].filter(Boolean).join(' · ');
  }

  /** "EVER ALLY · reis 1419-004W". */
  shipText(vessel: string | null | undefined, voyage: string | null | undefined): string {
    return [vessel?.trim(), voyage?.trim() ? `reis ${voyage.trim()}` : ''].filter(Boolean).join(' · ');
  }

  /**
   * What the order keeps as "the ship on the B/L": a final bill's ship and voyage. A draft's ship can still
   * change, so taking a draft over drops what an earlier final bill stored.
   */
  billShipText(doc: BillDocumentReading, plan: BillProposal, data: BillOverview): string {
    const named = doc.draft ? '' : this.shipText(plan.vessel, plan.voyage);
    if (named) return named;
    const stored = this.shipText(data.current.billVessel, data.current.billVoyage);
    return `${stored || 'Het schip'} vervalt${doc.draft ? ' (concept-B/L)' : ''}`;
  }

  finderUrl(vessel: string): string {
    return `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(vessel)}`;
  }

  choose(documentId: number): void {
    if (documentId === this.reading()?.documentId) return;
    this.picked.set(documentId);
    /* A typed number was for the other bill's ship. */
    this.imoText.set('');
    this.imoLeft.set(false);
  }

  /** No closing while it saves or adds a file: the answer must still reach the page. */
  close(): void {
    if (!this.busy()) this.closed.emit();
  }

  async load(): Promise<void> {
    const version = ++this.loadVersion;
    const current = () => !this.destroyRef.destroyed && version === this.loadVersion;
    this.loading.set(true);
    this.failure.set(null);
    this.overview.set(null);
    try {
      const data = await this.sourcing.billOfLading(this.orderId());
      if (!current()) return;
      this.picked.set(null);
      this.imoText.set('');
      this.imoLeft.set(false);
      this.overview.set(data);
    } catch (failure: unknown) {
      if (current()) this.failure.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      if (current()) this.loading.set(false);
    }
  }

  async apply(): Promise<void> {
    const data = this.overview();
    const doc = this.reading();
    if (!data || !doc || this.busy() || !this.canApply()) return;
    this.busy.set('apply');
    try {
      const fresh = await this.sourcing.applyBillOfLading(this.orderId(), {
        documentId: doc.documentId,
        imo: this.typedImo(),
        /* The server refuses when the reference changed since the sheet read it: the proposal was for that text. */
        expectedReference: data.current.trackingReference ?? null,
      });
      this.ui.toast('Track & trace bijgewerkt uit de bill of lading');
      if (!this.destroyRef.destroyed) this.applied.emit(fresh);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'De bill of lading overnemen is niet gelukt'), 'err');
    } finally {
      this.busy.set(null);
    }
  }

  /** A B/L or telex release added from the sheet lands in the dossier as a bill of lading and is read at once. */
  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    /* The same file can be chosen again after a failed attempt. */
    input.value = '';
    if (!file || this.busy()) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      this.ui.toast('Kies een PDF: alleen die kan gelezen worden.', 'err');
      return;
    }
    this.busy.set('upload');
    try {
      await this.sourcing.addDocument(this.orderId(), file, 'BILL_OF_LADING', null, null);
      this.ui.toast('Bill of lading bij de documenten gezet');
      if (this.destroyRef.destroyed) return;
      this.uploaded.emit();
      await this.load();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Het document toevoegen is niet gelukt'), 'err');
    } finally {
      this.busy.set(null);
    }
  }
}
