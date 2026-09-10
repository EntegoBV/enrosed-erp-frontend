import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PartnerContainerDeletionApi, type PartnerContainerDeletionPreview, type PartnerContainerDeletionResult } from '../../core/api/partner-container-deletion-api';
import { messageOf } from '../../core/api/errors';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import type { SalesContainerGroup } from './sales-list-groups';
import { STATUS_LABEL } from './quote-status';

@Component({
  selector: 'app-sales-container-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, RouterLink, EurPipe],
  template: `
    <app-sheet [title]="reviewing() ? 'Container verwijderen' : 'Partnercontainer ' + (container().purchaseOrderNumber || '#' + container().purchaseOrderId)" [wide]="reviewing()" (closed)="close()">
      <div body>
        @if (!reviewing()) {
          <p class="container-menu__who">{{ customerName() }} · {{ container().purchaseOrderNumber || 'Inkoop #' + container().purchaseOrderId }}</p>
          <div class="desk-actions">
            <a class="desk-action" [routerLink]="['/purchasing', container().purchaseOrderId]" [queryParams]="{ section: 'payments' }" (click)="close()"><i aria-hidden="true">›</i><span><b>Container openen</b><small>Inkooporder en alle voorschotfacturen</small></span></a>
            <button class="desk-action desk-action--danger" type="button" [disabled]="externalBusy()" (click)="check()"><i aria-hidden="true">×</i><span><b>Container verwijderen…</b><small>Controleer de inkooporder en gekoppelde voorschotfacturen</small></span></button>
          </div>
        } @else {
          @if (checking()) { <p class="container-menu__loading" role="status">Container en gekoppelde facturen controleren…</p> }
          @if (error()) { <div class="container-menu__error" role="alert"><span>{{ error() }}</span><button class="btn btn--sm" type="button" [disabled]="checking() || deleting()" (click)="check()">Opnieuw controleren</button></div> }
          @if (preview(); as data) {
            <p class="container-menu__intro"><b>{{ data.number }}</b> en de {{ data.invoices.length }} gekoppelde {{ data.invoices.length === 1 ? 'voorschotfactuur worden' : 'voorschotfacturen worden' }} samen tijdelijk verwijderd.</p>
            <p class="container-menu__scope">Dit is de volledige factuurlijst van de container, ook wanneer je zoekopdracht of filter minder facturen toont.</p>
            <ol class="container-menu__invoices" aria-label="Gekoppelde voorschotfacturen">
              @for (invoice of data.invoices; track invoice.id) {
                <li><span><b>{{ invoice.number }}</b><small>{{ statusLabel(invoice.status) }}</small></span><span><small>Factuurbedrag</small><b>{{ invoice.totalEur === null ? 'Niet beschikbaar' : (invoice.totalEur | eur) }}</b></span></li>
              } @empty { <li><span>Geen gekoppelde voorschotfacturen.</span></li> }
            </ol>
            @if (!data.allowed) { <p class="container-menu__blocked" role="status">{{ data.blockReason || 'Deze container kan niet samen met zijn facturen worden verwijderd.' }}</p> }
            <p class="container-menu__recovery">Herstellen kan via Instellingen → Beheer → Verwijderde items, zolang de hersteltermijn loopt. Herstel eerst de container en daarna de facturen.</p>
          }
        }
      </div>
      @if (reviewing()) {
        <div foot class="container-menu__actions"><button class="btn" type="button" [disabled]="deleting()" (click)="back()">Terug</button><button class="btn btn--danger" type="button" [disabled]="!preview()?.allowed || checking() || deleting() || externalBusy()" (click)="remove()">{{ deleting() ? 'Verwijderen…' : 'Container en facturen verwijderen' }}</button></div>
      }
    </app-sheet>
  `,
  styles: `
    .container-menu__who{font-size:12px;color:var(--muted);line-height:1.6;overflow-wrap:anywhere;margin:0 0 14px}.container-menu__intro{font-size:14px;line-height:1.65;margin:0 0 10px;overflow-wrap:anywhere}.container-menu__scope,.container-menu__recovery{font-size:12px;color:var(--muted);line-height:1.7;margin:0 0 15px}.container-menu__recovery{margin:16px 0 0}.container-menu__invoices{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:12px;overflow:hidden}.container-menu__invoices li{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px;border-bottom:1px solid var(--line)}.container-menu__invoices li:last-child{border:0}.container-menu__invoices li>span{display:grid;gap:6px;min-width:0;overflow-wrap:anywhere}.container-menu__invoices li>span:last-child{text-align:right}.container-menu__invoices b{font-size:13px}.container-menu__invoices small{font-size:10px;color:var(--muted)}.container-menu__blocked{padding:13px;border:1px solid var(--line);border-radius:11px;font-size:12px;line-height:1.7;background:var(--surface-2)}.container-menu__error{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px;background:var(--surface-2);color:var(--danger);border-radius:11px;margin-bottom:14px;font-size:12px;line-height:1.6}.container-menu__error>span{flex:1;min-width:160px}.container-menu__loading{font-size:13px;color:var(--muted)}.container-menu__actions{display:flex;justify-content:space-between;gap:12px;width:100%}.container-menu__actions .btn{min-height:44px}@media(max-width:520px){.container-menu__actions .btn--danger{flex:1;font-size:12px;padding-inline:12px}.container-menu__invoices li{gap:12px}.container-menu__invoices li>span:last-child{flex-shrink:0}.container-menu__scope,.container-menu__recovery{font-size:11px}}
  `,
})
export class SalesContainerMenu implements OnDestroy {
  readonly container = input.required<SalesContainerGroup>();
  readonly customerName = input('');
  readonly externalBusy = input(false);
  readonly closed = output<void>();
  readonly deleted = output<PartnerContainerDeletionResult>();
  readonly busyChange = output<boolean>();
  readonly reviewing = signal(false);
  readonly checking = signal(false);
  readonly deleting = signal(false);
  readonly preview = signal<PartnerContainerDeletionPreview | null>(null);
  readonly error = signal('');
  private readonly api = inject(PartnerContainerDeletionApi);
  private version = 0;
  private destroyed = false;

  constructor() {
    effect(() => { this.container().purchaseOrderId; this.version++; this.reviewing.set(false); this.preview.set(null); this.error.set(''); this.checking.set(false); });
  }

  statusLabel(status: string): string { return (STATUS_LABEL as Record<string, string>)[status] ?? status; }
  close(): void { if (!this.deleting()) this.closed.emit(); }
  back(): void {
    if (this.deleting()) return;
    this.version++; this.reviewing.set(false); this.preview.set(null); this.checking.set(false); this.error.set('');
  }

  async check(): Promise<void> {
    if (this.deleting() || this.checking() || this.externalBusy()) return;
    const id = this.container().purchaseOrderId;
    const version = ++this.version;
    this.reviewing.set(true); this.checking.set(true); this.preview.set(null); this.error.set('');
    try {
      const preview = await this.api.preview(id);
      if (this.destroyed || version !== this.version) return;
      if (preview.purchaseOrderId !== id) throw new Error('De containergegevens komen niet overeen. Controleer opnieuw.');
      this.preview.set(preview);
    } catch (failure) {
      if (!this.destroyed && version === this.version) this.error.set(messageOf(failure, failure instanceof Error ? failure.message : 'De container kon niet worden gecontroleerd.'));
    } finally { if (!this.destroyed && version === this.version) this.checking.set(false); }
  }

  async remove(): Promise<void> {
    const preview = this.preview();
    if (!preview?.allowed || preview.purchaseOrderId !== this.container().purchaseOrderId
      || this.checking() || this.deleting() || this.externalBusy() || this.destroyed) return;
    const version = this.version;
    this.deleting.set(true); this.busyChange.emit(true); this.error.set('');
    try {
      const result = await this.api.remove(preview.purchaseOrderId, preview.invoices.map(invoice => invoice.id));
      if (this.destroyed || version !== this.version) return;
      this.deleted.emit(result);
    } catch (failure) {
      if (!this.destroyed && version === this.version) {
        this.error.set(messageOf(failure, 'Verwijderen is niet gelukt. Controleer opnieuw; er is niets gedeeltelijk verwijderd.'));
        this.preview.set(null);
      }
    } finally {
      if (!this.destroyed) { this.deleting.set(false); this.busyChange.emit(false); }
    }
  }

  ngOnDestroy(): void { this.destroyed = true; this.version++; }
}
