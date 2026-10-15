/*
 * Where CashChart's labels go (the Kaslijn, the Kasprognose, a container's lane). Pure, no Angular, so the node
 * tests can pin it down.
 *
 * A label never covers another label, a marker's dot, a break-even flag or any drawn line: every series (solid,
 * dashed or dotted, each piece of a broken or clipped one), the buffer, today's vertical line and the lane's zero.
 * Each label first tries its own spots (most natural first); when none of them is free it takes the free place on
 * the plot nearest its point; when the plot has no free place at all it stays off the drawing (null) and the chart
 * lists it under the plot, so its words and figure are never lost.
 */

export interface Point { x: number; y: number; }
export interface Box { x1: number; x2: number; y1: number; y2: number; }
export type Anchor = 'start' | 'middle' | 'end';
/** A place for a label: its anchor and baseline, and how much less natural it is than the first choice. */
export interface Spot { anchor: Anchor; x: number; y: number; cost: number; }
export type MarkerKind = 'lowest' | 'zero' | 'end' | 'breakeven';
export interface PlacedLabel { anchor: Anchor; x: number; y: number; }

export interface LabelScene {
  /** The plot in px: labels stay between left and right, at least 2 px from the top and above bottom. */
  left: number; right: number; top: number; bottom: number;
  /** Every drawn line, points left to right: each piece of each series (any dash) and the lane's zero. */
  lines: Point[][];
  /** Today's vertical line (drawn from top − 6 to bottom) and its label beside its top. */
  today: { x: number; label: string; width: number } | null;
  /** The points worth a label, with their dot (or flag) and their label's width. */
  markers: { kind: MarkerKind; x: number; y: number; label: string; width: number }[];
  /** The buffer's horizontal line and its label. */
  buffer: { y: number; label: string; width: number } | null;
}
export interface LabelPlan { today: PlacedLabel | null; markers: (PlacedLabel | null)[]; buffer: PlacedLabel | null; }

/** The box a 10 px label covers around its baseline (the font's ascent 10 and descent 2, plus a pixel); the width includes the halo. */
export function textBox(anchor: Anchor, x: number, y: number, width: number): Box {
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { x1, x2: x1 + width, y1: y - 10, y2: y + 3 };
}
export const grow = (box: Box, by: number): Box => ({ x1: box.x1 - by, x2: box.x2 + by, y1: box.y1 - by, y2: box.y2 + by });
export const overlaps = (a: Box, b: Box): boolean => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
/** The distance between two boxes (0 when they touch). */
export const gap = (a: Box, b: Box): number => Math.hypot(Math.max(0, a.x1 - b.x2, b.x1 - a.x2), Math.max(0, a.y1 - b.y2, b.y1 - a.y2));

/** Whether a drawn line (points left to right, in px; a vertical one too) passes through the box. */
export function crosses(points: readonly Point[], box: Box): boolean {
  if (points.length === 1) return overlaps({ x1: points[0].x - 1, x2: points[0].x + 1, y1: points[0].y - 1, y2: points[0].y + 1 }, box);
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index];
    const b = points[index + 1];
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    if (hi < box.x1 || lo > box.x2) continue;
    let ya = a.y;
    let yb = b.y;
    if (b.x !== a.x) {
      const at = (px: number) => a.y + ((b.y - a.y) * (px - a.x)) / (b.x - a.x);
      ya = at(Math.max(lo, box.x1));
      yb = at(Math.min(hi, box.x2));
    }
    if (Math.max(ya, yb) >= box.y1 && Math.min(ya, yb) <= box.y2) return true;
  }
  return false;
}

/** A marker's dot (r 4 plus its ring) or a break-even flag (its pole and cloth). */
export function markBox(kind: MarkerKind, x: number, y: number): Box {
  return kind === 'breakeven' ? { x1: x - 2, x2: x + 10, y1: y - 20, y2: y + 2 } : { x1: x - 5, x2: x + 5, y1: y - 5, y2: y + 5 };
}

/**
 * Where a marker's label may go, most natural first: under a low point (lowest, zero), above or below and to the
 * left of an end point, to the right of a break-even flag; then beside the point and further away, a line at a time.
 */
export function markerSpots(kind: MarkerKind, mx: number, my: number): Spot[] {
  const spots: Spot[] = [];
  if (kind === 'breakeven') {
    spots.push({ anchor: 'start', x: mx + 11, y: my - 11, cost: 0 }, { anchor: 'end', x: mx - 4, y: my - 24, cost: 2 },
      { anchor: 'start', x: mx + 6, y: my + 17, cost: 8 }, { anchor: 'end', x: mx - 6, y: my + 17, cost: 9 });
    for (let step = 1; step <= 3; step++) {
      spots.push({ anchor: 'start', x: mx + 11, y: my - 11 - 12 * step, cost: 12 * step }, { anchor: 'end', x: mx - 4, y: my - 24 - 12 * step, cost: 2 + 12 * step });
    }
    return spots;
  }
  const lowFirst = kind !== 'end';
  for (let step = 0; step <= 6; step++) {
    const below = my + 17 + 12 * step;
    const above = my - 9 - 12 * step;
    const far = 12 * step;
    const belowCost = far + (lowFirst ? 0 : 4);
    const aboveCost = far + (lowFirst ? 8 : 0);
    if (kind !== 'end') {
      for (const shift of [0, -20, 20, -40, 40, -60, 60, -80, 80]) {
        spots.push({ anchor: 'middle', x: mx + shift, y: below, cost: belowCost + Math.abs(shift) / 8 }, { anchor: 'middle', x: mx + shift, y: above, cost: aboveCost + Math.abs(shift) / 8 });
      }
    }
    spots.push({ anchor: 'end', x: mx - 6, y: below, cost: belowCost + 3 }, { anchor: 'end', x: mx - 6, y: above, cost: aboveCost + 3 });
    if (kind !== 'end') spots.push({ anchor: 'start', x: mx + 6, y: below, cost: belowCost + 3 }, { anchor: 'start', x: mx + 6, y: above, cost: aboveCost + 3 });
  }
  spots.push({ anchor: 'end', x: mx - 9, y: my + 3.5, cost: 5 });
  if (kind !== 'end') spots.push({ anchor: 'start', x: mx + 9, y: my + 3.5, cost: 5 });
  return spots;
}

/** The buffer's label along its line, every 4 px: just above it first, from the left; then just below; then a line further away. */
export function bufferSpots(left: number, right: number, by: number, width: number): Spot[] {
  const spots: Spot[] = [];
  const span = Math.max(1, right - left);
  for (let x = left + 6; x + width <= right - 6 + 0.5; x += 4) {
    const along = ((x - left) / span) * 16;
    spots.push({ anchor: 'start', x, y: by - 6, cost: along }, { anchor: 'start', x, y: by + 13, cost: 3 + along },
      { anchor: 'start', x, y: by - 18, cost: 20 + along }, { anchor: 'start', x, y: by + 25, cost: 23 + along });
  }
  return spots;
}

/** Today's label beside the top of its line: on its right, else on its left; then lower down along the line. */
export function todaySpots(tx: number, top: number): Spot[] {
  const spots: Spot[] = [];
  for (let step = 0; step <= 4; step++) {
    spots.push({ anchor: 'start', x: tx + 5, y: top + 2 + 12 * step, cost: 10 * step }, { anchor: 'end', x: tx - 5, y: top + 2 + 12 * step, cost: 10 * step + 2 });
  }
  return spots;
}

interface Drawn { points: readonly Point[]; box: Box; }
const drawn = (points: readonly Point[]): Drawn => ({
  points,
  box: { x1: Math.min(...points.map((p) => p.x)), x2: Math.max(...points.map((p) => p.x)), y1: Math.min(...points.map((p) => p.y)), y2: Math.max(...points.map((p) => p.y)) },
});
/** Inclusive: a line's bounds may be flat (a horizontal or vertical rule). */
const touches = (a: Box, b: Box): boolean => a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;

/**
 * Today's label first, then the markers' (lowest, zero, end, break-even), then the buffer's; each on its first free
 * spot (cheapest, plus a penalty when it would sit closer to another marker than to its own), else on the free place
 * of the plot nearest its point, else null.
 */
export function planLabels(scene: LabelScene): LabelPlan {
  const { left, right, top, bottom } = scene;
  const lines = scene.lines.filter((line) => line.length > 0).map(drawn);
  if (scene.buffer) lines.push(drawn([{ x: left, y: scene.buffer.y }, { x: right, y: scene.buffer.y }]));
  if (scene.today) lines.push(drawn([{ x: scene.today.x, y: top - 6 }, { x: scene.today.x, y: bottom }]));
  const marks = scene.markers.map((marker) => markBox(marker.kind, marker.x, marker.y));
  const taken: Box[] = [...marks];

  const inside = (box: Box) => box.x1 >= left - 0.5 && box.x2 <= right + 0.5 && box.y1 >= 2 && box.y2 <= bottom - 1;
  const free = (box: Box) => {
    const near = grow(box, 1);
    const wide = grow(box, 2);
    return !taken.some((other) => overlaps(near, other)) && !lines.some((line) => touches(wide, line.box) && crosses(line.points, wide));
  };
  /* Anywhere on the plot, nearest the point first (only when none of a label's own spots is free). */
  const everywhere = (width: number, home: Point): Spot[] => {
    const spots: Spot[] = [];
    for (let y = 12; y <= bottom - 4; y += 3) {
      for (let x = left + width / 2; x <= right - width / 2; x += 5) {
        spots.push({ anchor: 'middle', x, y, cost: 100 + Math.hypot(x - home.x, y - 3.5 - home.y) });
      }
    }
    return spots;
  };
  const pick = (width: number, spots: Spot[], own: Box | null): { label: PlacedLabel; box: Box } | null => {
    let best: { label: PlacedLabel; box: Box; score: number } | null = null;
    for (const spot of spots) {
      let x = spot.x;
      if (spot.anchor === 'middle') x = Math.min(Math.max(x - width / 2, left + 2), right - 2 - width) + width / 2;
      const box = textBox(spot.anchor, x, spot.y, width);
      if (!inside(box)) continue;
      let score = spot.cost + Math.abs(x - spot.x) * 0.3;
      if (best && score >= best.score) continue;
      /* A label closer to another marker than to its own would name the wrong point. */
      if (own && marks.some((mark) => mark !== own && gap(box, mark) < gap(box, own))) score += 150;
      if ((best && score >= best.score) || !free(box)) continue;
      best = { label: { anchor: spot.anchor, x, y: spot.y }, box, score };
    }
    return best;
  };
  const place = (width: number, spots: Spot[], home: Point, own: Box | null): PlacedLabel | null => {
    const best = pick(width, spots, own) ?? pick(width, everywhere(width, home), own);
    if (!best) return null;
    taken.push(best.box);
    return best.label;
  };

  const today = scene.today ? place(scene.today.width, todaySpots(scene.today.x, top), { x: scene.today.x, y: top }, null) : null;
  const order: Record<MarkerKind, number> = { lowest: 0, zero: 1, end: 2, breakeven: 3 };
  const markers: (PlacedLabel | null)[] = scene.markers.map(() => null);
  scene.markers.map((marker, index) => ({ marker, index })).sort((a, b) => order[a.marker.kind] - order[b.marker.kind] || a.index - b.index)
    .forEach(({ marker, index }) => { markers[index] = place(marker.width, markerSpots(marker.kind, marker.x, marker.y), marker, marks[index]); });
  const buffer = scene.buffer ? place(scene.buffer.width, bufferSpots(left, right, scene.buffer.y, scene.buffer.width), { x: left, y: scene.buffer.y }, null) : null;
  return { today, markers, buffer };
}
