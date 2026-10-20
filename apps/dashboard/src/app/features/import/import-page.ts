import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  LucideAngularModule, Upload, FileText, CheckCircle, AlertTriangle, Trash2,
  Sparkles, Copy, RefreshCw, Home, User, EyeOff, Filter,
  BookOpen, Wand2, Pencil, Plus, Search, X, ChevronDown, ChevronRight,
} from 'lucide-angular';
import {
  ImportBatch, StagedTransaction, StagedDestination, ExpensePaidBy,
  ImportHealth, ApplyDecision, MerchantRule,
} from '@nexus/shared-types';
import { PageHeaderComponent } from '../../shared/page-header/page-header';
import { AutoAnimateDirective, CountUpDirective } from '../../shared/motion';

/** Une ligne du tableau de révision : la transaction + ce que l'utilisateur en fait. */
interface ReviewRow extends StagedTransaction {
  /** Destination fusionnée avec le titulaire, pour un seul groupe de boutons. */
  choice: 'maison' | 'alexis' | 'marion' | 'ignore';
  learn: boolean;
  touched: boolean;
}

interface SubcategoryRow { name: string; category: string; }

@Component({
  selector: 'app-import-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule, LucideAngularModule, PageHeaderComponent,
    AutoAnimateDirective, CountUpDirective,
  ],
  templateUrl: './import-page.html',
  styleUrl: './import-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportPage implements OnInit {
  private readonly http = inject(HttpClient);

  readonly icons = {
    Upload, FileText, CheckCircle, AlertTriangle, Trash2,
    Sparkles, Copy, RefreshCw, Home, User, EyeOff, Filter,
    BookOpen, Wand2, Pencil, Plus, Search, X, ChevronDown, ChevronRight,
  };

  // ── État ───────────────────────────────────────────────────────────────────

  readonly batches  = signal<ImportBatch[]>([]);
  readonly batch    = signal<ImportBatch | null>(null);
  readonly rows     = signal<ReviewRow[]>([]);
  readonly health   = signal<ImportHealth | null>(null);

  readonly categories    = signal<string[]>([]);
  readonly allSubcats    = signal<SubcategoryRow[]>([]);
  readonly allEnseignes  = signal<string[]>([]);

  readonly uploading  = signal(false);
  readonly applying   = signal(false);
  readonly loading    = signal(false);
  readonly error      = signal('');
  readonly notice     = signal('');

  /** Ne montrer que ce qui demande une décision. */
  readonly onlyAttention = signal(false);

  uploadOwner: ExpensePaidBy = 'marion';
  selectedFile: File | null = null;

  // ── Règles de reconnaissance ───────────────────────────────────────────────

  readonly rules       = signal<MerchantRule[]>([]);
  readonly showRules   = signal(false);
  readonly ruleQuery   = signal('');
  readonly seeding     = signal(false);
  readonly savingRule  = signal(false);
  /** Id de la règle en cours d'édition, `0` pour une création, `null` si aucune. */
  readonly ruleDraftId = signal<number | null>(null);

  draftPattern     = '';
  draftEnseigne    = '';
  draftCategory    = '';
  draftSubcategory = '';
  draftDestination: StagedDestination = 'maison';

  // ── Dérivé ─────────────────────────────────────────────────────────────────

  readonly visibleRows = computed(() =>
    this.onlyAttention()
      ? this.rows().filter(r => this.needsAttention(r))
      : this.rows()
  );

  readonly attentionCount = computed(() => this.rows().filter(r => this.needsAttention(r)).length);
  readonly autoCount      = computed(() => this.rows().filter(r => r.source === 'rule').length);

  readonly totalMaison = computed(() =>
    this.rows().filter(r => r.choice === 'maison').reduce((s, r) => s + r.amount, 0)
  );
  readonly totalPerso = computed(() =>
    this.rows().filter(r => r.choice === 'alexis' || r.choice === 'marion').reduce((s, r) => s + r.amount, 0)
  );
  readonly totalIgnored = computed(() =>
    this.rows().filter(r => r.choice === 'ignore').reduce((s, r) => s + r.amount, 0)
  );

  /** Bloque la validation tant qu'une ligne retenue n'a pas de catégorie. */
  readonly blockingRows = computed(() =>
    this.rows().filter(r => r.choice !== 'ignore' && !r.category.trim())
  );

  /** Aucune règle en base : le système n'a jamais été amorcé. */
  readonly needsSeeding = computed(() => this.rules().length === 0);

  readonly filteredRules = computed(() => {
    const q = this.ruleQuery().trim().toLowerCase();
    if (!q) return this.rules();
    return this.rules().filter(r =>
      r.pattern.toLowerCase().includes(q) ||
      r.enseigne.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q)
    );
  });

  // ── Cycle de vie ───────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadBatches();
    this.loadTaxonomy();
    this.loadHealth();
    this.loadRules();
  }

  private loadBatches(): void {
    this.http.get<ImportBatch[]>('/api/imports').subscribe({
      next: list => {
        this.batches.set(list);
        // On ouvre d'office le dernier lot qui a encore des lignes à valider.
        const pending = list.find(b => b.pending > 0);
        if (pending && !this.batch()) this.openBatch(pending.id);
      },
      error: () => this.error.set('Impossible de charger les imports.'),
    });
  }

  private loadTaxonomy(): void {
    this.http.get<string[]>('/api/expenses/categories')
      .subscribe(c => this.categories.set(c));
    this.http.get<{ name: string; category: string }[]>('/api/admin/subcategories')
      .subscribe(s => this.allSubcats.set(s.map(x => ({ name: x.name, category: x.category }))));
    this.http.get<{ name: string }[]>('/api/admin/enseignes')
      .subscribe(e => this.allEnseignes.set([...new Set(e.map(x => x.name))].sort()));
  }

  private loadHealth(): void {
    this.http.get<ImportHealth>('/api/imports/health').subscribe(h => this.health.set(h));
  }

  // ── Téléversement ──────────────────────────────────────────────────────────

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.error.set('');
  }

  upload(): void {
    if (!this.selectedFile || this.uploading()) return;

    const form = new FormData();
    form.append('file', this.selectedFile);
    form.append('accountOwner', this.uploadOwner);

    this.uploading.set(true);
    this.error.set('');

    this.http.post<ImportBatch>('/api/imports', form).subscribe({
      next: batch => {
        this.uploading.set(false);
        this.selectedFile = null;
        this.notice.set(
          `${batch.txNew} transaction(s) lue(s)` +
          (batch.txDuplicate ? `, ${batch.txDuplicate} déjà connue(s) et ignorée(s)` : '') +
          (batch.unmatched ? ` — ${batch.unmatched} sans règle` : ' — toutes reconnues')
        );
        this.loadBatches();
        this.loadHealth();
        this.openBatch(batch.id);
      },
      error: err => {
        this.uploading.set(false);
        this.error.set(err?.error?.message ?? 'Échec de l’import.');
      },
    });
  }

  // ── Lot ────────────────────────────────────────────────────────────────────

  openBatch(id: number): void {
    this.loading.set(true);
    this.http.get<ImportBatch>(`/api/imports/${id}`).subscribe(b => this.batch.set(b));
    this.http.get<StagedTransaction[]>(`/api/imports/${id}/transactions?status=pending`).subscribe({
      next: list => {
        this.rows.set(list.map(t => this.toRow(t)));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Impossible de charger les lignes de ce lot.');
      },
    });
  }

  private toRow(t: StagedTransaction): ReviewRow {
    let choice: ReviewRow['choice'] = 'maison';
    if (t.destination === 'ignore') choice = 'ignore';
    else if (t.destination === 'perso') choice = (t.persoUser ?? 'marion') as 'alexis' | 'marion';

    return {
      ...t,
      choice,
      // On propose d'apprendre dès qu'aucune règle ne couvrait la ligne :
      // c'est exactement le cas où la correction a de la valeur.
      learn: t.source === 'unmatched' && !t.isCredit,
      touched: false,
    };
  }

  /** Une ligne demande une décision si rien ne la couvrait, ou si elle sent le doublon. */
  needsAttention(r: ReviewRow): boolean {
    if (r.isCredit) return false;
    return r.source === 'unmatched' || r.duplicateOfId !== null || !r.category.trim();
  }

  // ── Édition d'une ligne ────────────────────────────────────────────────────

  setChoice(row: ReviewRow, choice: ReviewRow['choice']): void {
    this.patchRow(row, { choice, touched: true });
  }

  setEnseigne(row: ReviewRow, value: string): void {
    this.patchRow(row, { enseigne: value, touched: true });
  }

  setCategory(row: ReviewRow, value: string): void {
    // Changer de catégorie invalide la sous-catégorie si elle n'y appartient pas.
    const stillValid = this.allSubcats().some(s => s.category === value && s.name === row.subcategory);
    this.patchRow(row, {
      category: value,
      subcategory: stillValid ? row.subcategory : '',
      touched: true,
    });
  }

  setSubcategory(row: ReviewRow, value: string): void {
    this.patchRow(row, { subcategory: value, touched: true });
  }

  toggleLearn(row: ReviewRow): void {
    this.patchRow(row, { learn: !row.learn });
  }

  private patchRow(row: ReviewRow, patch: Partial<ReviewRow>): void {
    this.rows.update(rows => rows.map(r => (r.id === row.id ? { ...r, ...patch } : r)));
  }

  subcatsFor(category: string): string[] {
    return this.allSubcats().filter(s => s.category === category).map(s => s.name).sort();
  }

  // ── Actions de masse ───────────────────────────────────────────────────────

  setAllVisible(choice: ReviewRow['choice']): void {
    const ids = new Set(this.visibleRows().map(r => r.id));
    this.rows.update(rows => rows.map(r => (ids.has(r.id) ? { ...r, choice, touched: true } : r)));
  }

  /** Relance le moteur de règles — utile après avoir ajouté des règles ailleurs. */
  reclassify(): void {
    const id = this.batch()?.id;
    if (!id) return;
    this.http.post<{ reclassified: number; stillUnmatched: number }>('/api/imports/reclassify', { batchId: id })
      .subscribe(res => {
        this.notice.set(`${res.reclassified} ligne(s) reclassée(s), ${res.stillUnmatched} encore inconnue(s).`);
        this.openBatch(id);
        this.loadHealth();
      });
  }

  // ── Règles de reconnaissance ───────────────────────────────────────────────

  private loadRules(): void {
    this.http.get<MerchantRule[]>('/api/imports/rules')
      .subscribe(r => this.rules.set(r));
  }

  /**
   * Amorçage : fabrique une règle par enseigne déjà présente dans l'historique
   * saisi à la main. À ne faire qu'une fois, mais sans risque à relancer —
   * le backend ignore les motifs déjà connus.
   */
  seedRules(): void {
    if (this.seeding()) return;
    this.seeding.set(true);
    this.error.set('');

    this.http.post<{ created: number; skipped: number }>('/api/imports/rules/seed', {})
      .subscribe({
        next: res => {
          this.seeding.set(false);
          this.notice.set(
            `${res.created} règle(s) créée(s) depuis l'historique` +
            (res.skipped ? `, ${res.skipped} déjà connue(s).` : '.')
          );
          this.loadRules();
          this.loadHealth();
          // Les lots déjà en attente profitent immédiatement des nouvelles règles.
          if (this.batch()) this.reclassify();
        },
        error: err => {
          this.seeding.set(false);
          this.error.set(err?.error?.message ?? 'Échec de l’amorçage.');
        },
      });
  }

  startAddRule(): void {
    this.ruleDraftId.set(0);
    this.draftPattern = '';
    this.draftEnseigne = '';
    this.draftCategory = '';
    this.draftSubcategory = '';
    this.draftDestination = 'maison';
  }

  /** Pré-remplit le formulaire depuis une ligne du relevé qu'on n'a pas su classer. */
  addRuleFromRow(row: ReviewRow): void {
    this.showRules.set(true);
    this.ruleDraftId.set(0);
    this.draftPattern = row.enseigne || row.rawLabel;
    this.draftEnseigne = row.enseigne;
    this.draftCategory = row.category;
    this.draftSubcategory = row.subcategory;
    this.draftDestination = row.choice === 'ignore' ? 'ignore'
      : row.choice === 'maison' ? 'maison' : 'perso';
  }

  startEditRule(r: MerchantRule): void {
    this.ruleDraftId.set(r.id);
    this.draftPattern = r.pattern;
    this.draftEnseigne = r.enseigne;
    this.draftCategory = r.category;
    this.draftSubcategory = r.subcategory;
    this.draftDestination = r.destination;
  }

  cancelRuleDraft(): void { this.ruleDraftId.set(null); }

  saveRuleDraft(): void {
    if (this.savingRule()) return;
    if (!this.draftPattern.trim() || !this.draftEnseigne.trim() || !this.draftCategory.trim()) {
      this.error.set('Motif, enseigne et catégorie sont obligatoires.');
      return;
    }

    const editingId = this.ruleDraftId();
    const original = editingId ? this.rules().find(r => r.id === editingId) : null;

    this.savingRule.set(true);
    this.error.set('');

    this.http.post<MerchantRule>('/api/imports/rules', {
      pattern:     this.draftPattern,
      enseigne:    this.draftEnseigne,
      category:    this.draftCategory,
      subcategory: this.draftSubcategory,
      destination: this.draftDestination,
    }).subscribe({
      next: () => {
        // Le motif est la clé côté backend : l'avoir changé crée une nouvelle
        // règle, il faut donc retirer l'ancienne pour ne pas garder un doublon.
        const patternChanged = original &&
          original.pattern !== this.draftPattern.trim().toUpperCase();

        const finish = () => {
          this.savingRule.set(false);
          this.ruleDraftId.set(null);
          this.notice.set('Règle enregistrée — elle s’appliquera au prochain import.');
          this.loadRules();
          this.loadHealth();
          this.loadTaxonomy();
          if (this.batch()) this.reclassify();
        };

        if (patternChanged && original) {
          this.http.delete(`/api/imports/rules/${original.id}`).subscribe({
            next: finish, error: finish,
          });
        } else finish();
      },
      error: err => {
        this.savingRule.set(false);
        this.error.set(err?.error?.message ?? 'Échec de l’enregistrement de la règle.');
      },
    });
  }

  deleteRule(r: MerchantRule): void {
    this.http.delete(`/api/imports/rules/${r.id}`).subscribe({
      next: () => {
        this.notice.set(`Règle « ${r.pattern} » supprimée.`);
        this.loadRules();
        this.loadHealth();
      },
      error: err => this.error.set(err?.error?.message ?? 'Suppression impossible.'),
    });
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  apply(): void {
    const id = this.batch()?.id;
    if (!id || this.applying()) return;

    if (this.blockingRows().length) {
      this.error.set(
        `${this.blockingRows().length} ligne(s) retenue(s) sans catégorie — choisissez-en une ou passez-les à « Ne pas traiter ».`
      );
      return;
    }

    const decisions: ApplyDecision[] = this.rows().map(r => {
      const destination: StagedDestination =
        r.choice === 'ignore' ? 'ignore' : r.choice === 'maison' ? 'maison' : 'perso';

      return {
        id: r.id,
        destination,
        persoUser: destination === 'perso' ? (r.choice as ExpensePaidBy) : null,
        enseigne: r.enseigne,
        category: r.category,
        subcategory: r.subcategory,
        // On n'apprend que depuis une ligne retenue : ignorer une ligne ne dit
        // rien de généralisable sur le commerce.
        learnRule: r.learn && destination !== 'ignore',
      };
    });

    this.applying.set(true);
    this.error.set('');

    this.http.post<{ applied: number; rejected: number; rulesLearned: number }>(
      `/api/imports/${id}/apply`, { decisions }
    ).subscribe({
      next: res => {
        this.applying.set(false);
        this.notice.set(
          `${res.applied} dépense(s) enregistrée(s), ${res.rejected} ignorée(s)` +
          (res.rulesLearned ? `, ${res.rulesLearned} règle(s) apprise(s) pour la prochaine fois.` : '.')
        );
        this.batch.set(null);
        this.rows.set([]);
        this.loadBatches();
        this.loadTaxonomy();
        this.loadHealth();
        this.loadRules();
      },
      error: err => {
        this.applying.set(false);
        this.error.set(err?.error?.message ?? 'Échec de la validation.');
      },
    });
  }

  deleteBatch(id: number, event: Event): void {
    event.stopPropagation();
    this.http.delete<{ deleted: boolean }>(`/api/imports/${id}`).subscribe({
      next: () => {
        if (this.batch()?.id === id) { this.batch.set(null); this.rows.set([]); }
        this.loadBatches();
        this.loadHealth();
      },
      error: err => this.error.set(err?.error?.message ?? 'Suppression impossible.'),
    });
  }

  // ── Présentation ───────────────────────────────────────────────────────────

  fmtAmount(n: number): string {
    return n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
  }

  fmtDate(d: string): string {
    const [, m, day] = d.split('-');
    return `${day}/${m}`;
  }

  /** D'où vient une règle — « apprise » est celle qui compte, c'est vous qui l'avez créée. */
  originLabel(origin: MerchantRule['origin']): string {
    return origin === 'seed' ? 'historique' : origin === 'user' ? 'apprise' : 'Claude';
  }

  destinationLabel(d: StagedDestination): string {
    return d === 'maison' ? 'Commune' : d === 'perso' ? 'Perso' : 'Ignorée';
  }

  dismissNotice(): void { this.notice.set(''); }
  dismissError(): void  { this.error.set(''); }
}
