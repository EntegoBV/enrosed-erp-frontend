import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface DiaryEntry {
  date: string | null;
  title: string | null;
  text: string;
  items: string[];
}

const DATED = /^(Betaald|Ontvangst gecorrigeerd|Ontvangst|Voorraad bijgeboekt op|Beschadigd bijgemeld)\s+(\d{2}\/\d{2}\/\d{4})\s*:?\s*(.*)$/;
const ANY_DATED = /^(.{0,40}?)\s*(\d{2}\/\d{2}\/\d{4})\s*:?\s*(.*)$/;

/**
 * The container's diary, readable: one line per event, the date first,
 * then what happened. The receipt's per-product remarks indent under
 * their receipt; hand-written notes stay as they were typed.
 */
export function parseDiary(notes: string | null | undefined): DiaryEntry[] {
  if (!notes || !notes.trim()) return [];
  const entries: DiaryEntry[] = [];
  for (const raw of notes.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet && entries.length) {
      entries[entries.length - 1].items.push(bullet[1]);
      continue;
    }
    const known = line.match(DATED);
    if (known) {
      const title = known[1] === 'Voorraad bijgeboekt op' ? 'Voorraad bijgeboekt' : known[1];
      entries.push({ date: known[2], title, text: cleanup(known[3]), items: [] });
      continue;
    }
    const dated = line.match(ANY_DATED);
    if (dated && dated[1]) {
      entries.push({ date: dated[2], title: dated[1].replace(/[:·]$/, '').trim() || null, text: cleanup(dated[3]), items: [] });
      continue;
    }
    entries.push({ date: null, title: null, text: line.trim(), items: [] });
  }
  return entries;
}

/** A bare full stop left behind after the date moved forward reads as dirt. */
function cleanup(text: string): string {
  const trimmed = text.trim().replace(/^\((.*)\)\.?$/, '$1');
  return trimmed === '.' ? '' : trimmed;
}

@Component({
  selector: 'app-diary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="diary">
      @for (entry of entries(); track $index) {
        <li class="diary__entry">
          <span class="diary__date num">{{ entry.date ?? '' }}</span>
          <span class="diary__body">
            @if (entry.title) { <b>{{ entry.title }}</b> }
            @if (entry.text) { <span>{{ entry.text }}</span> }
            @if (entry.items.length) {
              <ul class="diary__items">
                @for (item of entry.items; track $index) { <li>{{ item }}</li> }
              </ul>
            }
          </span>
        </li>
      }
    </ol>
  `,
  styles: `
    .diary { list-style: none; margin: 8px 0 0; padding: 0; }
    .diary__entry { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 10px; padding: 7px 0;
      border-bottom: 1px solid var(--line); font-size: 12.5px; line-height: 1.45; }
    .diary__entry:last-child { border-bottom: 0; }
    .diary__date { color: var(--muted); font-size: 11.5px; padding-top: 1px; white-space: nowrap; }
    .diary__body { min-width: 0; color: var(--ink-2); overflow-wrap: anywhere; }
    .diary__body b { color: var(--ink); font-weight: 650; margin-right: 5px; }
    .diary__items { list-style: none; margin: 3px 0 0; padding: 0; }
    .diary__items li { position: relative; padding-left: 12px; color: var(--ink-2); }
    .diary__items li::before { content: ''; position: absolute; left: 2px; top: .55em; width: 4px; height: 4px;
      border-radius: 50%; background: var(--muted-2); }
  `,
})
export class Diary {
  readonly notes = input<string | null>(null);
  readonly entries = computed(() => parseDiary(this.notes()));
}
