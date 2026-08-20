import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { LANGUAGES, LanguageCode, PortalLine, PortalQuote } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe } from '../../shared/pipes';

const LOCALES: Record<LanguageCode, string> = {
  NL: 'nl-BE', FR: 'fr-BE', EN: 'en-GB', DE: 'de-DE', ES: 'es-ES',
  PL: 'pl-PL', PT: 'pt-PT', TR: 'tr-TR',
};

/**
 * Authenticated, read-only rendering of the exact customer-safe quotation DTO.
 * It has no token and no response controls, so opening a draft here cannot
 * publish it or make it look viewed by the customer.
 */
@Component({
  selector: 'app-customer-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, PageHeader, Skeleton, CbmPipe, DateNlPipe,
            EurPipe, NumPipe, PctPipe],
  template: `
    <app-page-header title="Klantweergave" [subtitle]="quote()?.number || 'Veilige preview'"
                     [showBack]="true" [showBell]="false">
      @if (orderId(); as currentId) {
        <a class="btn btn--sm" [routerLink]="['/sales', currentId]">Interne weergave</a>
      }
    </app-page-header>

    <main class="content preview-page anim-rise">
      <section class="preview-notice" role="status">
        <span class="preview-notice__icon" aria-hidden="true">◎</span>
        <div>
          <strong>Alleen voorbeeld — niet openbaar</strong>
          <p>
            Je ziet uitsluitend wat de klant zal zien. Deze route werkt alleen na aanmelden,
            maakt geen klantlink en telt niet als bekeken.
          </p>
        </div>
        <label class="language-control">
          <span>Taal</span>
          <select [value]="language()" [disabled]="loading()"
                  (change)="changeLanguage($any($event.target).value)">
            @for (option of languages; track option.code) {
              <option [value]="option.code">{{ option.code }} · {{ option.label }}</option>
            }
          </select>
        </label>
      </section>

      @if (quote(); as data) {
        <article class="quote-paper" aria-labelledby="customer-quote-title">
          <header class="quote-head">
            <img src="logo-ui.png" alt="Enrosed" />
            <div>
              <span>{{ t(data, 'quote', 'Offerte') }}</span>
              <h1 id="customer-quote-title">{{ data.number }}</h1>
            </div>
          </header>

          <section class="quote-intro">
            <div>
              <span class="quote-kicker">{{ t(data, 'portalYourQuote', 'Uw offerte') }}</span>
              <h2>{{ data.companyName || t(data, 'customer', 'Klant') }}</h2>
              @if (data.contactName) { <p>{{ data.contactName }}</p> }
            </div>
            <dl>
              <div><dt>{{ t(data, 'date', 'Datum') }}</dt><dd>{{ data.orderDate | dateNl: locale() }}</dd></div>
              <div><dt>{{ t(data, 'validUntil', 'Geldig tot') }}</dt><dd>{{ data.validUntil | dateNl: locale() }}</dd></div>
              <div><dt>{{ t(data, 'incoterm', 'Incoterm') }}</dt><dd>{{ data.incoterm || '—' }}</dd></div>
            </dl>
          </section>

          @if (data.deliveryTerms === 'TE_BEPALEN' || data.freight === 'TE_BEPALEN') {
            <section class="open-items">
              @if (data.deliveryTerms === 'TE_BEPALEN') {
                <div>
                  <strong>{{ t(data, 'portalTermsPendingTitle', 'Levertermijn nog te bepalen') }}</strong>
                  <p>{{ t(data, 'portalTermsPendingText', 'Wij vullen de levertermijn later aan.') }}</p>
                </div>
              }
              @if (data.freight === 'TE_BEPALEN') {
                <div>
                  <strong>{{ t(data, 'portalFreightPendingTitle', 'Vracht nog te bepalen') }}</strong>
                  <p>{{ t(data, 'portalFreightPendingText', 'Het totaal is nog zonder vracht.') }}</p>
                </div>
              }
            </section>
          }

          <section class="quote-lines" aria-label="Producten">
            @for (line of data.lines; track line.productId) {
              <article class="customer-line">
                <div class="customer-line__photo">
                  @if (line.photoUrl) {
                    <img [appAuthSrc]="line.photoUrl" [alt]="line.description" />
                  } @else { <span aria-hidden="true">◇</span> }
                </div>
                <div class="customer-line__copy">
                  <span class="sku">{{ line.sku }}</span>
                  <h3>{{ line.description }}</h3>
                  <p>
                    {{ line.quantity | num: 0: locale() }} {{ t(data, 'portalPieces', 'stuks') }}
                    <span aria-hidden="true"> · </span>
                    {{ line.unitPrice | eur: 2: locale() }} {{ t(data, 'portalPerPiece', 'per stuk') }}
                  </p>
                  <p class="delivery">{{ deliveryText(data, line) }}</p>
                </div>
                <div class="customer-line__amount">
                  <strong>{{ line.net | eur: 2: locale() }}</strong>
                  @if (line.discountPct) {
                    <small>{{ t(data, 'portalDiscount', 'korting') }} {{ line.discountPct | pct: 1: locale() }}</small>
                  }
                </div>
              </article>
            } @empty {
              <p class="empty">Deze offerte bevat nog geen producten.</p>
            }
          </section>

          <section class="quote-summary">
            <dl class="logistics">
              <div><dt>{{ t(data, 'cartons', 'Dozen') }}</dt><dd>{{ data.totals.cartons | num: 0: locale() }}</dd></div>
              @if (data.loadMode !== 'LOOSE_CARTONS') {
                <div><dt>{{ t(data, 'pallets', 'Pallets') }}</dt><dd>{{ data.totals.pallets | num: 0: locale() }}</dd></div>
              }
              <div><dt>{{ t(data, 'volume', 'Volume') }}</dt><dd>{{ data.totals.cbm || 0 | cbm: 3: locale() }}</dd></div>
            </dl>
            <dl class="amounts">
              <div><dt>{{ t(data, 'subtotal', 'Subtotaal') }}</dt><dd>{{ data.totals.subtotal | eur: 2: locale() }}</dd></div>
              @if (data.totals.orderDiscountAmount) {
                <div><dt>{{ t(data, 'orderDiscount', 'Orderkorting') }}</dt><dd>− {{ data.totals.orderDiscountAmount | eur: 2: locale() }}</dd></div>
              }
              @if (data.totals.extraDiscountAmount) {
                <div><dt>{{ data.totals.extraDiscountLabel || t(data, 'extraDiscount', 'Extra korting') }}</dt><dd>− {{ data.totals.extraDiscountAmount | eur: 2: locale() }}</dd></div>
              }
              <div><dt>{{ t(data, 'goodsValue', 'Goederenwaarde') }}</dt><dd>{{ data.totals.goodsTotal | eur: 2: locale() }}</dd></div>
              <div><dt>{{ t(data, 'freight', 'Vracht') }}</dt><dd>{{ data.freight === 'TE_BEPALEN' ? t(data, 'freightToBeDetermined', 'Nog te bepalen') : (data.totals.freight | eur: 2: locale()) }}</dd></div>
              @if (data.totals.handling) {
                <div><dt>{{ t(data, 'handling', 'Administratie') }}</dt><dd>{{ data.totals.handling | eur: 2: locale() }}</dd></div>
              }
              <div class="amounts__total"><dt>{{ t(data, 'total', 'Totaal') }}</dt><dd>{{ data.totals.total | eur: 2: locale() }}</dd></div>
              <div><dt>{{ t(data, 'vat', 'BTW') }} {{ data.totals.vatRatePct | pct: 0: locale() }}</dt><dd>{{ data.totals.vatAmount | eur: 2: locale() }}</dd></div>
              <div class="amounts__incl"><dt>{{ t(data, 'totalInclVat', 'Totaal incl. BTW') }}</dt><dd>{{ data.totals.totalInclVat | eur: 2: locale() }}</dd></div>
            </dl>
          </section>

          @if (data.notes) {
            <section class="customer-note"><strong>{{ t(data, 'note', 'Opmerking') }}</strong><p>{{ data.notes }}</p></section>
          }
          <footer>{{ t(data, 'portalFooter', 'Vragen? Antwoord gerust op de e-mail met deze offerte.') }}</footer>
        </article>
      } @else if (loading()) {
        <app-skeleton kind="card" />
        <app-skeleton kind="lines" [rows]="6" />
      } @else {
        <section class="preview-error">
          <strong>Voorbeeld kon niet worden geladen</strong>
          <p>{{ error() }}</p>
          <button class="btn btn--primary" type="button" (click)="retry()">Opnieuw proberen</button>
        </section>
      }
    </main>
  `,
  styles: `
    .preview-page { max-width:900px;margin-inline:auto;padding-bottom:48px }
    .preview-notice { position:sticky;z-index:3;top:64px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px 12px;align-items:center;margin-bottom:12px;padding:12px 14px;border:1px solid #d8c48e;border-radius:15px;background:#fff9e8;box-shadow:var(--sh-1) }
    .preview-notice__icon { display:grid;width:34px;height:34px;place-items:center;border-radius:11px;background:#fff;color:#956b09;font-size:18px }
    .preview-notice strong { display:block;font-size:12px }.preview-notice p { margin:2px 0 0;color:var(--muted);font-size:10.5px;line-height:1.4 }
    .language-control { grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--muted);font-size:10px;font-weight:700 }
    .language-control select { min-height:38px;max-width:190px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:0 10px;color:var(--ink);font:inherit }
    .quote-paper { overflow:hidden;border:1px solid #e4dfdc;border-radius:20px;background:#fff;box-shadow:0 18px 55px rgb(39 33 31/.1) }
    .quote-head { display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px;background:#211c1a;color:#fff }.quote-head img { width:112px;max-height:34px;object-fit:contain;object-position:left center }.quote-head>div { text-align:right }.quote-head span { color:rgb(255 255 255/.58);font-size:9px;text-transform:uppercase;letter-spacing:.11em }.quote-head h1 { margin:2px 0 0;color:#fff;font-size:19px }
    .quote-intro { display:grid;gap:18px;padding:20px;border-bottom:1px solid #eee9e6 }.quote-kicker { color:var(--rose);font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase }.quote-intro h2 { margin:4px 0 0;font-size:21px }.quote-intro p { margin:3px 0 0;color:var(--muted);font-size:11px }.quote-intro dl,.logistics,.amounts { margin:0 }.quote-intro dl>div,.logistics>div,.amounts>div { display:flex;justify-content:space-between;gap:14px;padding:5px 0 }.quote-intro dt,.logistics dt,.amounts dt { color:var(--muted);font-size:10.5px }.quote-intro dd,.logistics dd,.amounts dd { margin:0;font-size:11px;font-weight:700;text-align:right }
    .open-items { display:grid;gap:8px;padding:12px 18px;background:#fff9e8 }.open-items>div { padding:9px;border-left:3px solid #d2a633 }.open-items strong { font-size:11px }.open-items p { margin:2px 0 0;color:var(--muted);font-size:10px;line-height:1.4 }
    .quote-lines { padding:10px }.customer-line { display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:10px;padding:11px;border-bottom:1px solid #eee9e6 }.customer-line:last-child { border-bottom:0 }.customer-line__photo { width:54px;height:54px;display:grid;overflow:hidden;place-items:center;border:1px solid #eee9e6;border-radius:11px;color:var(--muted);font-size:20px }.customer-line__photo img { width:100%;height:100%;object-fit:contain }.customer-line__copy { min-width:0 }.customer-line .sku { color:var(--muted);font:9px var(--mono) }.customer-line h3 { margin:2px 0 0;font-size:12px;line-height:1.3 }.customer-line p { margin:5px 0 0;color:var(--muted);font-size:9.5px }.customer-line .delivery { color:var(--ink-2) }.customer-line__amount { min-width:82px;text-align:right }.customer-line__amount strong { display:block;font-size:12px;white-space:nowrap }.customer-line__amount small { display:block;margin-top:4px;color:var(--rose-dark);font-size:9px }.empty { padding:24px;text-align:center;color:var(--muted);font-size:11px }
    .quote-summary { display:grid;gap:18px;padding:18px 20px;border-top:1px solid #eee9e6;background:#fcfaf9 }.logistics>div { border-bottom:1px solid #eee9e6 }.amounts>div { border-bottom:1px solid #eee9e6 }.amounts__total { margin-top:4px;padding:10px 0!important;border-top:1px solid #d9d1cd }.amounts__total dt,.amounts__total dd { color:var(--ink);font-size:14px;font-weight:800 }.amounts__incl { border-bottom:0!important }.amounts__incl dt,.amounts__incl dd { color:var(--ink-2);font-weight:750 }
    .customer-note { padding:18px 20px;border-top:1px solid #eee9e6 }.customer-note strong { color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.1em }.customer-note p { margin:6px 0 0;white-space:pre-line;font-size:11px;line-height:1.55 }.quote-paper footer { padding:14px 20px;background:#211c1a;color:rgb(255 255 255/.65);font-size:9.5px;line-height:1.45;text-align:center }
    .preview-error { padding:30px;border:1px solid var(--line);border-radius:16px;background:var(--surface);text-align:center }.preview-error strong { font-size:15px }.preview-error p { color:var(--muted);font-size:11px }
    @media(min-width:640px) { .preview-notice { grid-template-columns:auto minmax(0,1fr) auto }.language-control { grid-column:auto;display:grid;justify-items:end }.quote-intro { grid-template-columns:minmax(0,1fr) 260px;align-items:start;padding:26px }.quote-summary { grid-template-columns:minmax(0,.75fr) minmax(280px,1.25fr);padding:22px 26px }.customer-line { grid-template-columns:64px minmax(0,1fr) 110px;padding:14px }.customer-line__photo { width:64px;height:64px } }
  `,
})
export class CustomerPreview {
  private readonly sales = inject(SalesApi);

  readonly id = input<string>('');
  readonly quote = signal<PortalQuote | null>(null);
  readonly language = signal<LanguageCode>('NL');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly languages = LANGUAGES;
  readonly locale = computed(() => LOCALES[this.language()] ?? LOCALES.NL);
  readonly orderId = computed(() => {
    const value = Number(this.id());
    return Number.isInteger(value) && value > 0 ? value : null;
  });

  constructor() {
    effect(() => {
      const orderId = this.orderId();
      if (orderId != null) void this.load(orderId);
      else {
        this.loading.set(false);
        this.error.set('Het ordernummer in de link is ongeldig.');
      }
    });
  }

  async changeLanguage(language: LanguageCode): Promise<void> {
    if (!LANGUAGES.some((item) => item.code === language)) return;
    this.language.set(language);
    const orderId = this.orderId();
    if (orderId != null) await this.load(orderId, language);
  }

  retry(): void {
    const orderId = this.orderId();
    if (orderId != null) void this.load(orderId, this.language());
  }

  t(quote: PortalQuote, key: string, fallback: string): string {
    return quote.text?.[key] || fallback;
  }

  deliveryText(quote: PortalQuote, line: PortalLine): string {
    if (line.deliveryWeek) {
      return `${this.t(quote, 'portalDeliveryInWeek', 'Levering in')} ${
        new WeekNlPipe().transform(line.deliveryWeek, 'short', this.locale())}`;
    }
    if (line.deliveryDate) {
      return `${this.t(quote, 'portalDeliverableFrom', 'Leverbaar vanaf')} ${
        new DateNlPipe().transform(line.deliveryDate, this.locale())}`;
    }
    return line.inStock
      ? this.t(quote, 'portalInStock', 'op voorraad')
      : this.t(quote, 'portalTermToBeDetermined', 'Levertermijn nog te bepalen');
  }

  private async load(orderId: number, language?: LanguageCode): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const quote = await this.sales.customerPreview(orderId, language);
      this.quote.set(quote);
      const responseLanguage = quote.language?.toUpperCase() as LanguageCode;
      if (LANGUAGES.some((item) => item.code === responseLanguage)) {
        this.language.set(responseLanguage);
      }
    } catch (failure: unknown) {
      this.quote.set(null);
      this.error.set(messageOf(failure, 'Het klantvoorbeeld kon niet worden geladen'));
    } finally {
      this.loading.set(false);
    }
  }
}
