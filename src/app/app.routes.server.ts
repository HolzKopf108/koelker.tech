// src/app/app.routes.server.ts
import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Home: echtes SSR (pro Request)
  { path: '', renderMode: RenderMode.Server },

  // Legal: kann stabil prerendered werden
  { path: 'impressum', renderMode: RenderMode.Prerender },
  { path: 'datenschutz', renderMode: RenderMode.Prerender },

  // Rest: SSR fallback (oder auch Prerender, wenn du nur statisch willst)
  { path: '**', renderMode: RenderMode.Server },
];
