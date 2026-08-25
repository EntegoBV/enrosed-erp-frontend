import {
  ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { PortalCatalogItem, PortalQuote } from '../../core/api/models';
import { Sheet, Ui } from '../../shared/ui';
import { PortalProductPicker } from './portal-product-picker';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe, PctPipe, WeekNlPipe } from '../../shared/pipes';
import { LANGUAGES, LanguageCode } from '../../core/api/models';

const PORTAL_LOCALES: Record<LanguageCode, string> = {
  NL: 'nl-BE', FR: 'fr-BE', EN: 'en-GB', DE: 'de-DE',
  ES: 'es-ES', PL: 'pl-PL', PT: 'pt-PT', TR: 'tr-TR',
};

type PortalFallback = 'chooseLanguage' | 'nameRequired' | 'genericError'
  | 'emptyTitle' | 'emptyText' | 'change' | 'addedByCustomer'
  | 'notFound' | 'notFoundText' | 'loading';

const PORTAL_FALLBACKS: Record<LanguageCode, Record<PortalFallback, string>> = {
  NL: {
    chooseLanguage: 'Taal kiezen', nameRequired: 'Vul uw naam in om te tekenen.',
    genericError: 'Er ging iets mis. Probeer het opnieuw.', emptyTitle: 'Niets gevonden',
    emptyText: 'Probeer een deel van de naam of de kleur.', change: 'Wijzig',
    addedByCustomer: 'Toegevoegd door de klant', notFound: 'Offerte niet gevonden',
    notFoundText: 'Deze link is niet meer geldig. Neem contact op, dan sturen we een nieuwe.',
    loading: 'Laden…',
  },
  FR: {
    chooseLanguage: 'Choisir la langue', nameRequired: 'Saisissez votre nom pour signer.',
    genericError: 'Une erreur s’est produite. Veuillez réessayer.', emptyTitle: 'Aucun article trouvé',
    emptyText: 'Essayez une partie du nom ou de la couleur.', change: 'Modifier',
    addedByCustomer: 'Ajouté par le client', notFound: 'Offre introuvable',
    notFoundText: 'Ce lien n’est plus valable. Contactez-nous et nous vous en enverrons un nouveau.',
    loading: 'Chargement…',
  },
  EN: {
    chooseLanguage: 'Choose language', nameRequired: 'Enter your name to sign.',
    genericError: 'Something went wrong. Please try again.', emptyTitle: 'No items found',
    emptyText: 'Try part of the name or colour.', change: 'Change',
    addedByCustomer: 'Added by the customer', notFound: 'Quotation not found',
    notFoundText: 'This link is no longer valid. Contact us and we will send a new one.',
    loading: 'Loading…',
  },
  DE: {
    chooseLanguage: 'Sprache wählen', nameRequired: 'Geben Sie zum Unterzeichnen Ihren Namen ein.',
    genericError: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.', emptyTitle: 'Keine Artikel gefunden',
    emptyText: 'Suchen Sie nach einem Teil des Namens oder der Farbe.', change: 'Ändern',
    addedByCustomer: 'Vom Kunden hinzugefügt', notFound: 'Angebot nicht gefunden',
    notFoundText: 'Dieser Link ist nicht mehr gültig. Kontaktieren Sie uns für einen neuen.',
    loading: 'Wird geladen…',
  },
  ES: {
    chooseLanguage: 'Elegir idioma', nameRequired: 'Indique su nombre para firmar.',
    genericError: 'Se ha producido un error. Inténtelo de nuevo.', emptyTitle: 'No se encontraron artículos',
    emptyText: 'Pruebe con parte del nombre o del color.', change: 'Cambiar',
    addedByCustomer: 'Añadido por el cliente', notFound: 'Presupuesto no encontrado',
    notFoundText: 'Este enlace ya no es válido. Contáctenos y le enviaremos uno nuevo.',
    loading: 'Cargando…',
  },
  PL: {
    chooseLanguage: 'Wybierz język', nameRequired: 'Proszę podać imię i nazwisko, aby podpisać.',
    genericError: 'Wystąpił błąd. Proszę spróbować ponownie.', emptyTitle: 'Nie znaleziono artykułów',
    emptyText: 'Proszę wpisać część nazwy lub koloru.', change: 'Zmień',
    addedByCustomer: 'Dodane przez klienta', notFound: 'Nie znaleziono oferty',
    notFoundText: 'Ten link nie jest już aktywny. Prosimy o kontakt, prześlemy nowy.',
    loading: 'Wczytywanie…',
  },
  PT: {
    chooseLanguage: 'Escolher idioma', nameRequired: 'Indique o seu nome para assinar.',
    genericError: 'Ocorreu um erro. Tente novamente.', emptyTitle: 'Nenhum artigo encontrado',
    emptyText: 'Experimente parte do nome ou da cor.', change: 'Alterar',
    addedByCustomer: 'Adicionado pelo cliente', notFound: 'Orçamento não encontrado',
    notFoundText: 'Esta ligação já não é válida. Contacte-nos e enviaremos uma nova.',
    loading: 'A carregar…',
  },
  TR: {
    chooseLanguage: 'Dil seçin', nameRequired: 'İmzalamak için adınızı girin.',
    genericError: 'Bir hata oluştu. Lütfen tekrar deneyin.', emptyTitle: 'Ürün bulunamadı',
    emptyText: 'Adın veya rengin bir bölümünü deneyin.', change: 'Değiştir',
    addedByCustomer: 'Müşteri tarafından eklendi', notFound: 'Teklif bulunamadı',
    notFoundText: 'Bu bağlantı artık geçerli değil. Yeni bağlantı için bizimle iletişime geçin.',
    loading: 'Yükleniyor…',
  },
};

/**
 * The quote as the customer sees it.
 *
 * No login: the link in the mail carries the token. No cost price, no
 * margin - the server sends its own view here, not our screen with fields
 * hidden.
 *
 * The customer can sign, reject, or propose quantities. The last one does
 * not change the quote: it is a proposal that lands with the seller.
 */
@Component({
  selector: 'app-portal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, PortalProductPicker, EurPipe, NumPipe, PctPipe, CbmPipe,
            DateNlPipe, WeekNlPipe],
  template: `
    <div class="portal">
      <header class="portal__bar">
        <img class="portal__logo" src="logo-ui.png" alt="Enrosed" />

        <!-- The customer can pick another language. Their pick only applies
             to this screen; the next quote leaves in the language on their
             file. Whoever sits in France but prefers English should not have
             to call us for that. -->
        <div class="portal__lang">
          <span class="portal__globe" aria-hidden="true">◍</span>
          <select class="portal__select" [ngModel]="language()"
                  (ngModelChange)="setLanguage($event)" [attr.aria-label]="local('chooseLanguage')">
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
                    {{ t('portalValidUntil') }} {{ data.validUntil | dateNl: locale() }}
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
                    @if (line.photoUrl) {
                      <img class="portal-line__photo" [src]="line.photoUrl" alt="" loading="lazy" />
                    } @else {
                      <div class="portal-line__photo portal-line__photo--empty" aria-hidden="true">◈</div>
                    }
                    <div class="list-item__body">
                      <div class="list-item__title">{{ line.description }}</div>
                      <div class="list-item__meta">
                        {{ line.quantity | num: 0: locale() }} {{ t('portalPieces') }} ·
                        {{ line.cartons | num: 0: locale() }} {{ t('portalBoxes') }}
                        @if (data.loadMode === 'LOOSE_CARTONS') {
                          · {{ (line.cbm ?? 0) | cbm: 3: locale() }}
                        } @else {
                          · {{ line.pallets }} {{ t('portalPalletsShort') }}
                        }
                      </div>
                      <div class="list-item__meta">
                        {{ line.unitPrice | eur: 3: locale() }} {{ t('portalPerPiece') }}
                        @if (line.discountPct) {
                          · {{ t('portalDiscount') }} {{ line.discountPct | pct: 1: locale() }}
                        }
                      </div>
                      <div class="list-item__meta list-item__meta--wrap">
                        @if (line.inStock) {
                          <span class="ok-text"><span class="stock-dot stock-dot--ok"></span>
                            {{ t('portalDeliverableFrom') }}
                            {{ line.deliveryDate | dateNl: locale() }}</span>
                        } @else if (line.deliveryWeek) {
                          <span class="ok-text"><span class="stock-dot stock-dot--ok"></span>
                            {{ t('portalDeliveryInWeek') }}
                            {{ line.deliveryWeek | weekNl: 'long': locale() }}</span>
                        } @else {
                          <!-- Orange, not red: it is an open item, not an error,
                               and red frightens on the screen where someone
                               is asked to sign. -->
                          <span class="warn-text"><span class="stock-dot stock-dot--low"></span>
                            {{ t('portalTermToBeDetermined') }}</span>
                        }
                      </div>
                    </div>
                    <div class="list-item__end">
                      <div class="strong num">{{ line.net | eur: 2: locale() }}</div>
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__body">
              <div class="stat-row"><span>{{ t('subtotal') }}</span>
                <span class="num">{{ data.totals.subtotal | eur: 2: locale() }}</span></div>
              @if (data.totals.orderDiscountAmount) {
                <div class="stat-row stat-row--discount">
                  <span>{{ t('orderDiscount') }} {{ data.totals.orderDiscountPercent | pct: 0: locale() }}</span>
                  <span class="num">− {{ data.totals.orderDiscountAmount | eur: 2: locale() }}</span></div>
              }
              @if (data.totals.extraDiscountAmount) {
                <div class="stat-row stat-row--discount">
                  <span>{{ data.totals.extraDiscountLabel || t('extraDiscount') }}
                    ({{ data.totals.extraDiscountPercent | pct: 1: locale() }})</span>
                  <span class="num">− {{ data.totals.extraDiscountAmount | eur: 2: locale() }}</span></div>
              }
              <div class="stat-row stat-row--sub"><span>{{ t('goodsValue') }}</span>
                <span class="num">{{ data.totals.goodsTotal | eur: 2: locale() }}</span></div>
              <div class="stat-row">
                <span>
                  {{ t('freight') }}
                  @if (!freightPending()) { ({{ freightBasis(data) }}) }
                </span>
                <span class="num">
                  @if (freightPending()) {
                    <span class="warn-text">{{ t('freightToBeDetermined') }}</span>
                  } @else {
                    {{ data.totals.freight | eur: 2: locale() }}
                  }
                </span></div>
              <div class="stat-row"><span>{{ t('handling') }}</span>
                <span class="num">{{ data.totals.handling | eur: 2: locale() }}</span></div>
              <div class="stat-row stat-row--total"><span>{{ t('total') }}</span>
                <span class="num">{{ data.totals.total | eur: 2: locale() }}</span></div>
              @if (data.totals.vatLegalMention) {
                <div class="stat-row stat-row--muted">
                  <span>{{ t('vat') }} — {{ data.totals.vatTreatment }}</span>
                  <span class="num">{{ 0 | eur: 2: locale() }}</span></div>
              } @else {
                <div class="stat-row stat-row--muted">
                  <span>{{ t('vat') }} {{ data.totals.vatRatePct | pct: 1: locale() }}</span>
                  <span class="num">{{ data.totals.vatAmount | eur: 2: locale() }}</span></div>
                <div class="stat-row stat-row--muted"><span>{{ t('totalInclVat') }}</span>
                  <span class="num">{{ data.totals.totalInclVat | eur: 2: locale() }}</span></div>
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
                  <!-- While their proposal is with us, signing is pointless:
                       they would sign the quote as it WAS. Withdrawing is the
                       way back, and that is itself a step in the history. -->
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
            <a [href]="termsUrl()" target="_blank" rel="noopener">{{ t('portalTerms') }}</a>
          </p>
        </div>
      } @else {
        <div class="content"><div class="empty">
          <div class="empty__title">{{ t('portalLoading') }}</div>
        </div></div>
      }
    </div>

    <!-- ======================================================= signing -->
    @if (signSheet()) {
      <app-sheet [title]="t('portalSignTitle')" [closeLabel]="t('portalCancel')"
                 (closed)="signSheet.set(false)">
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

    <!-- ====================================================== changes -->
    @if (proposalSheet()) {
      <app-sheet [title]="t('portalPropose')" [closeLabel]="t('portalCancel')"
                 (closed)="proposalSheet.set(false)">
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
                  {{ t('portalRoundingNotice') }} <b>{{ to | num: 0: locale() }}</b>
                  ({{ line.piecesPerCarton }} {{ t('portalPerBox') }})
                </span>
              } @else {
                <span class="hint">
                  {{ line.piecesPerCarton }} {{ t('portalPerBox') }}
                </span>
              }
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
                    {{ entry.quantity | num: 0: locale() }} {{ t('portalPieces') }}
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
        [locale]="locale()"
        [changeLabel]="local('change')"
        [emptyTitle]="local('emptyTitle')"
        [emptyText]="local('emptyText')"
        (picked)="addFromCatalog($event)"
        (cancelled)="catalogSheet.set(false)"
      />
    }

    @if (rejectSheet()) {
      <app-sheet [title]="t('portalRejectQuote')" [closeLabel]="t('portalCancel')"
                 (closed)="rejectSheet.set(false)">
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
    /* The language picker sits right and stays small: an exit for whoever
       needs it, not a core function of this screen. */
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
    /* The logo is very wide (roughly 6:1). Fixed height with width:auto
       keeps the ratio; without max-width it pushes the bar apart on narrow
       screens. */
    .portal__logo {
      height: 26px;
      width: auto;
      max-width: min(220px, 70vw);
      object-fit: contain;
      /* Black ink on transparent, so invert on the dark bar. */
      filter: invert(1);
    }
    .portal-line__photo {
      width: 56px;
      height: 56px;
      flex: none;
      border-radius: var(--r-sm);
      border: 1px solid var(--line);
      background: var(--surface-2);
      object-fit: cover;
    }
    .portal-line__photo--empty {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted-2);
      font-size: 18px;
    }
    .portal .content { padding-bottom: 60px; }
  `,
})
export class PortalPage implements OnDestroy {
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly token = input.required<string>();

  readonly quote = signal<PortalQuote | null>(null);
  readonly error = signal(false);
  readonly busy = signal(false);
  /** Language and browser locale are related, but deliberately not identical. */
  readonly language = signal<LanguageCode>('NL');
  readonly locale = computed(() => PORTAL_LOCALES[this.language()] ?? PORTAL_LOCALES.NL);
  private readonly originalDocumentLanguage = document.documentElement.lang;

  readonly signSheet = signal(false);
  readonly signName = signal('');
  readonly signNote = signal('');

  readonly proposalSheet = signal(false);
  readonly proposalLines = signal<{
    productId: number; description: string; quantity: number; piecesPerCarton: number;
  }[]>([]);
  /** Quantities about to snap to a full carton; visible now, not yet applied. */
  readonly pendingRound = signal<Record<number, number>>({});
  private roundTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Products not on the quote yet that the customer can add. */
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
    effect(() => {
      document.documentElement.lang = this.language().toLowerCase();
    });
  }

  ngOnDestroy(): void {
    for (const timer of this.roundTimers.values()) clearTimeout(timer);
    this.roundTimers.clear();
    document.documentElement.lang = this.originalDocumentLanguage;
  }

  private async load(token: string): Promise<void> {
    try {
      /* When this customer picked a language here before, they start in it again. */
      const chosen = this.storedLanguage(token);
      if (chosen) this.language.set(chosen);
      const quote = await this.sales.portalQuote(token, chosen ?? undefined);
      this.quote.set(quote);
      this.language.set(chosen ?? (quote.language as LanguageCode) ?? 'NL');
      this.proposeBy.set(quote.contactName ?? '');
      this.catalog.set(await this.sales.portalCatalog(token, this.language()));
    } catch {
      this.error.set(true);
    }
  }

  readonly pdfUrl = computed(() => this.sales.portalPdfUrl(this.token()));

  /**
   * Did we fill in the delivery term the customer was missing? That comes
   * from the backend: it knows what state the quote left in. Deriving it
   * from the lines went wrong the moment we omitted a term ourselves.
   */
  readonly deliveryTermsJustAdded = computed(() => {
    const quote = this.quote();
    return !!quote && quote.deliveryTerms === 'AANGEVULD' && quote.canRespond;
  });

  /** Is the customer still waiting on a term from us? */
  readonly deliveryTermsPending = computed(() => {
    const quote = this.quote();
    return !!quote && quote.deliveryTerms === 'TE_BEPALEN' && quote.canRespond;
  });

  /**
   * A text in the customer's language.
   *
   * The texts travel with the quote from the server, not from a bundle
   * here: that way the quote, the PDF, the mail and this screen are
   * guaranteed to use the same words, and a new language only needs adding
   * in one place.
   *
   * When something is missing - say the server still runs an older version -
   * the key itself appears. Ugly but visible, and therefore better than an
   * empty box in a document going to a customer.
   */
  t(key: string): string {
    const translated = this.quote()?.text?.[key];
    if (translated) return translated;
    const localKeys: Partial<Record<string, PortalFallback>> = {
      portalNotFound: 'notFound', portalNotFoundText: 'notFoundText', portalLoading: 'loading',
    };
    const fallback = localKeys[key];
    return fallback ? this.local(fallback) : key;
  }

  local(key: PortalFallback): string {
    return (PORTAL_FALLBACKS[this.language()] ?? PORTAL_FALLBACKS.NL)[key];
  }

  /** Is a proposal from this customer with us? */
  readonly proposalPending = computed(() =>
    this.quote()?.proposals.some((p) => p.status === 'IN_AFWACHTING') ?? false);

  /**
   * The customer withdraws their proposal.
   *
   * The proposal stays in the history; the quote simply lies with them
   * again. Deleting would mean nobody can later see what was asked.
   */
  async withdraw(): Promise<void> {
    await this.run(() => this.sales.portalWithdraw(this.token()), this.t('portalWithdrawn'));
  }

  readonly languages = LANGUAGES;

  private storedLanguage(token: string): LanguageCode | null {
    try {
      const stored = localStorage.getItem('enrosed.portalLanguage.' + token);
      return LANGUAGES.some((language) => language.code === stored)
        ? stored as LanguageCode : null;
    } catch {
      return null;
    }
  }

  /**
   * The customer picks another language.
   *
   * The pick is kept on this device so they need not choose again next
   * visit. Nothing changes on the customer file: that is an agreement
   * between us and them, not a browser setting.
   */
  async setLanguage(code: LanguageCode): Promise<void> {
    try {
      const token = this.token();
      const [quote, catalog] = await Promise.all([
        this.sales.portalQuote(token, code),
        this.sales.portalCatalog(token, code),
      ]);
      this.quote.set(quote);
      this.catalog.set(catalog);
      this.language.set(code);
      try {
        localStorage.setItem('enrosed.portalLanguage.' + token, code);
      } catch {
        /* private mode: then the pick only lasts this visit */
      }
    } catch {
      /* Quote, catalog and language stay in sync with the last successful pick. */
    }
  }

  /** Dutch customers read the Dutch terms; everyone else gets English. */
  termsUrl(): string {
    return this.language() === 'NL' ? '/voorwaarden' : '/voorwaarden?lang=en';
  }

  /** The same translate function, to hand down to a child component. */
  readonly translate = (key: string): string => this.t(key);

  statusLabel(quote: PortalQuote): string {
    switch (quote.status) {
      case 'GEACCEPTEERD': return this.t('portalStatusAccepted');
      case 'AFGEWEZEN': return this.t('portalStatusRejected');
      case 'WIJZIGING_GEVRAAGD': return this.t('portalStatusRevision');
      default: return this.t('portalStatusOpen');
    }
  }

  /** Is the customer still waiting on a freight amount from us? */
  readonly freightPending = computed(() => this.quote()?.freight === 'TE_BEPALEN');

  freightBasis(quote: PortalQuote): string {
    if (quote.freight === 'TE_BEPALEN') return '';
    switch (quote.freightPricingStrategy) {
      case 'PER_CBM':
        return `${new CbmPipe().transform(quote.totals.cbm ?? 0, 3, this.locale())} · ${this.t('freightPerCbm')}`;
      case 'FIXED':
        return this.t('freightFixedAmount');
      case 'PICKUP':
        return this.t('pickup');
      case 'CARRIER':
        /* The staffel is our internal kitchen; the customer just reads
           how many pallets travel. */
        return `${quote.totals.pallets} ${this.t('portalPalletsShort')}`;
      default:
        if (quote.loadMode === 'LOOSE_CARTONS') {
          return `${new CbmPipe().transform(quote.totals.cbm ?? 0, 3, this.locale())} · ${this.t('freightPerCbm')}`;
        }
        return `${quote.totals.pallets} ${this.t('portalPalletsShort')} · ${this.t('freightPerPallet')}`;
    }
  }

  /** Did we fill in the freight the customer was missing? */
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

  /** What is not on the quote yet. */
  readonly extraItems = computed(() => {
    const onQuote = new Set((this.quote()?.lines ?? []).map((line) => line.productId));
    return this.catalog().filter((item) => !onQuote.has(item.productId));
  });

  /** Anything without stock in what the customer wants added? */
  readonly hasOutOfStockAddition = computed(() => {
    const catalog = this.catalog();
    return [...this.additions().keys()].some(
      (productId) => {
        const item = catalog.find((candidate) => candidate.productId === productId);
        return item?.inventoryKnown === true && item.inStock === false;
      });
  });

  /** What the customer added, as a list for the summary. */
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
   * The customer's quantity, rounded to a full carton.
   *
   * The same contract as on our own screens: the notice appears at once,
   * the field only snaps after two seconds. Whoever types 240 is at "2"
   * after the first key, and a field that already corrects then is
   * unusable.
   *
   * The server rounds once more on save. This screen is the courtesy;
   * that check is the guarantee.
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
      /* Only adjust when nothing else was typed in the meantime. */
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
      this.ui.toast(this.local('nameRequired'), 'err');
      return;
    }
    await this.run(() => this.sales.portalAccept(this.token(), this.signName(), this.signNote()),
                   this.t('portalStatusAccepted'));
    this.signSheet.set(false);
  }

  async propose(): Promise<void> {
    /* Existing lines AND what the customer wants added, in one proposal. */
    const lines = [
      ...this.proposalLines().map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        note: null as string | null,
      })),
      ...[...this.additions()].map(([productId, addition]) => ({
        productId,
        quantity: addition.quantity,
        note: this.local('addedByCustomer') as string | null,
      })),
    ];

    await this.run(
      () => this.sales.portalPropose(this.token(), this.proposeBy(), this.proposeMessage(), lines),
      this.t('portalProposalSent'));

    this.proposalSheet.set(false);
    this.catalog.set(await this.sales.portalCatalog(this.token(), this.language()));
  }

  async reject(): Promise<void> {
    await this.run(() => this.sales.portalReject(this.token(), this.rejectMessage()),
                   this.t('portalStatusRejected'));
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
      this.ui.toast(message ?? this.local('genericError'), 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
