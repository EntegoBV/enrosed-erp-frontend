import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Icon } from './icon';
import { appendPaymentProofs, PROOF_ACCEPT, proofFileKey } from './payment-proof-selection';

/** A local proof queue; uploading remains part of the payment's save/retry flow. */
@Component({
  selector: 'app-payment-proof-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <section class="proof-picker" [class.proof-picker--over]="dragging()" [class.proof-picker--disabled]="disabled()"
             [attr.aria-label]="title()" (dragenter)="enter($event)" (dragover)="over($event)"
             (dragleave)="leave()" (drop)="drop($event)">
      <header><div><b>{{ title() }}</b><small>PDF, JPG of PNG · maximaal 25 MB per bestand</small></div>
        <span class="proof-count" aria-live="polite">{{ files().length }} / {{ maxFiles() }}</span>
      </header>
      <input #picker type="file" hidden multiple [accept]="accept" [disabled]="disabled()" (change)="choose($event)" />
      <button class="proof-add" type="button" [disabled]="disabled() || files().length >= maxFiles()" (click)="picker.click()">
        <span class="proof-add__icon"><app-icon name="media" [size]="21" /></span>
        <span><b>{{ maxFiles() === 0 ? 'Maximum bereikt' : files().length ? 'Nog bestanden toevoegen' : 'Bestanden kiezen' }}</b><small>{{ maxFiles() === 0 ? 'Er zijn al vijf betaalbewijzen aan deze betaling gekoppeld.' : 'Je kunt ook meerdere bestanden hierheen slepen' }}</small></span>
        <span class="proof-add__plus" aria-hidden="true">+</span>
      </button>
      @if (files().length) {
        <ul class="proof-files" aria-label="Gekozen betaalbewijzen">
          @for (file of files(); track fileKey(file); let index = $index) {
            <li><span class="proof-file__icon"><app-icon [name]="file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'media'" [size]="20" /></span>
              <span class="proof-file__copy"><b>{{ file.name }}</b><small>{{ fileSize(file.size) }}</small></span>
              <button type="button" [disabled]="disabled()" [attr.aria-label]="file.name + ' uit de selectie verwijderen'" (click)="remove(index)">×</button>
            </li>
          }
        </ul>
      }
      @if (errors().length) {
        <div class="proof-errors" role="alert">@for (error of errors(); track $index) { <p>{{ error }}</p> }</div>
      }
      <p class="proof-hint">De gekozen bestanden worden bij het bewaren aan deze betaling en het dossier gekoppeld.</p>
    </section>
  `,
  styles: `
    :host{display:block;min-width:0}.proof-picker{padding:14px;border:1px solid var(--line);border-radius:20px;background:var(--surface);transition:border-color .16s,background .16s}.proof-picker--over{border-color:var(--rose);background:var(--rose-soft)}.proof-picker--disabled{opacity:.7}.proof-picker header{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:12px}.proof-picker header>div{display:grid;gap:4px}.proof-picker header b{font-size:14px}.proof-picker small{font-size:11.5px;color:var(--muted);line-height:1.4}.proof-count{flex:none;padding:4px 9px;border-radius:99px;background:var(--surface-2);font-size:12px;font-variant-numeric:tabular-nums}.proof-add{display:flex;align-items:center;gap:12px;width:100%;min-height:70px;padding:12px;border:1px dashed var(--rose-line);border-radius:15px;background:var(--surface-2);text-align:left;color:var(--ink);font:inherit;cursor:pointer}.proof-add>span:nth-child(2){display:grid;gap:3px;min-width:0}.proof-add b{font-size:13px}.proof-add:disabled{opacity:.5;cursor:default}.proof-add__icon,.proof-file__icon{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:11px;background:var(--rose-soft);color:var(--rose-dark)}.proof-add__plus{margin-left:auto;font-size:24px;color:var(--rose-dark)}.proof-files{list-style:none;padding:0;margin:10px 0 0}.proof-files li{display:flex;align-items:center;gap:10px;padding:8px 0}.proof-files li+li{border-top:1px solid var(--line)}.proof-file__copy{display:grid;gap:3px;min-width:0;flex:1}.proof-file__copy b{overflow-wrap:anywhere;font-size:12px;line-height:1.45}.proof-files button{flex:none;width:44px;height:44px;border:0;border-radius:12px;color:var(--muted);background:var(--surface-2);font-size:24px;cursor:pointer}.proof-files button:hover{background:var(--danger-soft);color:var(--danger)}.proof-errors{margin-top:10px;color:var(--danger);font-size:12px;overflow-wrap:anywhere}.proof-errors p{margin:4px 0}.proof-hint{margin:10px 0 0;color:var(--muted);font-size:11.5px;line-height:1.5}.proof-picker button:focus-visible{outline:2px solid var(--rose);outline-offset:3px}@media(prefers-reduced-motion:reduce){.proof-picker{transition:none}}
  `,
})
export class PaymentProofPicker {
  readonly files = input<readonly File[]>([]);
  readonly disabled = input(false);
  readonly maxFiles = input(5);
  readonly title = input('Betalingsbewijs');
  readonly filesChange = output<File[]>();
  readonly errors = signal<string[]>([]);
  readonly dragging = signal(false);
  readonly accept = PROOF_ACCEPT;
  readonly fileKey = proofFileKey;
  private dragDepth = 0;

  choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.add(Array.from(input.files ?? []));
    input.value = '';
  }

  private add(files: File[]): void {
    if (this.disabled()) return;
    const selection = appendPaymentProofs(this.files(), files, this.maxFiles());
    this.errors.set(selection.errors);
    this.filesChange.emit(selection.files);
  }

  remove(index: number): void {
    if (this.disabled()) return;
    this.errors.set([]);
    this.filesChange.emit(this.files().filter((_, i) => i !== index));
  }

  enter(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files') || this.disabled()) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  over(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = this.disabled() ? 'none' : 'copy';
  }

  leave(): void {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dragging.set(false);
  }

  drop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    this.add(Array.from(event.dataTransfer?.files ?? []));
  }

  fileSize(bytes: number): string {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toLocaleString('nl-BE', { maximumFractionDigits: 1 })} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
}
