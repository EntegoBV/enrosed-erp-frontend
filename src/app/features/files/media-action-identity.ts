/** Identity captured when an asynchronous media-detail mutation starts. */
export interface MediaDetailActionIdentity {
  assetId: number;
  detailRequestId: number;
  actionId: number;
}

/**
 * A late response may update the open sheet only when it still belongs to the
 * same asset, the same detail load and the latest mutation on that sheet.
 */
export function isCurrentMediaDetailAction(
  expected: MediaDetailActionIdentity,
  current: MediaDetailActionIdentity | null,
): boolean {
  return current !== null
    && current.assetId === expected.assetId
    && current.detailRequestId === expected.detailRequestId
    && current.actionId === expected.actionId;
}
