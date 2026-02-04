// src/app/admin/admin.guard.ts
import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AdminApiService } from './admin-api.service';

export const adminGuard: CanActivateFn = async () => {
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const adminApi = inject(AdminApiService);
  const router = inject(Router);

  try {
    const me = await adminApi.me();
    if (me.isAdmin) return true;
  } catch {
    // ignore
  }

  return router.parseUrl('/login');
};
