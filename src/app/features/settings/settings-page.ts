import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SalesApi } from '../../core/api/sales-api';
import {
  Category, CompanyProfile, CsvImportResult, DiscountTier, HsCode,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';

/** Categorieën, douanetarieven en kortingsstaffels. */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader],
  template: `
    <app-page-header title="Instellingen" subtitle="Categorieën, tarieven en staffels" />

    <div class="content">
      <!-- ======================================= bedrijfsgegevens -->
      <div class="card">
        <div class="card__head"><h2>Onze bedrijfsgegevens</h2></div>
        <div class="card__body">
          <p class="small muted" style="margin-bottom:12px">
            Deze gegevens komen op elke offerte, factuur en catalogus. Het BTW-nummer hoort
            er wettelijk op te staan, net als je adres.
          </p>
          <p class="legend"><b>*</b> verplicht op documenten.</p>

          @if (company(); as profile) {
            <div class="form-grid">
              <div class="field">
                <label class="req" for="co-name">Handelsnaam</label>
                <input class="input" id="co-name" [ngModel]="profile.name"
                       (ngModelChange)="patchCompany({ name: $event })" />
              </div>
              <div class="field">
                <label for="co-legal">Juridische naam <span class="opt"></span></label>
                <input class="input" id="co-legal" [ngModel]="profile.legalName"
                       (ngModelChange)="patchCompany({ legalName: $event })"
                       placeholder="Enrosed BV" />
              </div>
              <div class="field">
                <label class="req" for="co-vat">BTW-nummer</label>
                <input class="input mono" id="co-vat" [ngModel]="profile.vatNumber"
                       (ngModelChange)="patchCompany({ vatNumber: $event })"
                       placeholder="BE 0123.456.789" />
              </div>
              <div class="field">
                <label for="co-reg">Ondernemingsnummer <span class="opt"></span></label>
                <input class="input mono" id="co-reg" [ngModel]="profile.registrationNumber"
                       (ngModelChange)="patchCompany({ registrationNumber: $event })" />
              </div>
              <div class="field span-2">
                <label class="req" for="co-address">Adres</label>
                <input class="input" id="co-address" [ngModel]="profile.addressLine"
                       (ngModelChange)="patchCompany({ addressLine: $event })" />
              </div>
              <div class="field">
                <label class="req" for="co-zip">Postcode</label>
                <input class="input" id="co-zip" [ngModel]="profile.postalCode"
                       (ngModelChange)="patchCompany({ postalCode: $event })" />
              </div>
              <div class="field">
                <label class="req" for="co-city">Stad</label>
                <input class="input" id="co-city" [ngModel]="profile.city"
                       (ngModelChange)="patchCompany({ city: $event })" />
              </div>
              <div class="field">
                <label class="req" for="co-country">Land (ISO)</label>
                <input class="input" id="co-country" maxlength="2" [ngModel]="profile.countryCode"
                       (ngModelChange)="patchCompany({ countryCode: $event.toUpperCase() })" />
                <span class="hint">Bepaalt mee welk BTW-regime binnenland is.</span>
              </div>
              <div class="field">
                <label for="co-email">E-mail <span class="opt"></span></label>
                <input class="input" id="co-email" type="email" [ngModel]="profile.email"
                       (ngModelChange)="patchCompany({ email: $event })" />
              </div>
              <div class="field">
                <label for="co-phone">Telefoon <span class="opt"></span></label>
                <input class="input" id="co-phone" [ngModel]="profile.phone"
                       (ngModelChange)="patchCompany({ phone: $event })" />
              </div>
              <div class="field">
                <label for="co-web">Website <span class="opt"></span></label>
                <input class="input" id="co-web" [ngModel]="profile.website"
                       (ngModelChange)="patchCompany({ website: $event })" />
              </div>
              <div class="field">
                <label for="co-iban">IBAN <span class="opt"></span></label>
                <input class="input mono" id="co-iban" [ngModel]="profile.iban"
                       (ngModelChange)="patchCompany({ iban: $event })" />
              </div>
              <div class="field">
                <label for="co-bic">BIC <span class="opt"></span></label>
                <input class="input mono" id="co-bic" [ngModel]="profile.bic"
                       (ngModelChange)="patchCompany({ bic: $event })" />
              </div>
              <div class="field span-2">
                <label for="co-foot">Voettekst op documenten <span class="opt"></span></label>
                <textarea class="textarea" id="co-foot" [ngModel]="profile.documentFooter"
                          (ngModelChange)="patchCompany({ documentFooter: $event })"
                          placeholder="Op al onze offertes zijn onze algemene voorwaarden van toepassing."></textarea>
              </div>
            </div>
            <div class="span-2 mt-8">
              <div class="section-title" style="margin-top:0">Juridische teksten</div>
              <p class="small muted" style="margin-bottom:8px">
                Voorwaarden en privacyverklaring staan klaar als voorstel voor Enrosed BV —
                laat ze nakijken door je boekhouder of jurist. Klanten lezen ze op
                <a href="/voorwaarden" target="_blank" rel="noopener">/voorwaarden</a>;
                documenten in een andere taal dan Nederlands verwijzen naar de
                <b>Engelse</b> versie. Leeg laten betekent: gebruik het ingebouwde voorstel.
              </p>
              <details style="margin-bottom:8px">
                <summary class="small strong" style="cursor:pointer">
                  Algemene voorwaarden (NL)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.termsAndConditions"
                          (ngModelChange)="patchCompany({ termsAndConditions: $event })"
                          [placeholder]="'Leeg = ingebouwd voorstel'"></textarea>
              </details>
              <details style="margin-bottom:8px">
                <summary class="small strong" style="cursor:pointer">
                  Terms and conditions (EN)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.termsAndConditionsEn"
                          (ngModelChange)="patchCompany({ termsAndConditionsEn: $event })"
                          [placeholder]="'Empty = built-in draft'"></textarea>
              </details>
              <details style="margin-bottom:8px">
                <summary class="small strong" style="cursor:pointer">
                  Privacyverklaring (NL)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.privacyPolicy"
                          (ngModelChange)="patchCompany({ privacyPolicy: $event })"
                          [placeholder]="'Leeg = ingebouwd voorstel'"></textarea>
              </details>
              <details>
                <summary class="small strong" style="cursor:pointer">
                  Privacy statement (EN)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.privacyPolicyEn"
                          (ngModelChange)="patchCompany({ privacyPolicyEn: $event })"
                          [placeholder]="'Empty = built-in draft'"></textarea>
              </details>
            </div>
            <button class="btn btn--primary btn--block mt-8" type="button"
                    [disabled]="savingCompany()" (click)="saveCompany()">
              {{ savingCompany() ? 'Bezig…' : 'Bedrijfsgegevens opslaan' }}
            </button>
          }
        </div>
      </div>

      <!-- ======================================= catalogus als CSV -->
      <div class="card">
        <div class="card__head"><h2>Catalogus als CSV</h2></div>
        <div class="card__body">
          <p class="small muted" style="margin-bottom:12px">
            Bulk-bewerken in een rekenblad: exporteer, pas aan, laad terug in. Rijen worden
            herkend aan de <b>SKU</b>; een lege cel laat het veld ongemoeid, en onbekende
            SKU's worden gemeld in plaats van stil aangemaakt.
          </p>

          <div class="section-title" style="margin-top:0">Productgegevens</div>
          <p class="small muted" style="margin-bottom:8px">
            HS-codes, afmetingen, dozen, barcodes en prijzen — alles behalve voorraad en
            vertalingen.
          </p>
          <div class="row wrap" style="gap:8px">
            <button class="btn" type="button" (click)="exportProducts()">Exporteren</button>
            <button class="btn" type="button" (click)="productsFile.click()">Importeren…</button>
            <input #productsFile type="file" accept=".csv,text/csv" style="display:none"
                   (change)="importProducts($any($event.target).files)" />
          </div>

          <div class="section-title">Vertalingen</div>
          <p class="small muted" style="margin-bottom:8px">
            Naam, beschrijving en kleur, één rij per product per taal. Wat gelijk blijft aan
            de basistekst telt niet als vertaling.
          </p>
          <div class="row wrap" style="gap:8px">
            <button class="btn" type="button" (click)="exportTranslations()">Exporteren</button>
            <button class="btn" type="button" (click)="translationsFile.click()">Importeren…</button>
            <input #translationsFile type="file" accept=".csv,text/csv" style="display:none"
                   (change)="importTranslations($any($event.target).files)" />
          </div>

          @if (csvResult(); as result) {
            <div class="alert mt-12" [class.alert--ok]="!result.problems.length"
                 [class.alert--warn]="result.problems.length > 0">
              <span class="alert__icon">{{ result.problems.length ? '!' : '✓' }}</span>
              <div>
                <b>{{ result.updatedProducts }} product(en) bijgewerkt.</b>
                @if (result.problems.length) {
                  <div class="small" style="margin-top:4px">
                    @for (problem of result.problems; track $index) {
                      <div>· {{ problem }}</div>
                    }
                  </div>
                }
              </div>
            </div>
          }
        </div>
      </div>

      <!-- ======================================= categorieen -->
      <div class="card">
        <div class="card__head"><h2>Productcategorieën</h2><span class="spacer"></span>
          <button class="btn btn--sm" type="button" (click)="addCategory()">+</button></div>
        <div class="card__body">
          <p class="small muted" style="margin-bottom:12px">
            Vaste lijst. Producten kiezen hieruit in plaats van vrije tekst.
          </p>
          @for (category of categories(); track category.id) {
            <div style="margin-bottom:10px">
              <div class="row" style="margin-bottom:4px">
                <input class="input input--sm mono" style="max-width:120px" aria-label="Code"
                       [ngModel]="category.code"
                       (ngModelChange)="saveCategory(category, { code: $event })" />
                <input class="input input--sm" aria-label="Naam" [ngModel]="category.name"
                       (ngModelChange)="saveCategory(category, { name: $event })" />
                <button class="btn btn--sm btn--danger" type="button"
                        (click)="removeCategory(category)">✕</button>
              </div>
              <!-- The description opens the category's chapter in the fair
                   catalogue; one selling sentence is enough. -->
              <input class="input input--sm" aria-label="Beschrijving"
                     placeholder="Beschrijving voor in de catalogus…"
                     [ngModel]="category.description"
                     (ngModelChange)="saveCategory(category, { description: $event })" />
            </div>
          }
        </div>
      </div>

      <!-- ======================================= douanetarieven -->
      <div class="card">
        <div class="card__head"><h2>Douanetarieven</h2><span class="spacer"></span>
          <button class="btn btn--sm" type="button" (click)="addHsCode()">+</button></div>
        <div class="card__body">
          <div class="alert alert--warn" style="margin-bottom:14px">
            <span class="alert__icon">!</span>
            <div>
              Kijk deze percentages na in de <b>TARIC-databank</b> van de EU. Wat hier staat is
              configuratie, geen douaneadvies.
            </div>
          </div>
          @for (code of hsCodes(); track code.code) {
            <div style="border:1px solid var(--line);border-radius:var(--r-sm);
                        padding:10px 12px;margin-bottom:10px">
              <div class="row" style="margin-bottom:8px">
                <input class="input input--sm mono" style="max-width:140px" aria-label="HS-code"
                       [ngModel]="code.code" (ngModelChange)="code.code = $event" />
                <input class="input input--sm num right" style="max-width:80px" type="number"
                       step="0.5" aria-label="Invoerrecht" [ngModel]="code.dutyRatePct"
                       (ngModelChange)="code.dutyRatePct = +$event" />
                <span class="small muted">%</span>
                <button class="btn btn--sm" type="button" (click)="saveHsCode(code)">✓</button>
                <button class="btn btn--sm btn--danger" type="button"
                        (click)="removeHsCode(code)">✕</button>
              </div>
              <input class="input input--sm" aria-label="Omschrijving" placeholder="Omschrijving"
                     [ngModel]="code.description" (ngModelChange)="code.description = $event" />
            </div>
          }
          <p class="small muted">
            Het invoerrecht geldt over de <b>douanewaarde</b>: goederen + lokale kosten China +
            zeevracht. De kosten vanaf de aankomsthaven vallen erbuiten.
          </p>
        </div>
      </div>

      <!-- ======================================= staffels -->
      @for (scope of scopes; track scope.key) {
        <div class="card">
          <div class="card__head"><h2>{{ scope.label }}</h2><span class="spacer"></span>
            <button class="btn btn--sm" type="button" (click)="addTier(scope.key)">+</button></div>
          <div class="card__body">
            @for (tier of tiers(scope.key); track $index) {
              <div class="row" style="margin-bottom:8px">
                <span class="small muted" style="width:52px">vanaf</span>
                <input class="input input--sm num right" type="number" step="50"
                       aria-label="Vanaf aantal" [ngModel]="tier.minQuantity"
                       (ngModelChange)="tier.minQuantity = +$event" />
                <span class="small muted">st →</span>
                <input class="input input--sm num right" type="number" step="0.5"
                       aria-label="Percentage" [ngModel]="tier.percent"
                       (ngModelChange)="tier.percent = +$event" />
                <span class="small muted">%</span>
                <button class="btn btn--sm btn--danger" type="button"
                        (click)="removeTier(scope.key, $index)">✕</button>
              </div>
            }
            <button class="btn btn--sm btn--primary mt-8" type="button"
                    (click)="saveTiers(scope.key)">Staffel opslaan</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class SettingsPage {
  /** Outcome of the last CSV import; problems are listed, never swallowed. */
  readonly csvResult = signal<CsvImportResult | null>(null);

  async exportProducts(): Promise<void> {
    saveBlob(await this.catalog.productsCsv(), 'enrosed-producten.csv');
  }

  async exportTranslations(): Promise<void> {
    saveBlob(await this.catalog.translationsCsv(), 'enrosed-vertalingen.csv');
  }

  async importProducts(files: FileList | null): Promise<void> {
    await this.runImport(files, (file) => this.catalog.importProductsCsv(file));
  }

  async importTranslations(files: FileList | null): Promise<void> {
    await this.runImport(files, (file) => this.catalog.importTranslationsCsv(file));
  }

  private async runImport(files: FileList | null,
                          upload: (file: File) => Promise<CsvImportResult>): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    try {
      this.csvResult.set(await upload(file));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Importeren mislukt'), 'err');
    }
  }

  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly scopes = [
    { key: 'LINE' as const, label: 'Lijnkorting — per product' },
    { key: 'ORDER' as const, label: 'Orderkorting — totaal order' },
  ];

  readonly company = signal<CompanyProfile | null>(null);
  readonly savingCompany = signal(false);
  readonly categories = signal<Category[]>([]);
  readonly hsCodes = signal<HsCode[]>([]);
  private readonly lineTiers = signal<DiscountTier[]>([]);
  private readonly orderTiers = signal<DiscountTier[]>([]);

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    const [categories, hsCodes, line, order, company] = await Promise.all([
      this.catalog.categories(), this.catalog.hsCodes(),
      this.sales.tiers('LINE'), this.sales.tiers('ORDER'),
      this.sales.company(),
    ]);
    this.company.set(company);
    this.categories.set(categories);
    this.hsCodes.set(hsCodes);
    this.lineTiers.set(line);
    this.orderTiers.set(order);
  }

  patchCompany(changes: Partial<CompanyProfile>): void {
    this.company.update((profile) => (profile ? { ...profile, ...changes } : profile));
  }

  async saveCompany(): Promise<void> {
    const profile = this.company();
    if (!profile) return;
    this.savingCompany.set(true);
    try {
      this.company.set(await this.sales.saveCompany(profile));
      this.ui.toast('Bedrijfsgegevens opgeslagen');
    } catch {
      this.ui.toast('Opslaan mislukt', 'err');
    } finally {
      this.savingCompany.set(false);
    }
  }

  tiers(scope: 'LINE' | 'ORDER'): DiscountTier[] {
    return scope === 'LINE' ? this.lineTiers() : this.orderTiers();
  }

  /* ---------------------------------------------------- categorieen */

  async addCategory(): Promise<void> {
    await this.catalog.createCategory(
      { id: null, code: 'NIEUW', name: 'Nieuwe categorie', description: '', position: 99 });
    await this.load();
  }

  async saveCategory(category: Category, changes: Partial<Category>): Promise<void> {
    await this.catalog.updateCategory(category.id!, { ...category, ...changes });
    await this.load();
  }

  removeCategory(category: Category): void {
    this.ui.confirm(
      { title: 'Categorie verwijderen', message: `<b>${category.name}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.catalog.deleteCategory(category.id!);
          await this.load();
        } catch (failure: unknown) {
          this.ui.toast(message(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  /* -------------------------------------------------- douanetarieven */

  addHsCode(): void {
    this.hsCodes.update((codes) =>
      [...codes, { id: null, code: '', description: '', dutyRatePct: 0 }]);
  }

  async saveHsCode(code: HsCode): Promise<void> {
    if (!code.code.trim()) { this.ui.toast('Vul een code in', 'err'); return; }
    await this.catalog.saveHsCode(code);
    this.ui.toast('Tarief opgeslagen');
    await this.load();
  }

  removeHsCode(code: HsCode): void {
    this.ui.confirm(
      { title: 'Tariefcode verwijderen',
        message: `<b>${code.code}</b> verwijderen? Producten vallen terug op het `
          + 'standaardpercentage van de inkooporder.',
        confirmLabel: 'Verwijderen', danger: true },
      async () => { await this.catalog.deleteHsCode(code.code); await this.load(); });
  }

  /* ------------------------------------------------------- staffels */

  addTier(scope: 'LINE' | 'ORDER'): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => [...tiers, { id: null, scope, minQuantity: 0, percent: 0 }]);
  }

  removeTier(scope: 'LINE' | 'ORDER', index: number): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => tiers.filter((_, i) => i !== index));
  }

  async saveTiers(scope: 'LINE' | 'ORDER'): Promise<void> {
    const saved = await this.sales.saveTiers(scope, this.tiers(scope));
    (scope === 'LINE' ? this.lineTiers : this.orderTiers).set(saved);
    this.ui.toast('Staffel opgeslagen');
  }
}

function message(failure: unknown, fallback: string): string {
  return (failure as { error?: { message?: string } }).error?.message ?? fallback;
}
