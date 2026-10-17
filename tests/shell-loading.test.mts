import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PRELOAD_PATHS, ROUTE_PROGRESS_DELAY_MS, ROUTE_PROGRESS_GROW_MS, preloadAllowed, preloadWanted,
} from '../src/app/core/platform/shell-loading-plan.ts';

const service = readFileSync(new URL('../src/app/core/platform/shell-loading.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app/app.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/app/app.routes.ts', import.meta.url), 'utf8');

test('the progress line waits 200 ms after the guards, then grows to 80 % over 2 s (N16)', () => {
  assert.equal(ROUTE_PROGRESS_DELAY_MS, 200);
  assert.equal(ROUTE_PROGRESS_GROW_MS, 2000);
  assert.match(service, /event instanceof GuardsCheckEnd && event\.shouldActivate/);
  assert.match(service, /timer = setTimeout\(show, ROUTE_PROGRESS_DELAY_MS\)/);
  assert.match(service, /z-index:70/);
  assert.match(service, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(service, /prefersReducedMotion\(\)/);
});

test('the five tab roots preload when idle, never on a data-saving or 2G connection (N17)', () => {
  assert.deepEqual([...PRELOAD_PATHS], ['dashboard', 'sales', 'purchasing', 'products', 'more']);
  for (const path of PRELOAD_PATHS) assert.ok(routes.includes(`path: '${path}',`), path);
  assert.equal(preloadAllowed(undefined), true, 'Safari has no navigator.connection');
  assert.equal(preloadAllowed({ effectiveType: '4g' }), true);
  assert.equal(preloadAllowed({ saveData: true, effectiveType: '4g' }), false);
  assert.equal(preloadAllowed({ effectiveType: '2g' }), false);
  assert.equal(preloadAllowed({ effectiveType: 'slow-2g' }), false);
  assert.match(service, /typeof view\.requestIdleCallback === 'function'/);
  assert.match(service, /view\.setTimeout\(run, 1500\)/);
});

test('the shell installs it from a lazy chunk', () => {
  assert.match(app, /uninstall = m\.installShellLoading\(this\.router, this\.document, this\.desktopViewport\)/);
  /* the workspace sides the shell defers load ahead too */
  for (const side of ['finance/finance-admin-nav', 'files/files-admin-nav', 'website-builder/website-admin-nav']) {
    assert.ok(service.includes(`import('../../features/${side}')`), side);
  }
});

test('preloading only for a signed-in user on a staff screen: never on /offerte, not before login', () => {
  assert.equal(preloadWanted(true, false), true);
  assert.equal(preloadWanted(false, false), false, 'before login (the guard is redirecting)');
  assert.equal(preloadWanted(false, true), false, 'the login page or a customer on /offerte');
  assert.equal(preloadWanted(true, true), false, 'a staff member opening a customer link');
  const gate = app.slice(app.indexOf('private readonly idlePreload = effect('), app.indexOf('logout(): void'));
  assert.match(gate, /if \(this\.idlePreloadStarted \|\| !preloadWanted\(this\.auth\.isLoggedIn\(\), this\.bare\(\)\)\) return;/);
  assert.match(gate, /this\.idlePreloadStarted = true;/);
  assert.match(gate, /m\.startIdlePreload\(this\.router, this\.document\)/);
  /* the progress line stays unconditional and no longer preloads */
  const progress = service.slice(service.indexOf('export function installShellLoading('), service.indexOf('export function startIdlePreload('));
  assert.doesNotMatch(progress, /requestIdleCallback|PRELOAD_PATHS/);
});
