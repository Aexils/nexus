import {
  Component, ChangeDetectionStrategy, ChangeDetectorRef,
  inject, signal, computed, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  BodyMeasurement, BodySettings, BodyMetricKey, BodyMetricDef,
  BODY_METRIC_DEFS,
} from '@nexus/shared-types';

const TOKEN_KEY = 'nexus-body-token';

interface ChartPoint { x: number; y: number; value: number; date: string; }

@Component({
  selector: 'app-marion-body-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './marion-body-page.html',
  styleUrl: './marion-body-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarionBodyPage implements OnInit {
  private readonly http   = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly cdr    = inject(ChangeDetectorRef);

  readonly metricDefs = BODY_METRIC_DEFS;

  // ── Auth ─────────────────────────────────────────────────────────────────

  readonly hasPassword     = signal(false);
  readonly isAuthenticated = signal(false);
  readonly setupMode       = signal(false);
  readonly authError       = signal('');
  readonly authLoading     = signal(false);

  passwordInput  = '';
  confirmInput   = '';
  newPwdInput    = '';
  confirmPwdInput = '';
  oldPwdInput    = '';
  pwdChangeError = signal('');
  pwdChangeOk    = signal(false);

  private get token(): string { return localStorage.getItem(TOKEN_KEY) ?? ''; }
  private set token(v: string) { localStorage.setItem(TOKEN_KEY, v); }
  private clearToken(): void { localStorage.removeItem(TOKEN_KEY); }

  // ── Data ─────────────────────────────────────────────────────────────────

  readonly measurements = signal<BodyMeasurement[]>([]);
  readonly settings     = signal<BodySettings | null>(null);
  readonly loading      = signal(false);
  readonly saving       = signal(false);
  readonly saveSuccess  = signal(false);
  readonly deleteId     = signal<number | null>(null);

  // ── UI ───────────────────────────────────────────────────────────────────

  readonly activeTab    = signal<'entry' | 'charts' | 'history' | 'settings'>('entry');
  readonly activeZone   = signal<BodyMetricKey | null>(null);
  readonly formOpen     = signal(true);

  // ── Form ─────────────────────────────────────────────────────────────────

  readonly todayDate = new Date().toISOString().slice(0, 10);
  formDate    = this.todayDate;
  formValues: Record<string, string> = {};

  // ── Chart ────────────────────────────────────────────────────────────────

  visibleMetrics = signal<Set<BodyMetricKey>>(new Set(['chest', 'waist', 'hips', 'thighLeft']));

  // ── Settings form ────────────────────────────────────────────────────────

  settingsValues: Record<string, string> = {};
  settingsSaveOk = signal(false);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.http.get<{ hasPassword: boolean }>('/api/body/status').subscribe({
      next: res => {
        this.hasPassword.set(res.hasPassword);
        if (!res.hasPassword) {
          this.setupMode.set(true);
        } else if (this.token) {
          this.verifySession();
        }
        this.cdr.markForCheck();
      },
    });
  }

  private verifySession(): void {
    this.http.post<{ ok: boolean }>('/api/body/verify', { token: this.token }).subscribe({
      next: res => {
        if (res.ok) {
          this.isAuthenticated.set(true);
          this.loadAll();
        } else {
          this.clearToken();
        }
        this.cdr.markForCheck();
      },
    });
  }

  private loadAll(): void {
    this.loading.set(true);
    const headers = { 'X-Body-Token': this.token };

    this.http.get<BodyMeasurement[]>('/api/body/measurements', { headers }).subscribe({
      next: data => {
        this.measurements.set(data);
        this.prefillForm(data);
        this.cdr.markForCheck();
      },
    });

    this.http.get<BodySettings>('/api/body/settings', { headers }).subscribe({
      next: data => {
        this.settings.set(data);
        this.initSettingsForm(data);
        this.loading.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  private prefillForm(measurements: BodyMeasurement[]): void {
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = measurements.find(m => m.date === today);
    if (todayEntry) {
      this.formDate = today;
      for (const def of BODY_METRIC_DEFS) {
        const v = (todayEntry as any)[def.key];
        if (v != null) this.formValues[def.key] = String(v);
      }
    }
  }

  private initSettingsForm(s: BodySettings): void {
    this.settingsValues['height']           = s.height           != null ? String(s.height)           : '';
    this.settingsValues['targetWeight']     = s.targetWeight     != null ? String(s.targetWeight)     : '';
    this.settingsValues['targetNeck']       = s.targetNeck       != null ? String(s.targetNeck)       : '';
    this.settingsValues['targetChest']      = s.targetChest      != null ? String(s.targetChest)      : '';
    this.settingsValues['targetAbdomen']    = s.targetAbdomen    != null ? String(s.targetAbdomen)    : '';
    this.settingsValues['targetWaist']      = s.targetWaist      != null ? String(s.targetWaist)      : '';
    this.settingsValues['targetHips']       = s.targetHips       != null ? String(s.targetHips)       : '';
    this.settingsValues['targetArmLeft']    = s.targetArmLeft    != null ? String(s.targetArmLeft)    : '';
    this.settingsValues['targetArmRight']   = s.targetArmRight   != null ? String(s.targetArmRight)   : '';
    this.settingsValues['targetThighLeft']  = s.targetThighLeft  != null ? String(s.targetThighLeft)  : '';
    this.settingsValues['targetThighRight'] = s.targetThighRight != null ? String(s.targetThighRight) : '';
    this.settingsValues['targetCalfLeft']   = s.targetCalfLeft   != null ? String(s.targetCalfLeft)   : '';
    this.settingsValues['targetCalfRight']  = s.targetCalfRight  != null ? String(s.targetCalfRight)  : '';
  }

  // ── Auth handlers ─────────────────────────────────────────────────────────

  doSetup(): void {
    if (this.passwordInput.length < 4) { this.authError.set('Minimum 4 caractères.'); return; }
    if (this.passwordInput !== this.confirmInput) { this.authError.set('Les mots de passe ne correspondent pas.'); return; }
    this.authLoading.set(true);
    this.http.post<{ ok: boolean; token: string }>('/api/body/setup', { password: this.passwordInput }).subscribe({
      next: res => {
        this.token = res.token;
        this.hasPassword.set(true);
        this.setupMode.set(false);
        this.isAuthenticated.set(true);
        this.authLoading.set(false);
        this.loadAll();
        this.cdr.markForCheck();
      },
      error: err => {
        this.authError.set(err.error?.message ?? 'Erreur lors de la configuration.');
        this.authLoading.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  doLogin(): void {
    if (!this.passwordInput) { this.authError.set('Entrez votre mot de passe.'); return; }
    this.authLoading.set(true);
    this.http.post<{ ok: boolean; token: string }>('/api/body/login', { password: this.passwordInput }).subscribe({
      next: res => {
        if (res.ok && res.token) {
          this.token = res.token;
          this.isAuthenticated.set(true);
          this.authLoading.set(false);
          this.authError.set('');
          this.loadAll();
        } else {
          this.authError.set('Mot de passe incorrect.');
          this.authLoading.set(false);
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.authError.set('Mot de passe incorrect.');
        this.authLoading.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  doLogout(): void {
    this.clearToken();
    this.isAuthenticated.set(false);
    this.measurements.set([]);
    this.settings.set(null);
    this.passwordInput = '';
    this.cdr.markForCheck();
  }

  doChangePassword(): void {
    this.pwdChangeError.set('');
    this.pwdChangeOk.set(false);
    if (this.newPwdInput.length < 4) { this.pwdChangeError.set('Minimum 4 caractères.'); return; }
    if (this.newPwdInput !== this.confirmPwdInput) { this.pwdChangeError.set('Les mots de passe ne correspondent pas.'); return; }
    this.http.post<{ ok: boolean; token: string }>(
      '/api/body/change-password',
      { oldPassword: this.oldPwdInput, newPassword: this.newPwdInput },
      { headers: { 'X-Body-Token': this.token } },
    ).subscribe({
      next: res => {
        this.token = res.token;
        this.pwdChangeOk.set(true);
        this.oldPwdInput = '';
        this.newPwdInput = '';
        this.confirmPwdInput = '';
        this.cdr.markForCheck();
      },
      error: err => {
        this.pwdChangeError.set(err.error?.message ?? 'Mot de passe actuel incorrect.');
        this.cdr.markForCheck();
      },
    });
  }

  // ── Silhouette interaction ────────────────────────────────────────────────

  setActiveZone(key: BodyMetricKey | null): void {
    this.activeZone.set(key);
    if (key && !this.formOpen()) this.formOpen.set(true);
    if (key) {
      setTimeout(() => {
        const el = document.getElementById(`body-input-${key}`);
        el?.focus();
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }

  zoneHasValue(key: BodyMetricKey): boolean {
    return !!this.formValues[key] && this.formValues[key] !== '';
  }

  zoneValue(key: BodyMetricKey): string {
    const v = this.formValues[key];
    return v ? v : '';
  }

  metricColor(key: BodyMetricKey): string {
    return BODY_METRIC_DEFS.find(d => d.key === key)?.color ?? '#888';
  }

  metricLabel(key: BodyMetricKey): string {
    return BODY_METRIC_DEFS.find(d => d.key === key)?.label ?? key;
  }

  isEnabled(key: BodyMetricKey): boolean {
    return this.settings()?.enabledMetrics.includes(key) ?? true;
  }

  enabledDefs(): BodyMetricDef[] {
    const s = this.settings();
    if (!s) return BODY_METRIC_DEFS;
    return BODY_METRIC_DEFS.filter(d => s.enabledMetrics.includes(d.key));
  }

  hasMeasurementDefs(): boolean {
    return this.enabledDefs().some(d => d.key !== 'weight');
  }

  // ── Save measurement ──────────────────────────────────────────────────────

  saveMeasurement(): void {
    const data: any = { date: this.formDate };
    let hasAny = false;
    for (const def of BODY_METRIC_DEFS) {
      const raw = this.formValues[def.key];
      if (raw != null && String(raw).trim() !== '') {
        const v = parseFloat(String(raw));
        if (!isNaN(v) && v > 0) { data[def.key] = v; hasAny = true; }
      }
    }
    if (!hasAny) return;

    this.saving.set(true);
    this.http.post<BodyMeasurement>(
      '/api/body/measurements', data,
      { headers: { 'X-Body-Token': this.token } },
    ).subscribe({
      next: saved => {
        const list = this.measurements();
        const idx = list.findIndex(m => m.date === saved.date);
        if (idx >= 0) {
          const updated = [...list]; updated[idx] = saved;
          this.measurements.set(updated);
        } else {
          this.measurements.set([saved, ...list].sort((a, b) => b.date.localeCompare(a.date)));
        }
        this.saving.set(false);
        this.saveSuccess.set(true);
        setTimeout(() => { this.saveSuccess.set(false); this.cdr.markForCheck(); }, 3000);
        this.cdr.markForCheck();
      },
      error: () => { this.saving.set(false); this.cdr.markForCheck(); },
    });
  }

  deleteMeasurement(id: number): void {
    this.http.delete<{ ok: boolean }>(
      `/api/body/measurements/${id}`,
      { headers: { 'X-Body-Token': this.token } },
    ).subscribe({
      next: () => {
        this.measurements.set(this.measurements().filter(m => m.id !== id));
        this.deleteId.set(null);
        this.cdr.markForCheck();
      },
    });
  }

  // ── Settings save ─────────────────────────────────────────────────────────

  saveSettings(): void {
    const s = this.settings();
    if (!s) return;
    const parse = (k: string) => { const v = this.settingsValues[k]; return v ? parseFloat(v) : undefined; };
    const body: Partial<BodySettings> = {
      height:           parse('height'),
      targetWeight:     parse('targetWeight'),
      targetNeck:       parse('targetNeck'),
      targetChest:      parse('targetChest'),
      targetAbdomen:    parse('targetAbdomen'),
      targetWaist:      parse('targetWaist'),
      targetHips:       parse('targetHips'),
      targetArmLeft:    parse('targetArmLeft'),
      targetArmRight:   parse('targetArmRight'),
      targetThighLeft:  parse('targetThighLeft'),
      targetThighRight: parse('targetThighRight'),
      targetCalfLeft:   parse('targetCalfLeft'),
      targetCalfRight:  parse('targetCalfRight'),
      enabledMetrics:   s.enabledMetrics,
    };
    this.http.put<BodySettings>(
      '/api/body/settings', body,
      { headers: { 'X-Body-Token': this.token } },
    ).subscribe({
      next: updated => {
        this.settings.set(updated);
        this.settingsSaveOk.set(true);
        setTimeout(() => { this.settingsSaveOk.set(false); this.cdr.markForCheck(); }, 3000);
        this.cdr.markForCheck();
      },
    });
  }

  toggleMetric(key: BodyMetricKey): void {
    const s = this.settings();
    if (!s) return;
    const enabled = [...s.enabledMetrics];
    const idx = enabled.indexOf(key);
    if (idx >= 0) enabled.splice(idx, 1);
    else enabled.push(key);
    this.settings.set({ ...s, enabledMetrics: enabled });
  }

  toggleChartMetric(key: BodyMetricKey): void {
    const set = new Set(this.visibleMetrics());
    if (set.has(key)) set.delete(key); else set.add(key);
    this.visibleMetrics.set(set);
  }

  // ── Computed stats ────────────────────────────────────────────────────────

  readonly lastMeasurement = computed(() => this.measurements()[0] ?? null);
  readonly prevMeasurement = computed(() => this.measurements()[1] ?? null);

  readonly bmi = computed(() => {
    const s = this.settings();
    const last = this.lastMeasurement();
    if (!s?.height || !last?.weight) return null;
    const h = s.height / 100;
    return +(last.weight / (h * h)).toFixed(1);
  });

  readonly bmiCategory = computed(() => {
    const b = this.bmi();
    if (b === null) return null;
    if (b < 18.5) return { label: 'Insuffisance pondérale', cls: 'bmi-low' };
    if (b < 25)   return { label: 'Poids normal', cls: 'bmi-ok' };
    if (b < 30)   return { label: 'Surpoids', cls: 'bmi-warn' };
    return { label: 'Obésité', cls: 'bmi-bad' };
  });

  readonly weightDelta = computed(() => {
    const last = this.lastMeasurement();
    const prev = this.prevMeasurement();
    if (!last?.weight || !prev?.weight) return null;
    return +(last.weight - prev.weight).toFixed(1);
  });

  readonly motivationalMessage = computed((): { text: string; type: 'good' | 'info' | 'warn' } => {
    const list = this.measurements();
    if (list.length === 0) return { text: 'Bienvenue Marion ! Commence par ajouter ta première mesure.', type: 'info' };

    const last = this.lastMeasurement()!;
    const delta = this.weightDelta();

    if (delta !== null) {
      if (delta < -1.5) return { text: `Bravo Marion ! Tu as perdu ${Math.abs(delta)} kg depuis ta dernière mesure. Continue comme ça ! 🔥`, type: 'good' };
      if (delta < 0)    return { text: `Belle progression ! ${Math.abs(delta)} kg de perdus. Chaque gramme compte ! 💪`, type: 'good' };
      if (delta > 1)    return { text: `Ne te décourage pas, la perte de poids n'est jamais linéaire. Reste concentrée sur tes objectifs ! 🌟`, type: 'warn' };
      return { text: `Stable cette semaine — la régularité est la clé du succès ! 🎯`, type: 'info' };
    }

    const s = this.settings();
    if (s?.targetWeight && last.weight) {
      const diff = +(last.weight - s.targetWeight).toFixed(1);
      if (diff <= 0) return { text: `Objectif atteint ! Tu es à ${Math.abs(diff)} kg sous ton objectif. Félicitations ! 🏆`, type: 'good' };
      if (diff < 3)  return { text: `Plus que ${diff} kg pour atteindre ton objectif. Tu y es presque ! 💫`, type: 'good' };
      return { text: `Encore ${diff} kg à perdre pour atteindre ton objectif. Courage, tu peux le faire ! 💪`, type: 'info' };
    }

    return { text: `Super, tu gardes un suivi régulier ! Continue à enregistrer tes mesures chaque semaine. 📈`, type: 'info' };
  });

  // ── Measurement deltas ─────────────────────────────────────────────────────

  getDelta(key: BodyMetricKey): { value: number; direction: 'down' | 'up' | 'same' } | null {
    const last = this.lastMeasurement();
    const prev = this.prevMeasurement();
    if (!last || !prev) return null;
    const a = (last as any)[key] as number | undefined;
    const b = (prev as any)[key] as number | undefined;
    if (a == null || b == null) return null;
    const delta = +(a - b).toFixed(1);
    return { value: Math.abs(delta), direction: delta < 0 ? 'down' : delta > 0 ? 'up' : 'same' };
  }

  progressToGoal(key: BodyMetricKey): number | null {
    const s = this.settings();
    const last = this.lastMeasurement();
    if (!s || !last) return null;
    const targetKey = 'target' + key.charAt(0).toUpperCase() + key.slice(1) as keyof BodySettings;
    const target = s[targetKey] as number | undefined;
    const current = (last as any)[key] as number | undefined;
    if (target == null || current == null) return null;
    // For weight/measurements, smaller is better
    const initial = this.measurements().slice(-1)[0] as any;
    const initialVal = initial?.[key] as number | undefined;
    if (initialVal == null || initialVal === target) return null;
    const progress = ((initialVal - current) / (initialVal - target)) * 100;
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  // ── Charts ────────────────────────────────────────────────────────────────

  readonly CHART_W = 600;
  readonly CHART_H = 180;
  readonly CHART_PAD_X = 48;
  readonly CHART_PAD_Y = 20;

  weightChartData = computed(() => {
    const list = [...this.measurements()].filter(m => m.weight != null).sort((a, b) => a.date.localeCompare(b.date));
    if (list.length < 2) return null;
    const values = list.map(m => m.weight!);
    const min = Math.min(...values) - 1;
    const max = Math.max(...values) + 1;
    const target = this.settings()?.targetWeight;
    return { list, values, min, max, target };
  });

  measurementsChartData = computed(() => {
    const visible = this.visibleMetrics();
    const keys = BODY_METRIC_DEFS.filter(d => d.key !== 'weight' && visible.has(d.key)).map(d => d.key);
    if (keys.length === 0) return null;

    const list = [...this.measurements()].sort((a, b) => a.date.localeCompare(b.date));
    if (list.length < 2) return null;

    const allValues: number[] = [];
    for (const key of keys) {
      for (const m of list) {
        const v = (m as any)[key] as number | undefined;
        if (v != null) allValues.push(v);
      }
    }
    if (allValues.length === 0) return null;

    const min = Math.min(...allValues) - 2;
    const max = Math.max(...allValues) + 2;
    return { list, keys, min, max };
  });

  toChartPoints(data: { list: BodyMeasurement[]; min: number; max: number }, key: BodyMetricKey | 'weight'): ChartPoint[] {
    const { list, min, max } = data;
    const W = this.CHART_W - 2 * this.CHART_PAD_X;
    const H = this.CHART_H - 2 * this.CHART_PAD_Y;
    const n = list.length;
    const range = max - min || 1;
    return list
      .map((m, i) => ({ m, i, v: (m as any)[key] as number | undefined }))
      .filter(({ v }) => v != null)
      .map(({ m, i, v }) => ({
        x: this.CHART_PAD_X + (i / (n - 1)) * W,
        y: this.CHART_PAD_Y + H - ((v! - min) / range) * H,
        value: v!,
        date: m.date,
      }));
  }

  /** Straight polyline path (fallback) */
  svgLine(points: ChartPoint[]): string {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }

  /** Smooth Catmull-Rom spline converted to cubic Bezier */
  svgSmoothLine(points: ChartPoint[]): string {
    if (points.length === 0) return '';
    if (points.length < 3) return this.svgLine(points);
    const t = 0.35;
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) * t;
      const cp1y = p1.y + (p2.y - p0.y) * t;
      const cp2x = p2.x - (p3.x - p1.x) * t;
      const cp2y = p2.y - (p3.y - p1.y) * t;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  svgSmoothArea(points: ChartPoint[]): string {
    if (points.length === 0) return '';
    const bottom = this.CHART_H - this.CHART_PAD_Y;
    const line = this.svgSmoothLine(points);
    return `${line} L ${points[points.length - 1].x.toFixed(1)} ${bottom} L ${points[0].x.toFixed(1)} ${bottom} Z`;
  }

  svgArea(points: ChartPoint[]): string {
    if (points.length === 0) return '';
    const bottom = this.CHART_H - this.CHART_PAD_Y;
    const line = this.svgLine(points);
    return `${line} L ${points[points.length - 1].x.toFixed(1)} ${bottom} L ${points[0].x.toFixed(1)} ${bottom} Z`;
  }

  // ── BMI Gauge ─────────────────────────────────────────────────────────────

  private readonly GAUGE_CX  = 60;
  private readonly GAUGE_CY  = 58;
  private readonly GAUGE_R   = 44;
  private readonly BMI_MIN   = 15;
  private readonly BMI_MAX   = 40;

  private bmiNorm(bmi: number): number {
    return (Math.max(this.BMI_MIN, Math.min(this.BMI_MAX, bmi)) - this.BMI_MIN) / (this.BMI_MAX - this.BMI_MIN);
  }

  private gaugePoint(norm: number, r = this.GAUGE_R): { x: number; y: number } {
    const angle = Math.PI * (1 - norm);
    return {
      x: +(this.GAUGE_CX + r * Math.cos(angle)).toFixed(2),
      y: +(this.GAUGE_CY - r * Math.sin(angle)).toFixed(2),
    };
  }

  /** SVG arc path for a BMI zone band (from bmiA to bmiB) */
  bmiZoneArc(bmiA: number, bmiB: number, r = this.GAUGE_R): string {
    const s = this.gaugePoint(this.bmiNorm(bmiA), r);
    const e = this.gaugePoint(this.bmiNorm(bmiB), r);
    const span = this.bmiNorm(bmiB) - this.bmiNorm(bmiA);
    const large = span > 0.5 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
  }

  /** SVG arc path for the filled portion up to current BMI */
  bmiFilledArc(bmi: number, r = this.GAUGE_R): string {
    return this.bmiZoneArc(this.BMI_MIN, bmi, r);
  }

  bmiNeedlePos(bmi: number): { x: number; y: number } {
    return this.gaugePoint(this.bmiNorm(bmi), this.GAUGE_R - 8);
  }

  bmiGaugeColor(bmi: number): string {
    if (bmi < 18.5) return '#60a5fa';
    if (bmi < 25)   return '#34d399';
    if (bmi < 30)   return '#fbbf24';
    return '#f87171';
  }

  /** Days since last measurement */
  readonly daysSinceLast = computed(() => {
    const last = this.lastMeasurement();
    if (!last) return null;
    const diff = Date.now() - new Date(last.date).getTime();
    return Math.floor(diff / 86_400_000);
  });

  xAxisLabels(list: BodyMeasurement[]): { x: number; label: string }[] {
    const n = list.length;
    const W = this.CHART_W - 2 * this.CHART_PAD_X;
    const step = Math.max(1, Math.floor(n / 6));
    return list
      .map((m, i) => ({ i, m }))
      .filter(({ i }) => i % step === 0 || i === n - 1)
      .map(({ i, m }) => ({
        x: this.CHART_PAD_X + (i / (n - 1)) * W,
        label: this.shortDate(m.date),
      }));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  goBack(): void { this.router.navigate(['/marion']); }

  shortDate(d: string): string {
    const [, m, day] = d.split('-');
    const months = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
    return `${parseInt(day)} ${months[parseInt(m) - 1]}`;
  }

  fmt(n: number, unit: string): string {
    return `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`;
  }

  dateLabel(d: string): string {
    return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  trackById(_: number, m: BodyMeasurement): number { return m.id; }
}
