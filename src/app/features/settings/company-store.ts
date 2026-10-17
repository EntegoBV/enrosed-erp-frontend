import { Injectable, inject, signal } from '@angular/core';
import { SalesApi } from '../../core/api/sales-api';
import { CompanyProfile } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';

/**
 * The company profile as every view of /settings sees it (provided by the
 * settings page, so it lives as long as the page).
 *
 * The backend saves the whole profile at once, the legal texts included. Two
 * views that each kept their own copy would silently undo each other: edit
 * the terms, go back to Bedrijfsgegevens, change the IBAN, save, and the old
 * terms ride along. So there is one saved profile here, and a save sends
 * only a patch on top of it: {...saved(), ...patch}. Editors rebase their
 * drafts on saved() whenever it changes.
 */
@Injectable()
export class CompanyStore {
  private readonly sales = inject(SalesApi);

  readonly saved = signal<CompanyProfile | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private pending: Promise<CompanyProfile | null> | null = null;

  /** Loads once; force re-reads (the overview's refresh, a retry). Keeps the shown value while it runs. */
  load(force = false): Promise<CompanyProfile | null> {
    if (this.pending) return this.pending;
    if (this.saved() && !force) return Promise.resolve(this.saved());
    this.loading.set(true);
    this.error.set(null);
    this.pending = this.sales.company()
      .then((profile) => {
        this.saved.set(profile);
        return profile;
      })
      .catch((failure: unknown) => {
        this.error.set(messageOf(failure, 'De bedrijfsgegevens konden niet worden geladen.'));
        return null;
      })
      .finally(() => {
        this.loading.set(false);
        this.pending = null;
      });
    return this.pending;
  }

  /** Saves only these fields on top of the last saved profile; the answer becomes saved(). Throws on failure. */
  async save(patch: Partial<CompanyProfile>): Promise<CompanyProfile> {
    const base = this.saved() ?? await this.sales.company();
    const result = await this.sales.saveCompany({ ...base, ...patch });
    this.saved.set(result);
    return result;
  }
}
