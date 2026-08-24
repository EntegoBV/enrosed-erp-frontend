import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Sheet } from '../../shared/ui';

/**
 * The little celebration when a container moves a step: the ship that
 * sails at Vertrokken, the boxes that land at Ontvangen. Same family as
 * the factory scene shown when the order is placed.
 */
@Component({
  selector: 'app-purchase-status-success',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet [title]="kind() === 'SHIPPED' ? 'Container vertrokken' : 'Container ontvangen'"
               closeLabel="Venster sluiten" (closed)="closed.emit()">
      <div body class="production-success" role="status" aria-live="polite">
        <div class="production-scene" aria-hidden="true">
          @if (kind() === 'SHIPPED') {
            <svg viewBox="0 0 360 168" focusable="false">
              <circle cx="311" cy="38" r="15" fill="var(--warn-soft)" stroke="var(--warn)" stroke-width="3" />
              <path class="ship-cloud" d="M52 40c-10-7-2-16 7-13-1-11 16-12 18-1 11-2 15 11 6 16"
                    fill="var(--surface)" stroke="currentColor" stroke-width="3" stroke-linejoin="round" />
              <g class="ship">
                <path d="M96 118h168l-18 26H117z" fill="var(--rose-soft)" stroke="currentColor"
                      stroke-width="3" stroke-linejoin="round" />
                <rect x="122" y="96" width="34" height="22" fill="var(--rose)" stroke="currentColor" stroke-width="3" rx="2" />
                <rect x="160" y="96" width="34" height="22" fill="var(--surface)" stroke="currentColor" stroke-width="3" rx="2" />
                <rect x="198" y="96" width="34" height="22" fill="var(--rose)" stroke="currentColor" stroke-width="3" rx="2" />
                <rect x="141" y="74" width="34" height="22" fill="var(--surface)" stroke="currentColor" stroke-width="3" rx="2" />
                <rect x="179" y="74" width="34" height="22" fill="var(--rose)" stroke="currentColor" stroke-width="3" rx="2" />
                <rect x="236" y="76" width="18" height="42" fill="var(--surface)" stroke="currentColor" stroke-width="3" rx="2" />
                <path class="ship-smoke" d="M245 66c-7-5-2-12 5-10-1-8 12-9 13-1"
                      fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
              </g>
              <path class="wave wave--front" d="M20 150c14-9 28-9 42 0s28 9 42 0 28-9 42 0 28 9 42 0 28-9 42 0 28 9 42 0 28-9 42 0"
                    fill="none" stroke="var(--rose-mid)" stroke-width="4" stroke-linecap="round" />
              <path class="wave wave--back" d="M6 160c14-7 28-7 42 0s28 7 42 0 28-7 42 0 28 7 42 0 28-7 42 0 28 7 42 0 28-7 42 0 28 7 42 0"
                    fill="none" stroke="var(--rose-line)" stroke-width="4" stroke-linecap="round" />
            </svg>
          } @else {
            <svg viewBox="0 0 360 168" focusable="false">
              <path d="M52 140V72l52-26 52 26v68z" fill="var(--rose-soft)" stroke="currentColor"
                    stroke-width="3" stroke-linejoin="round" />
              <path d="M70 140V96h68v44" fill="var(--surface)" stroke="currentColor" stroke-width="3" />
              <path d="M70 107h68M70 118h68M70 129h68" stroke="var(--rose-line)" stroke-width="3" />
              <g class="box box--one">
                <rect x="196" y="112" width="30" height="28" fill="var(--rose)" stroke="currentColor" stroke-width="3" rx="2" />
                <path d="M196 124h30" stroke="currentColor" stroke-width="2" />
              </g>
              <g class="box box--two">
                <rect x="232" y="112" width="30" height="28" fill="var(--surface)" stroke="currentColor" stroke-width="3" rx="2" />
                <path d="M232 124h30" stroke="currentColor" stroke-width="2" />
              </g>
              <g class="box box--three">
                <rect x="214" y="80" width="30" height="28" fill="var(--surface)" stroke="currentColor" stroke-width="3" rx="2" />
                <path d="M214 92h30" stroke="currentColor" stroke-width="2" />
              </g>
              <g class="arrival-check">
                <circle cx="298" cy="64" r="20" fill="var(--ok-soft)" stroke="var(--ok)" stroke-width="3" />
                <path d="m289 64 7 7 13-14" fill="none" stroke="var(--ok)" stroke-width="4"
                      stroke-linecap="round" stroke-linejoin="round" />
              </g>
              <path d="M20 140h320" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            </svg>
          }
        </div>
        <span class="production-success__eyebrow"
              [class.production-success__eyebrow--shipped]="kind() === 'SHIPPED'">
          Status · {{ kind() === 'SHIPPED' ? 'Vertrokken' : 'Ontvangen' }}
        </span>
        <h3>{{ orderNumber() }} {{ kind() === 'SHIPPED' ? 'is onderweg' : 'is binnen' }}</h3>
        <p>
          @if (kind() === 'SHIPPED') {
            Het schip vaart. Vul het track &amp; trace-nummer in en noteer de
            betaling die bij vertrek hoort - de melding op de order helpt je eraan herinneren.
          } @else {
            De aantallen staan in het dagboek van de container.
            {{ showAction() ? 'Boek de voorraad bij zodra alles op de juiste plek ligt.' : 'De voorraad is meteen bijgeboekt.' }}
          }
        </p>
      </div>
      <div foot class="production-success__actions">
        <button class="btn" type="button" data-initial-focus (click)="closed.emit()">Verder werken</button>
        @if (showAction()) {
          <button class="btn btn--primary" type="button" (click)="action.emit()">
            {{ kind() === 'SHIPPED' ? 'Track & trace invullen' : 'Voorraad bijboeken' }}
          </button>
        }
      </div>
    </app-sheet>
  `,
  styles: [`
    :host{display:contents}.production-success{text-align:center}.production-scene{overflow:hidden;margin:-4px -2px 16px;border:1px solid var(--rose-line);border-radius:18px;background:linear-gradient(180deg,var(--rose-soft),var(--surface-2))}.production-scene svg{display:block;width:100%;max-height:190px;color:var(--rose-dark)}
    .production-success__eyebrow{color:var(--ok);font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.production-success__eyebrow--shipped{color:var(--rose-dark)}.production-success h3{margin-top:4px;font-size:19px}.production-success p{max-width:430px;margin:7px auto 0;color:var(--muted);font-size:12px;line-height:1.55}.production-success__actions{display:grid;width:100%;gap:8px}
    .ship{animation:ship-bob 3.2s ease-in-out infinite;transform-origin:180px 130px}.ship-smoke{animation:ship-smoke 2.4s ease-in-out infinite}.ship-cloud{animation:cloud-drift 6s ease-in-out infinite}
    .wave{animation:wave-run 2.6s linear infinite}.wave--back{animation-duration:3.8s;animation-direction:reverse}
    .box{opacity:0;animation:box-drop .7s cubic-bezier(.2,.9,.3,1.2) forwards}.box--one{animation-delay:.15s}.box--two{animation-delay:.4s}.box--three{animation-delay:.65s}
    .arrival-check{opacity:0;transform-origin:298px 64px;animation:check-pop .5s cubic-bezier(.2,.9,.3,1.4) 1s forwards}
    @keyframes ship-bob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-5px) rotate(-1deg)}}
    @keyframes ship-smoke{0%,100%{opacity:.3;transform:translateY(2px)}50%{opacity:.8;transform:translateY(-3px)}}
    @keyframes cloud-drift{0%,100%{transform:translateX(0)}50%{transform:translateX(10px)}}
    @keyframes wave-run{0%{transform:translateX(0)}100%{transform:translateX(-28px)}}
    @keyframes box-drop{0%{opacity:0;transform:translateY(-46px)}70%{opacity:1;transform:translateY(4px)}100%{opacity:1;transform:translateY(0)}}
    @keyframes check-pop{0%{opacity:0;transform:scale(.4)}100%{opacity:1;transform:scale(1)}}
    @media(prefers-reduced-motion:reduce){.ship,.ship-smoke,.ship-cloud,.wave,.box,.arrival-check{animation:none;opacity:1}}
    @media(min-width:560px){.production-success__actions{grid-template-columns:1fr 1fr}}
  `],
})
export class PurchaseStatusSuccess {
  readonly kind = input.required<'SHIPPED' | 'RECEIVED'>();
  readonly orderNumber = input.required<string>();
  /** Show the primary follow-up button (tracking, or booking when still open). */
  readonly showAction = input(true);
  readonly closed = output<void>();
  readonly action = output<void>();
}
