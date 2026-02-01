// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { HomePage } from './pages/home.page';
import { ImpressumPage } from './pages/impressum.page';
import { DatenschutzPage } from './pages/datenschutz.page';

export const routes: Routes = [
  { path: '', component: HomePage, pathMatch: 'full' },
  { path: 'impressum', component: ImpressumPage },
  { path: 'datenschutz', component: DatenschutzPage },
  { path: '**', redirectTo: '' },
];
