/**
 * The installable app's manifest: Enrosed for the staff (public/manifest.webmanifest, starts at /dashboard) or the
 * partner portal (public/partner.webmanifest, starts at /partner).
 *
 * iOS reads the manifest when the page is added to the Home Screen (like the status bar meta, duo-status-bar.ts),
 * and a home-screen app has its own storage: no session and no last sign-in. Added from the portal with the staff
 * manifest it started at /dashboard and showed the staff login ("Kies Emre of Berat"). So the portal and the
 * partner login point the link at the partner manifest while they show, and put it back when they close.
 */
export type AppManifest = 'staff' | 'partner';

const HREF: Readonly<Record<AppManifest, string>> = { staff: 'manifest.webmanifest', partner: 'partner.webmanifest' };

export function useAppManifest(doc: Document, which: AppManifest): void {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link && link.getAttribute('href') !== HREF[which]) link.setAttribute('href', HREF[which]);
}
