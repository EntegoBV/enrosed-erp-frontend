export type ProductImagePublicationMenuPlacement = 'above' | 'below';

const PUBLICATION_MENU_ESTIMATED_HEIGHT_PX = 360;
const VIEWPORT_EDGE_GAP_PX = 12;

/**
 * Opens towards the side with useful viewport space when the full menu would
 * not fit below its trigger. The menu itself remains scrollable as a final
 * fallback for very short screens and large text settings.
 */
export function productImagePublicationMenuPlacement(
  triggerTop: number,
  triggerBottom: number,
  viewportHeight: number,
): ProductImagePublicationMenuPlacement {
  const spaceAbove = Math.max(0, triggerTop - VIEWPORT_EDGE_GAP_PX);
  const spaceBelow = Math.max(0, viewportHeight - triggerBottom - VIEWPORT_EDGE_GAP_PX);

  return spaceBelow < PUBLICATION_MENU_ESTIMATED_HEIGHT_PX && spaceAbove > spaceBelow
    ? 'above'
    : 'below';
}
