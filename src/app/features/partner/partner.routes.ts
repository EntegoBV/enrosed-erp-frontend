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
        loadComponent: () => import('./partner-melden').then((m) => m.PartnerMelden),
      },
      {
        path: 'meldingen',
        title: 'Meldingen',
        loadComponent: () => import('./partner-meldingen').then((m) => m.PartnerMeldingen),
      },
      /* Any other /partner address: the portal's home. */
      { path: '**', redirectTo: '' },
    ],
  },
];
