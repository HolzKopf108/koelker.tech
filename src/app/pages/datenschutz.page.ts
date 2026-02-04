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
  selector: 'app-datenschutz-page',
  templateUrl: './datenschutz.page.html',
})
export class DatenschutzPageComponent {
  private readonly seo = inject(SeoService);

  constructor() {
    this.seo.update({
      title: 'Datenschutzerklärung | Linus Kölker',
      description:
        'Datenschutzerklärung zur Website von Linus Kölker mit Informationen zur Datenverarbeitung.',
      url: `${SEO_SITE_URL}/datenschutz`,
      image: SEO_DEFAULT_IMAGE,
      imageAlt: SEO_DEFAULT_IMAGE_ALT,
      keywords: SEO_DEFAULT_KEYWORDS,
    });
  }
}
