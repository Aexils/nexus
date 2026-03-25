import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  LucideAngularModule,
  PlusCircle, Trash2, Home, Filter, TrendingUp, ChevronLeft, ChevronRight,
  CheckCircle, Pencil, ArrowUpDown, ArrowUp, ArrowDown, X,
  ShoppingCart, Cat, Utensils, Package, Car, Gamepad2, Music, Heart,
  Shirt, Laptop, Dumbbell, Plane, Coffee, Baby, Pill, ShoppingBag, Beef, Tag,
  Zap, Shield, Wifi, Building2,
  Calculator, Copy, Check,
  type LucideIconData,
} from 'lucide-angular';
import { Expense, ExpenseMonthSummary, MonthlyBreakdown, MonthlyCategory } from '@nexus/shared-types';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface DonutSlice {
  name: string;
  amount: number;
  pct: number;
  color: string;
  start: number;
  end: number;
  hasSubs: boolean;
}

interface ChartLine { key: string; color: string; points: { x: number; y: number }[]; }

interface SvgChartData {
  lines: ChartLine[];
  totalLine: { x: number; y: number }[];
  months: { label: string; x: number }[];
  yLines: { y: number; label: string }[];
  maxVal: number;
}

interface TableCell { amount: number; trend: 'up' | 'down' | 'same' | 'new'; }
interface TableRow { name: string; isCategory: boolean; depth: number; cells: TableCell[]; avg: number; }
interface MonthlyTableData { headers: string[]; rows: TableRow[]; }

// ── Constants ─────────────────────────────────────────────────────────────────

const LINE_COLORS = ['#7c3aed', '#f472b6', '#34d399', '#f59e0b', '#60a5fa', '#fb923c'];

const MONTH_LABELS: Record<string, string> = {
  '01': 'jan.', '02': 'fév.', '03': 'mar.', '04': 'avr.',
  '05': 'mai',  '06': 'jun.', '07': 'jul.', '08': 'aoû.',
  '09': 'sep.', '10': 'oct.', '11': 'nov.', '12': 'déc.',
};

const CATEGORY_COLORS: { bg: string; color: string; border: string }[] = [
  { bg: 'rgba(245,158,11,.15)',  color: '#f59e0b', border: 'rgba(245,158,11,.3)'  },
  { bg: 'rgba(16,185,129,.15)',  color: '#10b981', border: 'rgba(16,185,129,.3)'  },
  { bg: 'rgba(59,130,246,.15)',  color: '#3b82f6', border: 'rgba(59,130,246,.3)'  },
  { bg: 'rgba(239,68,68,.15)',   color: '#ef4444', border: 'rgba(239,68,68,.3)'   },
  { bg: 'rgba(139,92,246,.15)',  color: '#8b5cf6', border: 'rgba(139,92,246,.3)'  },
  { bg: 'rgba(236,72,153,.15)',  color: '#ec4899', border: 'rgba(236,72,153,.3)'  },
  { bg: 'rgba(20,184,166,.15)',  color: '#14b8a6', border: 'rgba(20,184,166,.3)'  },
  { bg: 'rgba(249,115,22,.15)',  color: '#f97316', border: 'rgba(249,115,22,.3)'  },
  { bg: 'rgba(6,182,212,.15)',   color: '#06b6d4', border: 'rgba(6,182,212,.3)'   },
  { bg: 'rgba(132,204,22,.15)',  color: '#84cc16', border: 'rgba(132,204,22,.3)'  },
];

// Maps keyword (substring, lowercase) → Lucide icon — first match wins
const CATEGORY_ICON_RULES: { keyword: string; icon: LucideIconData }[] = [
  { keyword: 'courses',       icon: ShoppingCart },
  { keyword: 'épicerie',      icon: ShoppingCart },
  { keyword: 'grocery',       icon: ShoppingCart },
  { keyword: 'supermarché',   icon: ShoppingCart },
  { keyword: 'mimi',          icon: Cat          },
  { keyword: 'chaton',        icon: Cat          },
  { keyword: 'chat',          icon: Cat          },
  { keyword: 'animal',        icon: Cat          },
  { keyword: 'restaurant',    icon: Utensils      },
  { keyword: 'resto',         icon: Utensils      },
  { keyword: 'manger',        icon: Utensils      },
  { keyword: 'repas',         icon: Utensils      },
  { keyword: 'café',          icon: Coffee        },
  { keyword: 'cafe',          icon: Coffee        },
  { keyword: 'coffee',        icon: Coffee        },
  { keyword: 'bébé',          icon: Baby          },
  { keyword: 'bebe',          icon: Baby          },
  { keyword: 'pharmacie',     icon: Pill          },
  { keyword: 'santé',         icon: Pill          },
  { keyword: 'médic',         icon: Pill          },
  { keyword: 'health',        icon: Heart         },
  { keyword: 'sport',         icon: Dumbbell      },
  { keyword: 'gym',           icon: Dumbbell      },
  { keyword: 'fitness',       icon: Dumbbell      },
  { keyword: 'voiture',       icon: Car           },
  { keyword: 'auto',          icon: Car           },
  { keyword: 'transport',     icon: Car           },
  { keyword: 'essence',       icon: Car           },
  { keyword: 'voyage',        icon: Plane         },
  { keyword: 'vacances',      icon: Plane         },
  { keyword: 'vêtements',     icon: Shirt         },
  { keyword: 'vetements',     icon: Shirt         },
  { keyword: 'clothes',       icon: Shirt         },
  { keyword: 'mode',          icon: Shirt         },
  { keyword: 'jeux',          icon: Gamepad2      },
  { keyword: 'game',          icon: Gamepad2      },
  { keyword: 'musique',       icon: Music         },
  { keyword: 'music',         icon: Music         },
  { keyword: 'tech',          icon: Laptop        },
  { keyword: 'informatique',  icon: Laptop        },
  { keyword: 'électronique',  icon: Laptop        },
  { keyword: 'viande',        icon: Beef          },
  { keyword: 'boucherie',     icon: Beef          },
  { keyword: 'cadeau',        icon: ShoppingBag   },
  { keyword: 'gift',          icon: ShoppingBag   },
  { keyword: 'électricité',   icon: Zap           },
  { keyword: 'electricite',   icon: Zap           },
  { keyword: 'electricité',   icon: Zap           },
  { keyword: 'électric',      icon: Zap           },
  { keyword: 'hydro',         icon: Zap           },
  { keyword: 'énergie',       icon: Zap           },
  { keyword: 'assurance',     icon: Shield        },
  { keyword: 'insurance',     icon: Shield        },
  { keyword: 'loyer',         icon: Building2     },
  { keyword: 'logement',      icon: Building2     },
  { keyword: 'rent',          icon: Building2     },
  { keyword: 'immobilier',    icon: Building2     },
  { keyword: 'internet',      icon: Wifi          },
  { keyword: 'téléphone',     icon: Wifi          },
  { keyword: 'telephone',     icon: Wifi          },
  { keyword: 'cellulaire',    icon: Wifi          },
  { keyword: 'cell',          icon: Wifi          },
  { keyword: 'forfait',       icon: Wifi          },
  { keyword: 'cinéma',        icon: Gamepad2      },
  { keyword: 'cinema',        icon: Gamepad2      },
  { keyword: 'loisir',        icon: Gamepad2      },
];

const ENSEIGNE_DOMAINS: Record<string, string> = {
  'metro':          'metro.ca',
  'super c':        'superc.ca',
  'superc':         'superc.ca',
  'walmart':        'walmart.ca',
  'iga':            'iga.net',
  'costco':         'costco.ca',
  'amazon':         'amazon.ca',
  'pharmaprix':     'pharmaprix.ca',
  'jean coutu':     'jeancoutu.com',
  'maxi':           'maxi.ca',
  'provigo':        'provigo.ca',
  'dollarama':      'dollarama.com',
  'canadian tire':  'canadiantire.ca',
  'tim hortons':    'timhortons.com',
  'mcdonalds':      'mcdonalds.com',
  'mcdonald':       'mcdonalds.com',
  'subway':         'subway.com',
  'rona':           'rona.ca',
  'home depot':     'homedepot.ca',
  'ikea':           'ikea.com',
  'best buy':       'bestbuy.ca',
  'apple':          'apple.com',
  'starbucks':      'starbucks.ca',
  'chefs plate':    'chefsplate.com',
  'chef plate':     'chefsplate.com',
  'chefsplate':     'chefsplate.com',
  'hydro québec':   'hydroquebec.com',
  'hydro quebec':   'hydroquebec.com',
  'hydro-québec':   'hydroquebec.com',
  'cineplex':       'cineplex.com',
  'desjardins':     'desjardins.com',
  'capreit':        'capreit.com',
  'bell':           'bell.ca',
  'vidéotron':      'videotron.com',
  'videotron':      'videotron.com',
  'telus':          'telus.com',
  'rogers':         'rogers.com',
  'fido':           'fido.ca',
  'koodo':          'koodomobile.com',
  'societe generale': 'sgcan.com',
  'td':             'td.com',
  'bnc':            'bnc.ca',
  'banque nationale': 'bnc.ca',
  'rbc':            'rbc.com',
  'bmo':            'bmo.com',
  'scotiabank':     'scotiabank.com',
  'sobeys':         'sobeys.com',
  'marché richelieu': 'epicier.net',
  'pa supermarché': 'pasupermarche.com',
  'pa supermarche': 'pasupermarche.com',
  'sportchek':      'sportchek.ca',
  'sport chek':     'sportchek.ca',
  'simons':         'simons.ca',
  'reitmans':       'reitmans.com',
  'winners':        'winners.ca',
  'bureau en gros': 'bureauengros.com',
  'staples':        'staples.ca',
  'netflix':        'netflix.com',
  'spotify':        'spotify.com',
  'google':         'google.com',
  'microsoft':      'microsoft.com',
  'steam':          'steampowered.com',
};

type SortCol = 'date' | 'paidBy' | 'enseigne' | 'category' | 'amount';
type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-maison-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './maison-page.html',
  styleUrl: './maison-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaisonPage implements OnInit {
  private readonly http = inject(HttpClient);

  readonly icons = {
    PlusCircle, Trash2, Home, Filter, TrendingUp,
    ChevronLeft, ChevronRight, CheckCircle, Pencil,
    ArrowUpDown, ArrowUp, ArrowDown, X,
    Calculator, Copy, Check,
  };

  // ── State ──────────────────────────────────────────────────────────────────

  readonly expenses      = signal<Expense[]>([]);
  readonly breakdown     = signal<MonthlyBreakdown[]>([]);
  readonly compMonth     = signal(this.currentMonthStr());
  readonly summaries     = computed<ExpenseMonthSummary[]>(() =>
    this.breakdown().map(b => ({
      month: b.month, totalAlexis: b.totalAlexis, totalMarion: b.totalMarion, total: b.total,
    }))
  );
  readonly categories    = signal<string[]>([]);
  readonly subcategories = signal<string[]>([]);
  readonly enseignes     = signal<string[]>([]);
  readonly loading    = signal(false);
  readonly submitting = signal(false);
  readonly success    = signal(false);

  readonly selectedMonth  = signal(this.currentMonthStr());
  readonly filterPaidBy   = signal('');
  readonly filterCategory = signal('');

  // Line chart controls (kept for compat)
  readonly lineMode  = signal<'categories' | 'subcategories'>('categories');
  readonly showTotal = signal(true);

  // Monthly table mode
  readonly tableMode = signal<'categories' | 'subcategories'>('categories');

  // Donut
  readonly donutMode = signal<'categories' | 'subcategories'>('categories');
  readonly selectedDonutCat = signal<string | null>(null);

  // Sort
  readonly sortCol = signal<SortCol>('date');
  readonly sortDir = signal<SortDir>('desc');

  // Edit modal
  readonly editingExpense     = signal<Expense | null>(null);
  readonly editSubcategories  = signal<string[]>([]);
  readonly editEnseignes      = signal<string[]>([]);
  readonly addingEditSubcat   = signal(false);
  readonly addingEditEnseigne = signal(false);
  editPaidBy    = 'alexis';
  editEnseigne  = '';
  editCategory  = '';
  editSubcategory = '';
  editAmount    = '';
  editDate      = '';
  editComment   = '';
  newEditSubcatName    = '';
  newEditEnseigneName  = '';

  // Add form
  formPaidBy      = 'alexis';
  formEnseigne    = '';
  formCategory    = '';
  formSubcategory = '';
  formAmount      = '';
  formDate        = this.todayStr();
  formComment     = '';

  // "Add new" inline inputs
  readonly addingCategory   = signal(false);
  readonly addingSubcategory = signal(false);
  readonly addingEnseigne   = signal(false);
  newCategoryName    = '';
  newSubcategoryName = '';
  newEnseigneName    = '';

  // ── Computed ───────────────────────────────────────────────────────────────

  readonly totalMonth  = computed(() => this.expenses().reduce((s, e) => s + e.amount, 0));
  readonly totalAlexis = computed(() => this.expenses().filter(e => e.paidBy === 'alexis').reduce((s, e) => s + e.amount, 0));
  readonly totalMarion = computed(() => this.expenses().filter(e => e.paidBy === 'marion').reduce((s, e) => s + e.amount, 0));

  readonly sortedExpenses = computed(() => {
    const col = this.sortCol();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return [...this.expenses()].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (col) {
        case 'paidBy':   av = a.paidBy;   bv = b.paidBy;   break;
        case 'enseigne': av = a.enseigne;  bv = b.enseigne; break;
        case 'category': av = a.category; bv = b.category; break;
        case 'amount':   av = a.amount;   bv = b.amount;   break;
        default:         av = a.date;     bv = b.date;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
  });

  readonly balance = computed(() => {
    const total = this.totalMonth();
    if (total === 0) return null;
    const diff = this.totalAlexis() - this.totalMarion();
    const amount = Math.abs(diff) / 2;
    if (amount < 0.01) return { balanced: true, amount: 0, debtor: '', creditor: '' };
    return diff > 0
      ? { balanced: false, amount, debtor: 'marion', creditor: 'alexis' }
      : { balanced: false, amount, debtor: 'alexis', creditor: 'marion' };
  });

  readonly pastBalances = computed(() =>
    this.summaries()
      .filter(s => s.month !== this.selectedMonth())
      .map(s => {
        const diff   = s.totalAlexis - s.totalMarion;
        const amount = Math.abs(diff) / 2;
        return {
          month:    s.month,
          balanced: amount < 0.01,
          amount,
          debtor:   diff > 0 ? 'marion' : 'alexis',
          creditor: diff > 0 ? 'alexis' : 'marion',
          total:    s.total,
        };
      })
  );

  readonly byCategory = computed(() => {
    const map: Record<string, number> = {};
    for (const e of this.expenses()) map[e.category] = (map[e.category] ?? 0) + e.amount;
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  });

  readonly donutSlices = computed<DonutSlice[]>(() => {
    const total = this.totalMonth();
    if (total === 0) return [];
    let cumulative = 0;
    return this.byCategory().map(([name, amount]) => {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
      const c = CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
      const pct = (amount / total) * 100;
      const start = cumulative;
      cumulative += pct;
      const hasSubs = this.expenses().some(e => e.category === name && !!e.subcategory);
      return { name, amount, pct, color: c.color, start, end: cumulative, hasSubs };
    });
  });

  readonly donutDrillSlices = computed<DonutSlice[]>(() => {
    const cat = this.selectedDonutCat();
    if (!cat) return [];
    const filtered = this.expenses().filter(e => e.category === cat);
    const map: Record<string, number> = {};
    for (const e of filtered) {
      const key = e.subcategory || 'Sans sous-catégorie';
      map[key] = (map[key] ?? 0) + e.amount;
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    if (total === 0) return [];
    let cumulative = 0;
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, amount], idx) => {
      const pct = (amount / total) * 100;
      const start = cumulative;
      cumulative += pct;
      return { name, amount, pct, color: LINE_COLORS[idx % LINE_COLORS.length], start, end: cumulative, hasSubs: false };
    });
  });

  readonly allSubSlices = computed<DonutSlice[]>(() => {
    const total = this.totalMonth();
    if (total === 0) return [];
    const map: Record<string, number> = {};
    for (const e of this.expenses()) {
      const key = e.subcategory || 'Sans sous-catégorie';
      map[key] = (map[key] ?? 0) + e.amount;
    }
    let cum = 0;
    return Object.entries(map).sort((a, b) => b[1] - a[1])
      .map(([name, amount], i) => {
        const pct = (amount / total) * 100;
        const start = cum; cum += pct;
        return { name, amount, pct, color: LINE_COLORS[i % LINE_COLORS.length], start, end: cum, hasSubs: false };
      });
  });

  readonly activeDonutSlices = computed<DonutSlice[]>(() => {
    if (this.donutMode() === 'subcategories') return this.allSubSlices();
    return this.selectedDonutCat() ? this.donutDrillSlices() : this.donutSlices();
  });

  readonly activeDonutTotal = computed(() =>
    this.activeDonutSlices().reduce((s, x) => s + x.amount, 0)
  );

  readonly activeDonutGradient = computed(() => {
    const slices = this.activeDonutSlices();
    if (!slices.length) return 'none';
    const stops = slices.map(s => `${s.color} ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`);
    return `conic-gradient(from -90deg, ${stops.join(', ')})`;
  });

  readonly selectedBreakdown = computed(() =>
    this.breakdown().find(b => b.month === this.compMonth()) ?? null
  );

  readonly maxCatAmount = computed(() => {
    const bd = this.selectedBreakdown();
    if (!bd || !bd.categories.length) return 1;
    return Math.max(...bd.categories.map(c => c.total));
  });

  readonly svgChart = computed<SvgChartData>(() => {
    const W = 900, H = 300, padL = 60, padB = 30, padT = 20, padR = 20;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const data = [...this.breakdown()].reverse(); // ASC order
    if (!data.length) return { lines: [], totalLine: [], months: [], yLines: [], maxVal: 0 };

    const mode = this.lineMode();
    const seriesMap = new Map<string, number[]>();

    if (mode === 'categories') {
      const allKeys = [...new Set(data.flatMap(b => b.categories.map(c => c.category)))];
      for (const key of allKeys) {
        seriesMap.set(key, data.map(b => b.categories.find(c => c.category === key)?.total ?? 0));
      }
    } else {
      // subcategories: unique by subcategory+category, display as "subcategory (category)"
      const seen = new Set<string>();
      const pairs: { display: string; subcat: string; cat: string }[] = [];
      for (const b of data) {
        for (const s of (b.subcategories ?? [])) {
          const uid = `${s.subcategory}||${s.category}`;
          if (!seen.has(uid)) {
            seen.add(uid);
            pairs.push({ display: `${s.subcategory} (${s.category})`, subcat: s.subcategory, cat: s.category });
          }
        }
      }
      for (const p of pairs) {
        seriesMap.set(p.display, data.map(b =>
          (b.subcategories ?? []).find(s => s.subcategory === p.subcat && s.category === p.cat)?.total ?? 0
        ));
      }
    }

    const totals = data.map(b => b.total);
    const allVals = [...Array.from(seriesMap.values()).flat(), ...totals, 1];
    const maxVal = Math.max(...allVals) * 1.1;

    const n = data.length;
    const xFor = (i: number) => n <= 1 ? padL + innerW / 2 : padL + i * innerW / (n - 1);
    const yFor = (v: number) => padT + innerH - (v / maxVal) * innerH;

    let colorIdx = 0;
    const lines: ChartLine[] = Array.from(seriesMap.entries()).map(([key, values]) => ({
      key,
      color: LINE_COLORS[colorIdx++ % LINE_COLORS.length],
      points: values.map((v, i) => ({ x: xFor(i), y: yFor(v) })),
    }));

    const totalLine = totals.map((v, i) => ({ x: xFor(i), y: yFor(v) }));

    const months = data.map((b, i) => ({
      label: this.monthLabel(b.month),
      x: xFor(i),
    }));

    const fmtY = (v: number): string => {
      if (v === 0) return '0';
      if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
      return Math.round(v).toString();
    };

    const yLines: { y: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const val = (maxVal / 4) * i;
      yLines.push({ y: yFor(val), label: fmtY(val) });
    }

    return { lines, totalLine, months, yLines, maxVal };
  });

  readonly monthlyTable = computed<MonthlyTableData>(() => {
    const data = [...this.breakdown()].reverse(); // oldest → newest (ASC)
    if (!data.length) return { headers: [], rows: [] };

    const mode = this.tableMode();
    const headers = data.map(b => this.monthLabel(b.month));
    const rows: TableRow[] = [];

    const getTrend = (amount: number, prev: number, i: number): TableCell['trend'] => {
      if (i === 0) return 'same';
      if (prev === 0 && amount > 0) return 'new';
      if (prev === 0) return 'same';
      const pct = (amount - prev) / prev * 100;
      return pct > 5 ? 'up' : pct < -5 ? 'down' : 'same';
    };

    const mkCells = (valFn: (b: typeof data[0]) => number): TableCell[] =>
      data.map((b, i) => {
        const amount = valFn(b);
        const prev = i > 0 ? valFn(data[i - 1]) : 0;
        return { amount, trend: getTrend(amount, prev, i) };
      });

    const mkAvg = (cells: TableCell[]): number => {
      const nz = cells.filter(c => c.amount > 0);
      return nz.length ? nz.reduce((s, c) => s + c.amount, 0) / nz.length : 0;
    };

    if (mode === 'categories') {
      const allCats = [...new Set(data.flatMap(b => b.categories.map(c => c.category)))];
      for (const cat of allCats) {
        const cells = mkCells(b => b.categories.find(c => c.category === cat)?.total ?? 0);
        rows.push({ name: cat, isCategory: true, depth: 0, cells, avg: mkAvg(cells) });

        const allSubs = [...new Set(data.flatMap(b =>
          (b.subcategories ?? []).filter(s => s.category === cat).map(s => s.subcategory)
        ))];
        for (const sub of allSubs) {
          const sc = mkCells(b => (b.subcategories ?? []).find(s => s.subcategory === sub && s.category === cat)?.total ?? 0);
          rows.push({ name: sub, isCategory: false, depth: 1, cells: sc, avg: mkAvg(sc) });
        }
      }
    } else {
      const subSeen = new Map<string, { sub: string; cat: string }>();
      for (const b of data) {
        for (const s of (b.subcategories ?? [])) {
          const key = `${s.subcategory}||${s.category}`;
          if (!subSeen.has(key)) subSeen.set(key, { sub: s.subcategory, cat: s.category });
        }
      }
      for (const [, { sub, cat }] of subSeen) {
        const cells = mkCells(b => (b.subcategories ?? []).find(s => s.subcategory === sub && s.category === cat)?.total ?? 0);
        rows.push({ name: `${sub} (${cat})`, isCategory: true, depth: 0, cells, avg: mkAvg(cells) });
      }
    }

    // Total row
    const totalCells = mkCells(b => b.total);
    rows.push({ name: 'Total', isCategory: true, depth: -1, cells: totalCells, avg: mkAvg(totalCells) });

    return { headers, rows };
  });

  // ── Calculatrice ───────────────────────────────────────────────────────────

  readonly showCalc    = signal(false);
  readonly calcDisplay = signal('0');
  readonly calcCopied  = signal(false);
  readonly calcPendingInfo = signal('');   // e.g. "12.5 +"

  private _calcOp: string | null = null;
  private _calcPrevVal: number | null = null;
  private _calcNewInput = true;

  calcKey(key: string): void {
    if (key >= '0' && key <= '9' || key === '.') {
      if (this._calcNewInput) {
        this.calcDisplay.set(key === '.' ? '0.' : key);
        this._calcNewInput = false;
      } else {
        const cur = this.calcDisplay();
        if (key === '.' && cur.includes('.')) return;
        this.calcDisplay.set(cur === '0' && key !== '.' ? key : cur + key);
      }
    } else if (key === 'C') {
      this.calcDisplay.set('0');
      this.calcPendingInfo.set('');
      this._calcOp = null;
      this._calcPrevVal = null;
      this._calcNewInput = true;
    } else if (key === '←') {
      const cur = this.calcDisplay();
      this.calcDisplay.set(cur.length > 1 ? cur.slice(0, -1) : '0');
    } else if (['+', '-', '×', '÷'].includes(key)) {
      this._calcPrevVal = parseFloat(this.calcDisplay());
      this._calcOp = key;
      this._calcNewInput = true;
      this.calcPendingInfo.set(`${this._calcPrevVal} ${key}`);
    } else if (key === '=') {
      if (this._calcOp && this._calcPrevVal !== null) {
        const cur = parseFloat(this.calcDisplay());
        let result: number;
        switch (this._calcOp) {
          case '+': result = this._calcPrevVal + cur; break;
          case '-': result = this._calcPrevVal - cur; break;
          case '×': result = this._calcPrevVal * cur; break;
          case '÷': result = cur !== 0 ? this._calcPrevVal / cur : NaN; break;
          default:  result = cur;
        }
        this.calcDisplay.set(isFinite(result) ? parseFloat(result.toPrecision(10)).toString() : 'Erreur');
        this.calcPendingInfo.set('');
        this._calcOp = null;
        this._calcPrevVal = null;
        this._calcNewInput = true;
      }
    }
  }

  calcCopy(): void {
    const text = this.calcDisplay();
    if (text === 'Erreur') return;
    const done = () => { this.calcCopied.set(true); setTimeout(() => this.calcCopied.set(false), 1800); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this.fallbackCopy(text, done));
    } else {
      this.fallbackCopy(text, done);
    }
  }

  private fallbackCopy(text: string, cb: () => void): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
    cb();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit() {
    this.loadCategories();
    this.loadExpenses();
    this.loadBreakdown();
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  loadCategories() {
    this.http.get<string[]>('/api/expenses/categories').subscribe({ next: d => this.categories.set(d) });
  }

  loadSubcategories(category: string) {
    this.http.get<string[]>('/api/expenses/subcategories', { params: { category } })
      .subscribe({ next: d => this.subcategories.set(d) });
  }

  loadEnseignes(subcategory: string) {
    this.http.get<string[]>('/api/expenses/enseignes', { params: { subcategory } })
      .subscribe({ next: d => this.enseignes.set(d) });
  }

  loadEditSubcategories(category: string) {
    this.http.get<string[]>('/api/expenses/subcategories', { params: { category } })
      .subscribe({ next: d => this.editSubcategories.set(d) });
  }

  loadEditEnseignes(subcategory: string) {
    this.http.get<string[]>('/api/expenses/enseignes', { params: { subcategory } })
      .subscribe({ next: d => this.editEnseignes.set(d) });
  }

  loadExpenses() {
    this.loading.set(true);
    const params: Record<string, string> = { month: this.selectedMonth() };
    if (this.filterPaidBy())   params['paidBy']   = this.filterPaidBy();
    if (this.filterCategory()) params['category'] = this.filterCategory();

    this.http.get<Expense[]>('/api/expenses', { params }).subscribe({
      next:  data => { this.expenses.set(data); this.loading.set(false); },
      error: ()   => this.loading.set(false),
    });
  }

  loadBreakdown() {
    this.http.get<MonthlyBreakdown[]>('/api/expenses/monthly-breakdown').subscribe({
      next: data => {
        this.breakdown.set(data);
        if (data.length && !data.find(b => b.month === this.compMonth())) {
          this.compMonth.set(data[0].month);
        }
      },
    });
  }

  // ── Sort ───────────────────────────────────────────────────────────────────

  toggleSort(col: SortCol) {
    if (this.sortCol() === col) {
      this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortCol.set(col);
      this.sortDir.set(col === 'amount' ? 'desc' : 'asc');
    }
  }

  sortIcon(col: SortCol) {
    if (this.sortCol() !== col) return this.icons.ArrowUpDown;
    return this.sortDir() === 'asc' ? this.icons.ArrowUp : this.icons.ArrowDown;
  }

  // ── Edit modal ─────────────────────────────────────────────────────────────

  openEdit(e: Expense) {
    this.editPaidBy      = e.paidBy;
    this.editEnseigne    = e.enseigne;
    this.editCategory    = e.category;
    this.editSubcategory = e.subcategory;
    this.editAmount      = String(e.amount);
    this.editDate        = e.date;
    this.editComment     = e.comment;
    this.addingEditSubcat.set(false);
    this.addingEditEnseigne.set(false);
    this.editSubcategories.set([]);
    this.editEnseignes.set([]);
    if (e.category)    this.loadEditSubcategories(e.category);
    if (e.subcategory) this.loadEditEnseignes(e.subcategory);
    this.editingExpense.set(e);
  }

  closeEdit() {
    this.editingExpense.set(null);
    this.addingEditSubcat.set(false);
    this.addingEditEnseigne.set(false);
  }

  onEditCategoryChange(v: string) {
    this.editCategory = v;
    this.editSubcategory = '';
    this.editEnseigne = '';
    this.editSubcategories.set([]);
    this.editEnseignes.set([]);
    if (v) this.loadEditSubcategories(v);
  }

  onEditSubcategoryChange(v: string) {
    if (v === '__new__') {
      this.addingEditSubcat.set(true);
      return;
    }
    this.editSubcategory = v;
    this.editEnseigne = '';
    this.editEnseignes.set([]);
    if (v) this.loadEditEnseignes(v);
  }

  onEditEnseigneSelect(v: string) {
    if (v === '__new__') {
      this.addingEditEnseigne.set(true);
      return;
    }
    this.editEnseigne = v;
  }

  confirmNewEditSubcat() {
    const name = this.newEditSubcatName.trim();
    if (!name || !this.editCategory) return;
    this.http.post<string[]>('/api/expenses/subcategories', { name, category: this.editCategory }).subscribe({
      next: list => {
        this.editSubcategories.set(list);
        this.editSubcategory = name;
        this.newEditSubcatName = '';
        this.addingEditSubcat.set(false);
        this.editEnseignes.set([]);
        this.editEnseigne = '';
      },
    });
  }

  confirmNewEditEnseigne() {
    const name = this.newEditEnseigneName.trim();
    if (!name || !this.editSubcategory) return;
    this.http.post<string[]>('/api/expenses/enseignes', { name, subcategory: this.editSubcategory }).subscribe({
      next: list => {
        this.editEnseignes.set(list);
        this.editEnseigne = name;
        this.newEditEnseigneName = '';
        this.addingEditEnseigne.set(false);
      },
    });
  }

  saveEdit() {
    const e = this.editingExpense();
    if (!e) return;
    const amount = parseFloat(this.editAmount);
    if (!this.editCategory || isNaN(amount) || amount <= 0 || !this.editDate) return;

    this.http.patch<Expense>(`/api/expenses/${e.id}`, {
      paidBy: this.editPaidBy, enseigne: this.editEnseigne, category: this.editCategory,
      subcategory: this.editSubcategory, amount, date: this.editDate, comment: this.editComment,
    }).subscribe({
      next: updated => {
        this.expenses.update(l => l.map(x => x.id === updated.id ? updated : x));
        this.loadBreakdown();
        this.closeEdit();
      },
    });
  }

  // ── Category / enseigne selects ────────────────────────────────────────────

  onCategorySelect(value: string) {
    if (value === '__new__') {
      this.formCategory = '';
      this.addingCategory.set(true);
    } else {
      this.formCategory = value;
      this.formSubcategory = '';
      this.formEnseigne = '';
      this.subcategories.set([]);
      this.enseignes.set([]);
      this.addingCategory.set(false);
      if (value) this.loadSubcategories(value);
    }
  }

  onSubcategorySelect(value: string) {
    if (value === '__new__') {
      this.formSubcategory = '';
      this.addingSubcategory.set(true);
    } else {
      this.formSubcategory = value;
      this.formEnseigne = '';
      this.enseignes.set([]);
      this.addingSubcategory.set(false);
      if (value) this.loadEnseignes(value);
    }
  }

  onEnseigneSelect(value: string) {
    if (value === '__new__') {
      this.formEnseigne = '';
      this.addingEnseigne.set(true);
    } else {
      this.formEnseigne = value;
      this.addingEnseigne.set(false);
    }
  }

  confirmNewCategory() {
    const name = this.newCategoryName.trim();
    if (!name) return;
    this.http.post<string[]>('/api/expenses/categories', { name }).subscribe({
      next: list => {
        this.categories.set(list);
        this.formCategory = name;
        this.formSubcategory = '';
        this.formEnseigne = '';
        this.subcategories.set([]);
        this.enseignes.set([]);
        this.newCategoryName = '';
        this.addingCategory.set(false);
        this.loadSubcategories(name);
      },
    });
  }

  cancelNewCategory() {
    this.newCategoryName = '';
    this.addingCategory.set(false);
  }

  confirmNewSubcategory() {
    const name = this.newSubcategoryName.trim();
    if (!name || !this.formCategory) return;
    this.http.post<string[]>('/api/expenses/subcategories', { name, category: this.formCategory }).subscribe({
      next: list => {
        this.subcategories.set(list);
        this.formSubcategory = name;
        this.formEnseigne = '';
        this.enseignes.set([]);
        this.newSubcategoryName = '';
        this.addingSubcategory.set(false);
        this.loadEnseignes(name);
      },
    });
  }

  cancelNewSubcategory() {
    this.newSubcategoryName = '';
    this.addingSubcategory.set(false);
  }

  confirmNewEnseigne() {
    const name = this.newEnseigneName.trim();
    if (!name || !this.formSubcategory) return;
    this.http.post<string[]>('/api/expenses/enseignes', { name, subcategory: this.formSubcategory }).subscribe({
      next: list => {
        this.enseignes.set(list);
        this.formEnseigne = name;
        this.newEnseigneName = '';
        this.addingEnseigne.set(false);
      },
    });
  }

  cancelNewEnseigne() {
    this.newEnseigneName = '';
    this.addingEnseigne.set(false);
  }

  // ── Category / enseigne display helpers ────────────────────────────────────

  categoryStyle(cat: string): Record<string, string> {
    let hash = 0;
    for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
    const c = CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
    return { background: c.bg, color: c.color, border: `1px solid ${c.border}` };
  }

  categoryIcon(cat: string): LucideIconData {
    const key = cat.toLowerCase();
    const match = CATEGORY_ICON_RULES.find(r => key.includes(r.keyword));
    return match ? match.icon : Tag;
  }

  enseigneFavicon(enseigne: string): string | null {
    const domain = ENSEIGNE_DOMAINS[enseigne.toLowerCase().trim()] ?? null;
    return domain ? `https://www.google.com/s2/favicons?sz=32&domain=${domain}` : null;
  }

  enseigneInitial(enseigne: string): string {
    return enseigne ? enseigne.charAt(0).toUpperCase() : '?';
  }

  // ── Form submit ────────────────────────────────────────────────────────────

  submit() {
    const amount = parseFloat(this.formAmount);
    if (!this.formCategory || isNaN(amount) || amount <= 0 || !this.formDate) return;

    this.submitting.set(true);
    this.http.post<Expense>('/api/expenses', {
      paidBy: this.formPaidBy, enseigne: this.formEnseigne, category: this.formCategory,
      subcategory: this.formSubcategory, amount, date: this.formDate, comment: this.formComment,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.success.set(true);
        setTimeout(() => this.success.set(false), 2500);
        this.formEnseigne = ''; this.formAmount = ''; this.formComment = '';
        this.enseignes.set([]);
        if (this.formSubcategory) this.loadEnseignes(this.formSubcategory);
        this.loadExpenses();
        this.loadBreakdown();
      },
      error: () => this.submitting.set(false),
    });
  }

  deleteExpense(id: number) {
    this.http.delete(`/api/expenses/${id}`).subscribe({
      next: () => { this.expenses.update(l => l.filter(e => e.id !== id)); this.loadBreakdown(); },
    });
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  prevMonth() { this.selectedMonth.update(m => this.offsetMonth(m, -1)); this.loadExpenses(); }
  nextMonth() { this.selectedMonth.update(m => this.offsetMonth(m, 1));  this.loadExpenses(); }
  applyFilters() { this.loadExpenses(); }

  resetFilters() {
    this.filterPaidBy.set(''); this.filterCategory.set('');
    this.selectedMonth.set(this.currentMonthStr());
    this.loadExpenses();
  }

  // ── Chart helpers ──────────────────────────────────────────────────────────

  linePoints(pts: { x: number; y: number }[]): string {
    return pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  fmt(n: number): string {
    return n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });
  }

  fmtK(n: number): string {
    if (n === 0) return '—';
    return Math.round(n).toLocaleString('fr-CA') + ' $';
  }

  toggleDonutMode(m: 'categories' | 'subcategories'): void {
    this.donutMode.set(m);
    this.selectedDonutCat.set(null);
  }

  formatDate(d: string): string {
    return new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  monthDisplayLabel(ym: string): string {
    const [year, month] = ym.split('-');
    const l = MONTH_LABELS[month] ?? month;
    return `${l.charAt(0).toUpperCase() + l.slice(1)} ${year}`;
  }

  monthLabel(ym: string): string {
    return MONTH_LABELS[ym.split('-')[1]] ?? ym.split('-')[1];
  }

  isCurrentMonth(): boolean { return this.selectedMonth() === this.currentMonthStr(); }

  private currentMonthStr(): string { return new Date().toISOString().slice(0, 7); }
  private todayStr(): string        { return new Date().toISOString().slice(0, 10); }

  private offsetMonth(ym: string, delta: number): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  alexisPct(cat: MonthlyCategory): number {
    return cat.total > 0 ? (cat.alexis / cat.total) * 100 : 0;
  }

  marionPct(cat: MonthlyCategory): number {
    return cat.total > 0 ? (cat.marion / cat.total) * 100 : 0;
  }

  trackExpense(_: number, e: Expense) { return e.id; }
}
