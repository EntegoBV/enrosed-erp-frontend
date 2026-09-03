import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PlannerApi, PlannerItem, PlannerStore } from '../../core/api/planner-api';
import { messageOf } from '../../core/api/errors';
import { DateField } from '../../shared/date-field';
import { plannedBusinessDay } from '../../shared/business-days';
import { Sheet, Ui } from '../../shared/ui';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A read-only line the containers write into the agenda by themselves. */
export interface PlannerMilestone {
  date: string;
  icon: string;
  title: string;
  sub: string | null;
  orderId: number;
}

interface CompactAgendaEntry {
  id: string;
  date: string;
  atTime: string | null;
  title: string;
  sub: string | null;
  item: PlannerItem | null;
  milestone: PlannerMilestone | null;
}

/**
 * Agenda and task list, side by side on the dashboard: the little month
 * calendar with appointment dots the way a paper desk planner works, and
 * a notebook of things to tick off.
 */
@Component({
  selector: 'app-planner-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DateField, Sheet],
  template: `
    @if (compact()) {
      <section class="card planner-compact" [class.planner-compact--hidden]="expanded()"
               aria-labelledby="planner-compact-title">
        <header class="planner-compact__head">
          <div>
            <span class="planner-compact__eyebrow">Planning</span>
            <h2 id="planner-compact-title">Vandaag en daarna</h2>
          </div>
          <button class="btn btn--sm" type="button" (click)="openNew('EVENT')">+ Nieuw</button>
        </header>

        <div class="planner-compact__body">
          <section class="planner-compact__section" aria-labelledby="planner-compact-agenda-title">
            <h3 id="planner-compact-agenda-title">Komend</h3>
            <div class="planner-compact__list">
              @for (entry of compactAgenda(); track entry.id) {
                <button class="planner-compact__row" type="button" (click)="openCompactAgenda(entry)">
                  <span class="planner-compact__date">{{ compactDay(entry.date) }}
                    @if (entry.atTime) { <small>{{ entry.atTime }}</small> }
                  </span>
                  <span class="planner-compact__copy">
                    <b>{{ entry.title }}</b>
                    @if (entry.sub) { <small>{{ entry.sub }}</small> }
                  </span>
                  <span class="planner-compact__chev" aria-hidden="true">›</span>
                </button>
              } @empty {
                <p class="planner-compact__empty">Geen afspraken of levermomenten gepland.</p>
              }
            </div>
          </section>

          <section class="planner-compact__section" aria-labelledby="planner-compact-tasks-title">
            <div class="planner-compact__section-head">
              <h3 id="planner-compact-tasks-title">Open taken</h3>
              @if (compactTasks().length > 3) { <small>3 van {{ compactTasks().length }}</small> }
            </div>
            <ul class="planner-compact__tasks">
              @for (item of compactTasks().slice(0, 3); track item.id) {
                <li>
                  <input class="task__tick" type="checkbox" [checked]="item.done"
                         [attr.aria-label]="'Afvinken: ' + item.title" (change)="toggleTask(item)" />
                  <button class="task__body" type="button" (click)="openEdit(item)">
                    <span class="task__title">{{ item.title }}</span>
                    @if (item.onDate) {
                      <small class="task__date" [class.task__date--late]="isOverdue(item)">{{ compactDay(item.onDate) }}</small>
                    }
                  </button>
                </li>
              } @empty {
                <li class="planner-compact__empty">Geen open taken.</li>
              }
            </ul>
          </section>
        </div>

        <button class="planner-compact__expand" type="button" (click)="expanded.set(true)">
          Volledige agenda en taken <span aria-hidden="true">›</span>
        </button>
      </section>
    }
    <div class="planner-full" [class.planner-full--visible]="!compact() || expanded()">
      @if (compact()) {
        <div class="planner-expanded-head">
          <strong>Volledige planning</strong>
          <button class="linklike" type="button" (click)="expanded.set(false)">Compact tonen</button>
        </div>
      }
    <div class="planner-duo">
      <div class="card planner-card">
        <div class="card__head"><h2>Agenda</h2>
          <span class="spacer"></span>
          <button class="btn btn--sm" type="button" (click)="openNew('EVENT')">+ Nieuw</button>
        </div>
        <div class="card__body">
          <div class="cal-pane">
          <div class="cal-head">
            <button class="cal-nav" type="button" aria-label="Vorige maand"
                    (click)="shiftMonth(-1)">‹</button>
            <strong class="cal-title">{{ monthLabel() }}</strong>
            <button class="cal-nav" type="button" aria-label="Volgende maand"
                    (click)="shiftMonth(1)">›</button>
          </div>
          <div class="cal-grid" role="grid">
            @for (day of weekDays; track day) { <span class="cal-dow">{{ day }}</span> }
            @for (cell of calendar(); track cell.key) {
              <button class="cal-day" type="button"
                      [class.cal-day--outside]="!cell.inMonth"
                      [class.cal-day--today]="cell.today"
                      [class.cal-day--selected]="cell.date === selectedDate()"
                      (click)="selectedDate.set(cell.date)">
                {{ cell.label }}
                @if (cell.events) { <i class="cal-count" aria-hidden="true">{{ cell.events }}</i> }
              </button>
            }
          </div>
          </div>
          @if (dayItems(); as items) {
            <div class="cal-agenda">
              <!-- Which day you are looking at, in words - the blue circle
                   alone was easy to lose. -->
              <h3 class="attach-title cal-agenda__day">{{ longDay(selectedDate()) }}</h3>
              @for (item of items; track item.id) {
                <div class="cal-agenda__row" [class.cal-agenda__row--done]="item.kind === 'TASK' && item.done">
                  @if (item.kind === 'TASK') {
                    <input class="cal-agenda__tick" type="checkbox" [checked]="item.done"
                           [attr.aria-label]="'Taak afvinken: ' + item.title" (change)="toggleTask(item)" />
                  } @else if (item.atTime) {
                    <span class="cal-agenda__time num">{{ item.atTime }}</span>
                  } @else {
                    <span class="cal-agenda__time cal-agenda__time--allday">dag</span>
                  }
                  <button class="cal-agenda__open" type="button"
                          (click)="item.kind === 'EVENT' ? openView(item) : openEdit(item)">
                    <b>{{ item.title }}</b>
                    @if (item.note) { <small>{{ item.note }}</small> }
                  </button>
                </div>
              }
              @for (stone of selectedMilestones(); track stone.title) {
                <!-- The containers keep their own diary in here: read-only,
                     one tap opens the order. -->
                <button class="cal-agenda__row cal-agenda__row--stone" type="button" (click)="openMilestone(stone)">
                  <span class="cal-agenda__time cal-agenda__stone-icon">{{ stone.icon }}</span>
                  <span class="cal-agenda__open">
                    <b>{{ stone.title }}</b>
                    @if (stone.sub) { <small>{{ stone.sub }}</small> }
                  </span>
                </button>
              }
              @if (!dayItems().length && !selectedMilestones().length) {
                <p class="cal-empty">niets gepland</p>
              }
              @if (!items.length && upcoming().length) {
                <!-- The next things coming up, so an empty day still tells
                     you where the week is heading. -->
                <div class="upcoming">
                  <span class="upcoming__label">Eerstvolgend</span>
                  @for (next of upcoming(); track next.id) {
                    <button class="upcoming__row" type="button" (click)="jumpToUpcoming(next)">
                      <small class="task__date">{{ shortDay(next.onDate) }}</small>
                      <b>{{ next.title }}</b>
                      @if (next.atTime) { <small class="muted">{{ next.atTime }}</small> }
                    </button>
                  }
                </div>
              }
            </div>
          }

        </div>
      </div>

      <!-- The notebook next to the planner: work with a deadline. Overdue
           first in red, then by day, loose ones last. -->
      <div class="card tasks-card">
        <div class="card__head"><h2>Taken</h2>
          <span class="spacer"></span>
          @if (smartTasks().length) { <small class="tasks-card__count">{{ smartTasks().length }} open</small> }
        </div>
        <div class="card__body">
          <form class="task-add" (submit)="addTask(); $event.preventDefault()">
            <input class="input input--sm" placeholder="Nieuwe taak… (dag kiezen kan erna)" enterkeyhint="done"
                   [ngModel]="newTask()" (ngModelChange)="newTask.set($event)" name="task" autocomplete="off" />
            <button class="btn btn--primary btn--sm" type="submit" [disabled]="!newTask().trim()">+</button>
          </form>
          <ul class="task-list">
            @for (item of smartTasks(); track item.id) {
              <li [class.task--done]="item.done">
                <input class="task__tick" type="checkbox" [checked]="item.done"
                       [attr.aria-label]="'Afvinken: ' + item.title" (change)="toggleTask(item)" />
                <button class="task__body" type="button" (click)="openEdit(item)">
                  <span class="task__title">{{ item.title }}</span>
                  <span class="task__tags">
                    @if (item.parentId) { <small class="task__note-mark" title="Hoort bij een afspraak">↳</small> }
                    @if (item.note) { <small class="task__note-mark" title="Heeft een notitie">✎</small> }
                    @if (item.onDate) {
                      <small class="task__date" [class.task__date--late]="isOverdue(item)">{{ shortDay(item.onDate) }}</small>
                    } @else {
                      <small class="task__date task__date--loose">los</small>
                    }
                  </span>
                </button>
                <button class="task__remove" type="button" title="Verwijderen"
                        [attr.aria-label]="'Taak verwijderen: ' + item.title" (click)="removeItem(item)">×</button>
              </li>
            } @empty {
              <li class="cal-empty cal-empty--row">geen open taken</li>
            }
          </ul>
          @if (doneTasks().length && !showDone()) {
            <button class="linklike task-list__toggle" type="button" (click)="showDone.set(true)">
              {{ doneTasks().length }} afgevinkt tonen</button>
          } @else if (showDone() && doneTasks().length) {
            <button class="linklike task-list__toggle" type="button" (click)="showDone.set(false)">
              Afgevinkte verbergen</button>
          }
        </div>
      </div>
    </div>
    </div>

    <!-- Looking first, editing on demand: the view is where the work
         happens - notes, attachments and the little to-dos of the day. -->
    @if (viewItem(); as item) {
      <app-sheet [title]="item.title" (closed)="viewing.set(null)">
        <div body (dragover)="onDragOver($event)" (drop)="onDrop($event, item)"
             [class.drop-target]="dragging()">
          <p class="view-sub">
            @if (item.onDate) { <b>{{ longDay(item.onDate) }}</b> @if (item.atTime) { · {{ item.atTime }} } }
            @if (item.pinned) { <span class="view-pin">📌 vastgepind</span> }
          </p>

          <h3 class="attach-title">Notities</h3>
          <!-- Typed straight in, saved the moment you tap elsewhere. -->
          <textarea class="view-note" rows="4" [ngModel]="noteDraft()"
                    (ngModelChange)="noteDraft.set($event)" (blur)="saveNote(item)"
                    placeholder="Wat is er afgesproken? Typ maar - bewaart vanzelf."></textarea>

          <h3 class="attach-title">Taken bij deze afspraak</h3>
          @if (childTasks(item).length) {
            <ul class="task-list view-tasks">
              @for (task of childTasks(item); track task.id) {
                <li [class.task--done]="task.done">
                  <input class="task__tick" type="checkbox" [checked]="task.done"
                         [attr.aria-label]="'Afvinken: ' + task.title" (change)="toggleTask(task)" />
                  <!-- Opens the task itself: plan it on its own day, add a note. -->
                  <button class="task__body" type="button" (click)="openEdit(task)">
                    <span class="task__title">{{ task.title }}</span>
                    <span class="task__tags">
                      @if (task.onDate && task.onDate !== item.onDate) {
                        <small class="task__date" [class.task__date--late]="isOverdue(task)">{{ shortDay(task.onDate) }}</small>
                      }
                    </span>
                  </button>
                  <button class="task__remove" type="button" title="Verwijderen"
                          [attr.aria-label]="'Taak verwijderen: ' + task.title" (click)="removeItem(task)">×</button>
                </li>
              }
            </ul>
          }
          <form class="task-add" (submit)="addChildTask(item); $event.preventDefault()">
            <input class="input input--sm" placeholder="Taak toevoegen, plant zich op deze dag…" enterkeyhint="done"
                   [ngModel]="childDraft()" (ngModelChange)="childDraft.set($event)" name="child" autocomplete="off" />
            <button class="btn btn--primary btn--sm" type="submit" [disabled]="!childDraft().trim()">+</button>
          </form>

          <h3 class="attach-title">Bijlagen</h3>
          @if (item.attachments?.length) {
            <ul class="attach-list">
              @for (file of item.attachments; track file.id) {
                <li>
                  <button class="attach-name" type="button" (click)="openAttachment(item, file)">
                    {{ file.filename }} <small>{{ sizeLabel(file.sizeBytes) }}</small>
                  </button>
                  <button class="attach-remove" type="button" title="Verwijderen"
                          [attr.aria-label]="'Bijlage verwijderen: ' + file.filename"
                          (click)="removeAttachment(item, file)">×</button>
                </li>
              }
            </ul>
          }
          <label class="btn btn--sm attach-add">
            {{ uploading() ? 'Bezig…' : '+ Bijlage toevoegen' }}
            <input type="file" hidden [disabled]="uploading()" (change)="uploadForView(item, $any($event.target))" />
          </label>
          <span class="hint attach-drop-hint hide-mobile"> of sleep een bestand hierheen</span>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="editFromView(item)">Bewerken</button>
          <span class="spacer"></span>
          <button class="btn btn--primary" type="button" (click)="viewing.set(null)">Klaar</button>
        </div>
      </app-sheet>
    }

    @if (editing(); as draft) {
      <app-sheet [title]="sheetTitle(draft)" (closed)="editing.set(null)">
        <div body>
          <div class="per-toggle kind-toggle" role="group" aria-label="Soort">
            <button type="button" [class.on]="draft.kind === 'TASK'"
                    (click)="patch({ kind: 'TASK', atTime: null })">Taak</button>
            <button type="button" [class.on]="draft.kind === 'EVENT'"
                    (click)="patch({ kind: 'EVENT' })">Afspraak</button>
          </div>
          <div class="form-grid mt-12">
            <div class="field span-2">
              <label class="req" for="pl-title">Omschrijving</label>
              <input class="input" id="pl-title" [ngModel]="draft.title"
                     (ngModelChange)="patch({ title: $event })" placeholder="Bijv. Side Arendonk · standopbouw" />
            </div>
            <div class="field" [class.span-2]="draft.kind === 'TASK'">
              <label for="pl-date">{{ draft.kind === 'TASK' ? 'Plannen op' : 'Datum' }} @if (draft.kind === 'TASK') { <span class="opt"></span> }</label>
              <app-date-field fieldId="pl-date" [value]="draft.onDate ?? ''" (valueChange)="patch({ onDate: $event || null })" />
              <!-- Pushing work out is one tap, not a date picker. -->
              <div class="snooze-row" role="group" aria-label="Snel plannen">
                <button class="snooze" type="button" (click)="snooze(0)">Vandaag</button>
                <button class="snooze" type="button" (click)="snooze(1)">Volgende werkdag</button>
                <button class="snooze" type="button" (click)="snooze(5)">+5 werkdagen</button>
                @if (draft.onDate) { <button class="snooze snooze--clear" type="button" (click)="patch({ onDate: null })">Los</button> }
              </div>
            </div>
            @if (draft.kind === 'EVENT') {
            <div class="field">
              <label for="pl-time">Tijd <span class="opt"></span></label>
              <input class="input" id="pl-time" type="time" [ngModel]="draft.atTime"
                     (ngModelChange)="patch({ atTime: $event })" />
            </div>
            }
            <div class="field span-2">
              <label for="pl-note">Afspraken &amp; notities <span class="opt"></span></label>
              <textarea class="textarea" id="pl-note" rows="5" [ngModel]="draft.note"
                        (ngModelChange)="patch({ note: $event })"
                        placeholder="Wat is er afgesproken? bijv. samples meenemen, prijslijst doorsturen…"></textarea>
            </div>
            <label class="pin-toggle span-2">
              <input type="checkbox" [checked]="draft.pinned ?? false"
                     (change)="patch({ pinned: !(draft.pinned ?? false) })" />
              <span><b>Vastpinnen</b> · als lijn bovenaan het dashboard tot je hem lospint</span>
            </label>
          </div>

          @if (draft.id !== null && draft.kind === 'EVENT') {
            <h3 class="attach-title">Taken bij deze afspraak</h3>
            @if (childTasks(draft).length) {
              <ul class="task-list view-tasks">
                @for (task of childTasks(draft); track task.id) {
                  <li [class.task--done]="task.done">
                    <input class="task__tick" type="checkbox" [checked]="task.done"
                           [attr.aria-label]="'Afvinken: ' + task.title" (change)="toggleTask(task)" />
                    <span class="task__title">{{ task.title }}</span>
                    <button class="task__remove" type="button" title="Verwijderen"
                            [attr.aria-label]="'Taak verwijderen: ' + task.title" (click)="removeItem(task)">×</button>
                  </li>
                }
              </ul>
            }
            <form class="task-add" (submit)="addChildTask(draft); $event.preventDefault()">
              <input class="input input--sm" placeholder="Taak toevoegen, plant zich op deze dag…" enterkeyhint="done"
                     [ngModel]="childDraft()" (ngModelChange)="childDraft.set($event)" name="child-edit" autocomplete="off" />
              <button class="btn btn--primary btn--sm" type="submit" [disabled]="!childDraft().trim()">+</button>
            </form>
          }

          <!-- A task born from an appointment says so; the line walks there. -->
          @if (draft.kind === 'TASK' && parentOf(draft); as parent) {
            <button class="task-parent" type="button" (click)="openParent(parent)">
              ↳ Hoort bij afspraak: <b>{{ parent.title }}</b>
              @if (parent.onDate) { <small>{{ shortDay(parent.onDate) }}</small> }
            </button>
          }

          @if (draft.id !== null) {
            <h3 class="attach-title">Bijlagen</h3>
            @if (draft.attachments?.length) {
              <ul class="attach-list">
                @for (file of draft.attachments; track file.id) {
                  <li>
                    <button class="attach-name" type="button" (click)="openAttachment(draft, file)">
                      {{ file.filename }} <small>{{ sizeLabel(file.sizeBytes) }}</small>
                    </button>
                    <button class="attach-remove" type="button" title="Verwijderen"
                            [attr.aria-label]="'Bijlage verwijderen: ' + file.filename"
                            (click)="removeAttachment(draft, file)">×</button>
                  </li>
                }
              </ul>
            }
            <label class="btn btn--sm attach-add">
              {{ uploading() ? 'Bezig…' : '+ Bijlage toevoegen' }}
              <input type="file" hidden [disabled]="uploading()" (change)="uploadAttachment(draft, $any($event.target))" />
            </label>
          } @else {
            <p class="hint">Bewaar de afspraak; daarna kun je bijlagen toevoegen.</p>
          }
        </div>
        <div foot style="display:contents">
          @if (draft.id !== null) {
            <button class="btn btn--danger" type="button" (click)="removeItem(draft); editing.set(null)">Verwijderen</button>
          }
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="editing.set(null)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="saving() || !draft.title.trim()"
                  (click)="save()">{{ saving() ? 'Bezig…' : 'Bewaren' }}</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .planner-compact { overflow: hidden; }
    .planner-compact--hidden,.planner-full { display: none; }
    /* The planner sizes its columns by the room it actually gets, so it
       reads the same beside the home figures as on its own page. */
    .planner-full { container-type: inline-size; }
    .planner-full--visible { display: block; }
    .planner-compact__head { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 15px 16px 12px; border-bottom: 1px solid var(--line); }
    .planner-compact__eyebrow { display: block; margin-bottom: 2px; color: var(--rose); font-size: 9.5px;
      font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .planner-compact__head h2 { font-size: 17px; letter-spacing: -.015em; }
    .planner-compact__body { display: grid; gap: 0; }
    .planner-compact__section { min-width: 0; padding: 12px 15px; }
    .planner-compact__section + .planner-compact__section { border-top: 1px solid var(--line); }
    .planner-compact__section h3 { color: var(--muted); font-size: 10px; font-weight: 780;
      letter-spacing: .07em; text-transform: uppercase; }
    .planner-compact__section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .planner-compact__section-head small { color: var(--muted); font-size: 10.5px; }
    .planner-compact__list { margin-top: 5px; }
    .planner-compact__row { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; align-items: center;
      gap: 9px; width: 100%; min-height: 43px; padding: 6px 1px; border: 0; border-bottom: 1px solid var(--line);
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .planner-compact__row:last-child { border-bottom: 0; }
    .planner-compact__row:hover { background: var(--surface-2); }
    .planner-compact__date { display: grid; color: var(--rose-dark); font-size: 10.5px; font-weight: 720; }
    .planner-compact__date small { color: var(--muted); font-size: 10px; font-weight: 600; }
    .planner-compact__copy { display: grid; min-width: 0; }
    .planner-compact__copy b { overflow: hidden; font-size: 12.5px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
    .planner-compact__copy small { overflow: hidden; color: var(--muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
    .planner-compact__chev { color: var(--muted-2); font-size: 17px; }
    .planner-compact__tasks { list-style: none; margin: 5px 0 0; padding: 0; }
    .planner-compact__tasks li { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 5px 1px;
      border-bottom: 1px solid var(--line); }
    .planner-compact__tasks li:last-child { border-bottom: 0; }
    .planner-compact__tasks .task__body { gap: 7px; }
    .planner-compact__tasks .task__date { margin-left: auto; }
    .planner-compact__empty { margin: 0; padding: 9px 1px 5px; color: var(--muted); font-size: 11.5px; }
    .planner-compact__expand { width: 100%; min-height: 43px; padding: 9px 15px; border: 0; border-top: 1px solid var(--line);
      background: var(--surface-2); color: var(--rose-dark); font: inherit; font-size: 12px; font-weight: 720; cursor: pointer; }
    .planner-compact__expand span { margin-left: 3px; font-size: 15px; }
    .planner-expanded-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px;
      padding: 2px 2px 0; }
    .planner-expanded-head strong { font-size: 13px; }
    .planner-duo { display: grid; gap: 12px; }
    .tasks-card__count { color: var(--muted); font-size: 11.5px; font-weight: 650; }
    @container (min-width: 1000px) {
      .planner-duo { grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); align-items: start; }
    }
    .cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cal-head strong { font-size: 13.5px; text-transform: capitalize; }
    .cal-nav { width: 30px; height: 30px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface);
      color: var(--ink-2); font-size: 15px; cursor: pointer; }
    .cal-nav:hover { background: var(--surface-2); }
    /* Day cells stay hand-sized: never wider than a thumb, however wide the card. */
    .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 46px)); gap: 2px; justify-content: space-between; }
    .cal-dow { padding: 2px 0 4px; color: var(--muted); font-size: 9.5px; font-weight: 750;
      letter-spacing: .05em; text-align: center; text-transform: uppercase; }
    .cal-day { position: relative; display: grid; place-items: center; aspect-ratio: 1; min-height: 34px; border: 0; border-radius: 9px;
      background: transparent; color: var(--ink-2); font: inherit; font-size: 12.5px; cursor: pointer; }
    @media (hover: hover) { .cal-day:hover { background: var(--surface-2); } }
    .cal-day--outside { color: var(--muted-2); }
    .cal-day--today { font-weight: 800; color: var(--rose-dark); box-shadow: inset 0 0 0 1.5px var(--rose-line); }
    .cal-day.cal-day--selected { background: var(--rose); color: #fff; font-weight: 700; box-shadow: none; }
    .cal-title { font-size: 13.5px; font-weight: 700; text-transform: capitalize; color: var(--ink); }
    /* How many appointments that day, as a small bubble - a dot said "something". */
    .cal-count { position: absolute; top: 2px; right: 2px; display: grid; place-items: center;
      min-width: 14px; height: 14px; padding: 0 3px; border-radius: 999px; background: var(--rose);
      color: #fff; font-size: 8.5px; font-style: normal; font-weight: 800; line-height: 1; }
    .cal-day--selected .cal-count { background: #fff; color: var(--rose-dark); }
    .cal-empty { margin: 0; padding: 10px 0 2px; color: var(--muted-2); font-size: 12px; text-align: center; }
    .cal-agenda { margin-top: 8px; border-top: 1px solid var(--line); }
    /* Desktop: the little calendar sits left like a paper desk planner,
       the day's list gets the rest of the width. */
    @container (min-width: 560px) {
      .planner-card .card__body { display: grid; grid-template-columns: 328px minmax(0, 1fr); gap: 4px 22px; align-items: start; }
      .planner-card .overdue { grid-column: 1 / -1; }
      .cal-pane { min-width: 0; }
      .cal-agenda { margin-top: 0; padding-left: 26px; border-top: 0; border-left: 1px solid var(--line); min-height: 100%; }
      .cal-day { min-height: 40px; }
    }
    @media (min-width: 1000px) {
      .planner-compact { display: none; }
      .planner-full { display: block; }
      .planner-expanded-head { display: none; }
    }
    .cal-agenda__row { display: flex; gap: 10px; width: 100%; padding: 8px 2px; border: 0; border-bottom: 1px solid var(--line);
      background: transparent; font: inherit; text-align: left; cursor: pointer; align-items: baseline; }
    .cal-agenda__row:hover { background: var(--surface-2); }
    .cal-agenda__time { flex: none; min-width: 40px; color: var(--muted); font-size: 11.5px; }
    .cal-agenda__time--allday { display: inline-grid; place-items: center; min-width: 40px; padding: 1px 0;
      border-radius: 7px; background: var(--rose-soft); color: var(--rose-dark); font-size: 9.5px;
      font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
    .cal-agenda__what { display: grid; min-width: 0; }
    .cal-agenda__what b { font-size: 13px; font-weight: 650; }
    .cal-agenda__what small { color: var(--muted); font-size: 11px; }
    .task-add { display: flex; gap: 8px; margin-bottom: 6px; }
    .task-add .input { flex: 1; min-width: 0; }
    .task-list { list-style: none; margin: 0; padding: 0; }
    .task-list li { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); }
    .task-list li:last-child { border-bottom: 0; }
    .task__title { font-size: 13px; overflow-wrap: anywhere; }
    .task--done .task__title { color: var(--muted); text-decoration: line-through; }
    .task__remove { width: 26px; height: 26px; flex: none; border: 0; border-radius: 8px; background: transparent;
      color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
    .task__remove:hover { background: var(--danger-soft); color: var(--danger); }
    .task-list__toggle { display: block; width: 100%; margin-top: 8px; padding: 9px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2);
      color: var(--muted); font-size: 12px; font-weight: 650; text-align: center; text-decoration: none; }
    .task-list__toggle:active { background: var(--surface); }
    .cal-empty--row { display: block; border: 0 !important; padding: 12px 0 4px; }
    .pin-toggle { display: flex; align-items: center; gap: 9px; padding: 4px 0; font-size: 12.5px; color: var(--ink-2); cursor: pointer; }
    .pin-toggle input { width: 19px; height: 19px; accent-color: var(--rose); flex: none; }
    .attach-title { margin: 14px 0 6px; color: var(--muted); font-size: 11px; font-weight: 750;
      letter-spacing: .06em; text-transform: uppercase; }
    .attach-list { list-style: none; margin: 0 0 8px; padding: 0; border-top: 1px solid var(--line); }
    .attach-list li { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); }
    .attach-name { flex: 1; min-width: 0; padding: 8px 2px; border: 0; background: transparent; font: inherit;
      font-size: 12.5px; font-weight: 650; color: var(--rose-dark); text-align: left; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .attach-name small { color: var(--muted); font-weight: 500; margin-left: 5px; }
    .attach-remove { width: 26px; height: 26px; flex: none; border: 0; border-radius: 8px; background: transparent;
      color: var(--muted); font-size: 16px; cursor: pointer; }
    .attach-remove:hover { background: var(--danger-soft); color: var(--danger); }
    .attach-add { display: inline-flex; }
    .view-sub { margin: -6px 0 4px; color: var(--ink-2); font-size: 13px; }
    .view-sub b { text-transform: capitalize; }
    .view-pin { margin-left: 8px; color: var(--rose-dark); font-size: 11.5px; font-weight: 650; }
    .view-note { display: block; width: 100%; min-height: 84px; padding: 10px 12px; border: 1px solid var(--line);
      border-radius: 12px; background: var(--surface-2); color: var(--ink); font: inherit; font-size: 13px;
      line-height: 1.5; resize: vertical; outline: none; box-sizing: border-box; }
    .view-note:focus { border-color: var(--rose); background: var(--surface); }
    .view-tasks { margin-bottom: 6px; }
    .drop-target { outline: 2px dashed var(--rose); outline-offset: -6px; border-radius: 12px; }
    .attach-drop-hint { margin-left: 8px; }
    .cal-agenda__day { margin-top: 10px; }
    .upcoming { padding: 2px 0 6px; }
    .upcoming__label { display: block; margin: 4px 0 4px; color: var(--muted); font-size: 10px;
      font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .upcoming__row { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 6px 0;
      border: 0; background: transparent; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
    .upcoming__row b { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upcoming__row:hover b { color: var(--rose-dark); }
    .task__date--loose { background: var(--surface-2); color: var(--muted); }
    .task-parent { display: flex; align-items: baseline; gap: 6px; width: 100%; margin-top: 10px; padding: 9px 12px;
      border: 1px dashed var(--rose-line); border-radius: 11px; background: var(--rose-soft);
      color: var(--ink-2); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
    .task-parent b { color: var(--rose-dark); }
    .task-parent small { margin-left: auto; color: var(--muted); }
    .kind-toggle { margin-top: 2px; }
    .snooze-row { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
    .snooze { padding: 5px 11px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface);
      color: var(--ink-2); font: inherit; font-size: 11.5px; font-weight: 650; cursor: pointer; }
    .snooze:hover { border-color: var(--rose-line); background: var(--rose-soft); color: var(--rose-dark); }
    .snooze--clear { color: var(--muted); }
    .task__tick { width: 19px; height: 19px; accent-color: var(--rose); flex: none; }
    .task__body { display: flex; flex: 1; min-width: 0; align-items: center; gap: 8px; padding: 0; border: 0;
      background: transparent; font: inherit; text-align: left; cursor: pointer; }
    .task__tags { display: inline-flex; gap: 6px; margin-left: auto; align-items: center; flex: none; }
    .task__date { padding: 1px 7px; border-radius: 999px; background: var(--rose-soft); color: var(--rose-dark);
      font-size: 10px; font-weight: 700; white-space: nowrap; }
    .task__date--late { background: var(--danger-soft); color: var(--danger); }
    .task__note-mark { color: var(--muted); font-size: 11px; }
    .cal-agenda__tick { width: 18px; height: 18px; accent-color: var(--rose); flex: none; margin-top: 1px; }
    .cal-agenda__open { display: grid; flex: 1; min-width: 0; padding: 0; border: 0; background: transparent;
      font: inherit; text-align: left; cursor: pointer; }
    .cal-agenda__open b { font-size: 13px; font-weight: 650; }
    .cal-agenda__open small { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cal-agenda__row--done .cal-agenda__open b { color: var(--muted); text-decoration: line-through; }
    .cal-agenda__row--stone { background: var(--surface-2); border-radius: 10px; margin: 2px -6px; padding: 8px 8px; border-bottom: 0; }
    .cal-agenda__row--stone + .cal-agenda__row--stone { margin-top: 4px; }
    .cal-agenda__stone-icon { min-width: 40px; text-align: center; font-size: 14px; }
    .cal-agenda__row--stone .cal-agenda__open b { font-weight: 620; }
  `,
})
export class PlannerCards {
  private readonly api = inject(PlannerApi);
  private readonly store = inject(PlannerStore);
  private readonly ui = inject(Ui);

  readonly compact = input(false);
  readonly expanded = signal(false);

  readonly items = this.store.items;
  readonly month = signal(startOfMonth(new Date()));
  readonly selectedDate = signal(isoDate(new Date()));
  readonly editing = signal<PlannerItem | null>(null);
  readonly viewing = signal<number | null>(null);
  readonly noteDraft = signal('');
  readonly childDraft = signal('');
  readonly dragging = signal(false);
  private readonly itemById = computed(() =>
    new Map(this.items().filter((item) => item.id !== null).map((item) => [item.id!, item])));
  private readonly childrenByParent = computed(() => {
    const children = new Map<number | null | undefined, PlannerItem[]>();
    for (const task of this.items()) {
      const own = children.get(task.parentId) ?? [];
      own.push(task);
      children.set(task.parentId, own);
    }
    return children;
  });

  /** The live item behind the view, so uploads and ticks refresh in place. */
  readonly viewItem = computed(() => {
    const id = this.viewing();
    return id === null ? null : this.itemById().get(id) ?? null;
  });

  openView(item: PlannerItem): void {
    this.viewing.set(item.id);
    this.noteDraft.set(item.note ?? '');
    this.childDraft.set('');
  }

  editFromView(item: PlannerItem): void {
    this.viewing.set(null);
    this.openEdit(item);
  }

  childTasks(item: PlannerItem): PlannerItem[] {
    return this.childrenByParent().get(item.id) ?? [];
  }

  async saveNote(item: PlannerItem): Promise<void> {
    const note = this.noteDraft().trim();
    if (note === (item.note ?? '')) return;
    try {
      await this.api.update({ ...item, note: note || null });
      await this.reload();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Notitie bewaren mislukt'), 'err');
    }
  }

  /** A task typed on the appointment plans itself onto that day. */
  async addChildTask(item: PlannerItem): Promise<void> {
    const title = this.childDraft().trim();
    if (!title || item.id === null) return;
    this.childDraft.set('');
    try {
      await this.api.create({ id: null, kind: 'TASK', title, onDate: item.onDate,
        atTime: null, note: null, done: false, parentId: item.id });
      await this.reload();
    } catch (failure: unknown) {
      this.childDraft.set(title);
      this.ui.toast(messageOf(failure, 'Taak bewaren mislukt'), 'err');
    }
  }

  async uploadForView(item: PlannerItem, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.uploadFile(item, file);
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  async onDrop(event: DragEvent, item: PlannerItem): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.uploadFile(item, file);
  }

  private async uploadFile(item: PlannerItem, file: File): Promise<void> {
    if (item.id === null) return;
    this.uploading.set(true);
    try {
      await this.api.addAttachment(item.id, file);
      await this.reload();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bijlage toevoegen mislukt'), 'err');
    } finally {
      this.uploading.set(false);
    }
  }

  /** Everything on the horizon after the selected day, nearest first. */
  readonly upcoming = computed(() => {
    const from = this.selectedDate();
    const own = this.items()
      .filter((item) => item.onDate && item.onDate > from && !(item.kind === 'TASK' && item.done))
      .map((item) => ({ id: 'p' + item.id, onDate: item.onDate!, atTime: item.atTime, title: item.title, item, stone: null as PlannerMilestone | null }));
    const stones = this.milestones()
      .filter((stone) => stone.date > from)
      .map((stone) => ({ id: 'm' + stone.orderId + stone.title, onDate: stone.date, atTime: null as string | null,
        title: stone.icon + ' ' + stone.title, item: null as PlannerItem | null, stone }));
    return [...own, ...stones]
      .sort((a, b) => a.onDate.localeCompare(b.onDate) || (a.atTime ?? '').localeCompare(b.atTime ?? ''))
      .slice(0, 3);
  });

  jumpTo(item: PlannerItem): void {
    if (!item.onDate) return;
    this.selectedDate.set(item.onDate);
    this.month.set(new Date(item.onDate.slice(0, 8) + '01'));
  }

  jumpToUpcoming(next: { onDate: string }): void {
    this.selectedDate.set(next.onDate);
    this.month.set(new Date(next.onDate.slice(0, 8) + '01'));
  }

  readonly newTask = signal('');
  readonly showDone = signal(false);
  readonly doneTasks = computed(() => this.tasks().filter((task) => task.done));

  /** Deadline first: overdue on top, then by day, loose last; done folded away. */
  readonly smartTasks = computed(() => {
    const today = isoDate(new Date());
    const rank = (task: PlannerItem) =>
      !task.onDate ? 2 : (task.onDate < today ? 0 : 1);
    return this.tasks()
      .filter((task) => this.showDone() || !task.done)
      .sort((a, b) => rank(a) - rank(b)
        || (a.onDate ?? '9999').localeCompare(b.onDate ?? '9999')
        || a.title.localeCompare(b.title, 'nl'));
  });
  readonly compactTasks = computed(() => this.smartTasks().filter((task) => !task.done));

  async addTask(): Promise<void> {
    const title = this.newTask().trim();
    if (!title) return;
    this.newTask.set('');
    try {
      await this.api.create({ id: null, kind: 'TASK', title, onDate: null, atTime: null, note: null, done: false });
      await this.reload();
    } catch (failure: unknown) {
      this.newTask.set(title);
      this.ui.toast(messageOf(failure, 'Taak bewaren mislukt'), 'err');
    }
  }

  parentOf(task: PlannerItem): PlannerItem | null {
    return task.parentId == null ? null
      : this.itemById().get(task.parentId) ?? null;
  }

  openParent(parent: PlannerItem): void {
    this.editing.set(null);
    this.openView(parent);
  }

  longDay(iso: string): string {
    return new Date(iso).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  readonly saving = signal(false);

  readonly weekDays = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
  /** Container milestones, derived by the dashboard - never stored, never stale. */
  readonly milestones = input<PlannerMilestone[]>([]);
  private readonly milestonesByDate = computed(() => {
    const grouped = new Map<string, PlannerMilestone[]>();
    for (const stone of this.milestones()) {
      const entries = grouped.get(stone.date) ?? [];
      entries.push(stone);
      grouped.set(stone.date, entries);
    }
    return grouped;
  });
  readonly selectedMilestones = computed(() =>
    this.milestonesByDate().get(this.selectedDate()) ?? []);

  readonly compactAgenda = computed<CompactAgendaEntry[]>(() => {
    const today = isoDate(new Date());
    const events: CompactAgendaEntry[] = this.events()
      .filter((item) => !!item.onDate && item.onDate >= today)
      .map((item) => ({
        id: `event-${item.id ?? item.onDate + item.title}`,
        date: item.onDate!,
        atTime: item.atTime,
        title: item.title,
        sub: item.note,
        item,
        milestone: null,
      }));
    const milestones: CompactAgendaEntry[] = this.milestones()
      .filter((stone) => stone.date >= today)
      .map((stone) => ({
        id: `milestone-${stone.orderId}-${stone.date}-${stone.title}`,
        date: stone.date,
        atTime: null,
        title: `${stone.icon} ${stone.title}`,
        sub: stone.sub,
        item: null,
        milestone: stone,
      }));
    return [...events, ...milestones]
      .sort((left, right) => left.date.localeCompare(right.date)
        || (left.atTime ?? '').localeCompare(right.atTime ?? '')
        || left.title.localeCompare(right.title, 'nl'))
      .slice(0, 3);
  });
  private readonly router = inject(Router);

  openCompactAgenda(entry: CompactAgendaEntry): void {
    if (entry.item) {
      this.openView(entry.item);
      return;
    }
    if (entry.milestone) this.openMilestone(entry.milestone);
  }

  compactDay(iso: string): string {
    const today = isoDate(new Date());
    if (iso === today) return 'Vandaag';
    const tomorrow = isoDate(new Date(new Date(`${today}T12:00:00`).getTime() + DAY_MS));
    return iso === tomorrow ? 'Morgen' : this.shortDay(iso);
  }

  openMilestone(stone: PlannerMilestone): void {
    void this.router.navigate(['/purchasing', stone.orderId]);
  }

  constructor() {
    void this.reload();
  }

  private reload(): Promise<void> {
    return this.store.reload();
  }

  readonly events = computed(() => this.items().filter((item) => item.kind === 'EVENT'));
  readonly pinnedItems = computed(() => this.items().filter((item) => item.pinned));

  openPinned(item: PlannerItem): void {
    if (item.onDate) { this.selectedDate.set(item.onDate); this.month.set(new Date(item.onDate.slice(0, 8) + '01')); }
    this.openEdit(item);
  }
  readonly tasks = computed(() => this.items().filter((item) => item.kind === 'TASK'));
  readonly openTasks = computed(() => this.tasks().filter((task) => !task.done));

  readonly monthLabel = computed(() =>
    this.month().toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' }));

  readonly calendar = computed(() => {
    const counts = new Map<string, number>();
    for (const item of this.items()) {
      if (item.onDate && !(item.kind === 'TASK' && item.done)) {
        counts.set(item.onDate, (counts.get(item.onDate) ?? 0) + 1);
      }
    }
    for (const stone of this.milestones()) {
      counts.set(stone.date, (counts.get(stone.date) ?? 0) + 1);
    }
    const today = isoDate(new Date());
    const first = this.month();
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(first.getTime() - startOffset * DAY_MS);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start.getTime() + index * DAY_MS);
      const iso = isoDate(date);
      return {
        key: iso, date: iso, label: date.getDate(),
        inMonth: date.getMonth() === first.getMonth(),
        today: iso === today,
        events: counts.get(iso) ?? 0,
      };
    });
  });

  /** Everything planned that day: appointments and tasks booked onto it. */
  readonly dayItems = computed(() =>
    this.items().filter((item) => item.onDate === this.selectedDate()));

  readonly selectedLabel = computed(() =>
    new Date(this.selectedDate()).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' }));

  shiftMonth(step: number): void {
    const current = this.month();
    const next = new Date(current.getFullYear(), current.getMonth() + step, 1);
    this.month.set(next);
    this.selectedDate.set(isoDate(next));
  }

  sheetTitle(draft: PlannerItem): string {
    if (draft.kind === 'TASK') return draft.id === null ? 'Nieuwe taak' : 'Taak';
    return draft.id === null ? 'Nieuwe afspraak' : 'Afspraak';
  }

  /** Quick planning counts Monday through Friday and never lands on a weekend. */
  snooze(days: number): void {
    const date = plannedBusinessDay(new Date(), days);
    this.patch({ onDate: isoDate(date) });
  }

  isOverdue(item: PlannerItem): boolean {
    return !!item.onDate && !item.done && item.onDate < isoDate(new Date());
  }

  shortDay(iso: string): string {
    return new Date(iso).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  openNew(kind: 'EVENT'): void {
    this.editing.set({ id: null, kind, title: '', onDate: this.selectedDate(), atTime: null, note: null, done: false });
  }

  openEdit(item: PlannerItem): void {
    this.editing.set({ ...item });
  }

  patch(changes: Partial<PlannerItem>): void {
    this.editing.update((draft) => draft && { ...draft, ...changes });
  }

  async save(): Promise<void> {
    const draft = this.editing();
    if (!draft || !draft.title.trim()) return;
    this.saving.set(true);
    try {
      if (draft.id === null) {
        const created = await this.api.create(draft);
        await this.reload();
        if (draft.onDate) this.selectedDate.set(draft.onDate);
        /* Stays open in edit: attachments become possible right away. */
        this.editing.set({ ...created });
        this.ui.toast('Bewaard - bijlagen kunnen er nu bij', 'ok');
      } else {
        await this.api.update(draft);
        await this.reload();
        if (draft.onDate) this.selectedDate.set(draft.onDate);
        this.editing.set(null);
      }
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  readonly uploading = signal(false);

  async uploadAttachment(draft: PlannerItem, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file || draft.id === null) return;
    this.uploading.set(true);
    try {
      await this.api.addAttachment(draft.id, file);
      await this.reload();
      const fresh = this.items().find((item) => item.id === draft.id);
      if (fresh) this.editing.set({ ...fresh });
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bijlage toevoegen mislukt'), 'err');
    } finally {
      this.uploading.set(false);
    }
  }

  async openAttachment(draft: PlannerItem, file: { id: number; filename: string }): Promise<void> {
    if (draft.id === null) return;
    try {
      const blob = await this.api.attachmentFile(draft.id, file.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bijlage openen mislukt'), 'err');
    }
  }

  async removeAttachment(draft: PlannerItem, file: { id: number }): Promise<void> {
    if (draft.id === null) return;
    try {
      await this.api.removeAttachment(draft.id, file.id);
      await this.reload();
      const fresh = this.items().find((item) => item.id === draft.id);
      if (fresh && this.editing()) this.editing.set({ ...fresh });
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bijlage verwijderen mislukt'), 'err');
    }
  }

  sizeLabel(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' kB';
  }

  async toggleTask(item: PlannerItem): Promise<void> {
    try {
      await this.api.update({ ...item, done: !item.done });
      await this.reload();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Aanpassen mislukt'), 'err');
    }
  }

  async removeItem(item: PlannerItem): Promise<void> {
    if (item.id === null) return;
    try {
      await this.api.remove(item.id);
      await this.reload();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
    }
  }
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
