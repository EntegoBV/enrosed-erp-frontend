import { Location } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { saveBlob } from '../../core/api/download';
import { messageOf, readableFailure } from '../../core/api/errors';
import { InvoiceFinderApi } from '../../core/api/invoice-finder-api';
import type { InvoiceFile, InvoiceFinderOdoo, InvoiceFinderQuery, InvoiceLink, InvoiceRow } from '../../core/api/invoice-finder-api';
import { Ui } from '../../shared/ui';
import { FinanceState } from './finance-state';
import type { FinanceLocation } from './finance-url';
import { downloadName, scopeOf } from './invoice-finder';

/** What the server answered for one filter: shown at once when that filter comes back, then fetched again. */
interface CachedPage {
  rows: InvoiceRow[];
  nextCursor: string | null;
  erpCount: number;
  odoo: InvoiceFinderOdoo | null;
}

const PAGE_SIZE = 50;
const statusOf = (failure: unknown): number | undefined => (failure as { status?: number } | null)?.status;
const codeOf = (failure: unknown): string | undefined => {
  const body = (failure as { error?: unknown } | null)?.error;
  return body && typeof body === 'object' ? (body as { code?: string }).code : undefined;
};

/**
 * Facturen: the finder's list, paging, preview row and actions. It loads on
 * its own (never waits for the sixteen sources of FinanceState) and follows
 * the address: tab, q, period, chip and container pick the list, doc the row
 * in the preview. Provided by CostsPage next to FinanceState.
 */
@Injectable()
export class InvoiceFinderState {
  private readonly state = inject(FinanceState);
  private readonly api = inject(InvoiceFinderApi);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly browserLocation = inject(Location);

  readonly rows = signal<InvoiceRow[]>([]);
  /** The first page of a filter is on its way. */
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal('');
  /** The server has no finder yet (the list answered 404). */
  readonly pending = signal(false);
  readonly odoo = signal<InvoiceFinderOdoo | null>(null);
  readonly hasMore = signal(false);
  readonly erpCount = signal(0);
  /** Entered through open() (phone ⋯ or the Kosten cell): the phone's back goes back in history. */
  readonly pushed = signal(false);
  readonly registering = signal<InvoiceRow | null>(null);
  readonly marking = signal<InvoiceRow | null>(null);
  /** Some page has arrived since the page opened: the skeleton gives way. */
  readonly answered = signal(false);

  /** A row asked for by key that the list does not hold (a deep link outside the filters). */
  private readonly extra = signal<InvoiceRow | null>(null);
  /** The key whose row answered 404. */
  private readonly gone = signal<string | null>(null);
  /** The filter of the rows on screen, once its first page answered. */
  private readonly answeredKey = signal('');

  readonly selectedKey = computed(() => {
    const location = this.state.location();
    return location.view === 'invoices' ? location.doc : '';
  });
  readonly selected = computed<InvoiceRow | null>(() => {
    const key = this.selectedKey();
    if (!key) return null;
    const extra = this.extra();
    return this.rows().find((row) => row.key === key) ?? (extra?.key === key ? extra : null);
  });
  readonly selectedGone = computed(() => !!this.selectedKey() && this.gone() === this.selectedKey() && !this.selected());
  readonly odooNote = computed(() => {
    const state = this.odoo()?.state;
    return state === 'NOT_CONNECTED' ? 'Odoo niet verbonden' : state === 'DEMO' ? 'Odoo: voorbeeld' : null;
  });
  /** The register sheet needs the bank lines and costs of FinanceState. */
  readonly financeReady = computed(() => !!this.state.loadedAt());

  private readonly cache = new Map<string, CachedPage>();
  private currentKey = '';
  private nextCursor: string | null = null;
  private ticket = 0;
  private docAsked = '';

  constructor() {
    /* The list follows the address while Facturen is on screen. */
    effect(() => {
      const location = this.state.location();
      if (location.view !== 'invoices') {
        untracked(() => {
          this.pushed.set(false);
          this.currentKey = '';
        });
        return;
      }
      const query = this.queryOf(location);
      const key = JSON.stringify(query);
      untracked(() => {
        if (key === this.currentKey) return;
        this.currentKey = key;
        const cached = this.cache.get(key);
        if (cached) this.show(cached);
        void this.load(key, query);
      });
    });

    /* A row in the preview that the list does not hold is fetched once per filter, after its first page answered. */
    effect(() => {
      const doc = this.selectedKey();
      const rows = this.rows();
      /* answeredKey is the signal; currentKey (plain) is only compared, so a newer filter waits for its own answer. */
      const ready = this.answeredKey() !== '' && this.answeredKey() === this.currentKey;
      if (!doc || !ready || rows.some((row) => row.key === doc)) return;
      const asked = `${this.answeredKey()}|${doc}`;
      if (this.docAsked === asked) return;
      this.docAsked = asked;
      untracked(() => void this.fetchRow(doc));
    });

    /* Every newer load of FinanceState (Vernieuwen, the visibility reload, saves) refreshes the finder too; the first one does not. */
    let previous: Date | null = null;
    effect(() => {
      const at = this.state.loadedAt();
      untracked(() => {
        if (previous && at && at.getTime() !== previous.getTime()) {
          this.cache.clear();
          if (this.state.location().view === 'invoices') void this.reload();
        }
        previous = at;
      });
    });
  }

  /** The server query of an address. */
  queryOf(location: FinanceLocation): InvoiceFinderQuery {
    const tab = location.tab === 'out' ? 'out' : 'in';
    const range = this.state.rangeOf(location);
    return { direction: tab === 'out' ? 'OUT' : 'IN', scope: scopeOf(tab, location.only), q: location.q.trim(), from: range.from, to: range.to,
      orderId: location.po, limit: PAGE_SIZE };
  }

  private show(page: CachedPage): void {
    this.rows.set(page.rows);
    this.nextCursor = page.nextCursor;
    this.hasMore.set(!!page.nextCursor);
    this.erpCount.set(page.erpCount);
    this.odoo.set(page.odoo);
  }

  /** Page 1 of a filter; a later request wins, rows already on screen stay until the answer arrives. */
  private async load(key: string, query: InvoiceFinderQuery): Promise<void> {
    const ticket = ++this.ticket;
    this.loading.set(true);
    this.loadingMore.set(false);
    try {
      const page = await this.api.list({ ...query, cursor: null });
      if (ticket !== this.ticket) return;
      const cached: CachedPage = { rows: page.rows ?? [], nextCursor: page.nextCursor ?? null, erpCount: page.erpCount ?? 0, odoo: page.odoo ?? null };
      this.cache.set(key, cached);
      this.show(cached);
      this.error.set('');
      this.pending.set(false);
    } catch (failure) {
      if (ticket !== this.ticket) return;
      if (statusOf(failure) === 404) {
        this.pending.set(true);
        this.show({ rows: [], nextCursor: null, erpCount: 0, odoo: null });
      } else {
        this.error.set(messageOf(failure, 'Facturen laden mislukt.'));
      }
    } finally {
      if (ticket === this.ticket) {
        this.loading.set(false);
        this.answered.set(true);
        this.answeredKey.set(key);
      }
    }
  }

  /** "Meer laden": the next page after the cursor; a stale cursor (filters changed in between) starts again at page 1. */
  async more(): Promise<void> {
    const cursor = this.nextCursor;
    if (!cursor || this.loadingMore() || this.loading()) return;
    const ticket = this.ticket;
    const key = this.currentKey;
    this.loadingMore.set(true);
    try {
      const page = await this.api.list({ ...(JSON.parse(key) as InvoiceFinderQuery), cursor });
      if (ticket !== this.ticket) return;
      const seen = new Set(this.rows().map((row) => row.key));
      const rows = [...this.rows(), ...(page.rows ?? []).filter((row) => !seen.has(row.key))];
      const cached: CachedPage = { rows, nextCursor: page.nextCursor ?? null, erpCount: page.erpCount ?? this.erpCount(), odoo: page.odoo ?? this.odoo() };
      this.cache.set(key, cached);
      this.show(cached);
    } catch (failure) {
      if (ticket !== this.ticket) return;
      if (statusOf(failure) === 400 && codeOf(failure) === 'INVALID_CURSOR') { void this.reload(); return; }
      this.ui.toast(messageOf(failure, 'Meer facturen laden mislukt.'), 'err');
    } finally {
      if (ticket === this.ticket) this.loadingMore.set(false);
    }
  }

  /** Page 1 again (Opnieuw, Vernieuwen, a stale cursor). */
  reload(): Promise<void> {
    const location = this.state.location();
    if (location.view !== 'invoices') return Promise.resolve();
    const query = this.queryOf(location);
    const key = JSON.stringify(query);
    this.cache.delete(key);
    this.currentKey = key;
    this.docAsked = '';
    return this.load(key, query);
  }

  private async fetchRow(key: string): Promise<void> {
    try {
      const row = await this.api.row(key);
      if (this.selectedKey() !== key) return;
      if (row.key !== key) {
        /* The key now stands for another row (a registered Odoo bill is its cost): the address follows. */
        this.extra.set(row);
        this.state.go({ doc: row.key });
      } else this.extra.set(row);
    } catch (failure) {
      if (statusOf(failure) === 404) this.gone.set(key);
      else if (this.selectedKey() === key) this.ui.toast(messageOf(failure, 'Deze factuur laden mislukt.'), 'err');
    }
  }

  /** Into Facturen from the phone's Kosten cell or ⋯ (history, so Back returns). */
  open(patch: Partial<FinanceLocation> = {}): void {
    this.pushed.set(true);
    this.state.go({ view: 'invoices', ...patch }, 'push');
  }

  /** The phone's back while Facturen was pushed. */
  back(): void {
    this.browserLocation.back();
  }

  /** The preview shows a row: the desk replaces the address, the phone pushes (Back closes the sheet). */
  select(key: string, mode: 'replace' | 'push' = 'replace'): void {
    if (this.selectedKey() === key) return;
    this.state.go({ doc: key }, mode);
  }

  close(): void {
    if (this.selectedKey()) this.state.go({ doc: '' });
  }

  /** A row came back from an action; when its key changed (registered → cost), the address follows. */
  replaceRow(row: InvoiceRow, previousKey: string): void {
    const rows = this.rows();
    const index = rows.findIndex((item) => item.key === previousKey);
    if (index >= 0) {
      const next = rows.filter((item, at) => at === index || item.key !== row.key);
      next[next.findIndex((item) => item.key === previousKey)] = row;
      this.rows.set(next);
      const cached = this.cache.get(this.currentKey);
      if (cached) this.cache.set(this.currentKey, { ...cached, rows: next });
    } else {
      this.extra.set(row);
    }
    if (this.extra()?.key === previousKey) this.extra.set(row);
    if (row.key !== previousKey && this.selectedKey() === previousKey) this.state.go({ doc: row.key });
  }

  /** "Openen in Inkoop", "Kost openen", "Verkoopdocument openen", "TICA openen". */
  openSource(row: InvoiceRow): void {
    const id = Number(row.key.slice(row.key.indexOf(':') + 1));
    switch (row.source) {
      case 'CONTAINER_INVOICE': case 'CONTAINER_FILE': {
        const orderId = row.container?.id ?? row.files.find((file) => file.orderId)?.orderId ?? null;
        if (orderId) void this.router.navigate(['/purchasing', orderId], { queryParams: { tab: 'betalingen' } });
        break;
      }
      case 'COST': this.state.go({ view: 'costs', tab: 'company', cost: id }, 'push'); break;
      case 'SALES': void this.router.navigate(['/sales', id]); break;
      default: {
        if (row.status !== 'TICA') break;
        const tica = row.links.find((link) => link.type === 'TICA');
        if (tica) this.state.openTicaSettlement(tica.id);
        else this.state.openTica();
      }
    }
  }

  /** A chip of Gekoppeld. */
  openLink(link: Pick<InvoiceLink, 'type' | 'id'>): void {
    if (link.type === 'CONTAINER') void this.router.navigate(['/purchasing', link.id]);
    else if (link.type === 'TRANSACTION') this.state.openLine(link.id);
    else this.state.openTicaSettlement(link.id);
  }

  async download(row: InvoiceRow, file: InvoiceFile, index: number): Promise<void> {
    try {
      const blob = await this.api.file(file);
      saveBlob(blob, downloadName(row, file, index));
    } catch (failure) {
      this.ui.toast(messageOf(await readableFailure(failure), 'Downloaden mislukt.'), 'err');
    }
  }

  private moveIdOf(row: InvoiceRow): number | null {
    return row.odoo?.moveId ?? row.odooMoveId ?? null;
  }

  async markHandled(row: InvoiceRow): Promise<void> {
    const moveId = this.moveIdOf(row);
    if (!moveId) return;
    try {
      /* A container mark changed to Afgehandeld keeps its note (the server replaces the whole mark); none on a new bill. */
      const note = row.odoo?.mark?.note ?? null;
      this.replaceRow(await this.api.mark(moveId, { resolution: 'HANDLED', purchaseOrderId: null, note }), row.key);
      this.ui.toast('Gemarkeerd als afgehandeld');
    } catch (failure) {
      await this.refused(row, failure, 'Markeren mislukt.');
    }
  }

  /** "Hoort bij container": '' when it worked, else the message for the sheet. */
  async markContainer(row: InvoiceRow, purchaseOrderId: number, note: string, name: string): Promise<string> {
    const moveId = this.moveIdOf(row);
    if (!moveId) return 'Deze factuur kan niet gemarkeerd worden.';
    try {
      this.replaceRow(await this.api.mark(moveId, { resolution: 'CONTAINER', purchaseOrderId, note: note.trim() || null }), row.key);
      this.ui.toast(`Bij ${name} gezet`);
      return '';
    } catch (failure) {
      if (statusOf(failure) === 409) {
        await this.refused(row, failure, 'Markeren mislukt.');
        return '';
      }
      return messageOf(failure, 'Markeren mislukt.');
    }
  }

  async clearMark(row: InvoiceRow): Promise<void> {
    const moveId = this.moveIdOf(row);
    if (!moveId) return;
    try {
      this.replaceRow(await this.api.clearMark(moveId), row.key);
      this.ui.toast('Markering gewist');
    } catch (failure) {
      await this.refused(row, failure, 'Markering wissen mislukt.');
    }
  }

  /** A refused action says why and shows the row as the server has it now (registered or matched meanwhile). */
  private async refused(row: InvoiceRow, failure: unknown, fallback: string): Promise<void> {
    this.ui.toast(messageOf(failure, fallback), 'err');
    if (statusOf(failure) !== 409) return;
    try {
      this.replaceRow(await this.api.row(row.key), row.key);
    } catch { /* the toast already said it */ }
  }

  /** The register sheet hands the new row back here: an Odoo bill becomes its cost. */
  async afterRegister(previousKey: string): Promise<void> {
    try {
      this.replaceRow(await this.api.row(previousKey), previousKey);
    } catch {
      void this.reload();
    }
  }
}
