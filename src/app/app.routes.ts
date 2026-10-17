import { Routes } from '@angular/router';
import { authGuard } from './core/api/auth.guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  /* Login and the customer portal live outside the guard:
     the customer has no account, only a token in the link. */
  {
    path: 'login',
    title: 'Aanmelden',
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'voorwaarden',
    title: 'Voorwaarden & privacy',
    loadComponent: () => import('./features/terms/terms-page').then((m) => m.TermsPage),
  },
  {
    path: 'offerte/:token',
    title: 'Offerte',
    loadComponent: () => import('./features/portal/portal-page').then((m) => m.PortalPage),
  },

  /* Everything below requires a login. */
  {
    path: 'dashboard',
    title: 'Dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard-home').then((m) => m.DashboardHome),
  },
  {
    path: 'dashboard/agenda',
    title: 'Agenda',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/agenda-page').then((m) => m.AgendaPage),
  },
  {
    path: 'dashboard/open',
    title: 'Open punten',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/open-page').then((m) => m.OpenPage),
  },
  {
    path: 'analyses',
    pathMatch: 'full',
    redirectTo: 'analyses/cash',
  },
  {
    path: 'analyses/:section',
    title: 'Analyses',
    canActivate: [authGuard],
    loadComponent: () => import('./features/analyses/analyses-page').then((m) => m.AnalysesPage),
  },
  {
    path: 'sales',
    title: 'Verkoop',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/sales/sales-list').then((m) => m.SalesList),
  },
  {
    path: 'sales/:id/edit',
    title: 'Verkooporder',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { mode: 'edit' },
    loadComponent: () => import('./features/sales/sales-screen').then((m) => m.SalesScreen),
  },
  {
    path: 'sales/:id',
    title: 'Verkooporder',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { mode: 'view' },
    loadComponent: () => import('./features/sales/sales-screen').then((m) => m.SalesScreen),
  },
  {
    path: 'revisions',
    title: 'Wijzigingen',
    canActivate: [authGuard],
    loadComponent: () => import('./features/sales/revision-list').then((m) => m.RevisionList),
  },
  {
    path: 'prospects',
    title: 'Prospects',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/prospects/prospects-page').then((m) => m.ProspectsPage),
  },
  {
    path: 'prospects/:id',
    title: 'Prospects',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/prospects/prospects-page').then((m) => m.ProspectsPage),
  },
  {
    path: 'customers',
    title: 'Klanten',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/customers/customer-list').then((m) => m.CustomerList),
  },
  {
    path: 'klantlogins',
    title: 'Login-aanvragen',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/login-requests/login-requests-page').then((m) => m.LoginRequestsPage),
  },
  {
    path: 'contactaanvragen',
    title: 'Contactaanvragen',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/contact-inquiries/contact-inquiries-page').then((m) => m.ContactInquiriesPage),
  },
  {
    path: 'purchasing',
    title: 'Inkoop',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/purchasing/purchase-list').then((m) => m.PurchaseList),
  },
  {
    path: 'purchasing/:id/edit',
    title: 'Inkooporder',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { mode: 'edit' },
    loadComponent: () =>
      import('./features/purchasing/purchase-screen').then((m) => m.PurchaseScreen),
  },
  {
    path: 'purchasing/:id',
    title: 'Inkooporder',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { mode: 'view' },
    loadComponent: () =>
      import('./features/purchasing/purchase-screen').then((m) => m.PurchaseScreen),
  },
  {
    path: 'suppliers',
    title: 'Leveranciers',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/suppliers/supplier-list').then((m) => m.SupplierList),
  },
  {
    /* Inkoop redesign I8 (2026-10-17): the HS codes on their own screen; Instellingen › Douanetarieven points here. */
    path: 'douane',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    title: 'Douane',
    loadComponent: () =>
      import('./features/purchasing/douane-page').then((m) => m.DouanePage),
  },
  {
    path: 'products',
    title: 'Catalogus',
    canActivate: [authGuard],
    loadComponent: () => import('./features/products/product-list').then((m) => m.ProductList),
  },
  {
    path: 'categories',
    title: 'Categorieën',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/categories-page').then((m) => m.CategoriesPage),
  },
  {
    path: 'catalog-export',
    title: 'Catalogus PDF',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/catalog-export').then((m) => m.CatalogExport),
  },
  {
    /* Vóór :id, anders zou "new" als productnummer gelezen worden. */
    path: 'products/new',
    title: 'Nieuw product',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/products/product-editor').then((m) => m.ProductEditor),
  },
  {
    path: 'products/:id',
    title: 'Product',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/product-screen').then((m) => m.ProductScreen),
  },
  {
    path: 'products/:id/edit',
    title: 'Product',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/products/product-editor').then((m) => m.ProductEditor),
  },
  {
    path: 'products/:id/translations',
    title: 'Product',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/product-translations-page').then((m) => m.ProductTranslationsPage),
    canDeactivate: [unsavedChangesGuard],
  },
  {
    path: 'website',
    title: 'Website beheren',
    pathMatch: 'full',
    title: 'Website',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/website-builder/website-admin-page')
        .then((m) => m.WebsiteAdminPage),
  },
  {
    path: 'website/layout',
    title: 'Homepage · Website',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/website-builder/website-builder-page')
        .then((m) => m.WebsiteBuilderPage),
  },
  {
    path: 'website/texts',
    title: 'Teksten · Website',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/website-builder/content-translations-page')
        .then((m) => m.ContentTranslationsPage),
  },
  {
    path: 'website/products',
    title: 'Producten · Website',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/website-builder/website-products-page')
        .then((m) => m.WebsiteProductsPage),
  },
  {
    path: 'website/categories',
    title: 'Categorieën · Website',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/website-builder/website-categories-page')
        .then((m) => m.WebsiteCategoriesPage),
  },
  {
    path: 'website/seo',
    title: 'SEO · Website',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { seoMode: true },
    loadComponent: () =>
      import('./features/website-builder/content-translations-page')
        .then((m) => m.ContentTranslationsPage),
  },
  {
    path: 'website/publication',
    title: 'Publicatie · Website',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/website-builder/website-publication-page')
        .then((m) => m.WebsitePublicationPage),
  },
  {
    path: 'catalog/texts',
    title: 'Catalogus PDF',
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
    title: 'Landen & vracht',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/country-list').then((m) => m.CountryList),
  },
  {
    path: 'costs',
    title: 'Kosten & bank',
    canActivate: [authGuard],
    loadComponent: () => import('./features/finance/costs-page').then((m) => m.CostsPage),
  },
  {
    path: 'stock/inventaris/telling/:id',
    title: 'Jaarinventaris',
    canActivate: [authGuard],
    loadComponent: () => import('./features/inventory/stock-count-page').then((m) => m.StockCountPage),
  },
  {
    path: 'stock/inventaris/afsluiting/:id',
    title: 'Jaarinventaris',
    canActivate: [authGuard],
    loadComponent: () => import('./features/inventory/stock-closing-page').then((m) => m.StockClosingPage),
  },
  {
    path: 'stock/inventaris',
    title: 'Jaarinventaris',
    canActivate: [authGuard],
    loadComponent: () => import('./features/inventory/inventory-page').then((m) => m.InventoryPage),
  },
  {
    path: 'stock',
    title: 'Voorraad',
    canActivate: [authGuard],
    loadComponent: () => import('./features/products/stock-page').then((m) => m.StockPage),
  },
  {
    path: 'barcodes',
    title: 'EAN-codes',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/barcode-pool-page').then((m) => m.BarcodePoolPage),
  },
  {
    path: 'stock-locations',
    title: 'Voorraadlocaties',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/stock-location-list').then((m) => m.StockLocationList),
  },
  {
    path: 'files',
    title: 'Documenten & media',
    canActivate: [authGuard],
    loadComponent: () => import('./features/files/files-page').then((m) => m.FilesPage),
  },
  { path: 'settings/documents-media', pathMatch: 'full', redirectTo: 'files' },
  {
    path: 'settings/deleted-items',
    title: 'Verwijderde items',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/deleted-items-page').then((m) => m.DeletedItemsPage),
  },
  {
    path: 'settings',
    title: 'Instellingen',
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'activity',
    title: 'Logboek',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/activity/activity-page').then((m) => m.ActivityPage),
  },
  {
    path: 'more',
    title: 'Meer',
    canActivate: [authGuard],
    loadComponent: () => import('./features/more/more-page').then((m) => m.MorePage),
  },

  /* Dutch addresses people type, and their detail forms (N26). */
  { path: 'verkoop', pathMatch: 'full', redirectTo: 'sales' },
  { path: 'verkoop/:id', pathMatch: 'full', redirectTo: 'sales/:id' },
  { path: 'inkoop', pathMatch: 'full', redirectTo: 'purchasing' },
  { path: 'inkoop/:id', pathMatch: 'full', redirectTo: 'purchasing/:id' },
  { path: 'producten', pathMatch: 'full', redirectTo: 'products' },
  { path: 'producten/:id', pathMatch: 'full', redirectTo: 'products/:id' },
  { path: 'voorraad', pathMatch: 'full', redirectTo: 'stock' },
  { path: 'klanten', pathMatch: 'full', redirectTo: 'customers' },
  { path: 'leveranciers', pathMatch: 'full', redirectTo: 'suppliers' },
  { path: 'instellingen', pathMatch: 'full', redirectTo: 'settings' },
  { path: 'kosten', pathMatch: 'full', redirectTo: 'costs' },
  { path: 'bank', pathMatch: 'full', redirectTo: 'costs' },
  { path: 'documenten', pathMatch: 'full', redirectTo: 'files' },
  { path: 'media', pathMatch: 'full', redirectTo: 'files' },
  /* one redirect per level: straight to the section 'analyses' itself redirects to */
  { path: 'analyse', pathMatch: 'full', redirectTo: 'analyses/cash' },
  { path: 'home', pathMatch: 'full', redirectTo: 'dashboard' },

  /* An address without a screen: a page that says so, inside the shell, behind the login. */
  {
    path: '**',
    title: 'Pagina niet gevonden',
    canActivate: [authGuard],
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
