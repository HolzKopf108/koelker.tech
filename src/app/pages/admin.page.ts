// src/app/pages/admin.page.ts
import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import type { ActiveElement, Chart, ChartConfiguration, ChartEvent, TooltipItem } from 'chart.js';

import {
  AdminApiService,
  AdminSummaryResponse,
  AdminTimeseriesPoint,
  AdminTimeseriesResponse,
} from '../admin/admin-api.service';
import {
  SEO_DEFAULT_IMAGE,
  SEO_DEFAULT_IMAGE_ALT,
  SEO_DEFAULT_KEYWORDS,
  SEO_SITE_URL,
} from '../seo/seo.constants';
import { SeoService } from '../seo/seo.service';
import { VERSION } from '../../version';

type LineChartConfig = ChartConfiguration<'line', number[], string>;
type ChartCtor = typeof import('chart.js/auto')['Chart'];
type ChartModule = {
  Chart?: ChartCtor;
  default?: ChartCtor;
};

@Component({
  standalone: true,
  selector: 'app-admin-page',
  templateUrl: './admin.page.html',
})
export class AdminPageComponent implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly adminApi = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);

  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private chartModule: ChartModule | null = null;
  private pageviewsChart: Chart<'line', number[], string> | null = null;
  private uniquesChart: Chart<'line', number[], string> | null = null;

  readonly daysOptions = [365, 90, 30, 7, 1];
  readonly selectedDays = signal<number>(30);
  readonly version = VERSION;

  readonly summary = signal<AdminSummaryResponse | null>(null);
  readonly series = signal<AdminTimeseriesPoint[]>([]);
  readonly chartSeries = signal<AdminTimeseriesPoint[]>([]);
  readonly sampleLabel = signal<string>('Täglich');
  readonly timezone = signal<string>('UTC');

  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly selectedPageviews = signal<AdminTimeseriesPoint | null>(null);
  readonly selectedUniques = signal<AdminTimeseriesPoint | null>(null);

  private readonly numberFormatter = new Intl.NumberFormat('de-DE');
  private readonly averageFormatter = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  @ViewChild('pageviewsCanvas') pageviewsCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('uniquesCanvas') uniquesCanvas?: ElementRef<HTMLCanvasElement>;

  constructor() {
    this.seo.update({
      title: 'Admin Dashboard | Linus Kölker',
      description: 'Adminbereich mit Analytics-Übersicht.',
      url: `${SEO_SITE_URL}/admin`,
      image: SEO_DEFAULT_IMAGE,
      imageAlt: SEO_DEFAULT_IMAGE_ALT,
      keywords: SEO_DEFAULT_KEYWORDS,
    });

    if (this.isBrowser) {
      void this.load();
    }
  }

  ngAfterViewInit() {
    if (this.isBrowser) {
      void this.renderCharts();
    }
  }

  ngOnDestroy() {
    this.destroyCharts();
  }

  formatNumber(value: number | null | undefined) {
    return this.numberFormatter.format(value ?? 0);
  }

  formatAverage(value: number | null | undefined) {
    return this.averageFormatter.format(value ?? 0);
  }

  formatDateLabel(date: string) {
    const [year, month, day] = date.split('-');
    if (!year || !month || !day) return date;
    return `${day}.${month}`;
  }

  async onDaysChange(value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.selectedDays.set(parsed);
    await this.load(parsed);
  }

  async logout() {
    try {
      await this.adminApi.logout();
    } finally {
      await this.router.navigateByUrl('/login');
    }
  }

  private async ensureAdmin() {
    const me = await this.adminApi.me();
    if (!me.isAdmin) {
      await this.router.navigateByUrl('/login');
      return false;
    }
    return true;
  }

  async load(days: number = this.selectedDays()) {
    if (!this.isBrowser) return;
    this.loading.set(true);
    this.error.set(null);

    try {
      const isAdmin = await this.ensureAdmin();
      if (!isAdmin) return;

      const [summary, timeseries] = await Promise.all([
        this.adminApi.summary(days),
        this.adminApi.timeseries(days, 'auto'),
      ]);

      this.applyData(summary, timeseries);
      await this.renderCharts();
    } catch {
      const stillAdmin = await this.ensureAdmin();
      if (stillAdmin) {
        this.error.set('Daten konnten nicht geladen werden.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  private applyData(summary: AdminSummaryResponse, timeseries: AdminTimeseriesResponse) {
    this.summary.set(summary);
    this.series.set(timeseries.series);
    this.chartSeries.set([]);
    this.sampleLabel.set(timeseries.sample.mode === 'weekly' ? 'Wöchentlich' : 'Täglich');
    this.timezone.set(timeseries.timezone ?? 'UTC');
    this.selectedPageviews.set(null);
    this.selectedUniques.set(null);
  }

  private async renderCharts() {
    if (!this.isBrowser) return;

    const data = this.series();
    if (!data.length) {
      this.destroyCharts();
      return;
    }

    const pageviewsCanvas = this.pageviewsCanvas?.nativeElement;
    const uniquesCanvas = this.uniquesCanvas?.nativeElement;
    if (!pageviewsCanvas || !uniquesCanvas) return;

    const chartModule = await this.loadChartModule();
    const ChartCtor = chartModule.Chart ?? chartModule.default;
    if (!ChartCtor) return;
    const chartData = this.downsampleForWidth(data);
    this.chartSeries.set(chartData);
    const labels = chartData.map((point) => this.formatDateLabel(point.date));
    const pageviewsData = chartData.map((point) => point.pageviews);
    const uniquesData = chartData.map((point) => point.uniques);
    const maxTicksLimit = this.isTinyScreen() ? 4 : this.isSmallScreen() ? 6 : 10;

    const baseOptions: LineChartConfig['options'] = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (context: TooltipItem<'line'>) => `${context.formattedValue}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#a1a1aa', autoSkip: true, maxTicksLimit },
          grid: { color: 'rgba(63, 63, 70, 0.35)' },
        },
        y: {
          ticks: { color: '#a1a1aa' },
          grid: { color: 'rgba(63, 63, 70, 0.35)' },
        },
      },
    };

    if (!this.pageviewsChart) {
      this.pageviewsChart = new ChartCtor(pageviewsCanvas.getContext('2d')!, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Pageviews',
              data: pageviewsData,
              borderColor: '#34d399',
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              borderWidth: 2,
              pointRadius: 2,
              pointHoverRadius: 4,
              tension: 0.3,
              fill: true,
            },
          ],
        },
        options: {
          ...baseOptions,
          onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            this.selectedPageviews.set(chartData[idx] ?? null);
          },
        },
      });
    } else {
      this.pageviewsChart.data.labels = labels;
      this.pageviewsChart.data.datasets[0].data = pageviewsData;
      this.pageviewsChart.update();
    }

    if (!this.uniquesChart) {
      this.uniquesChart = new ChartCtor(uniquesCanvas.getContext('2d')!, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Uniques',
              data: uniquesData,
              borderColor: '#4ade80',
              backgroundColor: 'rgba(34, 197, 94, 0.18)',
              borderWidth: 2,
              pointRadius: 2,
              pointHoverRadius: 4,
              tension: 0.3,
              fill: true,
            },
          ],
        },
        options: {
          ...baseOptions,
          onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
            if (!elements.length) return;
            const idx = elements[0].index;
            this.selectedUniques.set(chartData[idx] ?? null);
          },
        },
      });
    } else {
      this.uniquesChart.data.labels = labels;
      this.uniquesChart.data.datasets[0].data = uniquesData;
      this.uniquesChart.update();
    }
  }

  private async loadChartModule(): Promise<ChartModule> {
    if (!this.chartModule) {
      this.chartModule = (await import('chart.js/auto')) as unknown as ChartModule;
    }
    return this.chartModule;
  }

  private destroyCharts() {
    if (this.pageviewsChart) {
      this.pageviewsChart.destroy();
      this.pageviewsChart = null;
    }
    if (this.uniquesChart) {
      this.uniquesChart.destroy();
      this.uniquesChart = null;
    }
  }

  private isTinyScreen() {
    return typeof window !== 'undefined' && window.innerWidth <= 360;
  }

  private isSmallScreen() {
    return typeof window !== 'undefined' && window.innerWidth <= 520;
  }

  private downsampleForWidth(data: AdminTimeseriesPoint[]) {
    if (!this.isTinyScreen()) return data;
    const maxPoints = 24;
    if (data.length <= maxPoints) return data;
    const step = Math.ceil(data.length / maxPoints);
    return data.filter((_point, index) => index % step === 0);
  }
}
