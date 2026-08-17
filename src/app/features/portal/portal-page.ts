import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { PortalCatalogItem, PortalQuote } from '../../core/api/models';
import { Sheet, Ui } from '../../shared/ui';
import { PortalProductPicker } from './portal-product-picker';
import { DateNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe } from '../../shared/pipes';
import { LANGUAGES, LanguageCode } from '../../core/api/models';

/**
 * De offerte zoals de klant hem ziet.
 *
 * Geen aanmelding: de link uit de mail bevat het token. Geen kostprijs, geen
 * marge - de server stuurt hier een eigen weergave, geen versie van ons scherm
 * met velden verborgen.
 *
 * De klant kan tekenen, afwijzen, of aantallen voorstellen. Dat laatste wijzigt
 * de offerte niet: het is een voorstel dat bij de verkoper terechtkomt.
 */
@Component({
  selector: 'app-portal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, PortalProductPicker, EurPipe, NumPipe, PctPipe, DateNlPipe,
            WeekNlPipe],
  template: `
    <div class="portal">
      <header class="portal__bar">
        <img class="portal__logo" src="logo.png" alt="Enrosed" />

        <!-- De klant kan zelf een andere taal kiezen. Zijn keuze geldt alleen voor
             dit scherm; de volgende offerte vertrekt in de taal die op zijn fiche
             staat. Wie in Frankrijk zit maar liever Engels leest hoeft daarvoor
             niet te bellen. -->
        <div class="portal__lang">
          <span class="portal__globe" aria-hidden="true">◍</span>
          <select class="portal__select" [ngModel]="language()"
                  (ngModelChange)="setLanguage($event)" aria-label="Taal kiezen">
            @for (option of languages; track option.code) {
              <option [value]="option.code">{{ option.code }}</option>
            }
          </select>
        </div>
      </header>

      @if (error()) {
        <div class="content" style="max-width:640px">
          <div class="card"><div class="card__body">
            <div class="empty">
              <div class="empty__icon">◇</div>
              <div class="empty__title">{{ t('portalNotFound') }}</div>
              <div class="empty__text">{{ t('portalNotFoundText') }}</div>
            </div>
          </div></div>
        </div>
      } @else if (quote(); as data) {
        <div class="content" style="max-width:820px">

          <div class="card">
            <div class="card__body">
              <div class="row wrap" style="justify-content:space-between">
                <div>
                  <div class="tiny muted">{{ t('quote') }}</div>
                  <div style="font-size:22px;font-weight:700">{{ data.number }}</div>
                  <div class="small muted">
                    {{ t('portalFor') }} {{ data.companyName }} ·
                    {{ t('portalValidUntil') }} {{ data.validUntil | dateNl }}
                  </div>
                </div>
                <span class="badge" [class]="'badge--' + badge(data)">{{ statusLabel(data) }}</span>
              </div>
            </div>
          </div>

          @if (deliveryTermsPending()) {
            <div class="alert alert--warn mt-12">
              <span class="alert__icon">!</span>
              <div>
                <b>{{ t('portalTermsPendingTitle') }}.</b>
                {{ t('portalTermsPendingText') }}
              </div>
            </div>
          }

          @if (freightPending()) {
            <div class="alert alert--warn mt-12">
              <span class="alert__icon">!</span>
              <div>
                <b>{{ t('portalFreightPendingTitle') }}.</b> {{ t('portalFreightPendingText') }}
              </div>
            </div>
          }

          @if (freightJustAdded()) {
            <div class="alert alert--ok mt-12">
              <span class="alert__icon">✓</span>
              <div>
                <b>{{ t('freight') }}.</b> {{ t('portalFreightPendingText') }}
              </div>
            </div>
          }

          @if (deliveryTermsJustAdded()) {
            <div class="alert alert--ok mt-12">
              <span class="alert__icon">✓</span>
              <div>
                <b>{{ t('portalTermsAddedTitle') }}.</b> {{ t('portalTermsAddedText') }}
              </div>
            </div>
          }

          @if (data.signedByName) {
            <div class="alert alert--ok mt-12">
              <span class="alert__icon">✓</span>
              <div>
                {{ t('portalSignedBy') }} <b>{{ data.signedByName }}</b>.
                {{ t('portalSignedText') }}
              </div>
            </div>
          }

          @for (proposal of data.proposals; track proposal.proposedAt) {
            <div class="alert mt-12"
                 [class.alert--warn]="proposal.status === 'IN_AFWACHTING'"
                 [class.alert--ok]="proposal.status === 'GOEDGEKEURD'"
                 [class.alert--info]="proposal.status === 'AFGEWEZEN'">
              <span class="alert__icon">⇄</span>
              <div>
                @switch (proposal.status) {
                  @case ('IN_AFWACHTING') { {{ t('portalProposalSent') }} }
                  @case ('GOEDGEKEURD') { {{ t('portalProposalApproved') }} }
                  @default { {{ t('portalProposalRejected') }} }
                }
                @if (proposal.responseMessage) { <br />"{{ proposal.responseMessage }}" }
              </div>
            </div>
          }

          <div class="card mt-12">
            <div class="card__head"><h2>{{ t('portalYourQuote') }}</h2></div>
            <div class="card__body card__body--flush">
              <div class="list">
                @for (line of data.lines; track line.productId) {
                  <div class="list-item">
                    <div class="list-item__body">
                      <div class="list-item__title">{{ line.description }}</div>
                      <div class="list-item__meta">
                        {{ line.quantity | num }} {{ t('portalPieces') }} ·
                        {{ line.cartons | num }} {{ t('portalBoxes') }} ·
                        {{ line.pallets }} {{ t('portalPalletsShort') }}
                      </div>
                      <div class="list-item__meta">
                        {{ line.unitPrice | eur: 3 }} {{ t('portalPerPiece') }}
                        @if (line.discountPct) {
                          · {{ t('portalDiscount') }} {{ line.discountPct | pct: 1 }}
                        }
                      </div>
                      <div class="list-item__meta list-item__meta--wrap">
                        @if (line.inStock) {
                          <span class="ok-text"><span class="stock-dot stock-dot--ok"></span>
                            {{ t('portalDeliverableFrom') }}
                            {{ line.deliveryDate | dateNl }}</span>
                        } @else if (line.deliveryWeek) {
                          <span class="ok-text"><span class="stock-dot stock-dot--ok"></span>
                            {{ t('portalDeliveryInWeek') }}
                            {{ line.deliveryWeek | weekNl }}</span>
                        } @else {
                          <!-- Oranje, niet rood: het is een openstaand punt, geen fout,
                               en rood schrikt af op het scherm waar iemand moet tekenen. -->
                          <span class="warn-text"><span class="stock-dot stock-dot--low"></span>
                            {{ t('portalTermToBeDetermined') }}</span>
                        }
                      </div>
                    </div>
                    <div class="list-item__end">
                      <div class="strong num">{{ line.net | eur }}</div>
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__body">
              <div class="stat-row"><span>{{ t('subtotal') }}</span>
                <span class="num">{{ data.totals.subtotal | eur }}</span></div>
              @if (data.totals.orderDiscountAmount) {
                <div class="stat-row stat-row--discount">
                  <span>{{ t('orderDiscount') }} {{ data.totals.orderDiscountPercent | pct: 0 }}</span>
                  <span class="num">− {{ data.totals.orderDiscountAmount | eur }}</span></div>
              }
              @if (data.totals.extraDiscountAmount) {
                <div class="stat-row stat-row--discount">
                  <span>{{ data.totals.extraDiscountLabel || t('extraDiscount') }}
                    ({{ data.totals.extraDiscountPercent | pct: 1 }})</span>
                  <span class="num">− {{ data.totals.extraDiscountAmount | eur }}</span></div>
              }
              <div class="stat-row stat-row--sub"><span>{{ t('goodsValue') }}</span>
                <span class="num">{{ data.totals.goodsTotal | eur }}</span></div>
              <div class="stat-row">
                <span>{{ t('freight') }} ({{ data.totals.pallets }} {{ t('portalPalletsShort') }})</span>
                <span class="num">
                  @if (freightPending()) {
                    <span class="warn-text">{{ t('freightToBeDetermined') }}</span>
                  } @else {
                    {{ data.totals.freight | eur }}
                  }
                </span></div>
              <div class="stat-row"><span>{{ t('handling') }}</span>
                <span class="num">{{ data.totals.handling | eur }}</span></div>
              <div class="stat-row stat-row--total"><span>{{ t('total') }}</span>
                <span class="num">{{ data.totals.total | eur }}</span></div>
              @if (data.totals.vatLegalMention) {
                <div class="stat-row stat-row--muted">
                  <span>{{ t('vat') }} — {{ data.totals.vatTreatment }}</span>
                  <span class="num">{{ 0 | eur }}</span></div>
              } @else {
                <div class="stat-row stat-row--muted">
                  <span>{{ t('vat') }} {{ data.totals.vatRatePct | pct: 1 }}</span>
                  <span class="num">{{ data.totals.vatAmount | eur }}</span></div>
                <div class="stat-row stat-row--muted"><span>{{ t('totalInclVat') }}</span>
                  <span class="num">{{ data.totals.totalInclVat | eur }}</span></div>
              }
            </div>
          </div>

          @if (data.totals.vatLegalMention) {
            <div class="alert alert--info mt-12">
              <span class="alert__icon">§</span>
              <div>{{ data.totals.vatLegalMention }}</div>
            </div>
          }

          <a class="btn btn--block mt-12" [href]="pdfUrl()" target="_blank" rel="noopener">
            {{ t('portalPdf') }}
          </a>

          @if (data.canRespond) {
            <div class="card mt-16">
              <div class="card__head"><h2>{{ t('portalWhatNext') }}</h2></div>
              <div class="card__body">
                @if (proposalPending()) {
                  <!-- Zolang zijn voorstel bij ons ligt heeft tekenen geen zin: hij
                       zou tekenen voor de offerte zoals ze wás. Intrekken is de weg
                       terug, en dat is zelf een stap in de geschiedenis. -->
                  <div class="alert alert--warn" style="margin-bottom:12px">
                    <span class="alert__icon">⇄</span>
                    <div>
                      <b>{{ t('portalProposalPending') }}.</b>
                      {{ t('portalProposalPendingText') }}
                    </div>
                  </div>
                  <button class="btn btn--block" type="button" [disabled]="busy()"
                          (click)="withdraw()">{{ t('portalWithdraw') }}</button>
                } @else {
                  <button class="btn btn--accept btn--block" type="button"
                          (click)="signSheet.set(true)">{{ t('portalAccept') }}</button>
                  <button class="btn btn--block mt-8" type="button"
                          (click)="openProposal()">{{ t('portalPropose') }}</button>
                  <button class="btn btn--block btn--quiet mt-8" type="button"
                          (click)="rejectSheet.set(true)">{{ t('portalRejectQuote') }}</button>
                }
              </div>
            </div>
          }

          <p class="tiny muted center mt-24">
            Enrosed · {{ t('portalFooter') }} ·
            <a href="/voorwaarden" target="_blank" rel="noopener">{{ t('portalTerms') }}</a>
          </p>
        </div>
      } @else {
        <div class="content"><div class="empty">
          <div class="empty__title">{{ t('portalLoading') }}</div>
        </div></div>
      }
    </div>

    <!-- ======================================================= tekenen -->
    @if (signSheet()) {
      <app-sheet [title]="t('portalSignTitle')" (closed)="signSheet.set(false)">
        <div body>
          <p class="small muted" style="margin-bottom:14px">{{ t('portalSignText') }}</p>
          <div class="field">
            <label for="sign-name">{{ t('portalYourName') }}</label>
            <input class="input" id="sign-name" [ngModel]="signName()"
                   (ngModelChange)="signName.set($event)" />
          </div>
          <div class="field">
            <label for="sign-note">{{ t('portalNoteOptional') }}</label>
            <textarea class="textarea" id="sign-note" [ngModel]="signNote()"
                      (ngModelChange)="signNote.set($event)"></textarea>
          </div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button"
                  (click)="signSheet.set(false)">{{ t('portalCancel') }}</button>
          <button class="btn btn--accept" type="button" [disabled]="busy()"
                  (click)="accept()">{{ t('portalSignButton') }}</button>
        </div>
      </app-sheet>
    }

    <!-- ================================================== wijzigingen -->
    @if (proposalSheet()) {
      <app-sheet [title]="t('portalPropose')" (closed)="proposalSheet.set(false)">
        <div body>
          <p class="small muted" style="margin-bottom:14px">{{ t('portalProposeText') }}</p>
          <div class="section-title" style="margin-top:0">{{ t('portalOnYourQuote') }}</div>
          @for (line of proposalLines(); track line.productId) {
            <div class="field">
              <label [attr.for]="'prop-' + line.productId">{{ line.description }}</label>
              <input class="input num right" [id]="'prop-' + line.productId" type="number"
                     min="0" step="1" inputmode="numeric" [ngModel]="line.quantity"
                     (ngModelChange)="setProposal(line.productId, +$event)" />
              @if (pendingRound()[line.productId]; as to) {
                <span class="hint warn-text">
                  {{ t('portalRoundingNotice') }} <b>{{ to | num }}</b>
                  ({{ line.piecesPerCarton }} {{ t('portalPerBox') }})
                </span>
              } @else {
                <span class="hint">
                  {{ line.piecesPerCarton }} {{ t('portalPerBox') }}
                </span>
              }
            </div>
          }

          @if (hasOutOfStockAddition()) {
            <div class="alert alert--warn mt-8">
              <span class="alert__icon">!</span>
              <div>{{ t('portalOutOfStockWarning') }}</div>
            </div>
          }

          <div class="section-title">
            {{ t('portalAddSection') }} <span class="opt">{{ t('portalOptional') }}</span>
          </div>
          @if (additions().size) {
            @for (entry of additionList(); track entry.productId) {
              <div class="row" style="justify-content:space-between;padding:8px 0;
                                      border-bottom:1px solid var(--line)">
                <div>
                  <div class="small strong">{{ entry.description }}</div>
                  <div class="tiny muted">
                    {{ entry.quantity | num }} {{ t('portalPieces') }}
                  </div>
                </div>
                <button class="btn btn--sm btn--danger" type="button"
                        (click)="removeAddition(entry.productId)">✕</button>
              </div>
            }
          }
          <button class="btn btn--block mt-8" type="button" (click)="catalogSheet.set(true)">
            + {{ t('portalAddItem') }}
          </button>
          @if (hasOutOfStockAddition()) {
            <div class="alert alert--warn mt-8">
              <span class="alert__icon">!</span>
              <div>{{ t('portalOutOfStockWarning') }}</div>
            </div>
          }

          <div class="field mt-12">
            <label for="prop-name">{{ t('portalYourName') }}</label>
            <input class="input" id="prop-name" [ngModel]="proposeBy()"
                   (ngModelChange)="proposeBy.set($event)" />
          </div>
          <div class="field">
            <label for="prop-msg">{{ t('portalComment') }}</label>
            <textarea class="textarea" id="prop-msg" [ngModel]="proposeMessage()"
                      (ngModelChange)="proposeMessage.set($event)"></textarea>
          </div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button"
                  (click)="proposalSheet.set(false)">{{ t('portalCancel') }}</button>
          <button class="btn btn--primary" type="button" [disabled]="busy()"
                  (click)="propose()">{{ t('portalSend') }}</button>
        </div>
      </app-sheet>
    }

    @if (catalogSheet()) {
      <app-portal-product-picker
        [t]="translate"
        [items]="extraItems()"
        (picked)="addFromCatalog($event)"
        (cancelled)="catalogSheet.set(false)"
      />
    }

    @if (rejectSheet()) {
      <app-sheet [title]="t('portalRejectQuote')" (closed)="rejectSheet.set(false)">
        <div body>
          <div class="field">
            <label for="rej-msg">{{ t('portalReasonOptional') }}</label>
            <textarea class="textarea" id="rej-msg" [ngModel]="rejectMessage()"
                      (ngModelChange)="rejectMessage.set($event)"></textarea>
          </div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button"
                  (click)="rejectSheet.set(false)">{{ t('portalCancel') }}</button>
          <button class="btn btn--danger" type="button" [disabled]="busy()"
                  (click)="reject()">{{ t('portalReject') }}</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .portal { min-height: 100dvh; background: var(--bg); }
    .portal__bar {
      background: #17120f;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    /* De taalkiezer staat rechts en blijft klein: het is een uitweg voor wie hem
       nodig heeft, geen kernfunctie van dit scherm. */
    .portal__lang {
      position: absolute;
      right: 12px;
      display: flex;
      align-items: center;
      gap: 3px;
      color: #cfc6c0;
    }
    .portal__globe { font-size: 13px; }
    .portal__select {
      background: transparent;
      border: 0;
      color: #cfc6c0;
      font: inherit;
      font-size: 12px;
      padding: 4px 2px;
      cursor: pointer;
    }
    .portal__select option { color: #1a1614; }
    /* Het logo is zeer breed (ongeveer 6:1). Vaste hoogte met width:auto houdt
       de verhouding intact; zonder max-width duwt het op smalle schermen de balk
       uit elkaar. */
    .portal__logo {
      height: 26px;
      width: auto;
      max-width: min(220px, 70vw);
      object-fit: contain;
      /* Zwarte inkt op transparant, dus op de donkere balk omkeren. */
      filter: invert(1);
    }
    .portal .content { padding-bottom: 60px; }
  `,
})
export class PortalPage {
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly token = input.required<string>();

  readonly quote = signal<PortalQuote | null>(null);
  readonly error = signal(false);
  readonly busy = signal(false);

  readonly signSheet = signal(false);
  readonly signName = signal('');
  readonly signNote = signal('');

  readonly proposalSheet = signal(false);
  readonly proposalLines = signal<{
    productId: number; description: string; quantity: number; piecesPerCarton: number;
  }[]>([]);
  /** Aantallen die zo naar een volle doos springen; meteen zichtbaar, nog niet toegepast. */
  readonly pendingRound = signal<Record<number, number>>({});
  private roundTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Producten die nog niet op de offerte staan en die de klant erbij kan zetten. */
  readonly catalog = signal<PortalCatalogItem[]>([]);
  readonly additions = signal<Map<number, { description: string; quantity: number }>>(new Map());
  readonly proposeBy = signal('');
  readonly proposeMessage = signal('');

  readonly rejectSheet = signal(false);
  readonly catalogSheet = signal(false);
  readonly rejectMessage = signal('');

  constructor() {
    effect(() => {
      const token = this.token();
      if (token) void this.load(token);
    });
  }

  private async load(token: string): Promise<void> {
    try {
      /* Koos deze klant hier eerder een taal, dan begint hij daar weer in. */
      const chosen = this.storedLanguage(token);
      const quote = await this.sales.portalQuote(token, chosen ?? undefined);
      this.quote.set(quote);
      this.language.set(chosen ?? (quote.language as LanguageCode) ?? 'NL');
      this.proposeBy.set(quote.contactName ?? '');
      this.catalog.set(await this.sales.portalCatalog(token));
    } catch {
      this.error.set(true);
    }
  }

  readonly pdfUrl = computed(() => this.sales.portalPdfUrl(this.token()));

  /**
   * Hebben wij de levertermijn ingevuld die de klant miste? Dat komt van de
   * backend: die weet met welke stand de offerte vertrokken is. Het uit de
   * regels afleiden ging mis zodra wij zelf een termijn nalieten.
   */
  readonly deliveryTermsJustAdded = computed(() => {
    const quote = this.quote();
    return !!quote && quote.deliveryTerms === 'AANGEVULD' && quote.canRespond;
  });

  /** Wacht de klant nog op een termijn van ons? */
  readonly deliveryTermsPending = computed(() => {
    const quote = this.quote();
    return !!quote && quote.deliveryTerms === 'TE_BEPALEN' && quote.canRespond;
  });

  /**
   * Een tekst in de taal van de klant.
   *
   * De teksten komen van de server mee met de offerte, niet uit een bundel hier:
   * zo staan de offerte, de PDF, de mail en dit scherm gegarandeerd in dezelfde
   * woorden en hoeft een nieuwe taal maar op één plaats toegevoegd te worden.
   *
   * Ontbreekt er iets - bijvoorbeeld doordat de server nog een oudere versie
   * draait - dan verschijnt de sleutel zelf. Dat is lelijk maar zichtbaar, en
   * dus beter dan een leeg vak in een document dat naar een klant gaat.
   */
  t(key: string): string {
    return this.quote()?.text?.[key] ?? key;
  }

  /** Ligt er een voorstel van deze klant bij ons? */
  readonly proposalPending = computed(() =>
    this.quote()?.proposals.some((p) => p.status === 'IN_AFWACHTING') ?? false);

  /**
   * De klant trekt zijn voorstel weer in.
   *
   * Het voorstel blijft in de geschiedenis staan; alleen ligt de offerte weer bij
   * hem. Wissen zou betekenen dat niemand later nog kan zien wat er gevraagd was.
   */
  async withdraw(): Promise<void> {
    await this.run(() => this.sales.portalWithdraw(this.token()), this.t('portalWithdrawn'));
  }

  readonly languages = LANGUAGES;

  /** De taal waarin dit scherm staat; die van de klant tenzij hij zelf koos. */
  readonly language = signal<LanguageCode>('NL');

  private storedLanguage(token: string): LanguageCode | null {
    try {
      return (localStorage.getItem('enrosed.portalLanguage.' + token) as LanguageCode) || null;
    } catch {
      return null;
    }
  }

  /**
   * De klant kiest een andere taal.
   *
   * De keuze blijft in dit toestel bewaard zodat hij bij een volgend bezoek niet
   * opnieuw hoeft te kiezen. Op de klantfiche verandert er niets: dat is een
   * afspraak tussen ons en hem, geen instelling van zijn browser.
   */
  async setLanguage(code: LanguageCode): Promise<void> {
    this.language.set(code);
    try {
      localStorage.setItem('enrosed.portalLanguage.' + this.token(), code);
    } catch {
      /* privémodus: dan geldt de keuze alleen voor dit bezoek */
    }
    try {
      this.quote.set(await this.sales.portalQuote(this.token(), code));
    } catch {
      /* de offerte blijft staan zoals ze stond */
    }
  }

  /** Dezelfde vertaalfunctie om door te geven aan een kindcomponent. */
  readonly translate = (key: string): string => this.t(key);

  statusLabel(quote: PortalQuote): string {
    switch (quote.status) {
      case 'GEACCEPTEERD': return this.t('portalStatusAccepted');
      case 'AFGEWEZEN': return this.t('portalStatusRejected');
      case 'WIJZIGING_GEVRAAGD': return this.t('portalStatusRevision');
      default: return this.t('portalStatusOpen');
    }
  }

  /** Wacht de klant nog op een vrachtbedrag van ons? */
  readonly freightPending = computed(() => this.quote()?.freight === 'TE_BEPALEN');

  /** Hebben wij de vracht ingevuld die de klant miste? */
  readonly freightJustAdded = computed(() => {
    const quote = this.quote();
    return !!quote && quote.freight === 'AANGEVULD' && quote.canRespond;
  });

  badge(quote: PortalQuote): string {
    switch (quote.status) {
      case 'GEACCEPTEERD': return 'ok';
      case 'AFGEWEZEN': return 'danger';
      case 'WIJZIGING_GEVRAAGD': return 'gold';
      default: return 'rose';
    }
  }

  openProposal(): void {
    const quote = this.quote();
    if (!quote) return;
    this.proposalLines.set(quote.lines.map((line) => ({
      productId: line.productId, description: line.description, quantity: line.quantity,
      piecesPerCarton: Math.max(1, line.piecesPerCarton || 1),
    })));
    this.pendingRound.set({});
    this.additions.set(new Map());
    this.proposalSheet.set(true);
  }

  /** Wat er nog niet op de offerte staat. */
  readonly extraItems = computed(() => {
    const onQuote = new Set((this.quote()?.lines ?? []).map((line) => line.productId));
    return this.catalog().filter((item) => !onQuote.has(item.productId));
  });

  /** Zit er iets zonder voorraad in wat de klant erbij wil? */
  readonly hasOutOfStockAddition = computed(() => {
    const catalog = this.catalog();
    return [...this.additions().keys()].some(
      (productId) => catalog.find((item) => item.productId === productId)?.inStock === false);
  });

  /** Wat de klant erbij gezet heeft, als lijst voor het overzicht. */
  readonly additionList = computed(() =>
    [...this.additions()].map(([productId, value]) => ({ productId, ...value })));

  addFromCatalog(choice: { item: PortalCatalogItem; quantity: number }): void {
    this.catalogSheet.set(false);
    this.additions.update((current) => {
      const next = new Map(current);
      next.set(choice.item.productId,
        { description: choice.item.description, quantity: choice.quantity });
      return next;
    });
  }

  removeAddition(productId: number): void {
    this.additions.update((current) => {
      const next = new Map(current);
      next.delete(productId);
      return next;
    });
  }

  /**
   * Aantal van de klant, afgerond op een volle doos.
   *
   * Dezelfde afspraak als op onze eigen schermen: de melding verschijnt meteen,
   * het veld springt pas na twee seconden. Wie 240 intikt is na de eerste toets
   * bij "2", en een veld dat dan al bijstelt is onbruikbaar.
   *
   * De server rondt nog een keer af bij het opslaan. Dit scherm is de
   * beleefdheid; die controle is de garantie.
   */
  setProposal(productId: number, quantity: number): void {
    const wanted = Math.max(0, quantity || 0);
    this.proposalLines.update((lines) =>
      lines.map((line) => (line.productId === productId ? { ...line, quantity: wanted } : line)));

    const line = this.proposalLines().find((l) => l.productId === productId);
    const per = Math.max(1, line?.piecesPerCarton ?? 1);
    const snapped = Math.ceil(wanted / per) * per;

    clearTimeout(this.roundTimers.get(productId));
    this.pendingRound.update((map) => {
      const next = { ...map };
      if (snapped !== wanted && wanted > 0) next[productId] = snapped;
      else delete next[productId];
      return next;
    });
    if (snapped === wanted || wanted <= 0) return;

    this.roundTimers.set(productId, setTimeout(() => {
      /* Alleen bijstellen als er intussen niets anders is ingetikt. */
      const current = this.proposalLines().find((l) => l.productId === productId);
      if (!current || current.quantity !== wanted) return;
      this.proposalLines.update((lines) =>
        lines.map((l) => (l.productId === productId ? { ...l, quantity: snapped } : l)));
      this.pendingRound.update((map) => {
        const next = { ...map };
        delete next[productId];
        return next;
      });
    }, 2000));
  }

  async accept(): Promise<void> {
    if (!this.signName().trim()) {
      this.ui.toast('Vul uw naam in om te tekenen', 'err');
      return;
    }
    await this.run(() => this.sales.portalAccept(this.token(), this.signName(), this.signNote()),
                   'Bedankt, de offerte is aanvaard');
    this.signSheet.set(false);
  }

  async propose(): Promise<void> {
    /* Bestaande regels én wat de klant erbij wil, in één voorstel. */
    const lines = [
      ...this.proposalLines().map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        note: null as string | null,
      })),
      ...[...this.additions()].map(([productId, addition]) => ({
        productId,
        quantity: addition.quantity,
        note: 'toegevoegd door de klant' as string | null,
      })),
    ];

    await this.run(
      () => this.sales.portalPropose(this.token(), this.proposeBy(), this.proposeMessage(), lines),
      'Uw voorstel is doorgestuurd');

    this.proposalSheet.set(false);
    this.catalog.set(await this.sales.portalCatalog(this.token()));
  }

  async reject(): Promise<void> {
    await this.run(() => this.sales.portalReject(this.token(), this.rejectMessage()),
                   'Bedankt voor uw antwoord');
    this.rejectSheet.set(false);
  }

  private async run(action: () => Promise<PortalQuote>, success: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.quote.set(await action());
      this.ui.toast(success);
    } catch (failure: unknown) {
      const message = (failure as { error?: { message?: string } }).error?.message;
      this.ui.toast(message ?? 'Er ging iets mis', 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
