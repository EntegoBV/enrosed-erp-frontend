import { Routes } from '@angular/router';
import { authGuard } from './core/api/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  /* Aanmelden en het klantportaal staan buiten de bewaking:
     de klant heeft geen account, alleen een token in de link. */
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

  /* Alles hieronder vereist een aanmelding. */
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
    path: 'sales/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/sales/sales-editor').then((m) => m.SalesEditor),
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
    path: 'purchasing/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/purchasing/purchase-editor').then((m) => m.PurchaseEditor),
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
    path: 'products/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/product-editor').then((m) => m.ProductEditor),
  },
  {
    path: 'countries',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/country-list').then((m) => m.CountryList),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
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
