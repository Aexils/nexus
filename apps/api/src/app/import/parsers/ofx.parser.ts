import { ParsedStatement, ParsedTransaction, ImportFormat } from '@nexus/shared-types';

/**
 * Parseur OFX 1.0.2 / QFX (Banque Nationale).
 *
 * OFX 1.x est du SGML, pas du XML : les balises feuilles ne sont pas fermées.
 *
 *   <STMTTRN>
 *   <TRNTYPE>DEBIT
 *   <DTPOSTED>20261015120000[-5:EST]
 *   <TRNAMT>-45.67
 *   <FITID>202610150001
 *   <NAME>WAL-MART #3106
 *   </STMTTRN>
 *
 * Le capture-jusqu'au-prochain-`<` ci-dessous marche aussi bien sur l'OFX 2.x
 * (vrai XML, balises fermées), donc un seul parseur couvre les deux.
 */

/** Les en-têtes OFX 1.x précèdent le corps, en `CLÉ:VALEUR` ligne par ligne. */
function decodeBuffer(buf: Buffer): string {
  // On lit l'en-tête en latin1 : il est ASCII pur, donc sûr quel que soit le charset réel.
  const head = buf.subarray(0, 512).toString('latin1').toUpperCase();
  const charset = /CHARSET:\s*([^\r\n]+)/.exec(head)?.[1]?.trim();
  const encoding = /ENCODING:\s*([^\r\n]+)/.exec(head)?.[1]?.trim();

  // CHARSET:1252 et ENCODING:USASCII sont ce que sort la Banque Nationale.
  // Windows-1252 et latin1 ne divergent que sur 0x80-0x9F (€, guillemets
  // typographiques) — jamais sur les accents français, qui sont l'enjeu ici.
  if (encoding === 'UTF-8' || charset === 'UTF-8') return buf.toString('utf8');
  return buf.toString('latin1');
}

/** Valeur d'une balise feuille : tout jusqu'au prochain `<` ou fin de ligne. */
function leaf(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? m[1].trim() : '';
}

/** `20261015120000[-5:EST]` ou `20261015` → `2026-10-15`. */
function parseOfxDate(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function parseAmount(raw: string): number {
  // La spec impose le point décimal, mais on tolère la virgule par prudence.
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function parseOfx(buf: Buffer, format: ImportFormat = 'ofx'): ParsedStatement {
  const text = decodeBuffer(buf);

  // ACCTID vaut pour un compte chèque (BANKACCTFROM) comme pour une carte
  // de crédit (CCACCTFROM). On n'en garde que les 4 derniers chiffres : assez
  // pour détecter un relevé attribué au mauvais titulaire, inutile pour le reste.
  const acctId = leaf(text, 'ACCTID');
  const accountMask = acctId ? acctId.replace(/[^0-9A-Za-z]/g, '').slice(-4) : '';

  const transactions: ParsedTransaction[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];

  for (const block of blocks) {
    const date = parseOfxDate(leaf(block, 'DTPOSTED'));
    const trnAmt = parseAmount(leaf(block, 'TRNAMT'));
    if (!date || trnAmt === 0) continue;

    // En OFX un débit est négatif. Nexus stocke des dépenses positives.
    const isCredit = trnAmt > 0;

    const name = leaf(block, 'NAME');
    const memo = leaf(block, 'MEMO');
    // La BN tronque NAME à 32 caractères et déborde parfois dans MEMO ; on
    // recolle les deux sauf si MEMO n'est qu'une répétition de NAME.
    const rawLabel = memo && !name.startsWith(memo) && !memo.startsWith(name)
      ? `${name} ${memo}`.trim()
      : (name || memo).trim();

    transactions.push({
      fitid: leaf(block, 'FITID'),
      rawLabel,
      date,
      amount: Math.abs(trnAmt),
      isCredit,
    });
  }

  return { format, accountMask, transactions };
}
