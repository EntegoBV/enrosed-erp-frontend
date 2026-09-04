/** Where a context menu opens: the pointer, unless the menu would then hang off the screen. */
export interface MenuPoint {
  x: number;
  y: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export function clampMenuPosition(
  anchor: MenuPoint,
  size: MenuSize,
  viewport: MenuSize,
  margin = 8,
): MenuPoint {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.round(Math.min(Math.max(margin, anchor.x), maxX)),
    y: Math.round(Math.min(Math.max(margin, anchor.y), maxY)),
  };
}
