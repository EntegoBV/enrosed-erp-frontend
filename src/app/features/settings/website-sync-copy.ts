import type { WebsiteRebuildStatus } from '../../core/api/models';

/**
 * The words for the website rebuild status, the same in every variant of
 * app-website-sync-status (card, desk status bar, phone chip and banner).
 * Pure and import-free at runtime (node-tested).
 */

export type WebsiteSyncTone = 'ok' | 'warn' | 'danger' | 'muted';
/** refresh = load the status again; retry = start the update again; todo = open Te doen; reload = after a failed load. */
export type WebsiteSyncAction = 'refresh' | 'retry' | 'todo' | 'reload';

export interface WebsiteSyncCopy {
  tone: WebsiteSyncTone;
  label: string;
  /** Short, lower case: "sinds 16/10 23:40", "update geaccepteerd 23:41". */
  moment: string | null;
  /** One sentence for the card, the Live card and Publicatie. */
  detail: string;
  action: WebsiteSyncAction | null;
  actionLabel: string | null;
  /** lastError of a failed update: the card and Publicatie only. */
  error: string | null;
  /** "volgende automatische poging 23:50" of a failed update. */
  nextAttempt: string | null;
  /** True while the status is not LIVE and not still loading: the phone shows a banner. */
  needsBanner: boolean;
}

export interface WebsiteSyncInput {
  status: WebsiteRebuildStatus | null;
  loading: boolean;
  loadError: string | null;
  pollEnded: boolean;
  now?: Date;
}

/** The Vercel/Railway set-up text: only Publicatie shows it, inside "Technische uitleg". */
export const WEBSITE_SYNC_TECHNICAL = 'De backend kent nog geen Vercel Deploy Hook van de website. Maak er een '
  + 'aan in Vercel (project enrosed-website-frontend → Settings → Git → Deploy Hooks) en zet de URL op Railway '
  + 'als VERCEL_WEBSITE_DEPLOY_HOOK_URL. Daarna bouwt de website zichzelf opnieuw na elke opgeslagen wijziging.';

const pad = (value: number) => String(value).padStart(2, '0');

/** "23:40" today, "16/10 23:40" this year, "16/10/2025 23:40" before; null for a missing or broken time. */
export function shortMoment(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return time;
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  return date.getFullYear() === now.getFullYear() ? `${day} ${time}` : `${day}/${date.getFullYear()} ${time}`;
}

/** A rebuild that failed because required translations are missing: the input is kept, Te doen holds the work. */
export function isTranslationPending(status: WebsiteRebuildStatus | null): boolean {
  if (status?.status !== 'FAILED_OR_STALE' || !status.lastError) return false;
  return /missing required translation|translation entry|invalid public website copy|vertal|ontbrekende?\s+taal/i.test(status.lastError);
}

function withMoment(prefix: string, value: string | null, now: Date): string | null {
  const moment = shortMoment(value, now);
  return moment ? `${prefix} ${moment}` : null;
}

export function websiteSyncCopy(input: WebsiteSyncInput): WebsiteSyncCopy {
  const now = input.now ?? new Date();
  const base = { error: null, nextAttempt: null, needsBanner: true } as const;
  if (input.loadError) {
    return { ...base, tone: 'danger', label: 'Status niet geladen', moment: null, detail: input.loadError,
      action: 'reload', actionLabel: 'Opnieuw laden' };
  }
  const status = input.status;
  if (!status) {
    return { ...base, needsBanner: false, tone: 'muted', label: 'Status ophalen', moment: null,
      detail: 'De status van de website wordt gecontroleerd.', action: null, actionLabel: null };
  }
  if (isTranslationPending(status)) {
    return { ...base, tone: 'warn', label: 'Wacht op vertalingen', moment: 'verplichte talen ontbreken',
      detail: 'Opgeslagen; de website wacht nog op verplichte vertalingen. De invoer is niet verloren.',
      action: 'todo', actionLabel: 'Naar Te doen' };
  }
  const stopped = input.pollEnded && (status.status === 'QUEUED' || status.status === 'TRIGGERED');
  switch (status.status) {
    case 'LIVE':
      return { ...base, needsBanner: false, tone: 'ok', label: 'Live', moment: withMoment('sinds', status.liveAt, now),
        detail: 'De website draait op de laatste opgeslagen versie.', action: 'refresh', actionLabel: 'Vernieuwen' };
    case 'QUEUED':
      return { ...base, tone: 'warn', label: 'In wachtrij',
        moment: stopped ? 'controle gestopt na 5 minuten' : withMoment('sinds', status.queuedAt, now),
        detail: 'De wijziging staat klaar om de website opnieuw op te bouwen.',
        action: stopped ? 'refresh' : null, actionLabel: stopped ? 'Status vernieuwen' : null };
    case 'TRIGGERED':
      return { ...base, tone: 'warn', label: 'Wordt bijgewerkt',
        moment: stopped ? 'controle gestopt na 5 minuten' : withMoment('update geaccepteerd', status.hookAcceptedAt, now),
        detail: 'De update is geaccepteerd, maar staat nog niet live.',
        action: stopped ? 'refresh' : null, actionLabel: stopped ? 'Status vernieuwen' : null };
    case 'FAILED_OR_STALE':
      return { ...base, tone: 'danger', label: 'Actie nodig', moment: withMoment('laatste poging', status.lastAttemptAt, now),
        detail: 'De website kon niet worden bijgewerkt of loopt achter.', action: 'retry', actionLabel: 'Opnieuw proberen',
        error: status.lastError?.trim() || null, nextAttempt: withMoment('volgende automatische poging', status.nextAttemptAt, now) };
    case 'NOT_CONFIGURED':
      return { ...base, tone: 'muted', label: 'Niet automatisch', moment: 'de website wordt niet vanzelf bijgewerkt',
        detail: 'De website wordt na een wijziging niet vanzelf opnieuw opgebouwd. De koppeling is nog niet ingesteld.',
        action: null, actionLabel: null };
    default:
      return { ...base, needsBanner: false, tone: 'muted', label: 'Status ophalen', moment: null,
        detail: 'De status van de website wordt gecontroleerd.', action: null, actionLabel: null };
  }
}
