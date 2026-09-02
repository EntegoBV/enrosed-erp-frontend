import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE, api } from './api.config';
import {
  CompanyProfile, Country, Customer, CustomerPortalLink, DiscountTier, FreightPricingStrategy, LanguageCode,
  NotificationFeed, PortalCatalogItem, PortalQuote, QuoteEvent, QuoteRevision, SalesOrder,
  SalesOrderView, Carrier, CarrierShipQuote, DocumentType,
} from './models';
import { SalesPdfOptions, salesPdfQuery } from './sales-pdf-options';

@Injectable({ providedIn: 'root' })
export class SalesApi {
  private readonly http = inject(HttpClient);

  /* ------------------------------------------------------------ klanten */

  customers(): Promise<Customer[]> {
    return firstValueFrom(this.http.get<Customer[]>(api('/api/customers')));
  }

  createCustomer(customer: Customer): Promise<Customer> {
    return firstValueFrom(this.http.post<Customer>(api('/api/customers'), customer));
  }

  updateCustomer(id: number, customer: Customer): Promise<Customer> {
    return firstValueFrom(this.http.put<Customer>(api(`/api/customers/${id}`), customer));
  }

  deleteCustomer(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/customers/${id}`)));
  }

  /* ------------------------------------------------ bedrijfsgegevens */

  company(): Promise<CompanyProfile> {
    return firstValueFrom(this.http.get<CompanyProfile>(api('/api/company')));
  }

  saveCompany(profile: CompanyProfile): Promise<CompanyProfile> {
    return firstValueFrom(this.http.put<CompanyProfile>(api('/api/company'), profile));
  }

  /* ------------------------------------------------- landen en staffels */

  countries(): Promise<Country[]> {
    return firstValueFrom(this.http.get<Country[]>(api('/api/countries')));
  }

  saveCountry(country: Country): Promise<Country> {
    return firstValueFrom(this.http.put<Country>(api('/api/countries'), country));
  }

  deleteCountry(code: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/countries/${code}`)));
  }

  tiers(scope: 'LINE' | 'ORDER'): Promise<DiscountTier[]> {
    return firstValueFrom(this.http.get<DiscountTier[]>(api(`/api/discount-tiers/${scope}`)));
  }

  saveTiers(scope: 'LINE' | 'ORDER', tiers: DiscountTier[]): Promise<DiscountTier[]> {
    return firstValueFrom(
      this.http.put<DiscountTier[]>(api(`/api/discount-tiers/${scope}`), tiers));
  }

  productTiers(productId: number): Promise<DiscountTier[]> {
    return firstValueFrom(this.http.get<DiscountTier[]>(
      api(`/api/discount-tiers/LINE/products/${productId}`)));
  }

  saveProductTiers(productId: number, tiers: DiscountTier[]): Promise<DiscountTier[]> {
    return firstValueFrom(this.http.put<DiscountTier[]>(
      api(`/api/discount-tiers/LINE/products/${productId}`), tiers));
  }

  /* ------------------------------------------------------ verkooporders */

  orders(): Promise<SalesOrderView[]> {
    return firstValueFrom(this.http.get<SalesOrderView[]>(api('/api/sales-orders')));
  }

  order(id: number): Promise<SalesOrderView> {
    return firstValueFrom(this.http.get<SalesOrderView>(api(`/api/sales-orders/${id}`)));
  }

  createOrder(customerId: number, countryCode: string | null,
              incoterm: string, docType: DocumentType = 'OFFERTE'): Promise<SalesOrderView> {
    return firstValueFrom(this.http.post<SalesOrderView>(api('/api/sales-orders'),
      { customerId, countryCode, incoterm, docType }));
  }

  /** Freezes the quote's content into a new invoice; the quote stays. */
  createInvoiceFrom(quoteId: number): Promise<SalesOrderView> {
    return firstValueFrom(
      this.http.post<SalesOrderView>(api(`/api/sales-orders/${quoteId}/invoice`), {}));
  }

  markInvoiceSent(id: number): Promise<SalesOrderView> {
    return firstValueFrom(
      this.http.post<SalesOrderView>(api(`/api/sales-orders/${id}/mark-sent`), {}));
  }

  markInvoicePaid(id: number): Promise<SalesOrderView> {
    return firstValueFrom(
      this.http.post<SalesOrderView>(api(`/api/sales-orders/${id}/mark-paid`), {}));
  }

  /** Books the shipped goods out of stock; the server refuses to do it twice. */
  shipGoods(id: number): Promise<SalesOrderView> {
    return firstValueFrom(
      this.http.post<SalesOrderView>(api(`/api/sales-orders/${id}/ship-goods`), {}));
  }

  /* -------------------------------------------------- verzendorganisaties */

  carriers(): Promise<Carrier[]> {
    return firstValueFrom(this.http.get<Carrier[]>(api('/api/carriers')));
  }

  saveCarrier(carrier: Carrier): Promise<Carrier> {
    return carrier.id == null
      ? firstValueFrom(this.http.post<Carrier>(api('/api/carriers'), carrier))
      : firstValueFrom(this.http.put<Carrier>(api(`/api/carriers/${carrier.id}`), carrier));
  }

  deleteCarrier(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/carriers/${id}`)));
  }

  /** Prices one shipment against a staffel; the editor shows the breakdown. */
  carrierQuote(id: number, params: { country: string; postcode: string | null;
               pallets: number; palletType: string; weightKg: number | null }):
      Promise<CarrierShipQuote | null> {
    const query = new URLSearchParams({
      country: params.country,
      postcode: params.postcode ?? '',
      pallets: String(params.pallets),
      palletType: params.palletType,
      ...(params.weightKg != null ? { weightKg: String(params.weightKg) } : {}),
    });
    return firstValueFrom(this.http.get<CarrierShipQuote | null>(
      api(`/api/carriers/${id}/quote?${query}`)));
  }

  /** Prices the order as it stands on screen, without saving. */
  previewOrder(id: number, order: SalesOrder): Promise<SalesOrderView> {
    return firstValueFrom(this.http.post<SalesOrderView>(api(`/api/sales-orders/${id}/preview`), order));
  }

  updateOrder(id: number, order: SalesOrder): Promise<SalesOrderView> {
    return firstValueFrom(this.http.put<SalesOrderView>(api(`/api/sales-orders/${id}`), order));
  }

  /** Changes only delivery promises; safe after the commercial quote is locked. */
  updateDeliveryTerms(id: number,
                      lines: { productId: number; deliveryWeek: string | null }[]): Promise<SalesOrderView> {
    return firstValueFrom(this.http.put<SalesOrderView>(
      api(`/api/sales-orders/${id}/delivery-terms`), { lines }));
  }

  /** Changes only the open freight item; prices and quantities stay locked. */
  updateFreight(id: number, state: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD',
                manualFreightEur: number | null,
                freightPricingStrategy: FreightPricingStrategy | null,
                freightRatePerCbmEur: number | null,
                freightCarrierId: number | null = null): Promise<SalesOrderView> {
    return firstValueFrom(this.http.put<SalesOrderView>(
      api(`/api/sales-orders/${id}/freight`), {
        state, manualFreightEur, freightPricingStrategy, freightRatePerCbmEur, freightCarrierId,
      }));
  }

  duplicateOrder(id: number): Promise<SalesOrderView> {
    return firstValueFrom(
      this.http.post<SalesOrderView>(api(`/api/sales-orders/${id}/duplicate`), {}));
  }

  deleteOrder(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/api/sales-orders/${id}`)));
  }

  /* ----------------------------------------------------------- offertes */

  /** Builds the PDF, mails it to the customer and marks the quote sent. */
  sendQuote(id: number, message: string): Promise<SalesOrderView> {
    return firstValueFrom(
      this.http.post<SalesOrderView>(api(`/api/sales-orders/${id}/send`), { message }));
  }

  /** Puts a rejected or expired quote back on concept. */
  reopenQuote(id: number): Promise<SalesOrderView> {
    return firstValueFrom(
      this.http.post<SalesOrderView>(api(`/api/sales-orders/${id}/reopen`), {}));
  }

  /** A manual export can choose its language and visible customer-facing detail. */
  quotePdf(id: number, options: SalesPdfOptions | LanguageCode = {}): Promise<Blob> {
    const query = salesPdfQuery(typeof options === 'string' ? { language: options } : options);
    return firstValueFrom(
      this.http.get(api(`/api/sales-orders/${id}/pdf?${query}`), { responseType: 'blob' }));
  }

  /** The packing slip: pallets when laid out by hand, plain lines otherwise. */
  packingSlip(id: number): Promise<Blob> {
    return firstValueFrom(this.http.get(
      api(`/api/sales-orders/${id}/packing-slip`), { responseType: 'blob' }));
  }

  /**
   * Server-owned public URL, only present for a genuinely sent and currently
   * visible customer portal. Never derive this URL from a token in the UI.
   */
  portalLink(id: number): Promise<CustomerPortalLink> {
    return firstValueFrom(
      this.http.get<CustomerPortalLink>(
        api(`/api/sales-orders/${id}/portal-link`)));
  }

  /* -------------------------------------------------------- wijzigingen */

  pendingRevisions(): Promise<QuoteRevision[]> {
    return firstValueFrom(
      this.http.get<QuoteRevision[]>(api('/api/sales-orders/revisions/pending')));
  }

  revisionsFor(orderId: number): Promise<QuoteRevision[]> {
    return firstValueFrom(
      this.http.get<QuoteRevision[]>(api(`/api/sales-orders/${orderId}/revisions`)));
  }

  approveRevision(revisionId: number, handledBy: string, message: string): Promise<SalesOrderView> {
    return firstValueFrom(this.http.post<SalesOrderView>(
      api(`/api/sales-orders/revisions/${revisionId}/approve`), { handledBy, message }));
  }

  rejectRevision(revisionId: number, handledBy: string, message: string): Promise<SalesOrderView> {
    return firstValueFrom(this.http.post<SalesOrderView>(
      api(`/api/sales-orders/revisions/${revisionId}/reject`), { handledBy, message }));
  }

  /** The history of a quote, oldest step first. */
  history(id: number): Promise<QuoteEvent[]> {
    return firstValueFrom(this.http.get<QuoteEvent[]>(api(`/api/sales-orders/${id}/history`)));
  }

  /* ---------------------------------------------------------- meldingen */

  /** What is waiting on us, for the bell in the top right. */
  notifications(): Promise<NotificationFeed> {
    return firstValueFrom(this.http.get<NotificationFeed>(api('/api/notifications')));
  }

  /* ------------------------------------------------------------ portaal */

  /** @param language language the customer picked; empty for their own. */
  portalQuote(token: string, language?: LanguageCode): Promise<PortalQuote> {
    const query = language ? `?language=${encodeURIComponent(language)}` : '';
    return firstValueFrom(this.http.get<PortalQuote>(api(`/api/portal/${token}${query}`)))
      .then((quote) => ({
        ...quote,
        /* The lines carry the staff photo path, which needs a login and the
           API origin. The portal swaps in its own public token URL. */
        lines: quote.lines.map((line) => ({
          ...line,
          photoUrl: line.photoUrl ? this.portalPhotoUrl(token, line.productId) : null,
        })),
      }));
  }

  /** Products the customer can add, with the price this order charges. */
  portalCatalog(token: string, language?: LanguageCode): Promise<PortalCatalogItem[]> {
    const query = language ? `?language=${encodeURIComponent(language)}` : '';
    return firstValueFrom(
      this.http.get<PortalCatalogItem[]>(api(`/api/portal/${token}/products${query}`)),
    ).then((items) => items.map((item) => ({
      ...item,
      /* The API returns a relative public path. The portal and API have
         different production origins, so hand the picker an absolute URL. */
      photoUrl: item.photoUrl ? this.portalPhotoUrl(token, item.productId) : null,
    })));
  }

  portalPhotoUrl(token: string, productId: number): string {
    return `${API_BASE}/api/portal/${token}/products/${productId}/photo`;
  }

  portalPdfUrl(token: string): string {
    return `${API_BASE}/api/portal/${token}/pdf`;
  }

  portalAccept(token: string, signedByName: string, message: string): Promise<PortalQuote> {
    return firstValueFrom(
      this.http.post<PortalQuote>(api(`/api/portal/${token}/accept`), { signedByName, message }));
  }

  portalReject(token: string, message: string): Promise<PortalQuote> {
    return firstValueFrom(
      this.http.post<PortalQuote>(api(`/api/portal/${token}/reject`), { message }));
  }

  /** The customer withdraws their change proposal. */
  portalWithdraw(token: string): Promise<PortalQuote> {
    return firstValueFrom(
      this.http.post<PortalQuote>(api(`/api/portal/${token}/withdraw`), {}));
  }

  portalPropose(token: string, proposedBy: string, message: string,
                lines: { productId: number; quantity: number; note: string | null }[]
  ): Promise<PortalQuote> {
    return firstValueFrom(this.http.post<PortalQuote>(
      api(`/api/portal/${token}/propose`), { proposedBy, message, lines }));
  }
}
