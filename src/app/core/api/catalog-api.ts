import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import {
  CatalogImportResult,
  Category,
  HsCode,
  LanguageCode,
  Product,
  ProductFamily,
} from './models';

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);

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
    return firstValueFrom(this.http.put<Product>(api(`/api/products/${id}`), product));
  }

  /** Copies a product, usually to make the same style in another colour. */
  duplicateProduct(id: number, colour: string): Promise<Product> {
    return firstValueFrom(
      this.http.post<Product>(api(`/api/products/${id}/duplicate`), { colour }));
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

  uploadProductFamilyImage(
    familyId: number,
    file: File,
    variantExternalId?: string | null,
    variantColor?: string | null,
  ): Promise<ProductFamily> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (variantExternalId) form.append('variantExternalId', variantExternalId);
    if (variantColor) form.append('variantColor', variantColor);
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

  checkBarcode(value: string): Promise<{ valid: boolean; message: string }> {
    return firstValueFrom(
      this.http.get<{ valid: boolean; message: string }>(
        api('/api/products/barcode-check'), { params: { value } }));
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

  reorderPhotos(productId: number, photoIds: number[]): Promise<Product> {
    return firstValueFrom(
      this.http.put<Product>(api(`/api/products/${productId}/photos/order`), photoIds));
  }

  /** Fetches the bytes; the caller makes a blob URL or a download of them. */
  photoBlob(url: string): Promise<Blob> {
    return firstValueFrom(this.http.get(api(url), { responseType: 'blob' }));
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
  exportCatalog(request: {
    productIds: number[];
    includePrices: boolean;
    includePhotos: boolean;
    title: string;
    intro: string;
    /** Language of the catalogue; the fair audience decides, not our screen. */
    language: string;
  }): Promise<Blob> {
    return firstValueFrom(
      this.http.post(api('/api/catalog/export'), request, { responseType: 'blob' }));
  }

  /* --------------------------------------------------- categorieen / HS */

  categories(): Promise<Category[]> {
    return firstValueFrom(this.http.get<Category[]>(api('/api/categories')));
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
