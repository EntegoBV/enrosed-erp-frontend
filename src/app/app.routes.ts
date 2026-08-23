import { Routes } from '@angular/router';
import { authGuard } from './core/api/auth.guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  /* Login and the customer portal live outside the guard:
     the customer has no account, only a token in the link. */
  {
    path: 'login',
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'voorwaarden',
    loadComponent: () => import('./features/terms/terms-page').then((m) => m.TermsPage),
  },
  {
    path: 'offerte/:token',
    loadComponent: () => import('./features/portal/portal-page').then((m) => m.PortalPage),
  },

  /* Everything below requires a login. */
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'sales',
    canActivate: [authGuard],
    loadComponent: () => import('./features/sales/sales-list').then((m) => m.SalesList),
  },
  {
    path: 'sales/:id/edit',
    canActivate: [authGuard],
    loadComponent: () => import('./features/sales/sales-editor').then((m) => m.SalesEditor),
  },
  {
    path: 'sales/:id/customer-preview',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/sales/customer-preview').then((m) => m.CustomerPreview),
  },
  {
    path: 'sales/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/sales/sales-view').then((m) => m.SalesView),
  },
  {
    path: 'revisions',
    canActivate: [authGuard],
    loadComponent: () => import('./features/sales/revision-list').then((m) => m.RevisionList),
  },
  {
    path: 'customers',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/customers/customer-list').then((m) => m.CustomerList),
  },
  {
    path: 'purchasing',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/purchasing/purchase-list').then((m) => m.PurchaseList),
  },
  {
    path: 'purchasing/:id/edit',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/purchasing/purchase-editor').then((m) => m.PurchaseEditor),
  },
  {
    path: 'purchasing/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/purchasing/purchase-view').then((m) => m.PurchaseView),
  },
  {
    path: 'suppliers',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/suppliers/supplier-list').then((m) => m.SupplierList),
  },
  {
    path: 'products',
    canActivate: [authGuard],
    loadComponent: () => import('./features/products/product-list').then((m) => m.ProductList),
  },
  {
    path: 'catalog-export',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/catalog-export').then((m) => m.CatalogExport),
  },
  {
    /* Vóór :id, anders zou "new" als productnummer gelezen worden. */
    path: 'products/new',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/products/product-editor').then((m) => m.ProductEditor),
  },
  {
    path: 'products/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/product-view').then((m) => m.ProductView),
  },
  {
    path: 'products/:id/edit',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/products/product-editor').then((m) => m.ProductEditor),
  },
  {
    path: 'products/:id/translations',
    loadComponent: () =>
      import('./features/products/product-translations-page').then((m) => m.ProductTranslationsPage),
    canDeactivate: [unsavedChangesGuard],
  },
  {
    path: 'countries',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/country-list').then((m) => m.CountryList),
  },
  {
    path: 'stock',
    canActivate: [authGuard],
    loadComponent: () => import('./features/products/stock-page').then((m) => m.StockPage),
  },
  {
    path: 'barcodes',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/barcode-pool-page').then((m) => m.BarcodePoolPage),
  },
  {
    path: 'stock-locations',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/stock-location-list').then((m) => m.StockLocationList),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'more',
    canActivate: [authGuard],
    loadComponent: () => import('./features/more/more-page').then((m) => m.MorePage),
  },

  { path: '**', redirectTo: 'dashboard' },
];
