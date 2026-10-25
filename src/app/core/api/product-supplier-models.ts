/**
 * One product, several suppliers (2026-10-25): product_supplier rows as the screens read them.
 * Shared by the product side and the purchase/supplier side; types only.
 */
import type { Currency, Product, PurchaseOrder } from './models';

/** What one supplier asks for one product; on GET /api/products?supplierId=X as Product.offer. */
export interface ProductSupplierOffer {
  /** Null for a product without a row of this supplier yet (offered by its own supplier at its own price). */
  id: number | null;
  supplierId: number;
  /** The product's Voorkeur: the row its product card mirrors. */
  preferred: boolean;
  /** Inactive: kept for history, never offered on a new purchase line. */
  active: boolean;
  versionLabel: string | null;
  supplierReference: string | null;
  exwPrice: number | null;
  exwCurrency: Currency | null;
  extraUnitCost: number | null;
  moq: number | null;
  leadTimeDays: number | null;
}

export interface ProductSupplierLastOrder {
  orderId: number;
  number: string;
  /** Herkenbare naam, else the number. */
  name: string;
  orderDate: string | null;
  status: PurchaseOrder['status'];
  exwPrice: number | null;
  exwCurrency: Currency | null;
}

export interface ProductSupplierLastCost {
  unitEur: number;
  appliedAt: string;
  orderNumber: string | null;
}

/** GET /api/products/{id}/suppliers: preferred first, then active, then by supplier name. */
export interface ProductSupplierRow extends ProductSupplierOffer {
  id: number;
  productId: number;
  supplierName: string;
  supplierCity: string | null;
  supplierCurrency: Currency | null;
  supplierIncoterm: string | null;
  supplierLeadTimeDays: number | null;
  supplierNote: string | null;
  photoCount: number;
  lastOrder: ProductSupplierLastOrder | null;
  lastCost: ProductSupplierLastCost | null;
  /** Purchase lines naming this row, trashed containers included; above 0 it can no longer be deleted. */
  purchaseLineCount: number;
  updatedAt: string;
}

/** POST / PUT body of a row. */
export interface ProductSupplierWrite {
  /** POST only. */
  supplierId?: number;
  versionLabel: string | null;
  supplierReference: string | null;
  exwPrice: number | null;
  exwCurrency: Currency | null;
  extraUnitCost: number | null;
  moq: number | null;
  leadTimeDays: number | null;
  /** Omitted or null keeps the note; '' clears it. */
  supplierNote?: string | null;
  /** PUT: the row's updatedAt as loaded; another value is refused (409). */
  updatedAt?: string | null;
}

/** PUT …/suppliers/{rowId}/note: only the agreement note of one row ('' clears). */
export interface ProductSupplierNoteWrite {
  supplierNote: string;
  updatedAt: string | null;
}

/** The product's own supplier and purchase columns: a server-kept copy of the preferred row. */
export interface ProductPurchaseMirror {
  supplierId: number | null;
  supplierNote: string | null;
  exwPrice: number | null;
  exwCurrency: Currency | null;
  extraUnitCost: number | null;
}

/** The four purchase fields of a product PUT; null means "keep" on an existing product. */
export interface ProductPurchaseFieldsPut {
  supplierId: number | null;
  exwPrice: number | null;
  exwCurrency: Currency | null;
  extraUnitCost: number | null;
}

/** The product PUT body: a Product whose four purchase fields may be null. */
export type ProductPutBody = Omit<Product, keyof ProductPurchaseFieldsPut> & ProductPurchaseFieldsPut;

/** Every row mutation answers with the rows and the product's mirror after it. */
export interface ProductSupplierChange {
  rows: ProductSupplierRow[];
  product: ProductPurchaseMirror;
}

/** GET /api/suppliers/{id}/products. */
export interface SupplierProductRow {
  rowId: number;
  productId: number;
  sku: string | null;
  name: string;
  colour: string | null;
  variantSize: string | null;
  /** Small rendition of the product's first photo; null without photos. */
  photoUrl: string | null;
  productActive: boolean;
  /** This supplier is the product's Voorkeur. */
  preferred: boolean;
  active: boolean;
  versionLabel: string | null;
  supplierReference: string | null;
  exwPrice: number | null;
  exwCurrency: Currency | null;
  lastOrder: Pick<ProductSupplierLastOrder, 'orderId' | 'number' | 'orderDate'> | null;
}

/** ReceiptIssue gained its container's supplier (models.ts owns the field; this keeps the product side compiling alone). */
export interface ReceiptIssueSupplierPart {
  supplierId?: number | null;
}
