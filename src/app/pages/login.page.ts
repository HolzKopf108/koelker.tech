// src/app/pages/login.page.ts
import { isPlatformBrowser } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';

import { AdminApiService } from '../admin/admin-api.service';
import {
  SEO_DEFAULT_IMAGE,
  SEO_DEFAULT_IMAGE_ALT,
  SEO_DEFAULT_KEYWORDS,
  SEO_SITE_URL,
} from '../seo/seo.constants';
import { SeoService } from '../seo/seo.service';

@Component({
  standalone: true,
  selector: 'app-login-page',
  templateUrl: './login.page.html',
  imports: [FormsModule],
})
export class LoginPageComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly adminApi = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);

  username = '';
  password = '';

  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.seo.update({
      title: 'Admin Login | Linus Kölker',
      description: 'Login für den Adminbereich.',
      url: `${SEO_SITE_URL}/login`,
      image: SEO_DEFAULT_IMAGE,
      imageAlt: SEO_DEFAULT_IMAGE_ALT,
      keywords: SEO_DEFAULT_KEYWORDS,
    });

    if (isPlatformBrowser(this.platformId)) {
      void this.redirectIfAuthed();
    }
  }

  async redirectIfAuthed() {
    const me = await this.adminApi.me();
    if (me.isAdmin) {
      await this.router.navigateByUrl('/admin');
    }
  }

  async submit() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await this.adminApi.login(this.username.trim(), this.password);
      if (result.ok) {
        await this.router.navigateByUrl('/admin');
        return;
      }

      if (result.status === 429) {
        if (result.retryAfterMinutes) {
          this.error.set(`Versuche es in ${result.retryAfterMinutes} Minuten erneut.`);
        } else {
          this.error.set('Versuche es später erneut.');
        }
        return;
      }

      this.error.set(result.message ?? 'Falsche Kombination');
    } catch {
      this.error.set('Ein Fehler ist aufgetreten. Bitte erneut versuchen.');
    } finally {
      this.loading.set(false);
    }
  }
}
