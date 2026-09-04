import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import {
  CatalogChannel, CatalogImportResult, Category, ContentTranslationCreate, ContentTranslationGroup, ContentTranslationOverview, ContentTranslationScope, ContentTranslationWrite, HsCode, LanguageCode, Product, ProductFamily, ProductFamilyIdentityFinalization, ProductPublicTranslationsSnapshot, ProductPublicTranslationsWrite, ProductSharedFieldsApplyRequest, ProductSharedFieldsApplyResult, ProductSupplierAgreementPhoto, PublicWebsiteLayout, WebsiteBuilderHomepage, WebsiteBuilderSection, WebsiteRebuildStatus, StockMovement, StockLocation, StockLevel, ProductStock,
  PhotoRole,
} from './models';

export type CatalogLayout = 'SIMPLE' | 'BROCHURE';

export interface CatalogBrochureOptions {
  includeOverview?: boolean;
  includeCategoryIntros?: boolean;
  includeCustomisation?: boolean;
  includeOrdering?: boolean;
  includeBackCover?: boolean;
  coverTitle?: string;
  coverSubtitle?: string;
}

export interface CatalogExportRequest {
  productIds: number[];
  includePrices: boolean;
  includePhotos: boolean;
  /** Refuse incomplete customer copy instead of silently mixing fallback languages. */
  strictLanguage: boolean;
  title: string;
  intro: string;
  language: LanguageCode;
  layout: CatalogLayout;
  photosPerProduct?: number;
  brochure?: CatalogBrochureOptions;
}

export interface CatalogPreflightResult {
  ready: boolean;
  missingPaths: string[];
}

export interface WebsiteVisibilityResult {
  family: ProductFamily;
  rebuildQueued: boolean;
  notice: string | null;
}

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);
  /**
   * Share only identical photo requests that are currently in flight. The
   * completed response is intentionally not cached, so replacing a photo on
   * the server can never leave a stale image for the lifetime of this app.
   */
  private readonly pendingPhotoBlobs = new Map<string, Promise<Blob>>();

  /* ---------------------------------------------------------- producten */

  products(supplierId?: number): Promise<Product[]> {
    const query = supplierId ? `?supplierId=${supplierId}` : '';
    return firstValueFrom(this.http.get<Product[]>(api('/api/products' + query)));
  }

  product(id: number): Promise<Product> {
    return firstValueFrom(this.http.get<Product>(api(`/api/products/${id}`)));
  }

  createProduct(product: Product): Promise<Product> {
    return firstValueFrom(this.http.post<Product>(api('/api/products'), product));
  }

  updateProduct(id: number, product: Product): Promise<Product> {
    return firstValueFrom(
      this.http.put<Product>(api(`/api/products/${id}`), this.productWriteBody(product)));
  }

  /** Explicit move or unlink; null is intentional on this dedicated endpoint. */
  assignProductFamily(id: number, familyId: number | null): Promise<Product> {
    return firstValueFrom(this.http.put<Product>(
      api(`/api/products/${id}/family`),
      { familyId },
    ));
  }

  /** Links two existing products as colour and/or size variants in one server transaction. */
  linkProductVariant(id: number, variantProductId: number): Promise<ProductFamily> {
    return firstValueFrom(this.http.post<ProductFamily>(
      api(`/api/products/${id}/variants`),
      { variantProductId },
    ));
  }

  /** One atomic command; unique colour data can never be part of this request. */
  applyProductSharedFields(
    sourceProductId: number,
    request: ProductSharedFieldsApplyRequest,
  ): Promise<ProductSharedFieldsApplyResult> {
    return firstValueFrom(this.http.post<ProductSharedFieldsApplyResult>(
      api(`/api/products/${sourceProductId}/apply-shared-fields`),
      request,
    ));
  }

  /** Empty strings explicitly clear optional variant fields on backward-compatible writes. */
  private productWriteBody(product: Product): Product {
    return {
      ...product,
      /* The backend treats null as "legacy client omitted this field"; an empty
         string is the explicit command to clear a saved supplier note. */
      supplierNote: product.supplierNote ?? '',
      colourHex: product.colourHex ?? '',
      variantSize: product.variantSize ?? '',
    };
  }

  /** Copies a product into another colour/size combination. */
  duplicateProduct(
    id: number,
    variant: { colour: string | null; colourHex: string | null; variantSize: string | null },
  ): Promise<Product> {
    const body = {
      colour: variant.colour ?? '',
      colourHex: variant.colourHex ?? '',
      variantSize: variant.variantSize ?? '',
    };
    return firstValueFrom(
      this.http.post<Product>(api(`/api/products/${id}/duplicate`), body));
  }

  deleteProduct(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/products/${id}`)));
  }

  /* --------------------------------------------------- productfamilies */

  productFamilies(): Promise<ProductFamily[]> {
    return firstValueFrom(this.http.get<ProductFamily[]>(api('/api/product-families')));
  }

  productFamily(id: number): Promise<ProductFamily> {
    return firstValueFrom(
      this.http.get<ProductFamily>(api(`/api/product-families/${id}`)));
  }

  createProductFamily(family: ProductFamily): Promise<ProductFamily> {
    return firstValueFrom(
      this.http.post<ProductFamily>(api('/api/product-families'), family));
  }

  updateProductFamily(id: number, family: ProductFamily): Promise<ProductFamily> {
    return firstValueFrom(
      this.http.put<ProductFamily>(api(`/api/product-families/${id}`), family));
  }

  /**
   * Finalizes placeholder identity only while the persisted family and every SKU are drafts.
   * Expected keys and the complete SKU membership make this safe against stale editor state.
   */
  finalizeDraftProductFamilyIdentity(
    id: number,
    request: ProductFamilyIdentityFinalization,
  ): Promise<ProductFamily> {
    return firstValueFrom(this.http.put<ProductFamily>(
      api(`/api/product-families/${id}/finalize-draft-identity`),
      request,
    ));
  }

  /** Changes only website visibility; never rewrites a stale family snapshot. */
  setProductFamilyWebsiteVisibility(id: number, visible: boolean): Promise<WebsiteVisibilityResult> {
    return firstValueFrom(this.http.put<WebsiteVisibilityResult>(
      api(`/api/product-families/${id}/website-visibility`),
      { visible },
    ));
  }

  uploadProductFamilyImage(
    familyId: number,
    file: File,
    variantProductId?: number | null,
  ): Promise<ProductFamily> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (variantProductId !== null && variantProductId !== undefined) {
      form.append('variantProductId', String(variantProductId));
    }
    return firstValueFrom(this.http.post<ProductFamily>(
      api(`/api/product-families/${familyId}/images`), form));
  }

  deleteProductFamilyImage(familyId: number, imageId: number): Promise<ProductFamily> {
    return firstValueFrom(this.http.delete<ProductFamily>(
      api(`/api/product-families/${familyId}/images/${imageId}`)));
  }

  reorderProductFamilyImages(familyId: number, imageIds: number[]): Promise<ProductFamily> {
    return firstValueFrom(this.http.put<ProductFamily>(
      api(`/api/product-families/${familyId}/images/order`), imageIds));
  }

  updateProductFamilyImageAlt(
    familyId: number,
    imageId: number,
    language: LanguageCode,
    alt: string,
  ): Promise<ProductFamily> {
    return firstValueFrom(this.http.put<ProductFamily>(
      api(`/api/product-families/${familyId}/images/${imageId}/alt`), { language, alt }));
  }

  updateProductFamilyImageVariant(
    familyId: number,
    imageId: number,
    variantProductId: number | null,
  ): Promise<ProductFamily> {
    return firstValueFrom(this.http.put<ProductFamily>(
      api(`/api/product-families/${familyId}/images/${imageId}/variant`),
      { variantProductId },
    ));
  }

  updateProductFamilyImagePublication(
    familyId: number,
    imageId: number,
    channels: CatalogChannel[],
  ): Promise<ProductFamily> {
    return firstValueFrom(this.http.put<ProductFamily>(
      api(`/api/product-families/${familyId}/images/${imageId}/publication`),
      { channels },
    ));
  }

  productPublicTranslations(productId: number): Promise<ProductPublicTranslationsSnapshot> {
    return firstValueFrom(this.http.get<ProductPublicTranslationsSnapshot>(
      api(`/api/products/${productId}/public-translations`)));
  }

  updateProductPublicTranslations(
    productId: number,
    request: ProductPublicTranslationsWrite,
  ): Promise<ProductPublicTranslationsSnapshot> {
    return firstValueFrom(this.http.put<ProductPublicTranslationsSnapshot>(
      api(`/api/products/${productId}/public-translations`), request));
  }

  /** Manual stock correction after a recount; the product PUT leaves stock alone. */
  /** Sets the count at one location; without a location the warehouse. */
  setStock(productId: number, quantity: number, locationId: number | null = null,
           reference: string | null = null): Promise<Product> {
    return firstValueFrom(
      this.http.post<Product>(api(`/api/products/${productId}/stock`), { quantity, locationId, reference }));
  }

  /** Pieces leaving the shelf as broken or as a demo for a customer. */
  takeOutStock(productId: number, body: { locationId: number | null; quantity: number; kind: 'DAMAGED' | 'DEMO'; note: string | null }): Promise<Product> {
    return firstValueFrom(this.http.post<Product>(api(`/api/products/${productId}/stock/take-out`), body));
  }

  /* ---- the company's EAN list and barcode images ---- */

  barcodePool(): Promise<string[]> {
    return firstValueFrom(this.http.get<string[]>(api('/api/barcodes/pool')));
  }

  addBarcodes(codes: string): Promise<{ added: string[]; invalid: string[]; inUse: string[]; duplicate: string[] }> {
    return firstValueFrom(this.http.post<{ added: string[]; invalid: string[]; inUse: string[]; duplicate: string[] }>(
      api('/api/barcodes/pool'), { codes }));
  }

  removeBarcode(code: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/barcodes/pool/${code}`)));
  }

  /** The next free code, to put in a form; it leaves the list when the product is saved. */
  nextBarcode(): Promise<{ code: string; remaining: number }> {
    return firstValueFrom(this.http.get<{ code: string; remaining: number }>(api('/api/barcodes/pool/next')));
  }

  /** Print-ready EAN-13 PNG at 300 dpi. */
  barcodeImage(code: string): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/api/barcodes/${code}/image.png`), { responseType: 'blob' }));
  }

  /* ---- stock per location ---- */

  stockLocations(): Promise<StockLocation[]> {
    return firstValueFrom(this.http.get<StockLocation[]>(api('/api/stock/locations')));
  }

  saveStockLocation(location: StockLocation): Promise<StockLocation> {
    return location.id === null
      ? firstValueFrom(this.http.post<StockLocation>(api('/api/stock/locations'), location))
      : firstValueFrom(this.http.put<StockLocation>(api(`/api/stock/locations/${location.id}`), location));
  }

  deleteStockLocation(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/stock/locations/${id}`)));
  }

  /** Every product's pieces per location, in one call. */
  stockLevels(): Promise<StockLevel[]> {
    return firstValueFrom(this.http.get<StockLevel[]>(api('/api/stock/levels')));
  }

  productStock(productId: number): Promise<ProductStock[]> {
    return firstValueFrom(this.http.get<ProductStock[]>(api(`/api/products/${productId}/stock`)));
  }

  transferStock(productId: number, fromLocationId: number, toLocationId: number, quantity: number,
                note: string | null): Promise<Product> {
    return firstValueFrom(this.http.post<Product>(api(`/api/products/${productId}/stock/transfer`),
      { fromLocationId, toLocationId, quantity, note }));
  }

  stocktake(locationId: number, reference: string, counts: { productId: number; quantity: number }[]): Promise<void> {
    return firstValueFrom(this.http.post<void>(api('/api/stock/stocktake'), { locationId, reference, counts }));
  }

  deleteStockMovement(productId: number, movementId: number): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(api(`/api/products/${productId}/stock-movements/${movementId}`)));
  }

  stockMovements(productId: number): Promise<StockMovement[]> {
    return firstValueFrom(this.http.get<StockMovement[]>(api(`/api/products/${productId}/stock-movements`)));
  }

  /** Check digit plus uniqueness; the product being edited may keep its own codes. */
  checkBarcode(value: string, excludeProductId: number | null = null): Promise<{ valid: boolean; message: string }> {
    const params: Record<string, string> = { value };
    if (excludeProductId !== null) params['excludeProductId'] = String(excludeProductId);
    return firstValueFrom(
      this.http.get<{ valid: boolean; message: string }>(
        api('/api/products/barcode-check'), { params }));
  }

  /* -------------------------------------------------------------- fotos */

  uploadPhoto(productId: number, file: File): Promise<Product> {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(
      this.http.post<Product>(api(`/api/products/${productId}/photos`), form));
  }

  deletePhoto(productId: number, photoId: number): Promise<Product> {
    return firstValueFrom(
      this.http.delete<Product>(api(`/api/products/${productId}/photos/${photoId}`)));
  }

  /** Lets one photo open the website or the printed catalogue, or takes that role away. */
  setPhotoLead(productId: number, photoId: number, role: PhotoRole, lead: boolean): Promise<Product> {
    return firstValueFrom(this.http.put<Product>(
      api(`/api/products/${productId}/photos/${photoId}/lead`), { role, lead }));
  }

  reorderPhotos(productId: number, photoIds: number[]): Promise<Product> {
    return firstValueFrom(
      this.http.put<Product>(api(`/api/products/${productId}/photos/order`), photoIds));
  }

  /* ------------------------------------------ leveranciersafspraakfoto's */

  /** Ordered, supplier-scoped photos that only enter the supplier agreement PDF. */
  supplierAgreementPhotos(productId: number): Promise<ProductSupplierAgreementPhoto[]> {
    return firstValueFrom(this.http.get<ProductSupplierAgreementPhoto[]>(
      api(`/api/products/${productId}/supplier-agreement/photos`)));
  }

  uploadSupplierAgreementPhoto(
    productId: number,
    file: File,
    caption: string | null = null,
  ): Promise<ProductSupplierAgreementPhoto> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (caption?.trim()) form.append('caption', caption.trim());
    return firstValueFrom(this.http.post<ProductSupplierAgreementPhoto>(
      api(`/api/products/${productId}/supplier-agreement/photos`), form));
  }

  updateSupplierAgreementPhotoCaption(
    productId: number,
    photoId: number,
    caption: string | null,
  ): Promise<ProductSupplierAgreementPhoto> {
    return firstValueFrom(this.http.put<ProductSupplierAgreementPhoto>(
      api(`/api/products/${productId}/supplier-agreement/photos/${photoId}`),
      { caption: caption?.trim() || null },
    ));
  }

  reorderSupplierAgreementPhotos(
    productId: number,
    photoIds: number[],
  ): Promise<ProductSupplierAgreementPhoto[]> {
    return firstValueFrom(this.http.put<ProductSupplierAgreementPhoto[]>(
      api(`/api/products/${productId}/supplier-agreement/photos/order`), photoIds));
  }

  deleteSupplierAgreementPhoto(productId: number, photoId: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(
      api(`/api/products/${productId}/supplier-agreement/photos/${photoId}`)));
  }

  /** Fetches the bytes; the caller makes a blob URL or a download of them. */
  photoBlob(url: string): Promise<Blob> {
    const pending = this.pendingPhotoBlobs.get(url);
    if (pending) return pending;

    const request = firstValueFrom(this.http.get(api(url), { responseType: 'blob' }));
    this.pendingPhotoBlobs.set(url, request);
    void request.finally(() => {
      if (this.pendingPhotoBlobs.get(url) === request) this.pendingPhotoBlobs.delete(url);
    }).catch(() => undefined);
    return request;
  }

  /** One native Excel workbook with master data and customer-facing translations. */
  catalogWorkbook(): Promise<Blob> {
    return firstValueFrom(
      this.http.get(api('/api/products/workbook'), { responseType: 'blob' }));
  }

  importCatalogWorkbook(file: File): Promise<CatalogImportResult> {
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(
      this.http.post<CatalogImportResult>(api('/api/products/workbook'), form));
  }

  /** The catalogue as a PDF, with a hand-picked selection. */
  preflightCatalog(request: CatalogExportRequest): Promise<CatalogPreflightResult> {
    return firstValueFrom(
      this.http.post<CatalogPreflightResult>(api('/api/catalog/preflight'), request));
  }

  /** The catalogue as a PDF, after the lightweight translation preflight succeeds. */
  exportCatalog(request: CatalogExportRequest): Promise<Blob> {
    return firstValueFrom(
      this.http.post(api('/api/catalog/export'), request, { responseType: 'blob' }));
  }

  /* --------------------------------------------------- categorieen / HS */

  categories(): Promise<Category[]> {
    return firstValueFrom(this.http.get<Category[]>(api('/api/categories')));
  }

  reorderCategories(ids: number[]): Promise<Category[]> {
    return firstValueFrom(this.http.put<Category[]>(api('/api/categories/order'), ids));
  }

  createCategory(category: Category): Promise<Category> {
    return firstValueFrom(this.http.post<Category>(api('/api/categories'), category));
  }

  updateCategory(id: number, category: Category): Promise<Category> {
    return firstValueFrom(this.http.put<Category>(api(`/api/categories/${id}`), category));
  }

  deleteCategory(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/categories/${id}`)));
  }

  /* ------------------------------------------------- categoriefoto's */

  uploadCategoryPhoto(id: number, file: File): Promise<Category> {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(this.http.post<Category>(api(`/api/categories/${id}/photos`), form));
  }

  /** Takes a picture over from enrosed.com as the category's photo. */
  importCategoryPhoto(id: number, url: string): Promise<Category> {
    return firstValueFrom(this.http.post<Category>(api(`/api/categories/${id}/photos/import`), { url }));
  }

  deleteCategoryPhoto(id: number, photoId: number): Promise<Category> {
    return firstValueFrom(this.http.delete<Category>(api(`/api/categories/${id}/photos/${photoId}`)));
  }

  reorderCategoryPhotos(id: number, photoIds: number[]): Promise<Category> {
    return firstValueFrom(this.http.put<Category>(api(`/api/categories/${id}/photos/order`), photoIds));
  }

  categoryPhotoUrl(id: number, photoId: number): string {
    return `/api/categories/${id}/photos/${photoId}`;
  }

  contentTranslations(scope: ContentTranslationScope): Promise<ContentTranslationOverview> {
    return firstValueFrom(this.http.get<ContentTranslationOverview>(
      api('/api/content-translations'), { params: { scope } }));
  }

  contentTranslation(scope: ContentTranslationScope, key: string): Promise<ContentTranslationGroup> {
    return firstValueFrom(this.http.get<ContentTranslationGroup>(
      api(`/api/content-translations/${scope}/${encodeURIComponent(key)}`)));
  }

  createContentTranslation(request: ContentTranslationCreate): Promise<ContentTranslationGroup> {
    return firstValueFrom(this.http.post<ContentTranslationGroup>(
      api('/api/content-translations'), request));
  }

  updateContentTranslation(
    scope: ContentTranslationScope,
    key: string,
    request: ContentTranslationWrite,
  ): Promise<ContentTranslationGroup> {
    return firstValueFrom(this.http.put<ContentTranslationGroup>(
      api(`/api/content-translations/${scope}/${encodeURIComponent(key)}`), request));
  }

  deleteContentTranslation(
    scope: ContentTranslationScope,
    key: string,
    revision: number,
  ): Promise<void> {
    return firstValueFrom(this.http.delete<void>(
      api(`/api/content-translations/${scope}/${encodeURIComponent(key)}`),
      { params: { revision } },
    ));
  }

  websiteRebuildStatus(): Promise<WebsiteRebuildStatus> {
    return firstValueFrom(this.http.get<WebsiteRebuildStatus>(api('/api/website-rebuild')));
  }

  retryWebsiteRebuild(): Promise<WebsiteRebuildStatus> {
    return firstValueFrom(this.http.post<WebsiteRebuildStatus>(
      api('/api/website-rebuild/retry'), null));
  }

  websiteBuilderHomepage(): Promise<WebsiteBuilderHomepage> {
    return firstValueFrom(this.http.get<WebsiteBuilderHomepage>(
      api('/api/website-builder/homepage')));
  }

  saveWebsiteBuilderHomepage(
    revision: string | number,
    sections: WebsiteBuilderSection[],
  ): Promise<WebsiteBuilderHomepage> {
    return firstValueFrom(this.http.put<WebsiteBuilderHomepage>(
      api('/api/website-builder/homepage'),
      { revision, sections },
    ));
  }

  publishWebsiteBuilderHomepage(
    revision: string | number,
  ): Promise<WebsiteBuilderHomepage> {
    return firstValueFrom(this.http.post<WebsiteBuilderHomepage>(
      api('/api/website-builder/homepage/publish'),
      { revision },
    ));
  }

  publicWebsiteLayout(): Promise<PublicWebsiteLayout> {
    return firstValueFrom(this.http.get<PublicWebsiteLayout>(
      api('/api/v1/public/website-layout')));
  }

  hsCodes(): Promise<HsCode[]> {
    return firstValueFrom(this.http.get<HsCode[]>(api('/api/hs-codes')));
  }

  saveHsCode(hsCode: HsCode): Promise<HsCode> {
    return firstValueFrom(this.http.put<HsCode>(api('/api/hs-codes'), hsCode));
  }

  deleteHsCode(code: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/hs-codes/${code}`)));
  }
}
