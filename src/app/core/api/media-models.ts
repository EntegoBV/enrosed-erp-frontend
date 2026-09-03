/** One canonical library for every reusable file in the ERP. */
export type MediaKind = 'IMAGE' | 'DOCUMENT';

/** The document context in which a linked file may be used. */
export type MediaRole = 'CATALOGUE' | 'QUOTE' | 'INVOICE' | 'INTERNAL';

/** Business records that can reuse a library asset without copying its bytes. */
export type MediaTargetType =
  | 'PRODUCT'
  | 'PRODUCT_FAMILY'
  | 'PURCHASE_ORDER'
  | 'PLANNER_ITEM';

export interface MediaAssetLink {
  id: number;
  targetType: MediaTargetType;
  targetId: number;
  /** Kept nullable while older attachments are adopted by the media library. */
  targetLabel: string | null;
  role: MediaRole;
  /** Renderers use the one primary link for a target and document role. */
  primary: boolean;
  /** Optional historical pin; null follows the current asset version. */
  pinnedVersionId: number | null;
  createdAt: string;
  createdBy: string | null;
}

export interface MediaAssetVersion {
  id: number;
  versionNumber: number;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  createdAt: string;
  createdBy: string | null;
}

/** Compact list result. Large version history is only returned by the detail endpoint. */
export interface MediaAssetSummary {
  id: number;
  name: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  kind: MediaKind;
  widthPx: number | null;
  heightPx: number | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  currentVersionId: number;
  roles: MediaRole[];
  links: MediaAssetLink[];
  versionCount: number;
  /** The folder the library shows the file in; null is the root. */
  folderId: number | null;
  /** The live public link, when one exists. */
  share: MediaShare | null;
}

export interface MediaShare {
  token: string;
  createdAt: string;
  createdBy: string | null;
  downloads: number;
}

export interface MediaFolder {
  id: number;
  name: string;
  parentId: number | null;
  assetCount: number;
}

export interface MediaAssetDetail extends MediaAssetSummary {
  versions: MediaAssetVersion[];
}

export interface MediaAssetFilters {
  q?: string;
  kind?: MediaKind;
  role?: MediaRole;
  archived?: boolean;
  includeArchived?: boolean;
  targetType?: MediaTargetType;
  targetId?: number;
  offset?: number;
  limit?: number;
  /** A folder id narrows to that folder, 'root' to files outside every folder. */
  folder?: number | 'root';
}

export interface MediaUploadResult {
  asset: MediaAssetDetail;
  /** True means the server reused the bytes of an existing SHA-256 match. */
  reused: boolean;
}

export interface MediaLinkWrite {
  targetType: MediaTargetType;
  targetId: number;
  role: MediaRole;
}
