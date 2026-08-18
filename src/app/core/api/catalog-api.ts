import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from './api.config';
import { Category, CsvImportResult, HsCode, Product } from './models';

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

  /** The catalogue as a PDF, with a hand-picked selection. */
  /** Master-data CSV for bulk editing (HS codes, sizes, cartons, prices). */
  productsCsv(): Promise<Blob> {
    return firstValueFrom(this.http.get(api('/api/products/csv'), { responseType: 'blob' }));
  }

  importProductsCsv(file: File): Promise<CsvImportResult> {
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(this.http.post<CsvImportResult>(api('/api/products/csv'), form));
  }

  /** Translation CSV: one row per product per language. */
  translationsCsv(): Promise<Blob> {
    return firstValueFrom(
      this.http.get(api('/api/products/translations/csv'), { responseType: 'blob' }));
  }

  importTranslationsCsv(file: File): Promise<CsvImportResult> {
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(
      this.http.post<CsvImportResult>(api('/api/products/translations/csv'), form));
  }

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
