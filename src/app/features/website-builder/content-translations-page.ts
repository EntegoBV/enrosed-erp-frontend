import { ChangeDetectionStrategy, Component, HostListener, signal } from '@angular/core';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { PageHeader } from '../../shared/page-header';
import { ContentTranslationWorkspace } from '../settings/content-translation-workspace';

@Component({
  selector: 'app-content-translations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentTranslationWorkspace, PageHeader],
  template: `
    <app-page-header
      title="Website- &amp; SEO-teksten"
      subtitle="Algemene teksten per taal, los van producten en categorieën."
      [showBack]="true"
      [showBell]="false"
    />
    <main class="content content-page">
      <app-content-translation-workspace
        [visible]="true"
        (dirtyChange)="dirty.set($event)"
        (busyChange)="busy.set($event)"
      />
    </main>
  `,
  styles: `
    .content-page { max-width: 1180px; margin-inline: auto; padding-bottom: calc(32px + env(safe-area-inset-bottom)); }
  `,
})
export class ContentTranslationsPage implements HasUnsavedChanges {
  readonly dirty = signal(false);
  readonly busy = signal(false);

  canDeactivate(): boolean {
    if (this.busy()) return false;
    if (!this.dirty()) return true;
    return window.confirm('U heeft teksten die nog niet zijn opgeslagen. Toch verlaten?');
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty() && !this.busy()) return;
    event.preventDefault();
    event.returnValue = '';
  }
}
