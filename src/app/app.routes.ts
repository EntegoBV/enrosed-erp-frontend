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
    loadComponent: () => import('./features/dashboard/dashboard-home').then((m) => m.DashboardHome),
  },
  {
    path: 'analyses',
    pathMatch: 'full',
    redirectTo: 'analyses/overview',
  },
  {
    path: 'analyses/:section',
    canActivate: [authGuard],
    loadComponent: () => import('./features/analyses/analyses-page').then((m) => m.AnalysesPage),
  },
  {
    path: 'sales',
    canActivate: [authGuard],
    loadComponent: () => import('./features/sales/sales-list').then((m) => m.SalesList),
  },
  {
    path: 'sales/:id/edit',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/sales/sales-editor').then((m) => m.SalesEditor),
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
    canDeactivate: [unsavedChangesGuard],
    data: { mode: 'edit' },
    loadComponent: () =>
      import('./features/purchasing/purchase-screen').then((m) => m.PurchaseScreen),
  },
  {
    path: 'purchasing/:id',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { mode: 'view' },
    loadComponent: () =>
      import('./features/purchasing/purchase-screen').then((m) => m.PurchaseScreen),
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
      import('./features/products/product-screen').then((m) => m.ProductScreen),
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
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/product-translations-page').then((m) => m.ProductTranslationsPage),
    canDeactivate: [unsavedChangesGuard],
  },
  {
    path: 'website',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/website-builder/website-admin-page')
        .then((m) => m.WebsiteAdminPage),
  },
  {
    path: 'website/layout',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/website-builder/website-builder-page')
        .then((m) => m.WebsiteBuilderPage),
  },
  {
    path: 'website/texts',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/website-builder/content-translations-page')
        .then((m) => m.ContentTranslationsPage),
  },
  {
    path: 'website/products',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/website-builder/website-products-page')
        .then((m) => m.WebsiteProductsPage),
  },
  {
    path: 'website/categories',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { websiteCategoryMode: true },
    loadComponent: () =>
      import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'website/seo',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { seoMode: true },
    loadComponent: () =>
      import('./features/website-builder/content-translations-page')
        .then((m) => m.ContentTranslationsPage),
  },
  {
    path: 'website/publication',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/website-builder/website-publication-page')
        .then((m) => m.WebsitePublicationPage),
  },
  {
    path: 'catalog/texts',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { catalogMode: true },
    loadComponent: () =>
      import('./features/website-builder/content-translations-page')
        .then((m) => m.ContentTranslationsPage),
  },
  /* Keep all older builder bookmarks stable while /website is canonical. */
  { path: 'website-builder/layout', pathMatch: 'full', redirectTo: 'website/layout' },
  { path: 'website-builder/texts', pathMatch: 'full', redirectTo: 'website/texts' },
  { path: 'website-builder/products', pathMatch: 'full', redirectTo: 'website/products' },
  { path: 'website-builder/categories', pathMatch: 'full', redirectTo: 'website/categories' },
  { path: 'website-builder/seo', pathMatch: 'full', redirectTo: 'website/seo' },
  { path: 'website-builder/publication', pathMatch: 'full', redirectTo: 'website/publication' },
  { path: 'website-builder', pathMatch: 'full', redirectTo: 'website/layout' },
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
    path: 'files',
    canActivate: [authGuard],
    loadComponent: () => import('./features/files/files-page').then((m) => m.FilesPage),
  },
  { path: 'settings/documents-media', pathMatch: 'full', redirectTo: 'files' },
  {
    path: 'settings',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'activity',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/activity/activity-page').then((m) => m.ActivityPage),
  },
  {
    path: 'more',
    canActivate: [authGuard],
    loadComponent: () => import('./features/more/more-page').then((m) => m.MorePage),
  },

  { path: '**', redirectTo: 'dashboard' },
];
