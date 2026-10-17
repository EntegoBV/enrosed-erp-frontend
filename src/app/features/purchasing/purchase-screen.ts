import { ChangeDetectionStrategy, Component, DestroyRef, afterEveryRender, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Ui } from '../../shared/ui';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { WorkspaceReturn } from '../../core/platform/workspace-return';
import { PurchaseDesk } from './purchase-desk';
import { PurchaseEditor } from './purchase-editor';
import { PurchaseView } from './purchase-view';
import { PurchaseStepHandoff } from './purchase-step-handoff';
import type { PhoneTab } from './purchase-phone-model';

/**
 * One route, the right screen for the room: a desk on a wide viewport,
 * the guided view and editor on a phone. The desk reads and edits in one
 * place, so both the view and the edit URL land on it there.
 *
 * Deep links: ?section=payments is partner financing (money in),
 * ?section=ledger the payments to suppliers and forwarders (money out),
 * ?section=payment-result the Nacalculatie (the desk's third main view, the
 * phone's Kosten tab; both roots carry id purchase-payment-result), and
 * ?section=pay&payee=…&due=… opens the payment sheet once the payments have
 * loaded, and ?section=credit the Tegoed noteren sheet. On the phone ?tab=
 * opens one of the view's and the editor's five tabs.
 *
 * A next step confirmed on the phone's read view runs in the editor: the
 * view hands it over in memory (PurchaseStepHandoff), the editor opens and
 * runs it once its payments are in, and this screen goes back to the view on
 * the same tab once every sheet of the step has closed.
 */
@Component({
  selector: 'app-purchase-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PurchaseDesk, PurchaseEditor, PurchaseView],
  template: `
    @if (desktop.active()) {
      <app-purchase-desk [id]="id()" [mode]="mode()" />
    } @else if (mode() === 'edit') {
      <app-purchase-editor [id]="id()" [tab]="tab()" />
    } @else {
      <app-purchase-view [id]="id()" [tab]="tab()" [section]="section()" />
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
  /** The phone's open tab: overzicht (absent), producten, kosten, betalingen or dossier. */
  readonly tab = input<string>();

  private readonly desk = viewChild(PurchaseDesk);
  private readonly editor = viewChild(PurchaseEditor);
  private readonly viewer = viewChild(PurchaseView);
  private openedPaymentsFor: object | null = null;
  private openedPaymentsId = '';
  private openedPaymentsSection = '';
  private pendingPaymentsFocus: { screen: object; id: string; section: string; fallback: HTMLElement | null } | null = null;
  private readonly paymentPayees = ['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER'] as const;
  private readonly paymentDues = ['ORDERED', 'SHIPPED', 'FREIGHT', 'ARRIVED'] as const;
  private openedPaymentKey = '';
  /** The editor opened for a quick payment goes back to the read view once its sheet closes. */
  private returnAfterPayment: { editor: PurchaseEditor; id: string } | null = null;
  private readonly stepHandoff = inject(PurchaseStepHandoff);
  private readonly ui = inject(Ui);
  /** The editor that runs a step confirmed on the read view, and the tab to go back to. */
  private readonly returnAfterStep = signal<{ editor: PurchaseEditor; id: string; tab: PhoneTab } | null>(null);

  /** Kosten & bank or Documenten & media opened from here say 'Terug naar INK-…'. */
  private readonly describeReturn = effect(() => {
    const order = (this.desk() ?? this.editor() ?? this.viewer())?.view()?.order;
    if (order) untracked(() => this.workspaceReturn.describe('/purchasing/' + order.id, order.number));
  });

  constructor() {
    effect(() => this.openRequestedSection());
    effect(() => this.openRequestedPayment());
    effect(() => this.returnFromPayment());
    effect(() => this.runHandedStep());
    effect(() => this.returnFromStep());
    afterEveryRender(() => this.focusRequestedSection());
    inject(DestroyRef).onDestroy(() => this.dropUntakenStep());
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
          // The nacalculatie is the desk's third main view; the rail stays as it was.
          desk.mainView.set('nacalc');
        } else if (section === 'payments' && desk.hasPartnerTab()) {
          // Every financing link means the partner's money coming in: the Partner panel, a drawer below a 1140px host (B3).
          desk.showRail('partner', false);
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
    if (section === 'credit') { this.openRequestedCredit(id); return; }
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

  /** ?section=credit: the Tegoed noteren sheet on Betalingen, once the payments are in; the read view sends it to the editor. */
  private openRequestedCredit(id: string): void {
    const desk = this.desk();
    const editor = this.editor();
    const screen = desk ?? editor;
    if (!screen) {
      if (!this.viewer() || this.openedPaymentKey === 'credit-edit|' + id) return;
      this.openedPaymentKey = 'credit-edit|' + id;
      untracked(() => void this.router.navigate(['/purchasing', id, 'edit'], { queryParams: { section: 'credit' }, replaceUrl: true }));
      return;
    }
    const key = 'credit|' + id;
    if (screen.view()?.order.id !== Number(id) || screen.payments() === null || screen.paymentStateLoading()
      || screen.paymentStateError() || this.openedPaymentKey === key) return;
    this.openedPaymentKey = key;
    untracked(() => {
      if (desk) desk.mainView.set('payments');
      else editor?.jumpToSection('purchase-payments-section', undefined, false);
      screen.requestCredit({ kind: 'add' });
      void this.router.navigate(this.mode() === 'edit' ? ['/purchasing', id, 'edit'] : ['/purchasing', id], { replaceUrl: true });
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

  /**
   * A step confirmed on the read view: run it once the editor has the order
   * and its payments, once. The editor counts as handed from the view as
   * soon as the handoff waits for it, so back leads to the view (history is
   * [list, edit]) even while the order or its payments are still loading.
   */
  private runHandedStep(): void {
    const editor = this.editor();
    const id = this.id();
    if (editor && !untracked(() => editor.handedFromView()) && untracked(() => this.stepHandoff.waiting(Number(id), Date.now()))) {
      untracked(() => editor.handedFromView.set(true));
    }
    if (!editor || editor.view()?.order.id !== Number(id) || editor.payments() === null
      || editor.paymentStateLoading() || editor.paymentStateError()) return;
    untracked(() => {
      const handoff = this.stepHandoff.take(Number(id), Date.now());
      if (!handoff) return;
      const started = editor.runStep(handoff.step, handoff.tracking);
      this.returnAfterStep.set({ editor, id, tab: handoff.tab });
      editor.handedFromView.set(true);
      if (!started) this.ui.toast('De container staat al verder; er is niets gewijzigd.');
    });
  }

  /**
   * The edit screen goes away (back, another route) before its editor took
   * the read view's step: the step is dropped, so a later editor for the same
   * order never runs it without asking again.
   */
  private dropUntakenStep(): void {
    if (this.mode() === 'edit') this.stepHandoff.discard(Number(this.id()));
  }

  /**
   * Back to the read view on the same tab once the step and its sheets are
   * done; history stays [list, view]. 'Track & trace invullen' keeps the
   * editor, and so does a refused save that left the draft unsaved.
   */
  private returnFromStep(): void {
    const editor = this.editor();
    const id = this.id();
    // Read the step's state first, so this runs again whenever it changes.
    const busy = editor ? editor.stepFlowBusy() : false;
    const keep = editor ? editor.keepAfterStep() : false;
    const dirty = editor ? editor.dirty() : false;
    const pending = this.returnAfterStep();
    if (!pending) return;
    if (pending.editor !== editor || pending.id !== id || keep) {
      this.returnAfterStep.set(null);
      return;
    }
    if (busy) return;
    this.returnAfterStep.set(null);
    if (dirty) return;
    untracked(() => void this.router.navigate(['/purchasing', id],
      pending.tab === 'overzicht' ? { replaceUrl: true } : { queryParams: { tab: pending.tab }, replaceUrl: true }));
  }

  /** The open editor owns the unsaved-changes verdict; a plain view has none. */
  canDeactivate(): boolean | Promise<boolean> {
    const open = this.desk() ?? this.editor();
    return open ? open.canDeactivate() : true;
  }
}
