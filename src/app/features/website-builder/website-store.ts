import { Injectable, computed, inject, signal } from '@angular/core';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type {
  Category,
  ContentTranslationGroup,
  ContentTranslationOverview,
  ProductFamily,
  WebsiteBuilderHomepage,
} from '../../core/api/models';
import { isPerLanguageSizeIssue } from '../products/publication-issues';
import { websiteCounts, websiteTodos } from './website-attention';
import { publicFamilyName } from './website-family-label';
import { homepageSummary } from './website-homepage';
import { StoreWrite, rememberWrite, replayWrites, writesSince } from './website-store-writes';

export type WebsitePart = 'families' | 'categories' | 'content' | 'homepage';
export const WEBSITE_PARTS: readonly WebsitePart[] = ['families', 'categories', 'content', 'homepage'];

/** A part younger than this is not fetched again by ensure(). */
const FRESH_MS = 60_000;

const PART_LABELS: Record<WebsitePart, string> = {
  families: 'Producten',
  categories: 'Categorieën',
  content: 'Websiteteksten',
  homepage: 'Homepage-indeling',
};

/** "Producten konden niet gecontroleerd worden" for a failed part. */
export function websitePartLabel(part: WebsitePart): string {
  return PART_LABELS[part];
}

/**
 * The data of Website beheren, shared by its side, its phone tab bar and its
 * pages: product reeksen, categories, the WEBSITE text groups (654 × 9
 * languages, about 700 kB) and the homepage layout. Each part keeps its last
 * answer and its time; ensure() fetches only what is missing or older than
 * a minute, one request per part at a time, and a failed part keeps its last
 * value. Writes patch the store, so the counts follow without a refetch;
 * an answer that started before a patch gets the patch replayed on it.
 * The workspace never polls (the website sync store keeps its own poll).
 */
@Injectable({ providedIn: 'root' })
export class WebsiteStore {
  private readonly catalog = inject(CatalogApi);

  readonly families = signal<ProductFamily[] | null>(null);
  readonly categories = signal<Category[] | null>(null);
  readonly content = signal<ContentTranslationOverview | null>(null);
  readonly homepage = signal<WebsiteBuilderHomepage | null>(null);
  /** Moves on every full answer for the reeksen (not on a patch): lists that keep rows until the next load key on it. */
  readonly familiesVersion = signal(0);
  /** The error of the last failed load per part; cleared by the next good answer. */
  readonly errors = signal<Partial<Record<WebsitePart, string>>>({});
  readonly loading = signal<Partial<Record<WebsitePart, boolean>>>({});

  private readonly loadedAt: Partial<Record<WebsitePart, number>> = {};
  private readonly inFlight = new Map<WebsitePart, Promise<void>>();
  /** Patches per part, replayed on an answer that started before them (website-store-writes.ts). */
  private readonly writes: Partial<Record<WebsitePart, StoreWrite<unknown>[]>> = {};

  /** The WEBSITE text groups, or an empty list before they arrive. */
  readonly groups = computed<readonly ContentTranslationGroup[]>(() => this.content()?.groups ?? []);
  readonly counts = computed(() => websiteCounts({
    families: this.families(), categories: this.categories(), groups: this.content()?.groups ?? null,
  }));
  readonly todos = computed(() => websiteTodos({
    families: this.families() ?? [], categories: this.categories() ?? [], groups: this.content()?.groups ?? [],
    familyName: (family) => publicFamilyName(family), isSizeIssue: isPerLanguageSizeIssue,
  }));
  readonly homepageSummary = computed(() => {
    const snapshot = this.homepage();
    return snapshot ? homepageSummary(snapshot) : null;
  });

  /** True once the part has an answer (old or new). */
  has(part: WebsitePart): boolean {
    return this.valueOf(part) !== null;
  }

  isLoading(part: WebsitePart): boolean {
    return !!this.loading()[part];
  }

  /** Milliseconds since the part's last good answer, or null. */
  age(part: WebsitePart): number | null {
    const at = this.loadedAt[part];
    return at === undefined ? null : Date.now() - at;
  }

  isFresh(part: WebsitePart, maxAge = FRESH_MS): boolean {
    const age = this.age(part);
    return age !== null && age < maxAge && this.has(part);
  }

  /** Loads what is missing or older than a minute. */
  ensure(parts: readonly WebsitePart[] = WEBSITE_PARTS): Promise<void> {
    return Promise.all(parts.filter((part) => !this.isFresh(part)).map((part) => this.load(part, false))).then(() => undefined);
  }

  /**
   * Entering the workspace: everything older than a few seconds loads again
   * in the background (edits made elsewhere show), old values stay meanwhile;
   * a request already under way counts as fresh.
   */
  refreshStale(maxAge = 5_000): Promise<void> {
    return Promise.all(WEBSITE_PARTS.filter((part) => !this.isFresh(part, maxAge)).map((part) => this.load(part, false))).then(() => undefined);
  }

  /** Loads again whatever its age (the "Vernieuwen" buttons); old values stay meanwhile. */
  refresh(parts: readonly WebsitePart[] = WEBSITE_PARTS): Promise<void> {
    return Promise.all(parts.map((part) => this.load(part, true))).then(() => undefined);
  }

  patchFamily(family: ProductFamily): void {
    const apply = (list: ProductFamily[] | null) => list?.map((item) => item.id !== null && item.id === family.id ? family : item) ?? list;
    this.families.update(apply);
    this.remember('families', apply);
  }

  setFamilies(list: ProductFamily[]): void {
    this.set('families', list);
  }

  setHomepage(snapshot: WebsiteBuilderHomepage): void {
    this.set('homepage', snapshot);
  }

  setCategories(list: Category[]): void {
    this.set('categories', list);
  }

  /** The text groups a workspace fetched itself: the side and the other pages use them too. */
  setContent(overview: ContentTranslationOverview): void {
    this.set('content', overview);
  }

  /** A saved or created text group; the counts follow without fetching the 654 groups again. */
  patchContentGroup(group: ContentTranslationGroup): void {
    const apply = (overview: ContentTranslationOverview | null) => {
      if (!overview) return overview;
      const exists = overview.groups.some((item) => item.scope === group.scope && item.key === group.key);
      return {
        ...overview,
        groups: exists
          ? overview.groups.map((item) => item.scope === group.scope && item.key === group.key ? group : item)
          : [...overview.groups, group],
      };
    };
    this.content.update(apply);
    this.remember('content', apply);
  }

  /** A deleted text group. */
  removeContentGroup(key: string): void {
    const apply = (overview: ContentTranslationOverview | null) =>
      overview && { ...overview, groups: overview.groups.filter((item) => item.key !== key) };
    this.content.update(apply);
    this.remember('content', apply);
  }

  /** A patch is kept a while, so an older answer still under way cannot undo it. */
  private remember<T>(part: WebsitePart, apply: (value: T) => T): void {
    this.writes[part] = rememberWrite(this.writes[part] ?? [], { at: Date.now(), apply: apply as (value: unknown) => unknown });
  }

  private valueOf(part: WebsitePart): unknown {
    switch (part) {
      case 'families': return this.families();
      case 'categories': return this.categories();
      case 'content': return this.content();
      case 'homepage': return this.homepage();
    }
  }

  private set(part: WebsitePart, value: unknown): void {
    switch (part) {
      case 'families': this.families.set(value as ProductFamily[]); this.familiesVersion.update((version) => version + 1); break;
      case 'categories': this.categories.set(value as Category[]); break;
      case 'content': this.content.set(value as ContentTranslationOverview); break;
      case 'homepage': this.homepage.set(value as WebsiteBuilderHomepage); break;
    }
    this.loadedAt[part] = Date.now();
    this.errors.update((errors) => {
      if (!(part in errors)) return errors;
      const next = { ...errors };
      delete next[part];
      return next;
    });
  }

  private fetch(part: WebsitePart): Promise<unknown> {
    switch (part) {
      case 'families': return this.catalog.productFamilies();
      case 'categories': return this.catalog.categories();
      case 'content': return this.catalog.contentTranslations('WEBSITE');
      case 'homepage': return this.catalog.websiteBuilderHomepage();
    }
  }

  private load(part: WebsitePart, force: boolean): Promise<void> {
    const running = this.inFlight.get(part);
    if (running) return force ? running.then(() => this.load(part, false)) : running;
    const started = Date.now();
    this.loading.update((state) => ({ ...state, [part]: true }));
    const task = this.fetch(part)
      .then((value) => {
        /* A full list set while this answer was under way is newer: keep it. */
        if ((this.loadedAt[part] ?? 0) > started) return;
        /* Patches made since this request started are newer than its answer: replay them on it. */
        const writes = this.writes[part] ?? [];
        this.writes[part] = writesSince(writes, started);
        this.set(part, replayWrites(value, writes, started));
      })
      .catch((failure: unknown) => {
        this.errors.update((errors) => ({ ...errors, [part]: messageOf(failure, 'Controleer de verbinding en probeer opnieuw.') }));
      })
      .finally(() => {
        this.inFlight.delete(part);
        this.loading.update((state) => ({ ...state, [part]: false }));
      });
    this.inFlight.set(part, task);
    return task;
  }
}
