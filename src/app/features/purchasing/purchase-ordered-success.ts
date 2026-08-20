import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Sheet } from '../../shared/ui';

/** Accessible confirmation shown only after the backend placed the order. */
@Component({
  selector: 'app-purchase-ordered-success',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet title="Bestelling vastgelegd" closeLabel="Venster sluiten"
               (closed)="closed.emit()">
      <div body class="production-success" role="status" aria-live="polite">
        <div class="production-scene" aria-hidden="true">
          <svg viewBox="0 0 360 168" focusable="false">
            <defs>
              <linearGradient id="factory-wall" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="var(--rose-soft)" />
                <stop offset="1" stop-color="var(--surface)" />
              </linearGradient>
            </defs>
            <path class="factory-smoke" d="M76 39c-11-8-3-18 8-15-2-12 18-14 20-1 13-3 18 13 7 19"
                  fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
            <path d="M39 129V59h36v24l35-20v20l38-20v66z" fill="url(#factory-wall)"
                  stroke="currentColor" stroke-width="3" stroke-linejoin="round" />
            <path d="M55 59V34h18v25" fill="var(--surface)" stroke="currentColor" stroke-width="3" />
            <g class="factory-windows" fill="var(--rose)">
              <rect x="56" y="91" width="13" height="13" rx="2" />
              <rect x="82" y="91" width="13" height="13" rx="2" />
              <rect x="111" y="91" width="13" height="13" rx="2" />
            </g>
            <path class="conveyor" d="M139 123h180" stroke="currentColor" stroke-width="5"
                  stroke-linecap="round" stroke-dasharray="9 8" />
            <circle cx="170" cy="132" r="8" fill="var(--surface)" stroke="currentColor" stroke-width="3" />
            <circle cx="286" cy="132" r="8" fill="var(--surface)" stroke="currentColor" stroke-width="3" />
            @for (flower of [0, 1, 2]; track flower) {
              <g class="production-flower" [style.--flower-index]="flower"
                 [style.--flower-rest]="(176 + flower * 49) + 'px'">
                <path d="M0 0v24" stroke="var(--ok)" stroke-width="3" stroke-linecap="round" />
                <path d="M0 13c-8-8-12 2-3 5M0 16c8-8 12 2 3 5"
                      fill="none" stroke="var(--ok)" stroke-width="2" />
                <g fill="var(--rose)">
                  <circle cx="0" cy="-7" r="7"/><circle cx="7" cy="0" r="7"/>
                  <circle cx="0" cy="7" r="7"/><circle cx="-7" cy="0" r="7"/>
                </g>
                <circle r="4" fill="var(--surface)" />
              </g>
            }
            <path d="M324 43v86" stroke="currentColor" stroke-width="3" />
            <path d="m308 56 16-15 16 15" fill="var(--rose-soft)" stroke="currentColor"
                  stroke-width="3" stroke-linejoin="round" />
            <path d="M309 129h31" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </div>
        <span class="production-success__eyebrow">Status · Besteld</span>
        <h3>{{ orderNumber() }} is klaar voor productie</h3>
        <p>
          De afgesproken aantallen zijn vastgelegd. Je kunt nu verderwerken
          of teruggaan naar het controlescherm van deze inkooporder.
        </p>
      </div>
      <div foot class="production-success__actions">
        <button class="btn" type="button" data-initial-focus
                (click)="closed.emit()">Verder werken</button>
        <button class="btn btn--primary" type="button"
                (click)="overview.emit()">Naar orderoverzicht</button>
      </div>
    </app-sheet>
  `,
  styles: [`
    :host{display:contents}.production-success{text-align:center}.production-scene{overflow:hidden;margin:-4px -2px 16px;border:1px solid var(--rose-line);border-radius:18px;background:linear-gradient(180deg,var(--rose-soft),var(--surface-2))}.production-scene svg{display:block;width:100%;max-height:190px;color:var(--rose-dark)}
    .production-success__eyebrow{color:var(--ok);font-size:10px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.production-success h3{margin-top:4px;font-size:19px}.production-success p{max-width:430px;margin:7px auto 0;color:var(--muted);font-size:12px;line-height:1.55}.production-success__actions{display:grid;width:100%;gap:8px}
    .factory-smoke{animation:factory-smoke 2.8s ease-in-out infinite}.factory-windows{animation:factory-light 1.6s ease-in-out infinite}.conveyor{animation:conveyor-run .8s linear infinite}.production-flower{transform:translate(158px,94px);animation:flower-production 3.6s cubic-bezier(.35,.05,.65,.95) infinite;animation-delay:calc(var(--flower-index) * -1.2s)}
    @keyframes factory-smoke{0%,100%{opacity:.32;transform:translateY(4px)}50%{opacity:.72;transform:translateY(-4px)}}
    @keyframes factory-light{0%,100%{opacity:.4}50%{opacity:1}}@keyframes conveyor-run{to{stroke-dashoffset:-17}}
    @keyframes flower-production{0%{opacity:0;transform:translate(153px,94px) scale(.72)}12%{opacity:1}82%{opacity:1}100%{opacity:0;transform:translate(302px,94px) scale(1)}}
    @media(prefers-reduced-motion:reduce){.factory-smoke,.factory-windows,.conveyor,.production-flower{animation:none}.factory-smoke{opacity:.55}.production-flower{opacity:1;transform:translate(var(--flower-rest),94px)}}
    @media(min-width:560px){.production-success__actions{grid-template-columns:1fr 1fr}}
  `],
})
export class PurchaseOrderedSuccess {
  readonly orderNumber = input.required<string>();
  readonly closed = output<void>();
  readonly overview = output<void>();
}
