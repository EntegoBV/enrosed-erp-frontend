import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { SalesOrderView } from '../../core/api/models';

/**
 * 'Creditnota maken' sheet.
 *
 * LEAD STUB: the credit-note engineer replaces the body. Selector, inputs and
 * outputs are frozen because purchase-desk.ts and purchase-view.ts (owned by
 * the nacalculatie engineer) already mount it in partner mode.
 * Invoice mode: [invoiceId]; partner mode: [purchaseOrderId]. Exactly one is set.
 * After creation the sheet itself navigates to /sales/{id} and emits created.
 */
@Component({
  selector: 'app-sales-credit-note-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class SalesCreditNoteSheet {
  readonly invoiceId = input<number | null>(null);
  readonly purchaseOrderId = input<number | null>(null);
  readonly closed = output<void>();
  readonly created = output<SalesOrderView>();
}
