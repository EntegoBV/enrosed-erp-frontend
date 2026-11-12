import { Injectable, computed, inject, signal } from '@angular/core';
import { PartnerContainerPage, PartnerPortalApi, PartnerProductSpec } from '../../core/api/partner-portal-api';
import { upcoming } from './partner-containers-model';

/**
 * Enrosed's containers as the partner sees them (GET /api/partner-portal/containers), shared by the Containers
 * tab and the "Komt eraan" strip on the Overzicht. Provided by the portal's shell, so a sign-out drops it. Each
 * visit reads it again; the last answer shows meanwhile.
 */
@Injectable()
export class PartnerContainersData {
  private readonly api = inject(PartnerPortalApi);

  readonly page = signal<PartnerContainerPage | null>(null);
  readonly failure = signal<unknown>(null);
  readonly loading = signal(false);
  private pending: Promise<void> | null = null;

  /** The products by id. */
  readonly specs = computed(() => new Map<number, PartnerProductSpec>((this.page()?.products ?? []).map((spec) => [spec.productId, spec])));
  /** The server's product order (catalogue order), for the groups. */
  readonly order = computed(() => new Map<number, number>((this.page()?.products ?? []).map((spec, index) => [spec.productId, index])));
  /** What is still coming, the nearest first. */
  readonly coming = computed(() => {
    const page = this.page();
    return page ? upcoming(page.containers, page.serverDate) : [];
  });

  /** Reads the containers; a read under way is shared. */
  load(): Promise<void> {
    if (this.pending) return this.pending;
    this.loading.set(true);
    const run = this.api.containers().then(
      (page) => {
        this.page.set({ ...page, containers: page.containers ?? [], products: page.products ?? [] });
        this.failure.set(null);
      },
      (failure: unknown) => { this.failure.set(failure); },
    ).finally(() => {
      this.loading.set(false);
      if (this.pending === run) this.pending = null;
    });
    this.pending = run;
    return run;
  }
}
