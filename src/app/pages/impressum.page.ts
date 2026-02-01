import { Component, inject } from '@angular/core';

import {
  SEO_DEFAULT_IMAGE,
  SEO_DEFAULT_IMAGE_ALT,
  SEO_DEFAULT_KEYWORDS,
  SEO_SITE_URL,
} from '../seo/seo.constants';
import { SeoService } from '../seo/seo.service';

@Component({
  standalone: true,
  selector: 'app-impressum-page',
  templateUrl: './impressum.page.html',
})
export class ImpressumPage {
  private readonly seo = inject(SeoService);

  constructor() {
    this.seo.update({
      title: 'Impressum | Linus Kölker',
      description:
        'Impressum und rechtliche Angaben zur Website von Linus Kölker.',
      url: `${SEO_SITE_URL}/impressum`,
      image: SEO_DEFAULT_IMAGE,
      imageAlt: SEO_DEFAULT_IMAGE_ALT,
      keywords: SEO_DEFAULT_KEYWORDS,
    });
  }
}
