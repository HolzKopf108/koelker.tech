// src/app/admin/admin-api.service.ts
import { Injectable } from '@angular/core';

export type AdminMeResponse = {
  isAdmin: boolean;
  username?: string | null;
};

export type AdminSummaryResponse = {
  days: number;
  timezone: string;
  totalPageviews: number;
  totalUniques: number;
  averagePageviews: number;
  averageUniques: number;
};

export type AdminTimeseriesPoint = {
  date: string;
  pageviews: number;
  uniques: number;
};

export type AdminTimeseriesResponse = {
  days: number;
  timezone: string;
  sample: { mode: 'daily' | 'weekly'; step: number };
  series: AdminTimeseriesPoint[];
};

export type AdminLoginResult = {
  ok: boolean;
  status: number;
  message?: string;
  retryAfterMinutes?: number;
};

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private async requestJson<T>(path: string, options: RequestInit = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
      ...options,
    });

    const contentType = res.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? ((await res.json().catch(() => null)) as T | null) : null;

    return { res, data };
  }

  async me(): Promise<AdminMeResponse> {
    try {
      const { res, data } = await this.requestJson<AdminMeResponse>('/api/admin/auth/v1/me');
      if (!res.ok || !data) return { isAdmin: false };
      return data;
    } catch {
      return { isAdmin: false };
    }
  }

  async login(username: string, password: string): Promise<AdminLoginResult> {
    const { res, data } = await this.requestJson<{
      message?: string;
      retryAfterMinutes?: number;
    }>('/api/admin/auth/v1/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      return { ok: true, status: res.status };
    }

    return {
      ok: false,
      status: res.status,
      message: data?.message,
      retryAfterMinutes: data?.retryAfterMinutes,
    };
  }

  async logout(): Promise<void> {
    await this.requestJson('/api/admin/auth/v1/logout', { method: 'POST' });
  }

  async summary(days: number): Promise<AdminSummaryResponse> {
    const { res, data } = await this.requestJson<AdminSummaryResponse>(
      `/api/admin/stats/v1/summary?days=${encodeURIComponent(days)}`,
    );
    if (!res.ok || !data) {
      throw new Error('summary_failed');
    }
    return data;
  }

  async timeseries(days: number, sample: 'auto' | 'daily' | 'weekly' = 'auto'): Promise<AdminTimeseriesResponse> {
    const { res, data } = await this.requestJson<AdminTimeseriesResponse>(
      `/api/admin/stats/v1/timeseries?days=${encodeURIComponent(days)}&sample=${encodeURIComponent(sample)}`,
    );
    if (!res.ok || !data) {
      throw new Error('timeseries_failed');
    }
    return data;
  }
}
