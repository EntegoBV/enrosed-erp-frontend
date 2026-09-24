import { ChangeDetectionStrategy, Component, afterEveryRender, effect, inject, input, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { WorkspaceReturn } from '../../core/platform/workspace-return';
import { PurchaseDesk } from './purchase-desk';
import { PurchaseEditor } from './purchase-editor';
import { PurchaseView } from './purchase-view';

/**
 * One route, the right screen for the room: a desk on a wide viewport,
 * the guided view and editor on a phone. The desk reads and edits in one
 * place, so both the view and the edit URL land on it there.
 *
 * Deep links: ?section=payments is partner financing (money in),
 * ?section=ledger the payments to suppliers and forwarders (money out),
 * ?section=payment-result the Nacalculatie, and ?section=pay&payee=…&due=…
 * opens the payment sheet once the payments have loaded.
 */
@Component({
  selector: 'app-purchase-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PurchaseDesk, PurchaseEditor, PurchaseView],
  template: `
    @if (desktop.active()) {
      <app-purchase-desk [id]="id()" [mode]="mode()" />
    } @else if (mode() === 'edit') {
      <app-purchase-editor [id]="id()" />
    } @else {
      <app-purchase-view [id]="id()" />
    }
  `,
})
export class PurchaseScreen {
  readonly desktop = inject(DesktopViewport);
  private readonly router = inject(Router);
  private readonly workspaceReturn = inject(WorkspaceReturn);
  readonly id = input<string>('');
  readonly mode = input<'view' | 'edit'>('view');
  /** Bound from the route query so a pending term opens its financing schedule. */
  readonly section = input<string>();
  /** Quick pay: who gets paid and, for the supplier, which term. */
  readonly payee = input<string>();
  readonly due = input<string>();

  private readonly desk = viewChild(PurchaseDesk);
  private readonly editor = viewChild(PurchaseEditor);
  private readonly viewer = viewChild(PurchaseView);
  private openedPaymentsFor: object | null = null;
  private openedPaymentsId = '';
  private openedPaymentsSection = '';
  private pendingPaymentsFocus: { screen: object; id: string; section: string; fallback: HTMLElement | null } | null = null;
  private readonly paymentPayees = ['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER'] as const;
  private readonly paymentDues = ['ORDERED', 'SHIPPED', 'ARRIVED'] as const;
  private openedPaymentKey = '';
  /** The editor opened for a quick payment goes back to the read view once its sheet closes. */
  private returnAfterPayment: { editor: PurchaseEditor; id: string } | null = null;

  /** Kosten & bank or Documenten & media opened from here say 'Terug naar INK-…'. */
  private readonly describeReturn = effect(() => {
    const order = (this.desk() ?? this.editor() ?? this.viewer())?.view()?.order;
    if (order) untracked(() => this.workspaceReturn.describe('/purchasing/' + order.id, order.number));
  });

  constructor() {
    effect(() => this.openRequestedSection());
    effect(() => this.openRequestedPayment());
    effect(() => this.returnFromPayment());
    afterEveryRender(() => this.focusRequestedSection());
  }

  private openRequestedSection(): void {
    const section = this.section();
    const id = this.id();
    const desk = this.desk();
    const editor = this.editor();
    const viewer = this.viewer();
    const screen = desk ?? editor ?? viewer;
    if (section !== 'payments' && section !== 'payment-result' && section !== 'ledger') {
      this.openedPaymentsFor = null;
      this.pendingPaymentsFocus = null;
      return;
    }
    if (!screen || screen.view()?.order.id !== Number(id)
      || (this.openedPaymentsFor === screen && this.openedPaymentsId === id && this.openedPaymentsSection === section)) return;
    this.openedPaymentsFor = screen;
    this.openedPaymentsId = id;
    this.openedPaymentsSection = section;
    this.pendingPaymentsFocus = { screen, id, section, fallback: null };
    untracked(() => {
      if (desk) {
        if (section === 'payment-result') {
          desk.mainView.set('products');
          desk.railTab.set('costs');
          desk.costsPane.set('actual');
        } else if (section === 'payments' && desk.hasPartnerTab()) {
          // Every financing link means the partner's money coming in.
          desk.mainView.set('products');
          desk.railTab.set('partner');
        } else {
          desk.mainView.set('payments');
        }
      } else if (editor) {
        if (section === 'payment-result') editor.jumpToSection('purchase-costs-section', 'costs', false);
        else editor.jumpToSection('purchase-payments-section', undefined, false);
      } else {
        viewer?.workspaceSection.set(section === 'payment-result' ? 'purchase-costs-section' : 'purchase-payments-section');
      }
    });
  }

  /** The term controls arrive after the financing API; focus only once they exist. */
  private focusRequestedSection(): void {
    const pending = this.pendingPaymentsFocus;
    if (!pending) return;
    if (this.id() !== pending.id || this.section() !== pending.section
      || (this.desk() ?? this.editor() ?? this.viewer()) !== pending.screen
      || (pending.fallback && document.activeElement !== pending.fallback)) {
      this.pendingPaymentsFocus = null;
      return;
    }
    if (pending.section === 'payment-result' || pending.section === 'ledger') {
      const target = document.getElementById(pending.section === 'ledger' ? 'purchase-payments-section' : 'purchase-payment-result');
      if (!target) return;
      this.pendingPaymentsFocus = null;
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
      target.focus({ preventScroll: true });
      return;
    }
    const terms = document.getElementById('purchase-advance-invoices');
    const target = terms ?? document.getElementById('purchase-partner-payments')
      ?? document.getElementById('purchase-payments-section');
    if (!target) return;
    if (terms) this.pendingPaymentsFocus = null;
    else if (pending.fallback) return;
    else pending.fallback = target;
    target.scrollIntoView({ behavior: 'instant', block: 'start' });
    target.focus({ preventScroll: true });
  }

  /** ?section=pay: the payment sheet, once the payments are in; the read view only knows the ledger. */
  private openRequestedPayment(): void {
    const section = this.section();
    const id = this.id();
    if (section !== 'pay') {
      this.openedPaymentKey = '';
      return;
    }
    const desk = this.desk();
    const editor = this.editor();
    const screen = desk ?? editor;
    const payee = this.paymentPayees.find(item => item === this.payee());
    if (!screen || !payee) {
      if ((!screen && !this.viewer()) || this.openedPaymentKey === 'ledger|' + id) return;
      this.openedPaymentKey = 'ledger|' + id;
      const path = screen && this.mode() === 'edit' ? ['/purchasing', id, 'edit'] : ['/purchasing', id];
      untracked(() => void this.router.navigate(path, { queryParams: { section: 'ledger' }, replaceUrl: true }));
      return;
    }
    const due = payee === 'SUPPLIER' ? this.paymentDues.find(item => item === this.due()) ?? null : null;
    const key = `${id}|${payee}|${due ?? ''}`;
    if (screen.view()?.order.id !== Number(id) || screen.payments() === null || screen.paymentStateLoading()
      || screen.paymentStateError() || this.openedPaymentKey === key) return;
    this.openedPaymentKey = key;
    untracked(() => {
      if (desk) desk.mainView.set('payments');
      else editor?.jumpToSection('purchase-payments-section', undefined, false);
      const term = due ? screen.plannedInstalments().find(step => step.due === due) : undefined;
      screen.openPayment(term?.amount, term?.label, payee, due);
      if (desk) {
        void this.router.navigate(this.mode() === 'edit' ? ['/purchasing', id, 'edit'] : ['/purchasing', id], { replaceUrl: true });
      } else if (editor) {
        // Only a sheet that opened returns; a blocked one leaves the user in the editor, and a
        // later sheet opened there must not navigate away.
        this.returnAfterPayment = editor.paying() !== null ? { editor, id } : null;
      }
    });
  }

  /** Bewaren or Annuleren in the quick-pay sheet lands back on the view's Betalingen. */
  private returnFromPayment(): void {
    const editor = this.editor();
    const id = this.id();
    // Read the sheet state first, so this runs again whenever it changes.
    const paying = editor ? editor.paying() !== null : false;
    const busy = editor ? editor.payingBusy() : false;
    const pending = this.returnAfterPayment;
    if (!pending) return;
    if (pending.editor !== editor || pending.id !== id) {
      this.returnAfterPayment = null;
      return;
    }
    if (paying || busy) return;
    this.returnAfterPayment = null;
    untracked(() => void this.router.navigate(['/purchasing', id], { queryParams: { section: 'ledger' }, replaceUrl: true }));
  }

  /** The open editor owns the unsaved-changes verdict; a plain view has none. */
  canDeactivate(): boolean | Promise<boolean> {
    const open = this.desk() ?? this.editor();
    return open ? open.canDeactivate() : true;
  }
}
