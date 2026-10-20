import { ParsedStatement, ParsedTransaction } from '@nexus/shared-types';

/**
 * Parseur CSV de secours (Banque Nationale).
 *
 * L'OFX est le format à privilégier : il porte un FITID, donc une
 * déduplication exacte. Le CSV n'en a pas — on reconstruit une clé à partir
 * de (date, montant, libellé), ce qui suffit en pratique mais ne distingue
 * pas deux achats réellement identiques le même jour au même endroit. Ces
 * cas-là remontent dans l'écran de révision signalés comme doublons probables.
 *
 * À AJUSTER sur un vrai export : le mapping de colonnes ci-dessous est
 * tolérant (entêtes reconnus par mots-clés, repli positionnel), mais il n'a
 * pas encore vu de fichier réel de la BN.
 */

/** Découpe une ligne CSV en respectant les guillemets et les `""` échappés. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/).find(l => l.trim()) ?? '';
  const counts = [',', ';', '\t'].map(d => ({
    d,
    n: splitCsvLine(firstLine, d).length,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].d : ',';
}

function normHeader(h: string): string {
  return h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** `2026-10-15`, `15/10/2026`, `2026/10/15`, `15-10-2026` → `2026-10-15`. */
function parseDate(raw: string): string {
  const s = raw.trim();

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    // Ambigu entre JJ/MM et MM/JJ. Un nombre > 12 tranche tout seul ; sinon
    // on lit JJ/MM, convention québécoise.
    const [, a, b, y] = m;
    const [day, month] = Number(b) > 12 ? [b, a] : [a, b];
    return `${y}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return '';
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  // « 1 234,56 $ » / « -1,234.56 » / « (45.67) » pour un négatif comptable.
  let s = raw.replace(/[\s$ ]/g, '');
  const parenNegative = /^\(.*\)$/.test(s);
  if (parenNegative) s = s.slice(1, -1);

  // Si virgule ET point : le dernier des deux est le séparateur décimal.
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return parenNegative ? -n : n;
}

interface ColumnMap {
  date: number;
  label: number;
  /** Colonne unique signée, si le fichier n'a pas débit/crédit séparés. */
  amount: number;
  debit: number;
  credit: number;
}

function mapColumns(header: string[]): ColumnMap {
  const map: ColumnMap = { date: -1, label: -1, amount: -1, debit: -1, credit: -1 };

  header.forEach((raw, i) => {
    const h = normHeader(raw);
    if (map.date < 0 && /date/.test(h)) map.date = i;
    else if (map.debit < 0 && /debit|retrait|withdraw/.test(h)) map.debit = i;
    else if (map.credit < 0 && /credit|depot|deposit/.test(h)) map.credit = i;
    else if (map.amount < 0 && /montant|amount/.test(h)) map.amount = i;
    else if (map.label < 0 && /description|libelle|detail|transaction|payee|narration/.test(h)) {
      map.label = i;
    }
  });

  return map;
}

/** Le fichier commence-t-il par une ligne d'entêtes, ou directement par des données ? */
function looksLikeHeader(cells: string[]): boolean {
  if (!cells.length) return false;
  const hasDate = cells.some(c => parseDate(c) !== '');
  if (hasDate) return false;  // une date en première ligne = déjà des données
  return cells.some(c => /date|description|montant|debit|credit|libelle|amount/.test(normHeader(c)));
}

/** Repli quand les entêtes sont absents ou non reconnus : on devine par le contenu. */
function inferColumns(rows: string[][]): ColumnMap {
  const map: ColumnMap = { date: -1, label: -1, amount: -1, debit: -1, credit: -1 };
  const width = Math.max(...rows.map(r => r.length));

  for (let col = 0; col < width; col++) {
    const values = rows.map(r => r[col] ?? '').filter(v => v !== '');
    if (!values.length) continue;

    const dateHits = values.filter(v => parseDate(v) !== '').length;
    if (map.date < 0 && dateHits > values.length * 0.8) { map.date = col; continue; }

    const numHits = values.filter(v => parseAmount(v) !== 0).length;
    if (numHits > values.length * 0.8) {
      if (map.amount < 0) map.amount = col;
      continue;
    }

    // La colonne texte la plus « bavarde » est le libellé.
    const avgLen = values.reduce((s, v) => s + v.length, 0) / values.length;
    if (avgLen > 4 && map.label < 0) map.label = col;
  }

  return map;
}

export function parseCsv(buf: Buffer): ParsedStatement {
  // Les exports québécois sortent souvent en Windows-1252 ; on bascule en
  // latin1 si l'UTF-8 produit des caractères de remplacement.
  let text = buf.toString('utf8');
  if (text.includes('�')) text = buf.toString('latin1');
  text = text.replace(/^﻿/, '');

  const delim = detectDelimiter(text);
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return { format: 'csv', accountMask: '', transactions: [] };

  const allRows = lines.map(l => splitCsvLine(l, delim));
  const hasHeader = looksLikeHeader(allRows[0]);
  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  let cols = hasHeader ? mapColumns(allRows[0]) : inferColumns(dataRows);
  if (cols.date < 0 || (cols.amount < 0 && cols.debit < 0 && cols.credit < 0)) {
    // Entêtes présents mais non reconnus : on retombe sur la déduction.
    const inferred = inferColumns(dataRows);
    cols = {
      date: cols.date >= 0 ? cols.date : inferred.date,
      label: cols.label >= 0 ? cols.label : inferred.label,
      amount: cols.amount >= 0 ? cols.amount : inferred.amount,
      debit: cols.debit,
      credit: cols.credit,
    };
  }

  const transactions: ParsedTransaction[] = [];

  for (const row of dataRows) {
    const date = parseDate(row[cols.date] ?? '');
    if (!date) continue;

    let signed = 0;
    if (cols.debit >= 0 || cols.credit >= 0) {
      const debit = cols.debit >= 0 ? Math.abs(parseAmount(row[cols.debit] ?? '')) : 0;
      const credit = cols.credit >= 0 ? Math.abs(parseAmount(row[cols.credit] ?? '')) : 0;
      signed = credit - debit;
    } else {
      signed = parseAmount(row[cols.amount] ?? '');
    }
    if (signed === 0) continue;

    transactions.push({
      fitid: '',
      rawLabel: (row[cols.label] ?? '').trim(),
      date,
      amount: Math.abs(signed),
      isCredit: signed > 0,
    });
  }

  return { format: 'csv', accountMask: '', transactions };
}
