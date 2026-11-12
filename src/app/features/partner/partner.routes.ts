import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../core/guards/unsaved-changes.guard';
import { PartnerShell } from './partner-shell';

/**
 * The partner portal's screens (/partner, behind partnerGuard in app.routes).
 * One lazy chunk: staff never load it, a partner never loads a staff screen.
 */
export const PARTNER_ROUTES: Routes = [
  {
    path: '',
    component: PartnerShell,
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Partnerportaal',
        loadComponent: () => import('./partner-home').then((m) => m.PartnerHome),
      },
      {
        path: 'melden',
        title: 'Melden',
        canDeactivate: [unsavedChangesGuard],
        /* Another ?bewerk (or none) on the same page asks first when the form holds unsaved changes. */
        runGuardsAndResolvers: (from, to) => from.queryParamMap.get('bewerk') !== to.queryParamMap.get('bewerk'),
        loadComponent: () => import('./partner-melden').then((m) => m.PartnerMelden),
      },
      {
        path: 'meldingen',
        title: 'Meldingen',
        loadComponent: () => import('./partner-meldingen').then((m) => m.PartnerMeldingen),
      },
      {
        path: 'containers',
        title: 'Containers',
        loadComponent: () => import('./partner-containers').then((m) => m.PartnerContainers),
      },
      /* Any other /partner address: the portal's home. */
      { path: '**', redirectTo: '' },
    ],
  },
];
