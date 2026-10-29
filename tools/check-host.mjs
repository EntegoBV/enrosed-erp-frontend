#!/usr/bin/env node
/**
 * Headless check of the native host mode (enrosed-erp-ios) against a served
 * development build with a planted staff session and the mock API (the
 * harness: serve.mjs on 4341, mock-api.mjs on 8080).
 *
 *   node tools/check-host.mjs --out <dir> [--base http://localhost:4341] [--device duo|phone]
 *        [--routes /dashboard,/sales,...] [--poses 951x669@0.84.34.0,...] [--chrome <binary>]
 *        [--contract tools/host-contract.json] [--no-interact]
 *
 * Per pose (WxH@top.right.bottom.left safe-area insets, as the Duo's strip
 * poses give them) it installs, before any script of the page, a stub of
 * what the Swift shell injects: window.enrosedHost (receive/on/ready) and
 * window.webkit.messageHandlers.enrosed / enrosedAsk, which log every
 * message into window.__hostLog; the user agent carries the EnrosedHost/1
 * suffix. Per route: screenshot, the log dumped, every message validated
 * against tools/host-contract.json, the web chrome checked hidden and the
 * content checked clear of the strip. On the first pose a few commands are
 * exercised (a title-menu row, back, tabRoot, refresh).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

const OUT = path.resolve(arg('--out', path.join(process.cwd(), 'host-shots')));
const BASE = arg('--base', 'http://localhost:4341').replace(/\/$/, '');
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const DEVICE = arg('--device', 'duo');
const CONTRACT = JSON.parse(fs.readFileSync(path.resolve(arg('--contract', path.join(here, 'host-contract.json'))), 'utf8'));
const ROUTES = arg('--routes', '/dashboard,/sales,/purchasing,/products,/more,/settings,/settings?sectie=device,/costs,/files,/website,/analyses/overview,/customers,/products/new,/login')
  .split(',').map((s) => s.trim()).filter(Boolean);
const POSES = arg('--poses', '951x669@0.84.34.0,466x678@0.84.34.0,678x466@0.0.34.84,440x956@59.0.117.0,669x951@106.0.117.0').split(',').map((s) => {
  const [size, ins] = s.split('@');
  const [w, h] = size.split('x').map(Number);
  const insets = (ins ?? '0.0.0.0').split('.').map(Number);
  return { width: w, height: h, insets: { top: insets[0], right: insets[1], bottom: insets[2], left: insets[3] } };
});
const INTERACT = !flag('--no-interact');
const UA = `Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnrosedHost/1 (iOS; ${DEVICE})`;
const QUIET_MS = 1200;
const LOAD_TIMEOUT_MS = 20000;

const poseTag = (p) => `${p.width}x${p.height}-in${p.insets.top}-${p.insets.right}-${p.insets.bottom}-${p.insets.left}`;
const slug = (route) => route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '') || 'root';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

/* The stub of BridgeScript.js and the WebKit handlers (the contract's hostGlobal). */
const STUB = `(() => {
  const log = window.__hostLog = [];
  const handlers = Object.create(null);
  const queue = [];
  const host = window.enrosedHost = {
    version: 1, platform: 'ios', device: ${JSON.stringify(DEVICE)},
    receive(json) {
      const command = typeof json === 'string' ? JSON.parse(json) : json;
      const handler = handlers[command.type];
      if (handler) handler(command); else queue.push(command);
    },
    on(type, fn) { handlers[type] = fn; },
    ready() { window.__hostReady = (window.__hostReady || 0) + 1; for (const command of queue.splice(0)) host.receive(command); },
  };
  window.__hostAskReplies = [];
  window.webkit = { messageHandlers: {
    enrosed: { postMessage(message) { log.push(JSON.parse(message)); } },
    enrosedAsk: { postMessage(message) {
      const question = JSON.parse(message);
      log.push(question);
      const reply = window.__hostAskReplies.shift() ?? (question.type === 'confirm' ? { ok: false } : { value: null });
      return Promise.resolve(reply);
    } },
  } };
})();`;

/* ---------- a small JSON Schema validator (what the contract uses) ---------- */
function resolveRef(ref, root) {
  if (ref === '#') return root;
  const parts = ref.replace(/^#\//, '').split('/');
  let node = root;
  for (const part of parts) node = node?.[part];
  if (!node) throw new Error('unresolved $ref ' + ref);
  return node;
}
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}
function validate(schema, value, root, at = '$') {
  const errors = [];
  if (schema.$ref) return validate(resolveRef(schema.$ref, root), value, root, at);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!allowed.includes(actual) && !(actual === 'integer' && allowed.includes('number'))) errors.push(`${at}: type ${actual}, expected ${allowed.join('|')}`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: ${JSON.stringify(value)} fails ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: ${value} below ${schema.minimum}`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${at}: missing ${key}`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) if (key in value) errors.push(...validate(sub, value[key], root, `${at}.${key}`));
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) errors.push(`${at}: unexpected ${key}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, root, `${at}[${i}]`)));
  }
  if (schema.oneOf) {
    const results = schema.oneOf.map((sub) => validate(sub, value, root, at));
    const passing = results.filter((r) => r.length === 0).length;
    if (passing !== 1) {
      /* The branch whose `type` constant matches explains best; else the shortest error list. */
      const typed = schema.oneOf.map((sub, i) => ({ sub: sub.$ref ? resolveRef(sub.$ref, root) : sub, i }))
        .find(({ sub }) => sub.properties?.type?.const !== undefined && sub.properties.type.const === value?.type);
      const best = typed ? results[typed.i] : results.slice().sort((a, b) => a.length - b.length)[0];
      errors.push(passing === 0 ? `${at}: matches none of the alternatives (${best.join('; ')})` : `${at}: matches ${passing} alternatives`);
    }
  }
  if (schema.anyOf && !schema.anyOf.some((sub) => validate(sub, value, root, at).length === 0)) errors.push(`${at}: matches no alternative`);
  return errors;
}
const validateMessage = (message) => validate({ $ref: '#' }, message, CONTRACT);

/* ---------- Chrome over CDP ---------- */
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'enrosed-host-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--disable-extensions', '--disable-background-networking', '--window-size=1000,1000', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d; });
const cleanup = () => {
  try { chrome.kill('SIGTERM'); } catch { /* gone */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function devtoolsEndpoint() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(file)) {
      const [port, wsPath] = fs.readFileSync(file, 'utf8').trim().split('\n');
      if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
    }
    if (chrome.exitCode !== null) throw new Error('Chrome exited early: ' + chromeErr);
    await sleep(100);
  }
  throw new Error('DevToolsActivePort never appeared: ' + chromeErr);
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
      } else if (msg.method) for (const h of this.handlers) h(msg.method, msg.params ?? {}, msg.sessionId);
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', (e) => reject(new Error('ws error ' + (e.message ?? ''))));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(handler) { this.handlers.push(handler); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp; this.sid = sessionId; this.entries = []; this.inflight = new Set(); this.lastNet = Date.now(); this.loadWaiters = [];
    cdp.on((method, params, sid) => {
      if (sid !== this.sid) return;
      switch (method) {
        case 'Runtime.consoleAPICalled':
          if (params.type === 'error' || params.type === 'warning') this.entries.push({ kind: 'console.' + params.type, text: params.args.map((a) => a.value ?? a.description ?? a.type).join(' ') });
          break;
        case 'Runtime.exceptionThrown': this.entries.push({ kind: 'exception', text: params.exceptionDetails.exception?.description ?? params.exceptionDetails.text }); break;
        case 'Network.requestWillBeSent': this.inflight.add(params.requestId); this.lastNet = Date.now(); break;
        case 'Network.loadingFinished': this.inflight.delete(params.requestId); this.lastNet = Date.now(); break;
        case 'Network.loadingFailed': this.inflight.delete(params.requestId); this.lastNet = Date.now(); if (!params.canceled) this.entries.push({ kind: 'network.failed', text: params.errorText }); break;
        case 'Network.responseReceived': if (params.response.status >= 400) this.entries.push({ kind: 'network.' + params.response.status, text: params.response.url }); break;
        case 'Page.loadEventFired': this.loadWaiters.splice(0).forEach((r) => r()); break;
        default: break;
      }
    });
  }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  }
  waitLoad(timeout) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('load timeout')), timeout);
      this.loadWaiters.push(() => { clearTimeout(t); resolve(); });
    });
  }
  async waitQuiet(quietMs, capMs) {
    const start = Date.now();
    while (Date.now() - start < capMs) {
      if (this.inflight.size === 0 && Date.now() - this.lastNet >= quietMs) return true;
      await sleep(100);
    }
    return false;
  }
  async pose({ width, height, insets }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true, screenWidth: width, screenHeight: height });
    await this.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await this.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  }
  async open(url) {
    this.entries = []; this.inflight.clear(); this.lastNet = Date.now();
    const load = this.waitLoad(LOAD_TIMEOUT_MS);
    await this.send('Page.navigate', { url });
    await load;
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const href = await this.eval('location.pathname');
      if (!href.startsWith('/__session')) break;
      await Promise.race([this.waitLoad(LOAD_TIMEOUT_MS).catch(() => {}), sleep(300)]);
    }
    const quiet = await this.waitQuiet(QUIET_MS, 10000);
    await sleep(QUIET_MS);
    await this.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    /* The bridge's fallback page waits 300 ms after a navigation; one more frame for its post. */
    await sleep(400);
    await this.eval('new Promise(r => requestAnimationFrame(r))');
    return quiet;
  }
  async settle(ms = 700) {
    await sleep(ms);
    await this.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  }
  metrics(insets) {
    return this.eval(`(() => {
      const view = { w: innerWidth, h: innerHeight };
      const ins = ${JSON.stringify(insets)};
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      const display = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : null; };
      const visibility = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).visibility : null; };
      const hidden = (sel) => { const el = document.querySelector(sel); if (!el) return true; const s = getComputedStyle(el); return s.display === 'none' || s.visibility === 'hidden'; };
      /* Content boxes: everything the page lays out must stay inside the insets (the strip, the home indicator's side). */
      const boxes = Array.from(document.querySelectorAll('.content, .ios-page, .mpo-phone, .appbar__large, .ios-large, .sheet, .toasts, .ios-toolbar, .sales-mobile-dock, .mpo-savebar, .login__card'))
        .filter((el) => el.getClientRects().length).map((el) => ({ sel: el.className.toString().split(' ')[0], ...rect(el) }));
      const over = boxes.filter((b) => b.w > 0 && (b.x + b.w > view.w - ins.right + 1 || b.x < ins.left - 1));
      const spacer = document.querySelector('.appbar, .ios-nav');
      return {
        title: document.title, path: location.pathname + location.search, host: document.documentElement.dataset.host ?? null,
        hostDevice: document.documentElement.dataset.hostDevice ?? null, ready: window.__hostReady ?? 0,
        innerWidth: view.w, innerHeight: view.h, overflowX: document.documentElement.scrollWidth > view.w,
        webChrome: {
          tabbar: visibility('.tabbar'), tabbarDisplay: display('.tabbar'), appbarActions: display('.appbar__actions'), appbarBack: display('.appbar__back'),
          iosTrail: display('.ios-nav__trail'), iosLead: display('.ios-nav__lead'), fab: display('.fab'), iosTabbar: display('.ios-tabbar'),
          accessory: display('.ios-accessory'), sheroBar: display('.shero-bar'), mpoDock: display('.mpo-dock'), productHeader: display('.product-mobile-header'),
          productDock: display('.product-editor-dock'), safePaint: display('.safe-paint'),
          allHidden: ['.tabbar', '.appbar__actions', '.appbar__back', '.ios-nav__trail', '.ios-nav__lead', '.fab', '.ios-tabbar', '.ios-accessory', '.shero-bar', '.mpo-dock', '.product-mobile-header', '.product-editor-dock', '.safe-paint'].every(hidden),
        },
        spacer: spacer ? { h: Math.round(spacer.getBoundingClientRect().height), top: Math.round(spacer.getBoundingClientRect().top) } : null,
        insetTop: ins.top, boxes, over,
        log: window.__hostLog ?? null,
      };
    })()`);
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

/* ---------- the run ---------- */
const report = [];
const summarise = (page) => page ? {
  title: page.title, subtitle: page.subtitle ?? null, source: page.source, tabBar: page.tabBar, largeTitle: page.largeTitle, condensed: page.condensed,
  depth: page.stack.length, back: page.back?.label ?? null, primary: page.primary?.label ?? null,
  actions: page.actions.map((a) => a.label), menu: page.menu.map((m) => m.separator ? '—' : m.label), accessory: page.accessory?.label ?? null,
  titleMenu: page.titleMenu?.length ?? 0, workspaceTabs: page.workspaceTabs?.map((t) => t.label) ?? null,
  guardsBack: !!page.guardsBack, refreshable: !!page.refreshable, chrome: page.chrome, statusBar: page.statusBar,
} : null;

(async () => {
  const browser = await Cdp.connect(await devtoolsEndpoint());
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(browser, sessionId);
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

  let first = true;
  for (const pose of POSES) {
    await page.pose(pose);
    for (const route of ROUTES) {
      const tag = poseTag(pose);
      const file = path.join(OUT, `${slug(route)}-${tag}.png`);
      const row = { route, pose: tag, file: path.basename(file), errors: [], contract: [], checks: {} };
      try {
        if (route.startsWith('/login')) {
          /* The login page is the one screen without a session: clear what the earlier routes planted, then load it bare. */
          await page.eval('try { localStorage.clear(); } catch {}').catch(() => undefined);
          row.quiet = await page.open(`${BASE}${route}`);
        } else {
          row.quiet = await page.open(`${BASE}/__session.html?to=${encodeURIComponent(route)}`);
        }
      } catch (e) { row.errors.push('load: ' + e.message); }
      await page.shot(file);
      const m = await page.metrics(pose.insets).catch((e) => ({ error: e.message, log: null }));
      row.path = m.path; row.host = m.host; row.hostDevice = m.hostDevice; row.ready = m.ready;
      const log = m.log ?? [];
      fs.writeFileSync(path.join(OUT, `${slug(route)}-${tag}.log.json`), JSON.stringify(log, null, 1));
      const pages = log.filter((msg) => msg.type === 'page');
      const last = pages[pages.length - 1] ?? null;
      row.messages = log.map((msg) => msg.type);
      row.page = summarise(last);
      row.pagesForUrl = pages.filter((p) => p.url === m.path).length;
      for (const msg of log) for (const err of validateMessage(msg)) row.contract.push(`${msg.type}: ${err}`);
      row.checks = {
        stubSeen: !!m.log, hostMarked: m.host === 'ios', ready: (m.ready ?? 0) >= 1, readyMessage: log.some((msg) => msg.type === 'ready'),
        pageForUrl: !!last && last.url === m.path, webChromeHidden: !!m.webChrome?.allHidden, contentClear: Array.isArray(m.over) && m.over.length === 0,
        spacerIsInset: !m.spacer || m.spacer.h === m.insetTop, noOverflowX: m.overflowX === false, noErrors: page.entries.filter((e) => e.kind === 'exception' || e.kind === 'console.error').length === 0,
      };
      row.webChrome = m.webChrome; row.over = m.over; row.spacer = m.spacer;
      row.console = page.entries.filter((e) => e.kind === 'exception' || e.kind === 'console.error').map((e) => e.text.slice(0, 200));
      console.log(`[host] ${tag.padEnd(26)} ${route.padEnd(22)} ${m.path?.padEnd(24) ?? '?'} page=${row.page ? `${row.page.source} "${row.page.title}" tab=${row.page.tabBar} depth=${row.page.depth} primary=${row.page.primary ?? '-'} actions=${row.page.actions.length} menu=${row.page.menu.length}` : 'NONE'} | chrome=${row.checks.webChromeHidden ? 'hidden' : 'VISIBLE'} clear=${row.checks.contentClear ? 'y' : 'OVER ' + JSON.stringify(m.over?.slice(0, 2))} spacer=${m.spacer?.h}/${m.insetTop} contract=${row.contract.length ? row.contract.length + ' ERR' : 'ok'} console=${row.console.length}`);
      report.push(row);

      /* Commands, on the first pose only: a title-menu row pushes, back pops, tabRoot and refresh answer. */
      if (INTERACT && first && route === '/sales' && last) {
        const inter = { route, pose: tag, steps: [] };
        const rowId = last.titleMenu?.find((r) => r.url === '/customers')?.id ?? 'nav:/customers';
        await page.eval(`window.__hostLog.length = 0; window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'action', id: rowId }))})`);
        await page.settle();
        let m2 = await page.metrics(pose.insets);
        let p2 = (m2.log ?? []).filter((x) => x.type === 'page').pop();
        inter.steps.push({ step: 'action ' + rowId, path: m2.path, depth: p2?.stack.length ?? null, back: p2?.back?.label ?? null, willChange: (m2.log ?? []).filter((x) => x.type === 'nav.willChange').map((x) => x.direction + ' ' + x.to), ok: m2.path === '/customers' && p2?.stack.length === 2 });
        await page.eval(`window.__hostLog.length = 0; window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'back', count: 1 }))})`);
        await page.settle();
        m2 = await page.metrics(pose.insets);
        p2 = (m2.log ?? []).filter((x) => x.type === 'page').pop();
        inter.steps.push({ step: 'back 1', path: m2.path, depth: p2?.stack.length ?? null, willChange: (m2.log ?? []).filter((x) => x.type === 'nav.willChange').map((x) => x.direction + ' ' + x.to), ok: m2.path === '/sales' && p2?.stack.length === 1 });
        await page.eval(`window.__hostLog.length = 0; window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'open', url: '/sales/1', nav: 'push' }))})`);
        await page.settle(1200);
        m2 = await page.metrics(pose.insets);
        p2 = (m2.log ?? []).filter((x) => x.type === 'page').pop();
        inter.steps.push({ step: 'open /sales/1 push', path: m2.path, depth: p2?.stack.length ?? null, title: p2?.title ?? null, source: p2?.source ?? null, ok: m2.path === '/sales/1' && p2?.stack.length === 2 });
        await page.eval(`window.__hostLog.length = 0; window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'back' }))})`);
        await page.settle();
        m2 = await page.metrics(pose.insets);
        inter.steps.push({ step: 'back', path: m2.path, ok: m2.path === '/sales' });
        await page.eval(`window.__hostLog.length = 0; window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'tabRoot' }))}); window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'refresh' }))})`);
        await page.settle(1500);
        m2 = await page.metrics(pose.insets);
        inter.steps.push({ step: 'tabRoot + refresh', types: (m2.log ?? []).map((x) => x.type), ok: (m2.log ?? []).some((x) => x.type === 'refreshDone') });
        await page.eval(`window.__hostLog.length = 0; window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'insets', top: 0, right: 84, bottom: 34, left: 0 }))}); window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'sessionCheck' }))}); window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'lifecycle', state: 'active' }))})`);
        await page.settle(600);
        m2 = await page.metrics(pose.insets);
        inter.steps.push({ step: 'insets + sessionCheck + lifecycle', hostSafeR: await page.eval('document.documentElement.style.getPropertyValue("--host-safe-r")'), path: m2.path, ok: m2.path === '/sales' });
        fs.writeFileSync(path.join(OUT, 'interact-sales.json'), JSON.stringify(inter, null, 1));
        for (const s of inter.steps) console.log(`[host]   ${s.ok ? 'ok ' : 'FAIL'} ${s.step}: ${JSON.stringify({ ...s, step: undefined, ok: undefined })}`);
        report.push({ route: '/sales (interaction)', pose: tag, interaction: inter, errors: inter.steps.filter((s) => !s.ok).map((s) => s.step), contract: [], checks: { interactions: inter.steps.every((s) => s.ok) } });
      }
      if (INTERACT && first && route === '/dashboard' && last) {
        const inter = { route, pose: tag, steps: [] };
        const addId = last.accessory?.id;
        if (addId) {
          await page.eval(`window.__hostLog.length = 0; window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'action', id: addId }))})`);
          await page.settle();
          const m2 = await page.metrics(pose.insets);
          const sheet = await page.eval('!!document.querySelector(".overlay .sheet")');
          await page.shot(path.join(OUT, `dashboard-sheet-${tag}.png`));
          inter.steps.push({ step: 'action ' + addId + ' (Toevoegen sheet)', sheet, types: (m2.log ?? []).map((x) => x.type), overlayOpen: (m2.log ?? []).some((x) => x.type === 'overlay' && x.open === true), lastPageOverlay: (m2.log ?? []).filter((x) => x.type === 'page').pop()?.overlay ?? null, ok: sheet && (m2.log ?? []).some((x) => x.type === 'overlay' && x.open === true) });
          await page.eval('document.querySelector(".sheet__close")?.click()');
          await page.settle();
          const m3 = await page.metrics(pose.insets);
          inter.steps.push({ step: 'close sheet', overlayClosed: (m3.log ?? []).some((x) => x.type === 'overlay' && x.open === false), ok: (m3.log ?? []).some((x) => x.type === 'overlay' && x.open === false) });
        }
        /* Ui.confirm through the ask channel (the development build exposes ng.getComponent): the reply "secondary" lands
           in the second callback and no web sheet renders; the rich message arrives as plain text. */
        await page.eval(`window.__hostLog.length = 0; window.__hostAskReplies.push({ ok: false, secondary: true });`);
        const confirmed = await page.eval(`(async () => {
          const host = document.querySelector('app-ui-host');
          if (!window.ng || !host) return { answer: 'no debug api' };
          const ui = window.ng.getComponent(host).ui;
          const answer = await new Promise((resolve) => ui.confirm(
            { title: 'Niet-opgeslagen wijzigingen', message: '<b>Proef</b><br>regel twee', confirmLabel: 'Opslaan', secondaryLabel: 'Niet opslaan' },
            () => resolve('confirm'), () => resolve('secondary'), () => resolve('cancel')));
          await new Promise((r) => setTimeout(r, 200));
          return { answer, sheet: !!document.querySelector('.overlay .sheet') };
        })()`).catch((e) => ({ answer: 'eval ' + e.message }));
        const askMsg = (await page.eval('window.__hostLog')).find((x) => x.type === 'confirm');
        inter.steps.push({ step: 'Ui.confirm through enrosedAsk', ...confirmed, ask: askMsg ?? null, ok: confirmed.answer === 'secondary' && confirmed.sheet === false && !!askMsg && askMsg.message === 'Proef\nregel twee' && askMsg.secondary === 'Niet opslaan' });
        fs.writeFileSync(path.join(OUT, 'interact-dashboard.json'), JSON.stringify(inter, null, 1));
        for (const s of inter.steps) console.log(`[host]   ${s.ok ? 'ok ' : 'FAIL'} ${s.step}: ${JSON.stringify({ ...s, step: undefined, ok: undefined })}`);
        report.push({ route: '/dashboard (interaction)', pose: tag, interaction: inter, errors: inter.steps.filter((s) => !s.ok).map((s) => s.step), contract: [], checks: { interactions: inter.steps.every((s) => s.ok) } });
      }
      if (INTERACT && first && route === '/products/new' && last) {
        /* The leave question through enrosedAsk: a dirty editor, a native back, the reply "Niet opslaan" (secondary) lets it go. */
        const inter = { route, pose: tag, steps: [] };
        const typed = await page.eval(`(() => {
          const field = document.querySelector('input[type="text"]:not([disabled]), input:not([type]):not([disabled])');
          if (!field) return null;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(field, 'Hostproef roos'); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
          return field.getAttribute('aria-label') || field.id || field.name || 'input';
        })()`);
        await page.settle();
        let m2 = await page.metrics(pose.insets);
        let p2 = (m2.log ?? []).filter((x) => x.type === 'page').pop();
        inter.steps.push({ step: 'type into ' + typed, guardsBack: p2?.guardsBack ?? null, primary: p2?.primary ?? null, ok: !!typed && p2?.guardsBack === true && p2?.primary?.disabled !== true });
        /* The product editor asks its own leave question (a web sheet): the native back must open it, not leave. */
        await page.eval(`window.__hostLog.length = 0; window.enrosedHost.receive(${JSON.stringify(JSON.stringify({ type: 'back' }))})`);
        await page.settle(1200);
        m2 = await page.metrics(pose.insets);
        const leaveSheet = await page.eval('!!document.querySelector(".overlay .sheet")');
        await page.shot(path.join(OUT, `products-new-leave-${tag}.png`));
        inter.steps.push({ step: 'back on a dirty editor', path: m2.path, leaveSheet, overlayOpen: (m2.log ?? []).some((x) => x.type === 'overlay' && x.open === true), ok: leaveSheet && m2.path === '/products/new' && (m2.log ?? []).some((x) => x.type === 'overlay' && x.open === true) });
        fs.writeFileSync(path.join(OUT, 'interact-product-new.json'), JSON.stringify(inter, null, 1));
        for (const s of inter.steps) console.log(`[host]   ${s.ok ? 'ok ' : 'FAIL'} ${s.step}: ${JSON.stringify({ ...s, step: undefined, ok: undefined })}`);
        report.push({ route: '/products/new (interaction)', pose: tag, interaction: inter, errors: inter.steps.filter((s) => !s.ok).map((s) => s.step), contract: [], checks: { interactions: inter.steps.every((s) => s.ok) } });
      }
    }
    first = false;
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const md = ['| route | pose | final path | source | title | tabBar | depth | primary | actions | menu | chrome hidden | content clear | spacer | contract | console |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.filter((r) => !r.interaction).map((r) => `| ${r.route} | ${r.pose} | ${r.path ?? '?'} | ${r.page?.source ?? '-'} | ${r.page?.title ?? '-'} | ${r.page?.tabBar ?? '-'} | ${r.page?.depth ?? '-'} | ${r.page?.primary ?? '-'} | ${r.page?.actions.join(', ') ?? '-'} | ${r.page?.menu.join(', ') ?? '-'} | ${r.checks.webChromeHidden ? 'yes' : 'NO'} | ${r.checks.contentClear ? 'yes' : 'NO'} | ${r.spacer?.h ?? '-'}/${r.page ? '' : ''}${r.checks.spacerIsInset ? 'ok' : 'NO'} | ${r.contract.length ? r.contract.length + ' errors' : 'ok'} | ${r.console.length} |`)];
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
  const failing = report.filter((r) => r.contract.length || Object.values(r.checks).some((v) => v === false) || r.errors.length);
  console.log(`[host] ${report.length} rows in ${OUT}; ${failing.length} with a failed check`);
  for (const r of failing) console.log(`[host]   ${r.route} ${r.pose}: ${Object.entries(r.checks).filter(([, v]) => v === false).map(([k]) => k).join(', ')} ${r.contract.slice(0, 3).join(' | ')} ${r.errors.join(' | ')}`);
  browser.close();
  cleanup();
  process.exit(0);
})().catch((e) => { console.error('[host] failed:', e); cleanup(); process.exit(1); });
