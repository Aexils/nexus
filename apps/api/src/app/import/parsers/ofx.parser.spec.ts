import { parseOfx } from './ofx.parser';

/** Gabarit OFX 1.0.2 tel que l'émet la Banque Nationale (SGML, balises feuilles non fermées). */
const SAMPLE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20261101120000[-5:EST]<LANGUAGE>FRA</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>CAD
<BANKACCTFROM><BANKID>006<ACCTID>0123456789<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261015120000[-5:EST]
<TRNAMT>-45.67
<FITID>20261015001
<NAME>ACHAT WAL-MART #3106
<MEMO>MONTREAL QC
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261017
<TRNAMT>-12.40
<FITID>20261017002
<NAME>TIM HORTONS #421
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261020
<TRNAMT>1250.00
<FITID>20261020003
<NAME>DEPOT SALAIRE
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261022
<TRNAMT>-8.95
<FITID>20261022004
<NAME>PREMIERE MOISSON
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1432.18<DTASOF>20261031</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOfx', () => {
  const stmt = parseOfx(Buffer.from(SAMPLE, 'latin1'));

  it('lit toutes les transactions', () => {
    expect(stmt.transactions).toHaveLength(4);
  });

  it('ne garde que les 4 derniers chiffres du compte', () => {
    expect(stmt.accountMask).toBe('6789');
  });

  it('convertit les dates OFX avec fuseau', () => {
    expect(stmt.transactions[0].date).toBe('2026-10-15');
    expect(stmt.transactions[1].date).toBe('2026-10-17');
  });

  it('rend les débits en positif et marque les crédits', () => {
    expect(stmt.transactions[0].amount).toBe(45.67);
    expect(stmt.transactions[0].isCredit).toBe(false);

    const depot = stmt.transactions[2];
    expect(depot.amount).toBe(1250);
    expect(depot.isCredit).toBe(true);
  });

  it('recolle NAME et MEMO quand ils se complètent', () => {
    expect(stmt.transactions[0].rawLabel).toBe('ACHAT WAL-MART #3106 MONTREAL QC');
  });

  it('garde le FITID, qui rend la déduplication exacte', () => {
    expect(stmt.transactions.map(t => t.fitid))
      .toEqual(['20261015001', '20261017002', '20261020003', '20261022004']);
  });

  it('décode les accents du charset 1252', () => {
    const accented = SAMPLE.replace('<NAME>PREMIERE MOISSON', '<NAME>PREMIÈRE MOISSON');
    const parsed = parseOfx(Buffer.from(accented, 'latin1'));
    expect(parsed.transactions[3].rawLabel).toBe('PREMIÈRE MOISSON');
  });

  it('ne rend rien sur un fichier vide plutôt que de lever', () => {
    expect(parseOfx(Buffer.from('')).transactions).toEqual([]);
  });
});
