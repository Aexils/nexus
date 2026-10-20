import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Test d'intégration du pipeline complet sur une base SQLite jetable :
 * lecture → déduplication → classement → validation → apprentissage.
 *
 * C'est la propriété centrale du système qui est vérifiée ici : une correction
 * faite une fois dans l'écran de révision doit suffire à ce que le même
 * commerce soit reconnu tout seul au mois suivant.
 */

type ImportServiceT = import('./import.service').ImportService;
type ExpenseServiceT = import('../expense/expense.service').ExpenseService;

let dbFile: string;
let expenseSvc: ExpenseServiceT;
let svc: ImportServiceT;

function ofxFile(transactions: { date: string; amount: number; fitid: string; name: string }[]): Buffer {
  const blocks = transactions.map(t => `<STMTTRN>
<TRNTYPE>${t.amount > 0 ? 'CREDIT' : 'DEBIT'}
<DTPOSTED>${t.date}120000[-5:EST]
<TRNAMT>${t.amount.toFixed(2)}
<FITID>${t.fitid}
<NAME>${t.name}
</STMTTRN>`).join('\n');

  return Buffer.from(`OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>CAD
<BANKACCTFROM><BANKID>006<ACCTID>0123456789<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
${blocks}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`, 'latin1');
}

beforeEach(() => {
  dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-import-')), 'test.db');
  process.env['EXPENSE_DB_PATH'] = dbFile;

  jest.resetModules();
  const { ExpenseService } = require('../expense/expense.service');
  const { ImportService } = require('./import.service');

  expenseSvc = new ExpenseService();
  expenseSvc.onModuleInit();
  svc = new ImportService(expenseSvc);
  svc.onModuleInit();
});

afterEach(() => {
  try { fs.rmSync(path.dirname(dbFile), { recursive: true, force: true }); } catch { /* vide */ }
});

describe('amorçage depuis l’historique', () => {
  it('fabrique une règle par enseigne déjà saisie à la main', () => {
    expenseSvc.create('marion', 'Walmart', 'Courses', 'En ligne', 120.5, '2026-09-01');
    expenseSvc.create('marion', 'Tim Hortons', 'Restaurant', 'Café', 4.25, '2026-09-02');
    expenseSvc.create('marion', 'Walmart', 'Courses', 'En ligne', 80, '2026-09-03');

    const { created } = svc.seedRulesFromHistory();
    expect(created).toBe(2);

    const rules = svc.getRules();
    expect(rules.map(r => r.pattern).sort()).toEqual(['TIM HORTONS', 'WALMART']);
    expect(rules.every(r => r.origin === 'seed')).toBe(true);
  });

  it('est idempotent — relancer le seed ne duplique rien', () => {
    expenseSvc.create('marion', 'Walmart', 'Courses', 'En ligne', 120.5, '2026-09-01');
    svc.seedRulesFromHistory();
    const second = svc.seedRulesFromHistory();
    expect(second.created).toBe(0);
    expect(svc.getRules()).toHaveLength(1);
  });
});

describe('ingestion', () => {
  it('classe ce que les règles couvrent et signale le reste', () => {
    svc.upsertRule({ pattern: 'TIM HORTONS', enseigne: 'Tim Hortons', category: 'Restaurant', subcategory: 'Café' });

    const batch = svc.ingest(ofxFile([
      { date: '20261015', amount: -4.25, fitid: 'A1', name: 'ACHAT TIM HORTONS #421 MONTREAL QC' },
      { date: '20261016', amount: -62.10, fitid: 'A2', name: 'ACHAT RESTO INCONNU MONTREAL QC' },
    ]), 'releve.ofx', 'marion');

    expect(batch.txNew).toBe(2);
    expect(batch.unmatched).toBe(1);

    const staged = svc.getStaged(batch.id);
    expect(staged[0].enseigne).toBe('Tim Hortons');
    expect(staged[0].source).toBe('rule');
    expect(staged[1].source).toBe('unmatched');
  });

  it('propose « ne pas traiter » pour les crédits', () => {
    const batch = svc.ingest(ofxFile([
      { date: '20261020', amount: 1250, fitid: 'B1', name: 'DEPOT SALAIRE' },
    ]), 'releve.ofx', 'marion');

    const [dep] = svc.getStaged(batch.id);
    expect(dep.isCredit).toBe(true);
    expect(dep.destination).toBe('ignore');
    // Un crédit ne compte pas comme une ligne à classer.
    expect(batch.unmatched).toBe(0);
  });

  it('ne réimporte pas deux fois la même transaction', () => {
    const file = ofxFile([
      { date: '20261015', amount: -4.25, fitid: 'A1', name: 'TIM HORTONS' },
      { date: '20261016', amount: -62.10, fitid: 'A2', name: 'RESTO' },
    ]);

    const first = svc.ingest(file, 'releve.ofx', 'marion');
    expect(first.txNew).toBe(2);

    // Même fichier, relancé : la banque renvoie les mêmes FITID.
    const second = svc.ingest(file, 'releve.ofx', 'marion');
    expect(second.txNew).toBe(0);
    expect(second.txDuplicate).toBe(2);
  });

  it('signale une dépense déjà saisie à la main le même jour pour le même montant', () => {
    const manual = expenseSvc.create('marion', 'Metro', 'Courses', 'En magasin', 53.42, '2026-10-15');

    const batch = svc.ingest(ofxFile([
      { date: '20261015', amount: -53.42, fitid: 'C1', name: 'ACHAT METRO 0452' },
    ]), 'releve.ofx', 'marion');

    expect(svc.getStaged(batch.id)[0].duplicateOfId).toBe(manual.id);
  });

  it('refuse un format inconnu', () => {
    expect(() => svc.ingest(Buffer.from('peu importe'), 'releve.pdf', 'marion')).toThrow(/non géré/);
  });
});

describe('validation et apprentissage', () => {
  it('envoie les dépenses communes dans expenses et les perso dans personal_expenses', () => {
    const batch = svc.ingest(ofxFile([
      { date: '20261015', amount: -53.42, fitid: 'D1', name: 'ACHAT METRO 0452' },
      { date: '20261016', amount: -18.00, fitid: 'D2', name: 'ACHAT GYM ECONOFITNESS' },
      { date: '20261017', amount: -900.00, fitid: 'D3', name: 'VIREMENT COMPTE EPARGNE' },
    ]), 'releve.ofx', 'marion');

    const staged = svc.getStaged(batch.id);
    const result = svc.apply(batch.id, [
      { id: staged[0].id, destination: 'maison', enseigne: 'Metro', category: 'Courses', subcategory: 'En magasin' },
      { id: staged[1].id, destination: 'perso', persoUser: 'marion', enseigne: 'Éconofitness', category: 'Santé' },
      { id: staged[2].id, destination: 'ignore' },
    ]);

    expect(result.applied).toBe(2);
    expect(result.rejected).toBe(1);

    const maison = expenseSvc.findAll({ month: '2026-10' });
    expect(maison).toHaveLength(1);
    expect(maison[0].enseigne).toBe('Metro');
    // Le titulaire du compte est celui qui a payé.
    expect(maison[0].paidBy).toBe('marion');

    const perso = expenseSvc.getPersonalExpenses('marion', '2026-10');
    expect(perso).toHaveLength(1);
    expect(perso[0].category).toBe('Santé');
  });

  it('apprend une règle depuis une correction et reconnaît le mois suivant tout seul', () => {
    // Mois 1 : commerce inconnu, l'utilisateur le classe à la main.
    const first = svc.ingest(ofxFile([
      { date: '20261015', amount: -42.00, fitid: 'E1', name: 'ACHAT BOUCHERIE LAVALLEE #12 MONTREAL QC' },
    ]), 'octobre.ofx', 'marion');

    expect(svc.getStaged(first.id)[0].source).toBe('unmatched');

    svc.apply(first.id, [{
      id: svc.getStaged(first.id)[0].id,
      destination: 'maison',
      enseigne: 'Boucherie Lavallée',
      category: 'Courses',
      subcategory: 'En magasin',
      learnRule: true,
    }]);

    // Mois 2 : même commerce, autre succursale, autre montant. Plus rien à faire.
    const second = svc.ingest(ofxFile([
      { date: '20261112', amount: -37.80, fitid: 'E2', name: 'ACHAT BOUCHERIE LAVALLEE #07 LAVAL QC' },
    ]), 'novembre.ofx', 'marion');

    const staged = svc.getStaged(second.id)[0];
    expect(staged.source).toBe('rule');
    expect(staged.enseigne).toBe('Boucherie Lavallée');
    expect(staged.category).toBe('Courses');
    expect(second.unmatched).toBe(0);
  });

  it('rattrape les lignes en attente quand une règle arrive après coup', () => {
    const batch = svc.ingest(ofxFile([
      { date: '20261015', amount: -22.00, fitid: 'F1', name: 'ACHAT ADONIS 0318 MONTREAL QC' },
      { date: '20261018', amount: -31.50, fitid: 'F2', name: 'ACHAT ADONIS 0712 LAVAL QC' },
    ]), 'releve.ofx', 'marion');

    expect(batch.unmatched).toBe(2);

    svc.upsertRule({ pattern: 'ADONIS', enseigne: 'Adonis', category: 'Courses', subcategory: 'En magasin' });
    const { reclassified } = svc.reclassifyPending();

    expect(reclassified).toBe(2);
    expect(svc.getStaged(batch.id).every(s => s.source === 'rule')).toBe(true);
    expect(svc.getBatch(batch.id)!.unmatched).toBe(0);
  });

  it('ne réécrit pas une ligne que l’utilisateur a déjà validée', () => {
    const batch = svc.ingest(ofxFile([
      { date: '20261015', amount: -22.00, fitid: 'G1', name: 'ACHAT ADONIS 0318' },
    ]), 'releve.ofx', 'marion');

    const staged = svc.getStaged(batch.id)[0];
    svc.apply(batch.id, [{ id: staged.id, destination: 'maison', enseigne: 'Adonis', category: 'Courses' }]);

    svc.upsertRule({ pattern: 'ADONIS', enseigne: 'Autre chose', category: 'Divers' });
    const { reclassified } = svc.reclassifyPending();

    expect(reclassified).toBe(0);
    expect(svc.getStaged(batch.id)[0].enseigne).toBe('Adonis');
  });

  it('refuse d’appliquer une ligne sans catégorie', () => {
    const batch = svc.ingest(ofxFile([
      { date: '20261015', amount: -22.00, fitid: 'H1', name: 'INCONNU' },
    ]), 'releve.ofx', 'marion');

    const staged = svc.getStaged(batch.id)[0];
    expect(() => svc.apply(batch.id, [{ id: staged.id, destination: 'maison' }]))
      .toThrow(/catégorie manquante/);

    // La transaction n'a pas bougé : la validation est atomique.
    expect(svc.getStaged(batch.id)[0].status).toBe('pending');
    expect(expenseSvc.findAll({ month: '2026-10' })).toHaveLength(0);
  });
});

describe('regroupement des inconnus', () => {
  it('regroupe les libellés par motif suggéré, le plus fréquent en tête', () => {
    svc.ingest(ofxFile([
      { date: '20261001', amount: -12.00, fitid: 'I1', name: 'ACHAT CAFE OLIMPICO #1 MONTREAL QC' },
      { date: '20261005', amount: -9.00,  fitid: 'I2', name: 'ACHAT CAFE OLIMPICO #2 LAVAL QC' },
      { date: '20261007', amount: -55.00, fitid: 'I3', name: 'ACHAT QUINCAILLERIE NOTRE DAME' },
    ]), 'releve.ofx', 'marion');

    const groups = svc.getUnmatched();
    expect(groups).toHaveLength(2);
    expect(groups[0].suggestedPattern).toBe('CAFE OLIMPICO');
    expect(groups[0].count).toBe(2);
    expect(groups[0].totalAmount).toBeCloseTo(21);
  });
});

describe('santé du classement', () => {
  it('mesure la part des lignes classées automatiquement', () => {
    svc.upsertRule({ pattern: 'METRO', enseigne: 'Metro', category: 'Courses', subcategory: 'En magasin' });

    svc.ingest(ofxFile([
      { date: '20261001', amount: -50, fitid: 'J1', name: 'ACHAT METRO 0452' },
      { date: '20261002', amount: -20, fitid: 'J2', name: 'ACHAT METRO 0890' },
      { date: '20261003', amount: -15, fitid: 'J3', name: 'ACHAT INCONNU' },
      { date: '20261004', amount: 900, fitid: 'J4', name: 'DEPOT' },
    ]), 'releve.ofx', 'marion');

    const health = svc.getHealth();
    // 2 classées sur 3 lignes de dépense ; le dépôt ne compte pas.
    expect(health.autoRate).toBeCloseTo(66.67, 1);
    expect(health.totalRules).toBe(1);
  });
});
