import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/api.config';
import { Ui } from '../../shared/ui';
import { WorkQueue } from '../api/work-queue';

/**
 * Phone notifications for this device, via web push.
 *
 * Android subscribes straight from the browser; iOS wants the app on the
 * home screen first (Zet op beginscherm), then behaves the same. The
 * service worker shows the native notification and posts the kind to every
 * open window - a new sale rings the cash register in the app itself.
 */
@Injectable({ providedIn: 'root' })
export class PushSetup {
  private readonly http = inject(HttpClient);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);

  readonly supported = signal(false);
  /** Inside the native host (enrosed-erp-ios): no Push API in a WKWebView; the home-screen app keeps the notifications. */
  readonly hosted = signal(false);
  readonly enabled = signal(false);
  readonly busy = signal(false);
  readonly deviceCount = signal(0);

  private registration: ServiceWorkerRegistration | null = null;

  async init(): Promise<void> {
    if (document.documentElement.dataset['host']) { this.hosted.set(true); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    this.supported.set(true);
    try {
      this.registration = await navigator.serviceWorker.register('/push-sw.js');
      const subscription = await this.registration.pushManager.getSubscription();
      this.enabled.set(subscription !== null);
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.source !== 'enrosed-push') return;
        void this.work.refresh(true);
        /* Only the fronted app speaks: sound plus a toast instead of the
           suppressed system banner; when the banner speaks after all, it is
           the one message. */
        if (document.visibilityState !== 'visible') return;
        void this.ring(data).then((banner) => {
          if (!banner) this.ui.toast(data.title + (data.body ? ' — ' + data.body : ''));
        });
      });
    } catch {
      /* An old browser without workers simply has no notifications. */
    }
  }

  /**
   * The app's own sound for a sale. A browser only plays sound in a page someone has touched since it loaded, and the
   * app loads again by itself for a newer build (fresh-build-service.ts): a window that stands untouched after that
   * would stay silent while the worker has already held back the system banner for it. So when the sound is refused,
   * the banner speaks after all. True when it did (the toast is then left out). An older worker's message names no
   * address: its banner would open the dashboard instead of the sale, so that one keeps the toast.
   */
  private async ring(data: { kind: string; title?: string; body?: string; url?: string; tag?: string }): Promise<boolean> {
    if (!SOUND_BY_KIND[data.kind] || await playSoundFor(data.kind)) return false;
    if (!this.registration || typeof data.url !== 'string' || !data.url) return false;
    const body = data.body || '';
    try {
      await this.registration.showNotification(data.title || 'Enrosed', {
        body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
        tag: data.tag || data.kind + ':' + body.slice(0, 40), data: { url: data.url },
      });
      return true;
    } catch {
      /* No permission any more: the toast is all there is. */
      return false;
    }
  }

  async enable(): Promise<string | null> {
    if (!this.registration) await this.init();
    if (!this.registration) return 'Dit toestel ondersteunt geen meldingen';
    this.busy.set(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        return 'Meldingen zijn geweigerd - zet ze aan bij de browserinstellingen';
      }
      const { publicKey } = await firstValueFrom(
        this.http.get<{ publicKey: string }>(api('/api/push/public-key')));
      const subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey).buffer as ArrayBuffer,
      });
      const json = subscription.toJSON();
      const result = await firstValueFrom(this.http.post<{ subscriptions: number }>(
        api('/api/push/subscriptions'), {
          endpoint: subscription.endpoint,
          p256dh: json.keys?.['p256dh'],
          auth: json.keys?.['auth'],
          userAgent: navigator.userAgent.slice(0, 280),
        }));
      this.deviceCount.set(result.subscriptions);
      this.enabled.set(true);
      return null;
    } catch (failure) {
      return failure instanceof Error ? failure.message : 'Aanmelden voor meldingen mislukt';
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    this.busy.set(true);
    try {
      const subscription = await this.registration?.pushManager.getSubscription();
      if (subscription) {
        await firstValueFrom(this.http.delete<{ subscriptions: number }>(
          api('/api/push/subscriptions'), { body: { endpoint: subscription.endpoint } }));
        await subscription.unsubscribe();
      }
      this.enabled.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  devices(): Promise<{ id: number; device: string; since: string | null;
      lastStatus: number | null; lastAt: string | null }[]> {
    return firstValueFrom(this.http.get<{ id: number; device: string; since: string | null;
      lastStatus: number | null; lastAt: string | null }[]>(api('/api/push/subscriptions')));
  }

  async sendTest(): Promise<void> {
    await firstValueFrom(this.http.post(api('/api/push/test'), {}));
  }
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Which sound belongs to which news; everything else keeps the system sound. */
const SOUND_BY_KIND: Record<string, string> = {
  'sale-quote': '/sounds/offerte.mp3',
  'sale-invoice': '/sounds/factuur.mp3',
};

/** Plays the sound of this kind of news; false when it has none or the browser refused to play (no gesture in this page yet). */
export async function playSoundFor(kind: string): Promise<boolean> {
  const source = SOUND_BY_KIND[kind];
  if (!source) return false;
  try {
    const audio = new Audio(source);
    audio.volume = 0.8;
    await audio.play();
    return true;
  } catch {
    /* Autoplay refused without an earlier gesture: fall back to the synth. */
    return kind === 'sale-quote' ? playKaching() : false;
  }
}

/**
 * The cash register: a bright double "cha-ching", synthesised on the spot.
 *
 * Two detuned bell partials with a fast strike and a shimmering tail, hit
 * twice in quick succession - the shop-app sound everyone knows, without
 * shipping anyone's audio file.
 */
export async function playKaching(): Promise<boolean> {
  try {
    const context = new AudioContext();
    if (context.state === 'suspended') {
      /* Without a gesture in this page resume() stays pending until one comes, and the register would ring at that later tap. */
      await Promise.race([context.resume(), new Promise((done) => setTimeout(done, 300))]);
      if ((context.state as AudioContextState) !== 'running') {
        void context.close();
        return false;
      }
    }
    const master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);

    const ding = (start: number, gainScale: number) => {
      for (const [frequency, level] of [[2093, 1], [2637, 0.6], [3520, 0.35], [1046, 0.2]] as const) {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency * (1 + (Math.random() - 0.5) * 0.004);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(level * gainScale, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + 1);
      }
    };

    const now = context.currentTime + 0.02;
    ding(now, 0.55);        /* cha */
    ding(now + 0.12, 1);    /* ching */
    setTimeout(() => void context.close(), 1600);
    return true;
  } catch {
    /* No audio without a prior user gesture on some platforms; fine. */
    return false;
  }
}
