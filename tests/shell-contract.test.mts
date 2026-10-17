import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* The app shell (app.ts) as source text: what the redesign foundation promises the owner. */
const shell = readFileSync(new URL('../src/app/app.ts', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../src/styles/shell.scss', import.meta.url), 'utf8');

test('the desk sidebar: a skip link first, Meldingen op dit toestel in the foot, rail counts capped at 9+', () => {
  const skip = shell.indexOf('class="skip-link"');
  assert.ok(skip > 0 && skip < shell.indexOf('<aside class="sidebar"'), 'the skip link comes before the sidebar');
  assert.match(shell, />Naar de inhoud</);
  /* .main is focusable only while the skip link has put the focus there: a permanent
     tabindex takes the focus on every click and switches off the workspace shortcuts. */
  assert.match(shell, /<div class="main" id="inhoud">/);
  assert.doesNotMatch(shell, /class="main"[^>]*tabindex/);
  const skipTo = shell.slice(shell.indexOf('skipToContent(event: Event): void {'), shell.indexOf('initialUrl(): string'));
  assert.match(skipTo, /main\.setAttribute\('tabindex', '-1'\);/);
  assert.match(skipTo, /addEventListener\('blur', \(\) => main\.removeAttribute\('tabindex'\), \{ once: true \}\)/);
  assert.match(skipTo, /main\.focus\(\);/);
  assert.match(shell, /@for \(item of navDevice; track item\.id\)/);
  assert.match(shell, /sidebar__count-rail">\{\{ n > 9 \? '9\+' : n \}\}/);
  /* The rail Meer carries the login requests (Login-aanvragen is not in the 680-899 rail). */
  const more = shell.slice(shell.indexOf('sidebar__link--rail" [routerLink]="navMore.link"'), shell.indexOf('</a>', shell.indexOf('navMore.link')));
  assert.match(more, /openLoginRequests\(\)/);
  assert.match(shellCss, /\.skip-link:not\(:focus\)/);
});

test('the shell starts from the address bar and keeps staff inside it on /voorwaarden', () => {
  assert.match(shell, /initialValue: this\.initialUrl\(\)/);
  /* A workspace side is created only for a signed-in user: on a logged-out hard load the guard is
     still redirecting, and the side's first request (401) would drop the login's returnTo. */
  for (const side of ['app-website-admin-nav', 'app-files-admin-nav', 'app-finance-admin-nav']) {
    const at = shell.indexOf(`<${side} />`);
    const guard = shell.lastIndexOf('@if (auth.isLoggedIn()) {', at);
    assert.ok(at > 0 && guard > 0 && at - guard < 80, side);
  }
  assert.match(shell, /location\.pathname/);
  assert.match(shell, /url\.startsWith\('\/voorwaarden'\) && !this\.auth\.isLoggedIn\(\)/);
});

test('only a group the user toggles animates; the route opens and closes them instantly', () => {
  assert.match(shell, /\[class\.sidebar--animate\]="userToggled\(\)"/);
  const sync = shell.slice(shell.indexOf('syncOpenGroupWithRoute'), shell.indexOf('});', shell.indexOf('syncOpenGroupWithRoute')));
  assert.match(sync, /this\.userToggled\.set\(false\)/);
  const toggle = shell.slice(shell.indexOf('toggleGroup(group: SidebarGroup)'), shell.indexOf('}', shell.indexOf('toggleGroup(group: SidebarGroup)')));
  assert.match(toggle, /this\.userToggled\.set\(true\)/);
});
