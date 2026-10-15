import assert from 'node:assert/strict';
import test from 'node:test';
import { planLabels } from '../src/app/shared/chart-labels.ts';
import type { LabelPlan, LabelScene, PlacedLabel, Point } from '../src/app/shared/chart-labels.ts';

/*
 * CashChart's labels (chart-labels.ts): a label never covers a line (each piece of every series, dashed ones too, the
 * buffer, today's vertical line), a dot, a flag or another label, for any data; one with no free place on the plot
 * is left off it (the chart lists it under the drawing).
 *
 * The check below is the browser probe's: the label's glyph box (the font's ascent 10 and descent 2 around the
 * baseline, its advance = the planned width less the 4 px halo) against every line sampled every half pixel, every
 * dot (r 4), every flag (pole and cloth) and every other label.
 */

type Named = [name: string, flat: number[]];
interface Fixture { scene: Omit<LabelScene, 'lines'>; lines: Named[]; }
const pointsOf = (flat: number[]): Point[] => Array.from({ length: flat.length / 2 }, (_, index) => ({ x: flat[2 * index], y: flat[2 * index + 1] }));
const sceneOf = (fixture: Fixture): LabelScene => ({ ...fixture.scene, lines: fixture.lines.map(([, flat]) => pointsOf(flat)) });

interface Box { x1: number; x2: number; y1: number; y2: number; }
function glyph(label: PlacedLabel, width: number): Box {
  const advance = width - 4;
  const x1 = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - advance : label.x - advance / 2;
  return { x1, x2: x1 + advance, y1: label.y - 10, y2: label.y + 2 };
}
function sampled(points: Point[]): Point[] {
  if (points.length === 1) return points;
  const out: Point[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index];
    const b = points[index + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let step = 0; step <= steps; step++) out.push({ x: a.x + ((b.x - a.x) * step) / steps, y: a.y + ((b.y - a.y) * step) / steps });
  }
  return out;
}
const inside = (box: Box, point: Point) => point.x >= box.x1 - 0.5 && point.x <= box.x2 + 0.5 && point.y >= box.y1 - 0.5 && point.y <= box.y2 + 0.5;
const meet = (a: Box, b: Box) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

/** Every way the plan breaks the rule, in words ("Buffer € 10.000 covers Verkoop 4 weken trager (dashed)"). */
function problems(scene: LabelScene, plan: LabelPlan, names: string[] = []): string[] {
  const lines: [string, Point[]][] = scene.lines.map((points, index) => [names[index] ?? `line ${index}`, sampled(points)]);
  if (scene.buffer) lines.push(['the buffer line', sampled([{ x: scene.left, y: scene.buffer.y }, { x: scene.right, y: scene.buffer.y }])]);
  if (scene.today) lines.push(['the Vandaag line', sampled([{ x: scene.today.x, y: scene.top - 6 }, { x: scene.today.x, y: scene.bottom }])]);
  for (const marker of scene.markers.filter((row) => row.kind === 'breakeven')) {
    lines.push([`the flag of ${marker.label}`, sampled([{ x: marker.x, y: marker.y }, { x: marker.x, y: marker.y - 18 }, { x: marker.x + 9, y: marker.y - 14.5 }, { x: marker.x, y: marker.y - 11 }])]);
  }
  const dots = scene.markers.filter((row) => row.kind !== 'breakeven').map((row) => ({ name: `the dot of ${row.label}`, box: { x1: row.x - 4, x2: row.x + 4, y1: row.y - 4, y2: row.y + 4 } }));
  const placed: { text: string; box: Box }[] = [];
  if (scene.today && plan.today) placed.push({ text: scene.today.label, box: glyph(plan.today, scene.today.width) });
  scene.markers.forEach((marker, index) => { const label = plan.markers[index]; if (label) placed.push({ text: marker.label, box: glyph(label, marker.width) }); });
  if (scene.buffer && plan.buffer) placed.push({ text: scene.buffer.label, box: glyph(plan.buffer, scene.buffer.width) });
  const found: string[] = [];
  for (const label of placed) {
    const { box } = label;
    if (box.x1 < scene.left - 0.5 || box.x2 > scene.right + 0.5 || box.y1 < 0 || box.y2 > scene.bottom) found.push(`${label.text} leaves the plot`);
    for (const [name, points] of lines) if (points.some((point) => inside(box, point))) found.push(`${label.text} covers ${name}`);
    for (const dot of dots) if (meet(box, dot.box)) found.push(`${label.text} covers ${dot.name}`);
    for (const other of placed) if (other !== label && meet(box, other.box)) found.push(`${label.text} covers ${other.text}`);
  }
  return found;
}
const allPlaced = (plan: LabelPlan) => plan.today !== null && plan.buffer !== null && plan.markers.every((label) => label !== null);

/*
 * The two scenes of the defect (work/bank-forecast 937321b, the mock's default reading of 90000), taken from the
 * drawn Kasprognose: its plot, today's line, the buffer, the markers and every drawn series as px points (straight
 * runs merged). The old placement put "Buffer € 10.000" over the dashed "Verkoop 4 weken trager" on the phone and
 * over the Vandaag line at 1100.
 */
const PHONE: Fixture = {
  scene: {"left":60,"right":326,"top":14,"bottom":188,"today":{"x":79,"label":"Vandaag","width":48},"buffer":{"y":111.44,"label":"Buffer € 10.000","width":86},"markers":[{"kind":"lowest","x":187.57,"y":127.36,"label":"Laagste − € 12.876","width":104},{"kind":"zero","x":155,"y":118.58,"label":"Onder nul · 10 dec","width":98}]},
  lines: [
    ["Wat vastligt (dashed)", [79,82.5,85.8,82.5,87.1,79.6,88.5,85.6,89.9,85.6,91.2,79.9,92.6,86.7,93.9,87,100.7,87,102.1,88,103.4,107.5,106.1,107.5,107.5,103.2,118.4,103.2,119.7,103.3,126.5,103.3,127.9,105.1,141.4,105.1,142.8,103.5,144.1,103.5,145.5,104,153.6,104,155,118.6,161.8,118.6,163.1,113.7,169.9,113.7,171.3,125.9,183.5,125.9,184.9,126.9,186.2,126.9,187.6,141.5,193,141.5,194.4,145.9,201.1,145.9,202.5,146,209.3,146,210.6,149.6,225.6,149.6,226.9,150.7,263.6,150.7,264.9,151.7,281.2,151.7,282.6,151.8,305.6,151.8,307,152.8,323.3,152.8,324.6,152.9,326,152.9]],
    ["Verkoop 4 weken trager (dashed)", [79,82.5,85.8,82.5,87.1,79.6,88.5,85.6,89.9,85.6,91.2,79.9,92.6,86.7,93.9,87,100.7,87,102.1,88,103.4,111.6,106.1,111.6,107.5,107.4,118.4,107.4,119.7,107.5,126.5,107.5,127.9,109.3,141.4,109.3,142.8,107.7,144.1,107.7,145.5,108.1,153.6,108.1,155,121.5,159.1,121.5,160.4,121.6,161.8,121.6,163.1,116.7,164.5,115.4,169.9,115.4,171.3,127.6,172.6,127.6,174,126.3,182.1,126.3,183.5,123.7,184.9,124.7,186.2,124.7,187.6,139.3,191.6,139.3,193,136.7,194.4,141.1,201.1,141.1,202.5,138.6,209.3,138.6,210.6,142.2,212,139.6,213.4,139.1,220.1,139.1,221.5,136,222.9,135.5,225.6,135.5,226.9,136.5,228.3,135,229.6,135,231,131.9,232.4,131.3,236.4,131.3,237.8,129.9,239.1,129.9,240.5,126.8,241.9,126.2,243.2,126.2,244.6,126.3,245.9,126.3,247.3,124.8,248.6,124.8,250,121.7,251.4,130.9,255.4,130.9,256.8,129.4,258.1,129.4,259.5,126.3,260.9,125.8,263.6,125.8,264.9,126.9,266.3,125.7,267.6,125.7,269,123.2,270.4,122.7,274.4,122.7,275.8,121.5,277.1,121.5,278.5,119,279.9,117.7,281.2,117.7,282.6,117.8,283.9,117.8,285.3,116.6,286.6,116.6,288,114.1,289.4,112.8,290.7,115.7,293.4,115.7,294.8,114.5,296.1,113.8,297.5,113.8,298.9,112.5,302.9,112.5,304.3,110.1,305.6,108.7,307,109.7,308.4,107.1,312.4,107.1,313.8,104.7,315.1,103.3,316.5,103.3,317.9,100.6,321.9,100.6,323.3,98.2,324.6,96.9,326,96.9]],
    ["Saldo tot vandaag", [60,37.4,64.1,37.4,65.4,45.9,66.8,55.7,68.1,55.7,69.5,58.4,70.9,55.8,73.6,55.8,74.9,57.2,76.3,68.3,77.6,67.3,79,82.6]],
    ["Saldo met scenario", [79,82.5,85.8,82.5,87.1,79.6,88.5,85.6,89.9,85.6,91.2,79.9,92.6,86.7,93.9,87,100.7,87,102.1,88,103.4,111.6,106.1,111.6,107.5,107.4,115.6,107.4,117,106.2,125.1,106.2,126.5,105,127.9,106.8,134.6,106.8,136,105.5,141.4,105.5,142.8,104,144.1,104,145.5,101.8,153.6,101.8,155,113.8,161.8,113.8,163.1,108.9,164.5,106.3,169.9,106.3,171.3,118.5,172.6,118.5,174,115.9,175.4,115.4,182.1,115.4,183.5,112.3,184.9,112.7,186.2,112.7,187.6,127.4,188.9,127.4,190.3,125.9,191.6,125.9,193,122.8,194.4,126.6,198.4,126.6,199.8,125.1,201.1,125.1,202.5,122.1,203.9,121.5,207.9,121.5,209.3,120.1,210.6,123.7,212,120.6,213.4,120.1,216.1,120.1,217.4,121.9,218.8,120.4,220.1,120.4,221.5,117.3,222.9,116.9,225.6,116.9,226.9,117.9,228.3,116.7,229.6,116.7,231,114.2,232.4,113.7,236.4,113.7,237.8,112.5,239.1,112.5,240.5,110.1,241.9,108.7,243.2,108.7,244.6,108.8,245.9,108.8,247.3,107.6,248.6,107.6,250,105.1,251.4,113.6,255.4,113.6,256.8,112.4,258.1,111.7,259.5,111.7,260.9,110.4,263.6,110.4,264.9,111.4,266.3,109,267.6,107.6,269,107.6,270.4,104.9,274.4,104.9,275.8,102.5,277.1,101.1,278.5,101.1,279.9,98.5,283.9,98.5,285.3,96.1,286.6,94.7,288,94.7,289.4,92.1,290.7,95,293.4,95,294.8,92.6,296.1,91.2,297.5,91.2,298.9,88.5,302.9,88.5,304.3,87.3,305.6,86.6,307,87.6,308.4,86.2,312.4,86.2,313.8,84.9,315.1,84.2,316.5,84.2,317.9,82.9,321.9,82.9,323.3,81.6,324.6,80.9,326,80.9]],
  ],
};
const DESK_1100: Fixture = {
  scene: {"left":60,"right":400,"top":18,"bottom":238,"today":{"x":123.75,"label":"Vandaag","width":48},"buffer":{"y":141.2,"label":"Buffer € 10.000","width":86},"markers":[{"kind":"lowest","x":245.18,"y":161.33,"label":"Laagste − € 12.876 · zo 3 jan","width":152},{"kind":"zero","x":208.75,"y":150.23,"label":"Zonder verkoop onder nul · do 10 dec","width":195},{"kind":"end","x":400,"y":102.64,"label":"€ 53.818","width":51},{"kind":"end","x":400,"y":193.57,"label":"− € 49.506 vastligt","width":101}]},
  lines: [
    ["Wat vastligt (dashed)", [123.8,104.6,131.3,104.6,132.9,100.9,134.4,108.5,135.9,108.5,137.4,101.3,138.9,110,140.4,110.2,148,110.2,149.6,111.5,151.1,136.2,154.1,136.2,155.6,130.8,167.8,130.8,169.3,130.9,176.9,130.9,178.4,133.2,193.6,133.2,195.1,131.2,196.6,131.2,198.1,131.7,207.2,131.7,208.8,150.2,213.3,150.2,214.8,150.3,216.3,150.3,217.9,144.1,225.4,144.1,227,159.5,240.6,159.5,242.1,160.8,243.7,160.8,245.2,179.3,251.3,179.3,252.8,184.8,260.4,184.8,261.9,184.9,269.5,184.9,271,189.5,287.7,189.5,289.2,190.8,307.4,190.8,308.9,190.9,330.2,190.9,331.7,192.1,349.9,192.1,351.4,192.2,377.2,192.2,378.8,193.5,397,193.5,398.5,193.6,400,193.6]],
    ["Verkoop 4 weken trager (dashed)", [123.8,104.6,131.3,104.6,132.9,100.9,134.4,108.5,135.9,108.5,137.4,101.3,138.9,110,140.4,110.2,148,110.2,149.6,111.5,151.1,141.4,154.1,141.4,155.6,136.1,167.8,136.1,169.3,136.2,176.9,136.2,178.4,138.5,193.6,138.5,195.1,136.5,196.6,136.5,198.1,137,207.2,137,208.8,153.9,213.3,153.9,214.8,154,216.3,154,217.9,147.8,219.4,146.2,225.4,146.2,227,161.6,228.5,161.6,230,160,239.1,160,240.6,156.7,242.1,158,243.7,158,245.2,176.5,249.7,176.5,251.3,173.2,252.8,178.7,260.4,178.7,261.9,175.5,269.5,175.5,271,180.1,272.5,176.8,274,176.2,281.6,176.2,283.1,172.3,284.6,171.6,287.7,171.6,289.2,172.8,290.7,171,292.2,171,293.8,167.1,295.3,166.4,299.8,166.4,301.3,164.5,302.9,164.5,304.4,160.6,305.9,159.9,310.4,159.9,312,158.1,313.5,158.1,315,154.2,316.5,165.8,321.1,165.8,322.6,163.9,324.1,163.9,325.6,160,327.1,159.4,330.2,159.4,331.7,160.7,333.2,159.2,334.7,159.2,336.3,156,337.8,155.4,342.3,155.4,343.8,153.9,345.4,153.9,346.9,150.8,348.4,149.1,349.9,149.1,351.4,149.2,352.9,149.2,354.5,147.7,356,147.7,357.5,144.6,359,142.9,360.5,146.6,363.6,146.6,365.1,145.1,366.6,144.2,368.1,144.2,369.6,142.6,374.2,142.6,375.7,139.5,377.2,137.8,378.8,139.1,380.3,135.7,384.8,135.7,386.3,132.6,387.9,130.9,389.4,130.9,390.9,127.5,395.4,127.5,397,124.5,398.5,122.8,400,122.8]],
    ["Saldo tot vandaag", [60,38.4,69.1,38.4,70.6,42.4,81.3,42.4,82.8,45.7,88.8,45.7,90.4,41.2,91.9,52.7,96.4,52.7,97.9,46.2,101,46.2,102.5,47.5,107.1,47.5,108.6,58.3,110.1,70.7,111.6,70.7,113.1,74.2,114.6,70.8,117.7,70.8,119.2,72.6,120.7,86.6,122.2,85.4,123.8,104.7]],
    ["Saldo met scenario", [123.8,104.6,131.3,104.6,132.9,100.9,134.4,108.5,135.9,108.5,137.4,101.3,138.9,110,140.4,110.2,148,110.2,149.6,111.5,151.1,141.4,154.1,141.4,155.6,136.1,164.7,136.1,166.3,134.5,167.8,134.5,169.3,134.6,175.4,134.6,176.9,133,178.4,135.3,186,135.3,187.5,133.7,193.6,133.7,195.1,131.7,196.6,131.7,198.1,129,207.2,129,208.8,144.1,213.3,144.1,214.8,144.2,216.3,144.2,217.9,138,219.4,134.7,225.4,134.7,227,150.1,228.5,150.1,230,146.8,231.5,146.2,239.1,146.2,240.6,142.3,242.1,142.9,243.7,142.9,245.2,161.3,246.7,161.3,248.2,159.5,249.7,159.5,251.3,155.6,252.8,160.4,257.3,160.4,258.8,158.5,260.4,158.5,261.9,154.7,263.4,154,267.9,154,269.5,152.1,271,156.7,272.5,152.8,274,152.1,277.1,152.1,278.6,154.4,280.1,152.5,281.6,152.5,283.1,148.7,284.6,148.1,287.7,148.1,289.2,149.3,290.7,147.8,292.2,147.8,293.8,144.7,295.3,144.1,299.8,144.1,301.3,142.6,302.9,142.6,304.4,139.4,305.9,137.8,307.4,137.8,308.9,137.9,310.4,137.9,312,136.4,313.5,136.4,315,133.2,316.5,143.9,321.1,143.9,322.6,142.4,324.1,141.5,325.6,141.5,327.1,139.9,330.2,139.9,331.7,141.1,333.2,138.1,334.7,136.3,336.3,136.3,337.8,133,342.3,133,343.8,129.9,345.4,128.2,346.9,128.2,348.4,124.8,349.9,124.8,351.4,124.9,352.9,124.9,354.5,121.8,356,120.1,357.5,120.1,359,116.7,360.5,120.4,363.6,120.4,365.1,117.3,366.6,115.6,368.1,115.6,369.6,112.2,374.2,112.2,375.7,110.6,377.2,109.7,378.8,111,380.3,109.3,384.8,109.3,386.3,107.7,387.9,106.8,389.4,106.8,390.9,105.1,395.4,105.1,397,103.5,398.5,102.6,400,102.6]],
  ],
};

test('phone (390): "Buffer € 10.000" stays off the dashed "Verkoop 4 weken trager" line, and every label is free', () => {
  const scene = sceneOf(PHONE);
  const names = PHONE.lines.map(([name]) => name);
  const old: LabelPlan = { today: null, markers: scene.markers.map(() => null), buffer: { anchor: 'start', x: 238, y: scene.buffer!.y + 13 } };
  assert.deepEqual(problems(scene, old, names), ['Buffer € 10.000 covers Verkoop 4 weken trager (dashed)'], 'the fixture reproduces the defect');
  const plan = planLabels(scene);
  assert.ok(allPlaced(plan), 'every label finds a place on the plot');
  assert.deepEqual(problems(scene, plan, names), []);
  assert.ok(Math.abs(plan.buffer!.y - scene.buffer!.y) <= 25, 'the buffer label stays beside its line');
});

test('desk at 1100: "Buffer € 10.000" stays off the Vandaag line, and every label is free', () => {
  const scene = sceneOf(DESK_1100);
  const names = DESK_1100.lines.map(([name]) => name);
  const old: LabelPlan = { today: null, markers: scene.markers.map(() => null), buffer: { anchor: 'start', x: scene.left + 6, y: scene.buffer!.y - 5 } };
  assert.deepEqual(problems(scene, old, names), ['Buffer € 10.000 covers the Vandaag line'], 'the fixture reproduces the defect');
  const plan = planLabels(scene);
  assert.ok(allPlaced(plan), 'every label finds a place on the plot');
  assert.deepEqual(problems(scene, plan, names), []);
  assert.ok(Math.abs(plan.buffer!.y - scene.buffer!.y) <= 25, 'the buffer label stays beside its line');
});

/** A small deterministic generator (mulberry32), so the "any data" run is the same every time. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('any data: 400 generated charts (phone to desk, 1 to 4 series with gaps, buffer, today, every marker kind) never get a label over a line, a dot, a flag or a label', () => {
  const next = random(20261015);
  const between = (low: number, high: number) => low + (high - low) * next();
  let labels = 0;
  let onPlot = 0;
  for (let run = 0; run < 400; run++) {
    const width = Math.round(between(300, 760));
    const left = Math.round(between(40, 64));
    const right = width - 12;
    const top = 18;
    const bottom = Math.round(between(110, 250));
    const days = Math.round(between(30, 200));
    const x = (day: number) => left + ((right - left) * day) / days;
    const series: Point[][] = [];
    for (let count = Math.ceil(between(0, 4)), index = 0; index < count; index++) {
      let y = between(top + 8, bottom - 8);
      const start = index === 0 ? 0 : Math.round(between(0, days / 2));
      let piece: Point[] = [];
      for (let day = start; day <= days; day++) {
        if (next() < 0.01 && piece.length) { series.push(piece); piece = []; continue; }
        y = Math.min(bottom - 4, Math.max(top + 4, y + (next() < 0.15 ? between(-40, 40) : between(-2, 2))));
        piece.push({ x: x(day), y });
      }
      if (piece.length) series.push(piece);
    }
    const all = series.flat();
    const markers: LabelScene['markers'] = [];
    const kinds = ['lowest', 'zero', 'end', 'breakeven'] as const;
    for (let count = Math.floor(between(0, 5)), index = 0; index < count && all.length; index++) {
      const point = all[Math.floor(between(0, all.length))];
      markers.push({ kind: kinds[Math.floor(between(0, 4))], x: point.x, y: point.y, label: `marker ${index}`, width: Math.round(between(40, 200)) });
    }
    const scene: LabelScene = {
      left, right, top, bottom, lines: series,
      today: next() < 0.85 ? { x: x(Math.round(between(0, days))), label: 'Vandaag', width: 48 } : null,
      markers,
      buffer: next() < 0.8 ? { y: between(top + 4, bottom - 4), label: 'Buffer € 10.000', width: 86 } : null,
    };
    const plan = planLabels(scene);
    assert.deepEqual(problems(scene, plan), [], `run ${run}`);
    const placed = [plan.today, plan.buffer, ...plan.markers];
    labels += (scene.today ? 1 : 0) + (scene.buffer ? 1 : 0) + markers.length;
    onPlot += placed.filter((label) => label !== null).length;
  }
  assert.ok(onPlot / labels > 0.95, `${onPlot} of ${labels} labels on the plot`);
});

test('a plot with no free place leaves the labels off it (null) rather than over a line', () => {
  const lines: Point[][] = [];
  for (let y = 4; y <= 200; y += 6) lines.push([{ x: 40, y }, { x: 400, y }]);
  const scene: LabelScene = { left: 40, right: 400, top: 18, bottom: 200, lines, today: { x: 120, label: 'Vandaag', width: 48 },
    markers: [{ kind: 'lowest', x: 200, y: 100, label: 'Laagste − € 12.876', width: 104 }], buffer: { y: 150, label: 'Buffer € 10.000', width: 86 } };
  const plan = planLabels(scene);
  assert.deepEqual(plan, { today: null, markers: [null], buffer: null });
});
