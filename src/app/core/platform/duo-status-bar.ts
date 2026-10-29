/**
 * The iPhone Duo's status bar in the home-screen app (2026-10-29). With the opaque `default` status bar a home-screen
 * web app gets the Duo's side strip as a reserved white bar it cannot draw in: on Emre's Duo the side rail stood
 * beside it. With `black-translucent` iOS paints that strip in the page's background colour instead (seen the same
 * day), so the page and the strip read as one surface; the page itself still ends at the strip (382 wide folded,
 * 867 unfolded sideways, no side inset), as WebKit keeps web content out of the space behind the side controls in
 * Safari 27.1. Should a later iOS let the page in, nav-rail.ts sees the strip as an inset and stands the rail in it.
 *
 * iOS reads the meta when the app is added to the Home Screen, so it changes here, at start-up, on a Duo only: its
 * screen is 466 x 678 folded and 669 x 951 unfolded (WebKit keeps reporting 466 x 678 after unfolding). An app added
 * before keeps its bar until it is added again. Other iPhones keep the opaque bar: iOS 26/27 blur what lies under a
 * translucent one. `data-duo` on <html> lets styles/nav-rail.scss paint the status bar's area solid (.safe-paint).
 */

/** The Duo's screens in points, portrait (short side first): the outer display, the inner display. */
export const DUO_SCREENS: ReadonlyArray<readonly [number, number]> = [[466, 678], [669, 951]];

/** True for an iPhone Duo's screen size, in either orientation. */
export function isDuoScreen(width: number, height: number): boolean {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return DUO_SCREENS.some(([w, h]) => short === w && long === h);
}

/** On a Duo: mark <html> and switch the status bar meta to translucent, for the next "Zet op beginscherm". */
export function installDuoStatusBar(doc: Document): void {
  const screen = doc.defaultView?.screen;
  if (!screen || !isDuoScreen(screen.width, screen.height)) return;
  doc.documentElement.dataset['duo'] = '';
  doc.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', 'black-translucent');
}
