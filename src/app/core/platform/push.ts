import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/api.config';

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

  readonly supported = signal(false);
  readonly enabled = signal(false);
  readonly busy = signal(false);
  readonly deviceCount = signal(0);

  private registration: ServiceWorkerRegistration | null = null;

  async init(): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    this.supported.set(true);
    try {
      this.registration = await navigator.serviceWorker.register('/push-sw.js');
      const subscription = await this.registration.pushManager.getSubscription();
      this.enabled.set(subscription !== null);
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.source !== 'enrosed-push') return;
        void playSoundFor(data.kind);
      });
    } catch {
      /* An old browser without workers simply has no notifications. */
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

export async function playSoundFor(kind: string): Promise<void> {
  const source = SOUND_BY_KIND[kind];
  if (!source) return;
  try {
    const audio = new Audio(source);
    audio.volume = 0.8;
    await audio.play();
  } catch {
    /* Autoplay refused without an earlier gesture: fall back to the synth. */
    if (kind === 'sale-quote') void playKaching();
  }
}

/**
 * The cash register: a bright double "cha-ching", synthesised on the spot.
 *
 * Two detuned bell partials with a fast strike and a shimmering tail, hit
 * twice in quick succession - the shop-app sound everyone knows, without
 * shipping anyone's audio file.
 */
export async function playKaching(): Promise<void> {
  try {
    const context = new AudioContext();
    if (context.state === 'suspended') await context.resume();
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
  } catch {
    /* No audio without a prior user gesture on some platforms; fine. */
  }
}
