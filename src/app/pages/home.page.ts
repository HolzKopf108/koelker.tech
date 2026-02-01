// src/app/pages/home.page.ts
import { Component, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

type RepoCard = {
  id: number;
  name: string;
  url: string;
  description: string | null;
  languages: string[];
};

@Component({
  standalone: true,
  selector: 'app-home-page',
  templateUrl: './home.page.html',
})
export class HomePage {
  private readonly platformId = inject(PLATFORM_ID);

  readonly email = 'linus.koelker@gmx.de';

  readonly repos = signal<RepoCard[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  readonly copied = signal<boolean>(false);

  constructor() {
    // IMPORTANT: Only fetch in browser (avoid SSR doing self-fetch /api during render)
    if (isPlatformBrowser(this.platformId)) {
      void this.loadPinnedRepos();
    } else {
      // SSR renders fine without projects; client hydrates and loads later
      this.loading.set(false);
    }
  }

  async loadPinnedRepos() {
    try {
      this.loading.set(true);
      this.error.set(null);

      const res = await fetch('/api/pinned-repos', {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = (await res.json()) as RepoCard[];
      this.repos.set(data);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Unknown error');
      this.repos.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  mailtoHref() {
    return `mailto:${this.email}?subject=${encodeURIComponent('Kontakt über koelker.tech')}`;
  }

  async copyEmail() {
    try {
      // clipboard is browser-only; we already only call this from UI in browser
      await navigator.clipboard.writeText(this.email);
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1200);
    } catch {
      // fallback: try old-school selection
      try {
        const ta = document.createElement('textarea');
        ta.value = this.email;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);

        this.copied.set(true);
        window.setTimeout(() => this.copied.set(false), 1200);
      } catch {
        this.copied.set(false);
      }
    }
  }
}
