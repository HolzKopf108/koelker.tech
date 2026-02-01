// src/app/seo/seo.service.ts
import { Inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';

import { SEO_SITE_NAME } from './seo.constants';

type SeoConfig = {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt?: string;
  siteName?: string;
  type?: string;
  locale?: string;
  keywords?: string[];
  robots?: string;
  canonical?: string;
  jsonLd?: Record<string, unknown>;
};

@Injectable({ providedIn: 'root' })
export class SeoService {
  constructor(
    private readonly meta: Meta,
    private readonly title: Title,
    @Inject(DOCUMENT) private readonly document: Document,
  ) {}

  update(config: SeoConfig) {
    const siteName = config.siteName ?? SEO_SITE_NAME;
    const locale = config.locale ?? 'de_DE';
    const type = config.type ?? 'website';
    const robots =
      config.robots ??
      'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1';

    this.title.setTitle(config.title);

    this.meta.updateTag({ name: 'description', content: config.description });
    this.meta.updateTag({ name: 'robots', content: robots });
    this.meta.updateTag({ name: 'author', content: siteName });

    if (config.keywords?.length) {
      this.meta.updateTag({ name: 'keywords', content: config.keywords.join(', ') });
    }

    this.meta.updateTag({ property: 'og:title', content: config.title });
    this.meta.updateTag({ property: 'og:description', content: config.description });
    this.meta.updateTag({ property: 'og:url', content: config.url });
    this.meta.updateTag({ property: 'og:type', content: type });
    this.meta.updateTag({ property: 'og:site_name', content: siteName });
    this.meta.updateTag({ property: 'og:locale', content: locale });
    this.meta.updateTag({ property: 'og:image', content: config.image });

    if (config.imageAlt) {
      this.meta.updateTag({ property: 'og:image:alt', content: config.imageAlt });
    }

    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: config.title });
    this.meta.updateTag({ name: 'twitter:description', content: config.description });
    this.meta.updateTag({ name: 'twitter:image', content: config.image });

    if (config.imageAlt) {
      this.meta.updateTag({ name: 'twitter:image:alt', content: config.imageAlt });
    }

    this.setCanonical(config.canonical ?? config.url);

    if (config.jsonLd) {
      this.setJsonLd(config.jsonLd);
    } else {
      this.removeJsonLd();
    }
  }

  private setCanonical(url: string) {
    const existing = this.document.head.querySelector("link[rel='canonical']");

    if (existing) {
      existing.setAttribute('href', url);
      return;
    }

    const link = this.document.createElement('link');
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', url);
    this.document.head.appendChild(link);
  }

  private setJsonLd(data: Record<string, unknown>) {
    const script = this.ensureJsonLdScript();
    script.textContent = JSON.stringify(data);
  }

  private removeJsonLd() {
    const existing = this.document.head.querySelector("script[data-seo='jsonld']");
    if (existing) {
      existing.remove();
    }
  }

  private ensureJsonLdScript(): HTMLScriptElement {
    const existing = this.document.head.querySelector("script[data-seo='jsonld']");
    if (existing && existing instanceof HTMLScriptElement) {
      return existing;
    }

    const script = this.document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.setAttribute('data-seo', 'jsonld');
    this.document.head.appendChild(script);
    return script;
  }
}