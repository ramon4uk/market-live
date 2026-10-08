import { Routes } from '@angular/router';
import { Dashboard } from './pages/dashboard/dashboard';
import { Settings } from './pages/settings/settings';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: Dashboard, title: 'Market dashboard' },
  { path: 'settings', component: Settings, title: 'Settings' },
  { path: '**', redirectTo: 'dashboard' },
];
