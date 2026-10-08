import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CountLine, CountView, OpenDocument } from '../../core/api/inventory-models';
import { NumPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { differenceText, openDocumentHint, openDocumentText } from './inventory-count';

/**
 * Why a difference cannot be booked yet: the invoices that are not afgepunt
 * (or the containers that are not bijgeboekt) which hold this product, the
 * way out, and the counter's statement that the difference has another
 * cause. One block for the line, the reason sheet and the booking sheet.
 * The tick only asks: the page saves it and the line that comes back sets it.
 */
@Component({
  selector: 'app-stock-count-documents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: 'inv-docs' },
  template: `
    @for (document of line().openDocuments; track document.kind + ':' + document.id) {
      <p class="inv-docs__text">{{ text(document) }}
        <a class="inv-docs__link" [routerLink]="link(document)">{{ document.kind === 'FACTUUR' ? 'Factuur openen' : 'Container openen' }} ›</a></p>
    }
    @if (editable()) {
      <p class="inv-docs__hint">{{ hint() }}</p>
      <label class="inv-docs__check">
        <input type="checkbox" [checked]="line().documentsConfirmed" [disabled]="disabled()" (change)="toggle($event)" />
        <span>{{ checkLabel() }}</span>
      </label>
    } @else if (line().documentsConfirmed) {
      <p class="inv-docs__hint">Bevestigd: {{ checkLabel().toLowerCase() }}.</p>
    }
  `,
})
export class StockCountDocuments {
  readonly line = input.required<CountLine>();
  /** False once the session is booked or cancelled: the statement is only read then. */
  readonly editable = input(true);
  readonly disabled = input(false);
  readonly confirmed = output<boolean>();

  /** The way out, by what is open; a booked count has none left, so it is only shown while the session is open. */
  readonly hint = computed(() => openDocumentHint(this.line().openDocuments));
  readonly checkLabel = computed(() => {
    const documents = this.line().openDocuments;
    const what = documents.length !== 1 ? 'deze documenten' : documents[0].kind === 'FACTUUR' ? 'deze factuur' : 'deze container';
    return `Dit verschil komt niet door ${what}`;
  });

  text(document: OpenDocument): string {
    return openDocumentText(document);
  }

  link(document: OpenDocument): string {
    return document.kind === 'FACTUUR' ? `/sales/${document.id}` : `/purchasing/${document.id}`;
  }

  /** The box follows the saved line, not the tap: a refused save leaves it as it was. */
  toggle(event: Event): void {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    box.checked = this.line().documentsConfirmed;
    this.confirmed.emit(wanted);
  }
}

export interface CountReasonChoice {
  reasonCode: string;
  reasonNote: string | null;
}

/**
 * The reason of a difference: for one line right after its count was saved
 * ("Later" keeps the count and leaves the line on "Reden kiezen"), or for
 * all lines without a reason at once (`line` null, `bulkCount` lines). It
 * only chooses; the page writes, with the count of each line unchanged.
 */
@Component({
  selector: 'app-stock-count-reason-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, NumPipe, StockCountDocuments],
  template: `
    <app-sheet variant="ios" [title]="title()" (closed)="closed.emit()">
      <div body class="inv-reason">
        @if (line(); as row) {
          <p class="inv-reason__lead"><strong>{{ row.productName }}</strong> · geteld {{ row.countedQuantity | num }}, volgens systeem {{ row.expectedQuantity | num }}</p>
          @if (row.openDocuments.length) {
            <app-stock-count-documents class="inv-reason__docs" [line]="row" [disabled]="busy()" (confirmed)="documents.emit($event)" />
          }
        } @else {
          <p class="inv-reason__lead">Elke regel bewaart deze reden bij zijn eigen verschil. De getelde aantallen wijzigen niet.</p>
        }
        <div class="inv-reason__choices" role="group" aria-label="Reden">
          @for (reason of reasons(); track reason.code) {
            <button class="inv-reason__choice" type="button" [attr.aria-pressed]="code() === reason.code" (click)="code.set(reason.code)">{{ reason.label }}</button>
          }
        </div>
        <div class="field inv-reason__note">
          <label for="inv-reason-note">Toelichting@if (noteRequired()) { <span class="inv-reason__must"> · verplicht bij deze reden</span> }</label>
          <textarea class="textarea" id="inv-reason-note" rows="2" maxlength="500" [value]="note()" (input)="note.set($any($event.target).value)"></textarea>
        </div>
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="closed.emit()">{{ line() ? 'Later' : 'Annuleren' }}</button>
        <button class="btn btn--primary" type="button" [disabled]="!canSave()" (click)="submit()">{{ busy() ? 'Bezig…' : 'Bewaren' }}</button>
      </div>
    </app-sheet>
  `,
})
export class StockCountReasonSheet implements OnInit {
  readonly line = input<CountLine | null>(null);
  readonly bulkCount = input(0);
  readonly reasons = input.required<CountView['reasons']>();
  readonly busy = input(false);
  readonly save = output<CountReasonChoice>();
  readonly documents = output<boolean>();
  readonly closed = output<void>();

  readonly code = signal<string | null>(null);
  readonly note = signal('');

  readonly title = computed(() => {
    const row = this.line();
    return row ? `${differenceText(row.difference ?? 0)} · ${row.productName}` : `Zelfde reden voor alle ${this.bulkCount()}`;
  });
  readonly noteRequired = computed(() => this.reasons().find((reason) => reason.code === this.code())?.noteRequired ?? false);
  readonly canSave = computed(() => !this.busy() && !!this.code() && (!this.noteRequired() || !!this.note().trim()));

  /* Once, on opening: a reload of the session behind the sheet must not wipe what is being chosen. */
  ngOnInit(): void {
    this.code.set(this.line()?.reasonCode ?? null);
    this.note.set(this.line()?.reasonNote ?? '');
  }

  submit(): void {
    const reasonCode = this.code();
    if (!reasonCode || !this.canSave()) return;
    this.save.emit({ reasonCode, reasonNote: this.note().trim() || null });
  }
}
