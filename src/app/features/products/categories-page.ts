import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { Category, CategoryPhoto, Product } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';

/** The collection pictures enrosed.com already shows, offered for one-click takeover. */
const WEBSITE_CATEGORY_PHOTOS: { match: RegExp; url: string; label: string }[] = [
  { match: /display/i, url: 'https://enrosed.com/photos/home-categories/display-range-v1-960.webp', label: 'display-range-v1' },
  { match: /foam|schuim|bear|beer|teddy/i, url: 'https://enrosed.com/photos/home-categories/foam-bear-heart-v1-1254.webp', label: 'foam-bear-heart-v1' },
];

/**
 * Categories as a wall of collections: every card leads with the photo the
 * website and the printed catalogue open the category with, says how many
 * products live in it, and lets you add, order or drop its photos without
 * leaving the page. Names, texts and the website copy per language keep
 * their own editor.
 */
@Component({
  selector: 'app-categories-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, AuthImage, PageHeader, Skeleton, Sheet],
  template: `
    <app-page-header title="Categorieën"
                     [subtitle]="loading() ? 'Laden…' : categories().length + ' categorieën · foto’s voor website en catalogus'"
                     [showBack]="false" [showBell]="false">
      <a class="btn btn--sm hide-mobile" routerLink="/website/categories">Teksten &amp; talen</a>
    </app-page-header>

    <div class="content">
      <p class="cat-intro">
        Elke categorie opent met haar <b>eerste foto</b>: op de website als kop van de collectie en in de
        gedrukte catalogus als hoofdstukpagina. Namen, teksten en de websiteteksten per taal bewerk je onder
        <a routerLink="/website/categories">Teksten &amp; talen</a>.
      </p>

      @if (loadError()) {
        <div class="alert alert--warn" role="alert">
          <span class="alert__icon">!</span>
          <div class="grow"><b>Categorieën konden niet worden geladen</b><div class="small">{{ loadError() }}</div></div>
          <button class="btn btn--sm" type="button" (click)="load()">Opnieuw</button>
        </div>
      } @else if (loading()) {
        <app-skeleton kind="list" [rows]="4" />
      } @else {
        <div class="cat-grid">
          @for (category of categories(); track category.id; let i = $index; let last = $last) {
            <article class="card cat-card" [attr.aria-busy]="busyId() === category.id">
              <div class="cat-card__hero">
                @if (lead(category); as photo) {
                  <img [appAuthSrc]="photoUrl(category, photo)" [alt]="category.name" />
                } @else {
                  <div class="cat-card__empty"><span aria-hidden="true">◇</span>Nog geen foto</div>
                }
                <span class="cat-card__number" aria-hidden="true">{{ i + 1 }}</span>
                <span class="cat-card__order">
                  <button type="button" [disabled]="i === 0 || busyId() !== null" (click)="move(i, -1)" aria-label="Categorie hoger">↑</button>
                  <button type="button" [disabled]="last || busyId() !== null" (click)="move(i, 1)" aria-label="Categorie lager">↓</button>
                </span>
              </div>
              <div class="cat-card__body">
                <span class="cat-card__eyebrow">{{ category.eyebrow || category.code }}</span>
                <h2>{{ category.name }}</h2>
                <p class="cat-card__facts">{{ productCount(category) }} {{ productCount(category) === 1 ? 'product' : 'producten' }}
                  · {{ (category.photos ?? []).length }} {{ (category.photos ?? []).length === 1 ? 'foto' : 'foto’s' }}</p>

                @if ((category.photos ?? []).length > 1) {
                  <ol class="cat-strip" aria-label="Foto’s van deze categorie; de eerste opent de categorie">
                    @for (photo of category.photos; track photo.id; let p = $index) {
                      <li class="cat-strip__item" [class.cat-strip__item--lead]="p === 0">
                        <img [appAuthSrc]="photoUrl(category, photo)" [alt]="photo.originalFilename" />
                        @if (p !== 0) {
                          <button class="cat-strip__lead" type="button" [disabled]="busyId() !== null"
                                  [attr.aria-label]="photo.originalFilename + ' als eerste foto'" title="Als eerste foto"
                                  (click)="makeLead(category, photo)">★</button>
                        }
                        <button class="cat-strip__remove" type="button" [disabled]="busyId() !== null"
                                [attr.aria-label]="photo.originalFilename + ' verwijderen'" title="Verwijderen"
                                (click)="removePhoto(category, photo)">×</button>
                      </li>
                    }
                  </ol>
                } @else if (lead(category); as photo) {
                  <button class="linklike cat-card__drop" type="button" [disabled]="busyId() !== null" (click)="removePhoto(category, photo)">Foto verwijderen</button>
                }

                <div class="cat-card__actions">
                  <label class="btn btn--primary btn--sm cat-upload" [class.btn--disabled]="busyId() !== null">
                    {{ busyId() === category.id ? 'Bezig…' : 'Foto toevoegen' }}
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" [disabled]="busyId() !== null"
                           (change)="upload(category, $event)" />
                  </label>
                  @if (websitePhoto(category); as suggestion) {
                    <button class="btn btn--sm" type="button" [disabled]="busyId() !== null"
                            [title]="suggestion.url" (click)="importFromWebsite(category, suggestion.url)">Van enrosed.com</button>
                  }
                  <button class="btn btn--sm btn--quiet" type="button" [disabled]="busyId() !== null" (click)="askUrl(category)">Via webadres</button>
                </div>
              </div>
            </article>
          } @empty {
            <div class="empty">
              <div class="empty__icon">▤</div>
              <div class="empty__title">Nog geen categorieën</div>
              <a class="btn btn--primary" routerLink="/website/categories">Eerste categorie maken</a>
            </div>
          }
        </div>
      }
    </div>

    @if (urlPrompt(); as prompt) {
      <app-sheet [title]="'Foto van enrosed.com · ' + prompt.category.name" (closed)="urlPrompt.set(null)">
        <div body>
          <p class="small muted" style="margin-bottom:12px">Plak het adres van een foto op enrosed.com. Alleen foto’s van onze eigen website worden overgenomen.</p>
          <div class="field">
            <label for="cat-photo-url">Webadres van de foto</label>
            <input class="input" id="cat-photo-url" type="url" placeholder="https://enrosed.com/photos/…"
                   [ngModel]="prompt.url" (ngModelChange)="urlPrompt.set({ category: prompt.category, url: $event })" />
          </div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="urlPrompt.set(null)">Annuleren</button>
          <span class="spacer"></span>
          <button class="btn btn--primary" type="button" [disabled]="!prompt.url.trim() || busyId() !== null"
                  (click)="importFromWebsite(prompt.category, prompt.url)">Overnemen</button>
        </div>
      </app-sheet>
    }
  `,
  styles: [`
    :host{display:block}
    .cat-intro{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5;max-width:720px}
    .cat-intro b{color:var(--ink)}
    .cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
    .cat-card{display:flex;flex-direction:column;overflow:hidden;padding:0}
    .cat-card__hero{position:relative;aspect-ratio:4/3;background:linear-gradient(145deg,#f3ece4,#e8dccf)}
    .cat-card__hero img{display:block;width:100%;height:100%;object-fit:cover}
    .cat-card__empty{display:grid;height:100%;place-items:center;align-content:center;gap:4px;color:var(--muted);font-size:12px}
    .cat-card__empty span{font-size:26px;color:var(--rose)}
    .cat-card__number{position:absolute;top:10px;left:10px;display:grid;width:28px;height:28px;place-items:center;border-radius:9px;background:rgb(26 22 20/.72);color:#fff;font-size:12px;font-weight:800}
    .cat-card__order{position:absolute;top:10px;right:10px;display:flex;gap:4px}
    .cat-card__order button{width:28px;height:28px;border:0;border-radius:8px;background:rgb(255 255 255/.92);color:var(--ink);font:inherit;font-size:14px;cursor:pointer}
    .cat-card__order button:disabled{opacity:.4;cursor:default}
    .cat-card__body{display:grid;gap:6px;padding:12px 14px 14px}
    .cat-card__eyebrow{color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
    .cat-card h2{margin:0;font-size:17px}
    .cat-card__facts{margin:0;color:var(--muted);font-size:12px}
    .cat-strip{display:flex;gap:6px;margin:4px 0 0;padding:0;list-style:none;overflow-x:auto}
    .cat-strip__item{position:relative;flex:none;width:64px;height:64px;border:2px solid transparent;border-radius:10px;overflow:hidden}
    .cat-strip__item--lead{border-color:var(--rose)}
    .cat-strip__item img{display:block;width:100%;height:100%;object-fit:cover}
    .cat-strip__lead,.cat-strip__remove{position:absolute;bottom:3px;display:grid;width:22px;height:22px;place-items:center;border:0;border-radius:6px;background:rgb(26 22 20/.72);color:#fff;font-size:12px;cursor:pointer}
    .cat-strip__lead{left:3px}.cat-strip__remove{right:3px}
    .cat-card__drop{justify-self:start;font-size:12px}
    .cat-card__actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
    .cat-upload{position:relative;overflow:hidden;cursor:pointer}
    .cat-upload input{position:absolute;inset:0;opacity:0;cursor:pointer}
    .btn--disabled{opacity:.6;pointer-events:none}
  `],
})
export class CategoriesPage {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly categories = signal<Category[]>([]);
  readonly products = signal<Product[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly busyId = signal<number | null>(null);
  readonly urlPrompt = signal<{ category: Category; url: string } | null>(null);

  private readonly countByCategory = computed(() => {
    const counts = new Map<number, number>();
    for (const product of this.products()) {
      if (product.categoryId == null) continue;
      counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
    }
    return counts;
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [categories, products] = await Promise.all([
        this.catalog.categories(),
        this.catalog.products().catch(() => [] as Product[]),
      ]);
      this.categories.set(categories);
      this.products.set(products);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, 'Controleer de verbinding en probeer opnieuw.'));
    } finally {
      this.loading.set(false);
    }
  }

  productCount(category: Category): number {
    return category.id === null ? 0 : this.countByCategory().get(category.id) ?? 0;
  }

  lead(category: Category): CategoryPhoto | null {
    return category.photos?.[0] ?? null;
  }

  photoUrl(category: Category, photo: CategoryPhoto): string {
    return this.catalog.categoryPhotoUrl(category.id!, photo.id);
  }

  /** The website already shows a picture for this collection: offer it. */
  websitePhoto(category: Category): { url: string; label: string } | null {
    const haystack = `${category.code} ${category.name} ${category.eyebrow ?? ''}`;
    const hit = WEBSITE_CATEGORY_PHOTOS.find((entry) => entry.match.test(haystack));
    if (!hit) return null;
    const already = (category.photos ?? []).some((photo) => photo.originalFilename.includes(hit.label));
    return already ? null : { url: hit.url, label: hit.label };
  }

  async upload(category: Category, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || category.id === null) return;
    await this.run(category, () => this.catalog.uploadCategoryPhoto(category.id!, file),
      `Foto toegevoegd aan ${category.name}`, 'Foto toevoegen mislukt');
  }

  askUrl(category: Category): void {
    this.urlPrompt.set({ category, url: '' });
  }

  async importFromWebsite(category: Category, url: string): Promise<void> {
    if (category.id === null) return;
    this.urlPrompt.set(null);
    await this.run(category, () => this.catalog.importCategoryPhoto(category.id!, url.trim()),
      `Foto van enrosed.com overgenomen voor ${category.name}`, 'Foto overnemen mislukt');
  }

  makeLead(category: Category, photo: CategoryPhoto): void {
    if (category.id === null) return;
    const ids = [photo.id, ...(category.photos ?? []).map((item) => item.id).filter((id) => id !== photo.id)];
    void this.run(category, () => this.catalog.reorderCategoryPhotos(category.id!, ids),
      `${category.name} opent nu met deze foto`, 'Volgorde opslaan mislukt');
  }

  removePhoto(category: Category, photo: CategoryPhoto): void {
    if (category.id === null || this.busyId() !== null) return;
    this.ui.confirm({
      title: 'Foto verwijderen',
      message: `<b>${escapeHtml(photo.originalFilename)}</b> bij <b>${escapeHtml(category.name)}</b> verwijderen?`,
      confirmLabel: 'Verwijderen', danger: true,
    }, () => {
      void this.run(category, () => this.catalog.deleteCategoryPhoto(category.id!, photo.id),
        'Foto verwijderd', 'Foto verwijderen mislukt');
    });
  }

  /** The arrows: the ids in their new order become positions 1..n on the server. */
  async move(index: number, direction: -1 | 1): Promise<void> {
    const list = [...this.categories()];
    const target = index + direction;
    if (target < 0 || target >= list.length || this.busyId() !== null) return;
    [list[index], list[target]] = [list[target], list[index]];
    const moved = list[target];
    this.busyId.set(moved.id);
    try {
      this.categories.set(await this.catalog.reorderCategories(list.map((category) => category.id!)));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Volgorde opslaan mislukt'), 'err');
    } finally {
      this.busyId.set(null);
    }
  }

  private async run(category: Category, action: () => Promise<Category>, done: string, failed: string): Promise<void> {
    if (this.busyId() !== null) return;
    this.busyId.set(category.id);
    try {
      const updated = await action();
      this.categories.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      this.ui.toast(done);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, failed), 'err');
    } finally {
      this.busyId.set(null);
    }
  }
}
