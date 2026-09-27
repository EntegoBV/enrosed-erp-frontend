import { Injectable, computed, signal } from '@angular/core';
import { isWorkspaceUrl, returnLabel, returnPath } from './return-label';

/** The last ERP screen before a workspace opened, and what it is called. */
export interface WorkspaceOrigin {
  url: string;
  label: string;
}

const STORAGE_KEY = 'enrosed.workspace.return';

/**
 * Remembers where the user left the ERP for Kosten & bank or Documenten &
 * media, so the workspace's way out returns there ("Terug naar
 * inkooporder") instead of always to the dashboard. The app shell notes
 * every navigation; workspace URLs are skipped, so the origin survives any
 * wandering inside a workspace. Kept per tab in sessionStorage, so a reload
 * inside a workspace still knows the way back.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceReturn {
  private readonly current = signal<WorkspaceOrigin | null>(readStored());
  /** Labels a screen gave itself, e.g. the order number of a purchase order. */
  private readonly described = new Map<string, string>();

  readonly origin = this.current.asReadonly();
  readonly label = computed(() => this.origin()?.label ?? 'ERP');
  /** A desk has the dashboard as its home; a phone has Meer, where the workspaces live. */
  readonly deskUrl = computed(() => this.origin()?.url ?? '/dashboard');
  readonly phoneUrl = computed(() => this.origin()?.url ?? '/more');

  note(url: string): void {
    if (isWorkspaceUrl(url)) return;
    const origin = { url, label: this.described.get(returnPath(url)) ?? returnLabel(url) };
    const previous = this.current();
    if (previous && previous.url === origin.url && previous.label === origin.label) return;
    this.current.set(origin);
    store(origin);
  }

  /** A screen names itself more precisely once it knows, e.g. describe('/purchasing/46', 'INK-2026-014'). */
  describe(path: string, label: string): void {
    this.described.set(path, label);
    const origin = this.current();
    if (!origin || returnPath(origin.url) !== path || origin.label === label) return;
    const next = { url: origin.url, label };
    this.current.set(next);
    store(next);
  }
}

function readStored(): WorkspaceOrigin | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceOrigin> | null;
    return typeof parsed?.url === 'string' && typeof parsed.label === 'string'
      ? { url: parsed.url, label: parsed.label } : null;
  } catch {
    return null;
  }
}

function store(origin: WorkspaceOrigin): void {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(origin));
  } catch {
    /* Private mode or a full quota: the way back then lasts this session only. */
  }
}
