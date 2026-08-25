import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { countryName } from '../../core/api/geo';
import { messageOf } from '../../core/api/errors';
import { Carrier, CarrierLane, CarrierTier, CarrierZone, Country } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { Ui } from '../../shared/ui';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';

/**
 * Shipping organisations and their staffels.
 *
 * The list shows each carrier as a card with its lanes; the sheet edits one
 * carrier as a whole document: surcharges, and per country the zones (postcode
 * groups) and the tier ladder with a price per zone. A simple carrier is one
 * lane with a single zone without postcodes and a few rungs.
 */
@Component({
  selector: 'app-carrier-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, Skeleton, DateNlPipe, EurPipe, NumPipe],
  template: `
    <div class="carrier-page">
      <div class="carrier-page__head">
        <p class="muted">Staffels per organisatie: zone per postcode, trap per pallet.
          De offerte rekent er automatisch mee.</p>
        <button class="btn btn--primary btn--sm" type="button" (click)="startNew()">+ Nieuw</button>
      </div>

      @if (loading()) {
        <app-skeleton kind="stats" [rows]="2" />
      } @else {
        @for (carrier of carriers(); track carrier.id) {
          <section class="card carrier-card">
            <div class="carrier-card__head">
              <div class="carrier-card__id">
                <h2>{{ carrier.name }}</h2>
                @if (carrier.fullName) { <small>{{ carrier.fullName }}</small> }
              </div>
              <span class="badge" [class]="carrier.active ? 'badge--ok' : 'badge--warn'">
                {{ carrier.active ? 'Actief' : 'Inactief' }}
              </span>
            </div>
            <div class="carrier-facts">
              <span><small>Dieseltoeslag</small><b>{{ carrier.dieselSurchargePct ?? 0 | num }} %</b></span>
              <span><small>Geldig tot</small>
                <b>{{ carrier.validUntil ? (carrier.validUntil | dateNl) : '—' }}</b></span>
              <span><small>Landen</small><b>{{ carrier.lanes.length }}</b></span>
            </div>
            @if (carrier.lanes.length) {
              <div class="lane-chips">
                @for (lane of carrier.lanes; track lane.countryCode) {
                  <button class="lane-chip" type="button" (click)="openLane(carrier, lane)">
                    <b>{{ lane.countryCode }}</b>
                    <small>{{ lane.zones.length }} zones · {{ lane.tiers.length }} trappen</small>
                  </button>
                }
              </div>
            }

            @if (carrier.notes) { <p class="carrier-notes">{{ carrier.notes }}</p> }

            <!-- The phone rings, someone asks "what would shipping cost?" -
                 the carrier's own staffel answers, without opening a quote. -->
            <details class="quick-fold">
              <summary>
                <b>Snel een vrachtprijs</b>
                <small>land + postcode + pallets → meteen het tarief</small>
                <i class="quick-fold__chev" aria-hidden="true"></i>
              </summary>
              <div class="quick-quote__form">
                <label><span>Land</span>
                  <select class="select" [ngModel]="quickCountry() || carrier.lanes[0]?.countryCode"
                          (ngModelChange)="quickCountry.set($event)">
                    @for (lane of sortedLanes(carrier); track lane.countryCode) {
                      <option [value]="lane.countryCode">{{ countryLabel(lane.countryCode) }}</option>
                    }
                  </select></label>
                <label><span>Postcode</span>
                  <input class="input" [ngModel]="quickPostcode()" placeholder="bv. 1082"
                         (ngModelChange)="quickPostcode.set($event)" /></label>
                <label><span>Pallets</span>
                  <input class="input num" type="number" min="1" [ngModel]="quickPallets()"
                         (ngModelChange)="quickPallets.set(+$event || 1)" /></label>
                <label><span>Soort</span>
                  <select class="select" [ngModel]="quickType()" (ngModelChange)="quickType.set($event)">
                    <option value="EURO">Europallet</option>
                    <option value="BLOCK">Blokpallet</option>
                  </select></label>
                <label><span>Gewicht kg</span>
                  <input class="input num" type="number" min="0" [ngModel]="quickWeight()"
                         placeholder="optioneel" (ngModelChange)="quickWeight.set($event === '' ? null : +$event)" /></label>
                <button class="btn btn--primary" type="button" [disabled]="quickBusy()"
                        (click)="runQuickFor(carrier)">{{ quickBusy() ? 'Bezig…' : 'Bereken' }}</button>
              </div>
              @if (quickCarrierId() === carrier.id) {
                @if (quickResult(); as quote) {
                  <dl class="peek-result">
                    <div><dt>Zone</dt><dd>{{ quote.zoneName }}
                      @if (!quote.postcodeMatched) { <small>· dichtstbijzijnde gekozen</small> }</dd></div>
                    <div><dt>Trap</dt><dd>{{ quote.tierLabel }}</dd></div>
                    <div><dt>Basis</dt><dd>{{ quote.baseEur | eur: 2 }}</dd></div>
                    @if (quote.dieselEur) {
                      <div><dt>Dieseltoeslag {{ quote.dieselPct | num }}%</dt><dd>+ {{ quote.dieselEur | eur: 2 }}</dd></div>
                    }
                    @if (quote.surchargePctEur) {
                      <div><dt>Toeslag {{ quote.surchargePct | num }}%</dt><dd>+ {{ quote.surchargePctEur | eur: 2 }}</dd></div>
                    }
                    @if (quote.surchargeFixedEur) {
                      <div><dt>Vaste toeslag</dt><dd>+ {{ quote.surchargeFixedEur | eur: 2 }}</dd></div>
                    }
                    <div class="peek-result__total"><dt>Vracht per zending</dt><dd>{{ quote.totalEur | eur: 2 }}</dd></div>
                  </dl>
                } @else if (quickTried()) {
                  <p class="peek-nofit">Deze zending past niet in de staffel — te veel pallets of te zwaar
                    voor de hoogste trap. Vraag een prijs op bij de organisatie.</p>
                }
              }
            </details>
            <div class="carrier-card__actions">
              <button class="btn btn--sm" type="button" (click)="startEdit(carrier)">Bewerken</button>
              <button class="btn btn--sm btn--danger" type="button" (click)="remove(carrier)">
                Verwijderen
              </button>
            </div>
          </section>
        } @empty {
          <div class="card"><div class="empty">
            <div class="empty__icon">▦</div>
            <div class="empty__title">Nog geen verzendorganisaties</div>
            <p class="muted">Voeg er een toe met zijn staffel; de offerte rekent er dan mee.</p>
            <button class="btn btn--primary" type="button" (click)="startNew()">+ Nieuw</button>
          </div></div>
        }
      }
    </div>

    <!-- ============================ carrier editor: the whole document -->
    @if (editing(); as draft) {
      <app-sheet [title]="draft.id == null ? 'Nieuwe verzendorganisatie' : draft.name"
                 [wide]="true" (closed)="editing.set(null)">
        <div body>
          <div class="form-grid">
            <div class="field">
              <label class="req" for="ca-name">Naam</label>
              <input class="input" id="ca-name" [ngModel]="draft.name"
                     (ngModelChange)="patch({ name: $event })" />
            </div>
            <div class="field">
              <label for="ca-full">Volledige naam</label>
              <input class="input" id="ca-full" [ngModel]="draft.fullName"
                     (ngModelChange)="patch({ fullName: $event })" />
            </div>
            <div class="field">
              <label for="ca-diesel">Dieseltoeslag %</label>
              <input class="input num" id="ca-diesel" type="number" min="0" step="0.1"
                     [ngModel]="draft.dieselSurchargePct"
                     (ngModelChange)="patch({ dieselSurchargePct: toNum($event) })" />
              <span class="hint">Maandelijks variabel; komt bovenop elke staffelprijs.</span>
            </div>
            <div class="field">
              <label for="ca-valid">Geldig tot</label>
              <input class="input" id="ca-valid" type="date" [ngModel]="draft.validUntil"
                     (ngModelChange)="patch({ validUntil: $event || null })" />
            </div>
            <div class="field span-2">
              <label for="ca-notes">Afspraken &amp; voorwaarden</label>
              <textarea class="textarea" id="ca-notes" rows="2" [ngModel]="draft.notes"
                        (ngModelChange)="patch({ notes: $event })"></textarea>
            </div>
            <label class="check-option span-2">
              <input type="checkbox" [ngModel]="draft.active"
                     (ngModelChange)="patch({ active: $event })" />
              <span><strong>Actief</strong>
                <small>Alleen actieve organisaties verschijnen bij de vrachtkeuze.</small></span>
            </label>
          </div>

          <div class="lanes-head">
            <h3>Landen</h3>
            <div class="lanes-add">
              <select class="select" [ngModel]="newLaneCountry()"
                      (ngModelChange)="newLaneCountry.set($event)">
                <option value="">Kies land…</option>
                @for (country of countries(); track country.code) {
                  <option [value]="country.code">{{ country.name }}</option>
                }
              </select>
              <button class="btn btn--sm" type="button" (click)="addLane()">+ Land</button>
            </div>
          </div>

          @for (lane of draft.lanes; track $index; let laneIndex = $index) {
            <details class="lane-fold" [open]="draft.lanes.length === 1">
              <summary>
                <b>{{ lane.countryCode }}</b>
                <span>{{ lane.zones.length }} zones · {{ lane.tiers.length }} trappen</span>
                <button class="lane-remove" type="button" aria-label="Land verwijderen"
                        (click)="removeLane(laneIndex); $event.preventDefault()">×</button>
              </summary>

              <div class="form-grid">
                <div class="field">
                  <label>Toeslag %</label>
                  <input class="input num" type="number" step="0.1" [ngModel]="lane.surchargePct"
                         (ngModelChange)="patchLane(laneIndex, { surchargePct: toNum($event) })" />
                </div>
                <div class="field">
                  <label>Vaste toeslag €</label>
                  <input class="input num" type="number" step="0.01" [ngModel]="lane.surchargeFixedEur"
                         (ngModelChange)="patchLane(laneIndex, { surchargeFixedEur: toNum($event) })" />
                </div>
                <div class="field span-2">
                  <label>Toelichting toeslagen</label>
                  <input class="input" [ngModel]="lane.surchargeNote"
                         (ngModelChange)="patchLane(laneIndex, { surchargeNote: $event })" />
                </div>
              </div>

              <div class="zone-head">
                <h4>Zones</h4>
                <button class="btn btn--sm" type="button" (click)="addZone(laneIndex)">+ Zone</button>
              </div>
              <p class="tiny muted">Postcodes als prefixen of reeksen, met komma's:
                <code>10-15,18-44</code> of <code>AB,SW</code>. Eén zone zonder postcodes = heel het land.</p>
              @for (zone of lane.zones; track $index; let zoneIndex = $index) {
                <div class="zone-row">
                  <input class="input" placeholder="Naam" [ngModel]="zone.name"
                         (ngModelChange)="patchZone(laneIndex, zoneIndex, { name: $event })" />
                  <input class="input mono" placeholder="Postcodes" [ngModel]="zone.postcodes"
                         (ngModelChange)="patchZone(laneIndex, zoneIndex, { postcodes: $event })" />
                  <button class="zone-remove" type="button" aria-label="Zone verwijderen"
                          (click)="removeZone(laneIndex, zoneIndex)">×</button>
                </div>
              }

              <div class="zone-head">
                <h4>Staffel</h4>
                <button class="btn btn--sm" type="button" (click)="addTier(laneIndex)">+ Trap</button>
              </div>
              <div class="tier-scroll">
                <table class="tier-table">
                  <thead>
                    <tr>
                      <th>EP t/m</th><th>BP t/m</th><th>LDM</th><th>KG</th>
                      @for (zone of lane.zones; track $index) { <th>{{ zone.name }}</th> }
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (tier of lane.tiers; track $index; let tierIndex = $index) {
                      <tr>
                        <td><input class="input num" type="number" step="0.5" [ngModel]="tier.epMax"
                                   (ngModelChange)="patchTier(laneIndex, tierIndex, { epMax: toNum($event) })" /></td>
                        <td><input class="input num" type="number" step="0.5" [ngModel]="tier.bpMax"
                                   (ngModelChange)="patchTier(laneIndex, tierIndex, { bpMax: toNum($event) })" /></td>
                        <td><input class="input num" type="number" step="0.1" [ngModel]="tier.ldmMax"
                                   (ngModelChange)="patchTier(laneIndex, tierIndex, { ldmMax: toNum($event) })" /></td>
                        <td><input class="input num" type="number" step="1" [ngModel]="tier.kgMax"
                                   (ngModelChange)="patchTier(laneIndex, tierIndex, { kgMax: toNum($event) })" /></td>
                        @for (zone of lane.zones; track $index; let zoneIndex = $index) {
                          <td><input class="input num" type="number" step="0.01"
                                     [ngModel]="tier.prices[zoneIndex] ?? null"
                                     (ngModelChange)="patchPrice(laneIndex, tierIndex, zoneIndex, $event)" /></td>
                        }
                        <td><button class="zone-remove" type="button" aria-label="Trap verwijderen"
                                    (click)="removeTier(laneIndex, tierIndex)">×</button></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>
          }
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="editing.set(null)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="saving()"
                  (click)="save()">{{ saving() ? 'Opslaan…' : 'Opslaan' }}</button>
        </div>
      </app-sheet>
    }

    <!-- ============================ read-only lane peek from the card -->
    @if (laneView(); as peek) {
      <app-sheet [title]="peek.carrier.name + ' · ' + countryLabel(peek.lane.countryCode)"
                 [wide]="true" (closed)="closeLane()">
        <div body>
          <!-- One sentence tells the whole mechanic before any table. -->
          <p class="peek-explainer">
            De <b>postcode</b> van de klant bepaalt de <b>zone</b> (kolom); het aantal
            <b>pallets</b> en het <b>gewicht</b> bepalen de <b>trap</b> (rij). Waar rij en
            kolom kruisen staat de prijs per zending
            @if (peek.carrier.dieselSurchargePct) {
              — daar komt nog {{ peek.carrier.dieselSurchargePct | num }}% dieseltoeslag bovenop
            }.
            @if (peek.lane.surchargeNote) { <span class="muted">{{ peek.lane.surchargeNote }}</span> }
          </p>

          <!-- Trying one shipment explains more than any legend. -->
          <div class="peek-try">
            <div class="peek-try__head">
              <h4>Probeer een zending</h4>
              <p>Vul in en zie meteen welke zone en trap gelden.</p>
            </div>
            <div class="peek-try__form">
              <label><span>Postcode</span>
                <input class="input" [ngModel]="testPostcode()" placeholder="bv. 1082"
                       (ngModelChange)="testPostcode.set($event)" /></label>
              <label><span>Pallets</span>
                <input class="input num" type="number" min="1" [ngModel]="testPallets()"
                       (ngModelChange)="testPallets.set(+$event || 1)" /></label>
              <label><span>Soort</span>
                <select class="select" [ngModel]="testType()" (ngModelChange)="testType.set($event)">
                  <option value="EURO">Europallet</option>
                  <option value="BLOCK">Blokpallet</option>
                </select></label>
              <label><span>Gewicht kg</span>
                <input class="input num" type="number" min="0" [ngModel]="testWeight()"
                       placeholder="optioneel" (ngModelChange)="testWeight.set($event === '' ? null : +$event)" /></label>
              <button class="btn btn--primary" type="button" [disabled]="testBusy()"
                      (click)="runTest(peek)">{{ testBusy() ? 'Bezig…' : 'Bereken' }}</button>
            </div>
            @if (testResult(); as quote) {
              <dl class="peek-result">
                <div><dt>Zone</dt><dd>{{ quote.zoneName }}
                  @if (!quote.postcodeMatched) { <small>· dichtstbijzijnde gekozen</small> }</dd></div>
                <div><dt>Trap</dt><dd>{{ quote.tierLabel }}</dd></div>
                <div><dt>Basis</dt><dd>{{ quote.baseEur | eur: 2 }}</dd></div>
                @if (quote.dieselEur) {
                  <div><dt>Dieseltoeslag {{ quote.dieselPct | num }}%</dt><dd>+ {{ quote.dieselEur | eur: 2 }}</dd></div>
                }
                @if (quote.surchargePctEur) {
                  <div><dt>Toeslag {{ quote.surchargePct | num }}%</dt><dd>+ {{ quote.surchargePctEur | eur: 2 }}</dd></div>
                }
                @if (quote.surchargeFixedEur) {
                  <div><dt>Vaste toeslag</dt><dd>+ {{ quote.surchargeFixedEur | eur: 2 }}</dd></div>
                }
                <div class="peek-result__total"><dt>Vracht</dt><dd>{{ quote.totalEur | eur: 2 }}</dd></div>
              </dl>
            } @else if (testTried()) {
              <p class="peek-nofit">Deze zending past niet in de staffel — te veel pallets of
                te zwaar voor de hoogste trap.</p>
            }
          </div>

          <h4 class="peek-title">Zones
            <small>welke postcodes bij welke kolom horen</small></h4>
          @for (zone of peek.lane.zones; track $index) {
            <div class="peek-zone">
              <b>{{ zone.name }}</b>
              @if (zone.postcodes) {
                <span class="peek-zone__chips">
                  @for (token of zoneTokens(zone.postcodes); track $index) {
                    <i>{{ token }}</i>
                  }
                </span>
              } @else {
                <span class="muted">heel het land</span>
              }
            </div>
          }

          <h4 class="peek-title">Staffel
            <small>prijs per zending, per trap en zone</small></h4>
          <div class="tier-scroll">
            <table class="tier-table tier-table--view">
              <thead>
                <tr><th class="tier-table__sticky">Trap</th>
                  @for (zone of peek.lane.zones; track $index) { <th class="r">{{ zone.name }}</th> }
                </tr>
              </thead>
              <tbody>
                @for (tier of peek.lane.tiers; track $index) {
                  <tr>
                    <td class="tier-table__sticky">{{ tierLabel(tier) }}</td>
                    @for (price of tier.prices; track $index) {
                      <td class="num r">{{ price != null ? (price | eur: 0) : '—' }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        <div foot style="display:contents">
          <button class="btn btn--block" type="button" (click)="closeLane()">Sluiten</button>
        </div>
      </app-sheet>
    }
  `,
  styles: [`
    :host { display:block }
    .carrier-page>*+* { margin-top:12px }
    .carrier-page__head { display:flex;align-items:center;justify-content:space-between;gap:12px }
    .carrier-page__head p { font-size:11.5px;line-height:1.45 }
    .carrier-page__head .btn { flex:none }
    @media(max-width:679px) { .carrier-page__head .btn { display:none } }
    .carrier-card { padding:15px }
    .carrier-card__head { display:flex;align-items:flex-start;justify-content:space-between;gap:12px }
    .carrier-card__id h2 { font-size:16px }
    .carrier-card__id small { color:var(--muted);font-size:11px }
    .carrier-facts { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:11px }
    .carrier-facts span { display:grid;gap:1px;padding:8px 10px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2) }
    .carrier-facts small { color:var(--muted);font-size:8.5px;font-weight:760;letter-spacing:.06em;text-transform:uppercase }
    .carrier-facts b { font-size:12.5px }
    .lane-chips { display:flex;flex-wrap:wrap;gap:6px;margin-top:11px }
    .lane-chip { display:grid;gap:0;padding:6px 11px;border:1px solid var(--line);border-radius:11px;background:var(--surface);font:inherit;text-align:left;cursor:pointer }
    .lane-chip:hover { background:var(--surface-2) }
    .lane-chip b { font-size:12px }
    .lane-chip small { color:var(--muted);font-size:9.5px }
    .carrier-notes { margin:11px 0 0;color:var(--muted);font-size:11px;line-height:1.5 }
    .carrier-card__actions { display:flex;gap:7px;margin-top:12px }

    .lanes-head { display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 8px }
    .lanes-head h3 { font-size:14px }
    .lanes-add { display:flex;gap:6px }
    .lane-fold { margin-top:8px;border:1px solid var(--line);border-radius:13px;background:var(--surface) }
    .lane-fold summary { display:flex;align-items:center;gap:10px;padding:11px 13px;cursor:pointer;list-style:none }
    .lane-fold summary::-webkit-details-marker { display:none }
    .lane-fold summary b { font-size:13px }
    .lane-fold summary span { flex:1;color:var(--muted);font-size:11px }
    .lane-fold[open] summary { border-bottom:1px solid var(--line) }
    .lane-fold>*:not(summary) { margin:10px 13px }
    .lane-remove,.zone-remove { display:grid;place-items:center;width:26px;height:26px;flex:none;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--muted);font-size:14px;cursor:pointer }
    .lane-remove:hover,.zone-remove:hover { color:var(--danger);border-color:var(--danger) }
    .zone-head { display:flex;align-items:center;justify-content:space-between;margin:14px 13px 4px }
    .zone-head h4 { font-size:12.5px }
    .zone-row { display:grid;grid-template-columns:minmax(80px,1fr) minmax(0,2fr) 26px;gap:6px;align-items:center;margin:6px 13px }
    .tier-scroll { overflow-x:auto;margin:8px 13px 13px;border:1px solid var(--line);border-radius:11px }
    .tier-table { border-collapse:collapse;min-width:100% }
    .tier-table th { padding:7px 8px;border-bottom:1px solid var(--line);background:var(--surface-2);color:var(--muted);font-size:9px;font-weight:760;letter-spacing:.05em;text-transform:uppercase;text-align:left;white-space:nowrap }
    .tier-table td { padding:3px 4px;border-bottom:1px solid var(--line) }
    .tier-table tr:last-child td { border-bottom:0 }
    .tier-table .input { min-width:64px;padding:6px 7px;font-size:12px }
    .tier-table--view td { padding:6px 9px;font-size:11.5px;white-space:nowrap }
    .quick-fold { margin-top:11px;border:1px solid var(--rose-line);border-radius:13px;background:var(--rose-soft) }
    .quick-fold summary { display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:pointer;list-style:none }
    .quick-fold summary::-webkit-details-marker { display:none }
    .quick-fold summary b { font-size:12.5px }
    .quick-fold summary small { flex:1;color:var(--muted);font-size:10px }
    .quick-fold__chev { width:7px;height:7px;flex:none;border-right:1.6px solid var(--rose-dark);border-bottom:1.6px solid var(--rose-dark);transform:rotate(45deg);transition:transform .15s ease }
    .quick-fold[open] .quick-fold__chev { transform:rotate(-135deg) }
    .quick-fold>*:not(summary) { margin:0 13px 12px }
    .quick-quote__form { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px }
    @media(min-width:680px) { .quick-quote__form { grid-template-columns:repeat(5,minmax(0,1fr)) auto;align-items:end } }
    .quick-quote__form label { display:grid;gap:3px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em }
    .quick-quote__form .btn { align-self:end }
    @media(max-width:679px) { .quick-quote__form .btn { grid-column:1/-1 } }
    .quick-fold .peek-result { background:var(--surface) }
    .peek-explainer { margin:0 0 12px;color:var(--ink-2);font-size:12px;line-height:1.55 }
    .peek-explainer .muted { display:block;margin-top:3px;font-size:10.5px }
    .peek-try { margin-bottom:14px;padding:12px;border:1px solid var(--rose-line);border-radius:14px;background:var(--rose-soft) }
    .peek-try__head h4 { font-size:13px }
    .peek-try__head p { margin:1px 0 9px;color:var(--muted);font-size:10.5px }
    .peek-try__form { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px }
    @media(min-width:680px) { .peek-try__form { grid-template-columns:1.2fr .7fr 1fr .9fr auto;align-items:end } }
    .peek-try__form label { display:grid;gap:3px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em }
    .peek-try__form .btn { align-self:end }
    @media(max-width:679px) { .peek-try__form .btn { grid-column:1/-1 } }
    .peek-result { margin:11px 0 0;padding:9px 11px;display:grid;gap:4px;border-radius:11px;background:var(--surface) }
    .peek-result div { display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:11.5px }
    .peek-result dt { color:var(--muted) }
    .peek-result dd { margin:0;font-weight:650;font-variant-numeric:tabular-nums }
    .peek-result dd small { color:var(--muted);font-weight:550 }
    .peek-result__total { margin-top:2px;padding-top:6px;border-top:1px dashed var(--line);font-weight:760 }
    .peek-result__total dt { color:var(--ink) }
    .peek-nofit { margin:10px 0 0;color:var(--warn);font-size:11px }
    .peek-title { margin:14px 0 6px;font-size:12.5px }
    .peek-title small { margin-left:6px;color:var(--muted);font-size:10px;font-weight:550 }
    .peek-zone { display:flex;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid var(--line);font-size:11.5px }
    .peek-zone b { flex:none;min-width:64px }
    .peek-zone__chips { display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;margin-left:auto }
    .peek-zone__chips i { padding:1.5px 7px;border:1px solid var(--line);border-radius:999px;background:var(--surface-2);font-size:10px;font-style:normal;font-variant-numeric:tabular-nums }
    .tier-table__sticky { position:sticky;left:0;background:var(--surface);white-space:nowrap;font-weight:650;box-shadow:1px 0 0 var(--line) }
    thead .tier-table__sticky { background:var(--surface-2) }
    @media(max-width:679px) { .carrier-facts { grid-template-columns:repeat(3,minmax(0,1fr)) } }
  `],
})
export class CarrierManager {
  private readonly sales = inject(SalesApi);
  private readonly ui = inject(Ui);

  readonly loading = signal(true);
  readonly carriers = signal<Carrier[]>([]);
  readonly countries = signal<Country[]>([]);
  readonly editing = signal<Carrier | null>(null);
  readonly saving = signal(false);
  readonly newLaneCountry = signal('');
  readonly laneView = signal<{ carrier: Carrier; lane: CarrierLane } | null>(null);

  /* --- the standalone quick tariff, and the tester inside the lane peek --- */
  readonly activeCarriers = computed(() =>
    this.carriers().filter((carrier) => carrier.active && carrier.lanes.length));
  readonly quickCarrierId = signal<number | null>(null);
  readonly quickCountry = signal('');
  readonly quickPostcode = signal('');
  readonly quickPallets = signal(1);
  readonly quickType = signal<'EURO' | 'BLOCK'>('EURO');
  readonly quickWeight = signal<number | null>(null);
  readonly quickResult = signal<import('../../core/api/models').CarrierShipQuote | null>(null);
  readonly quickTried = signal(false);
  readonly quickBusy = signal(false);

  sortedLanes(carrier: Carrier): CarrierLane[] {
    return carrier.lanes.slice().sort((a, b) =>
      this.countryLabel(a.countryCode).localeCompare(this.countryLabel(b.countryCode), 'nl'));
  }

  async runQuickFor(carrier: Carrier): Promise<void> {
    if (this.quickBusy() || carrier.id == null) return;
    const country = this.quickCountry() || this.sortedLanes(carrier)[0]?.countryCode;
    if (!country) return;
    this.quickCarrierId.set(carrier.id);
    this.quickBusy.set(true);
    try {
      const quote = await this.sales.carrierQuote(carrier.id, {
        country,
        postcode: this.quickPostcode() || null,
        pallets: Math.max(1, this.quickPallets()),
        palletType: this.quickType(),
        weightKg: this.quickWeight(),
      });
      this.quickResult.set(quote);
      this.quickTried.set(true);
    } catch {
      this.quickResult.set(null);
      this.quickTried.set(true);
    } finally {
      this.quickBusy.set(false);
    }
  }

  /* --- the try-a-shipment tester inside the lane peek --- */
  readonly testPostcode = signal('');
  readonly testPallets = signal(1);
  readonly testType = signal<'EURO' | 'BLOCK'>('EURO');
  readonly testWeight = signal<number | null>(null);
  readonly testResult = signal<import('../../core/api/models').CarrierShipQuote | null>(null);
  readonly testTried = signal(false);
  readonly testBusy = signal(false);

  closeLane(): void {
    this.laneView.set(null);
    this.testResult.set(null);
    this.testTried.set(false);
    this.testPostcode.set('');
  }

  async runTest(peek: { carrier: Carrier; lane: CarrierLane }): Promise<void> {
    if (this.testBusy()) return;
    this.testBusy.set(true);
    try {
      const quote = await this.sales.carrierQuote(peek.carrier.id!, {
        country: peek.lane.countryCode,
        postcode: this.testPostcode() || null,
        pallets: Math.max(1, this.testPallets()),
        palletType: this.testType(),
        weightKg: this.testWeight(),
      });
      this.testResult.set(quote);
      this.testTried.set(true);
    } catch {
      this.testResult.set(null);
      this.testTried.set(true);
    } finally {
      this.testBusy.set(false);
    }
  }

  zoneTokens(postcodes: string): string[] {
    return postcodes.split(',').map((token) => token.trim()).filter(Boolean);
  }

  /** "t/m 2 EP · 1.400 kg" - the row in words instead of four bare cells. */
  tierLabel(tier: CarrierTier): string {
    const kg = tier.kgMax == null ? null
      : new Intl.NumberFormat('nl-BE').format(tier.kgMax) + ' kg';
    const pallets: string[] = [];
    if (tier.epMax != null) pallets.push(`${tier.epMax} EP`);
    if (tier.bpMax != null) pallets.push(`${tier.bpMax} BP`);
    if (pallets.length) {
      return `t/m ${pallets.join(' / ')}${kg ? ' · ' + kg : ''}`;
    }
    if (kg) return `t/m ${kg}`;
    if (tier.ldmMax != null) return `t/m ${tier.ldmMax} laadmeter`;
    return '—';
  }

  countryLabel(code: string): string {
    return this.countries().find((country) => country.code === code)?.name
      ?? countryName(code) ?? code;
  }

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    try {
      const [carriers, countries] = await Promise.all([
        this.sales.carriers(), this.sales.countries(),
      ]);
      this.carriers.set(carriers);
      this.countries.set(countries);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verzendorganisaties laden mislukt'), 'err');
    } finally {
      this.loading.set(false);
    }
  }

  toNum(value: unknown): number | null {
    if (value === '' || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  startNew(): void {
    this.editing.set({
      id: null, name: '', fullName: null, active: true,
      dieselSurchargePct: null, validUntil: null, notes: null, lanes: [],
    });
  }

  startEdit(carrier: Carrier): void {
    /* A deep copy: cancel must leave the list untouched. */
    this.editing.set(structuredClone(carrier));
  }

  openLane(carrier: Carrier, lane: CarrierLane): void {
    this.laneView.set({ carrier, lane });
  }

  patch(changes: Partial<Carrier>): void {
    const draft = this.editing();
    if (draft) this.editing.set({ ...draft, ...changes });
  }

  private patchLanes(mutate: (lanes: CarrierLane[]) => void): void {
    const draft = this.editing();
    if (!draft) return;
    const lanes = structuredClone(draft.lanes);
    mutate(lanes);
    this.editing.set({ ...draft, lanes });
  }

  addLane(): void {
    const code = this.newLaneCountry();
    if (!code) { this.ui.toast('Kies eerst een land', 'err'); return; }
    if (this.editing()?.lanes.some((lane) => lane.countryCode === code)) {
      this.ui.toast('Dat land staat er al bij', 'err');
      return;
    }
    this.patchLanes((lanes) => lanes.push({
      countryCode: code, surchargePct: null, surchargeFixedEur: null, surchargeNote: null,
      zones: [{ name: 'Heel het land', postcodes: '' }],
      tiers: [{ epMax: 1, bpMax: null, ldmMax: null, kgMax: null, prices: [null] }],
    }));
    this.newLaneCountry.set('');
  }

  removeLane(index: number): void {
    this.patchLanes((lanes) => lanes.splice(index, 1));
  }

  patchLane(index: number, changes: Partial<CarrierLane>): void {
    this.patchLanes((lanes) => Object.assign(lanes[index], changes));
  }

  addZone(laneIndex: number): void {
    this.patchLanes((lanes) => {
      const lane = lanes[laneIndex];
      lane.zones.push({ name: `Zone ${lane.zones.length + 1}`, postcodes: '' });
      for (const tier of lane.tiers) tier.prices.push(null);
    });
  }

  removeZone(laneIndex: number, zoneIndex: number): void {
    this.patchLanes((lanes) => {
      const lane = lanes[laneIndex];
      lane.zones.splice(zoneIndex, 1);
      for (const tier of lane.tiers) tier.prices.splice(zoneIndex, 1);
    });
  }

  patchZone(laneIndex: number, zoneIndex: number, changes: Partial<CarrierZone>): void {
    this.patchLanes((lanes) => Object.assign(lanes[laneIndex].zones[zoneIndex], changes));
  }

  addTier(laneIndex: number): void {
    this.patchLanes((lanes) => {
      const lane = lanes[laneIndex];
      const last = lane.tiers[lane.tiers.length - 1];
      lane.tiers.push({
        epMax: last?.epMax != null ? last.epMax + 1 : 1,
        bpMax: null, ldmMax: null, kgMax: null,
        prices: lane.zones.map(() => null),
      });
    });
  }

  removeTier(laneIndex: number, tierIndex: number): void {
    this.patchLanes((lanes) => lanes[laneIndex].tiers.splice(tierIndex, 1));
  }

  patchTier(laneIndex: number, tierIndex: number, changes: Partial<CarrierTier>): void {
    this.patchLanes((lanes) => Object.assign(lanes[laneIndex].tiers[tierIndex], changes));
  }

  patchPrice(laneIndex: number, tierIndex: number, zoneIndex: number, value: unknown): void {
    this.patchLanes((lanes) => {
      lanes[laneIndex].tiers[tierIndex].prices[zoneIndex] = this.toNum(value);
    });
  }

  async save(): Promise<void> {
    const draft = this.editing();
    if (!draft) return;
    if (!draft.name.trim()) { this.ui.toast('Geef de organisatie een naam', 'err'); return; }
    this.saving.set(true);
    try {
      const saved = await this.sales.saveCarrier(draft);
      this.carriers.update((list) => {
        const others = list.filter((carrier) => carrier.id !== saved.id);
        return [...others, saved].sort((a, b) => a.name.localeCompare(b.name, 'nl'));
      });
      this.editing.set(null);
      this.ui.toast(`${saved.name} opgeslagen`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  remove(carrier: Carrier): void {
    this.ui.confirm({
      title: `${carrier.name} verwijderen`,
      message: 'De staffel verdwijnt; offertes die ernaar verwijzen vallen terug op het landentarief.',
      confirmLabel: 'Verwijderen', danger: true,
    }, () => {
      void (async () => {
        try {
          await this.sales.deleteCarrier(carrier.id!);
          this.carriers.update((list) => list.filter((item) => item.id !== carrier.id));
          this.ui.toast(`${carrier.name} verwijderd`);
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      })();
    });
  }
}
