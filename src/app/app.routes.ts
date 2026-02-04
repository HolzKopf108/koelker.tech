// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { adminGuard } from './admin/admin.guard';
import { AdminPageComponent } from './pages/admin.page';
import { HomePageComponent } from './pages/home.page';
import { ImpressumPageComponent } from './pages/impressum.page';
import { DatenschutzPageComponent } from './pages/datenschutz.page';
import { LoginPageComponent } from './pages/login.page';

export const routes: Routes = [
  { path: '', component: HomePageComponent, pathMatch: 'full' },
  { path: 'login', component: LoginPageComponent },
  { path: 'admin', component: AdminPageComponent, canActivate: [adminGuard] },
  { path: 'impressum', component: ImpressumPageComponent },
  { path: 'datenschutz', component: DatenschutzPageComponent },
  { path: '**', redirectTo: '' },
];
