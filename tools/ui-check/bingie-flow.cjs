// Parcours de l'espace Bingie dans Chromium (faux Nexus local, données fictives).
const { chromium } = require('playwright');
const OUT = process.argv[2], MODE = process.argv[3] || 'bureau', BASE = 'http://127.0.0.1:4312';
const results = [];
const check = (label, ok, detail = '') => results.push([ok ? 'OK ' : 'ÉCHEC', `${MODE} : ${label}`, detail]);
const control = (page, body) => page.evaluate(b => fetch('/mock/control', { method: 'POST', body: JSON.stringify(b) }).then(r => r.status), body);
const traktWrites = page => page.evaluate(() => fetch('/mock/trakt-writes').then(r => r.json()));
const path = page => new URL(page.url()).pathname;
async function eventually(read, test, ms = 4000) {
  const end = Date.now() + ms; let value = await read();
  while (!test(value) && Date.now() < end) { await new Promise(r => setTimeout(r, 100)); value = await read(); }
  return value;
}

(async () => {
  const mobile = MODE === 'mobile';
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
                                       isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const errors = []; let leaveWarnings = 0;
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { if (d.type() === 'beforeunload') { leaveWarnings++; return d.accept(); } errors.push('dialogue ' + d.type()); d.dismiss(); });
  const shot = name => page.screenshot({ path: `${OUT}/bingie-${MODE}-${name}.png` });

  // 1. Anciennes adresses
  for (const [old, now] of [['/trakt', '/bingie/ecrans'], ['/trakt/reglages', '/bingie/reglages'],
                            ['/trakt/service', '/bingie/services'], ['/aggregator', '/bingie/sources']]) {
    await page.goto(BASE + old, { waitUntil: 'load' });
    check(`${old} redirige vers ${now}`, (await eventually(() => path(page), p => p === now)) === now, path(page));
  }
  await control(page, { authenticated: false, csrf: 'csrf-fictif', down: false });

  // 2. Accueil et écran de télé sous la barre
  await page.goto(BASE + '/bingie', { waitUntil: 'load' });
  check('/bingie ouvre Écrans', (await eventually(() => path(page), p => p === '/bingie/ecrans')) === '/bingie/ecrans');
  await page.waitForSelector('app-trakt-studio .rail-item', { timeout: 10000 });
  const geometry = await page.evaluate(() => ({
    bar: document.querySelector('.bar').getBoundingClientRect().bottom,
    studio: document.querySelector('app-trakt-studio').getBoundingClientRect().top,
  }));
  check('atelier sous la barre Bingie (aucun chevauchement)', geometry.studio >= geometry.bar - 1, JSON.stringify(geometry));
  const barLinks = await page.locator('app-trakt-studio .bar a').allInnerTexts();
  check('aucun lien de navigation en double dans l’atelier', barLinks.length === 0, barLinks.join(', '));
  check('onglet actif signalé', (await page.locator('.tab[aria-current="page"]').innerText()).includes('Écrans'));
  await shot('1-ecrans');

  // 3. Navigation entre modules : chargement des données, sans rechargement de page
  await page.evaluate(() => { window.__bingieMarker = 'même page'; });
  const tab = name => page.locator('.tab', { hasText: name });
  for (const [name, url, selector] of [['Réglages', '/bingie/reglages', 'app-trakt-settings .page'],
                                       [mobile ? 'Sources' : 'Sources et qualité', '/bingie/sources', 'app-aggregator-page .syncbar'],
                                       ['Services', '/bingie/services', 'app-trakt-page nxs-page-header'],
                                       ['Écrans', '/bingie/ecrans', 'app-trakt-studio .rail-item']]) {
    await tab(name).click();
    const loaded = await page.waitForSelector(selector, { timeout: 10000 }).then(() => true).catch(() => false);
    check(`onglet ${name} : module chargé`, loaded && (await eventually(() => path(page), p => p === url)) === url, path(page));
    await shot('2-' + url.split('/')[2]);
  }
  check('aucun rechargement complet entre modules', (await page.evaluate(() => window.__bingieMarker)) === 'même page');
  const settingsBack = await page.goto(BASE + '/bingie/reglages', { waitUntil: 'load' })
    .then(() => page.waitForSelector('app-trakt-settings .page')).then(() => page.locator('app-trakt-settings .back').count());
  check('aucun lien de retour en double dans les réglages', settingsBack === 0);

  // 4. Écriture Trakt sans session : refusée, connexion proposée ; puis acceptée
  await page.goto(BASE + '/bingie/ecrans', { waitUntil: 'load' });
  const ret = page.getByRole('button', { name: '+ YouTube' });
  await ret.waitFor({ timeout: 10000 });
  await ret.click();
  const panel = page.locator('form.login');
  check('écriture refusée sans session -> connexion proposée', await panel.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)
        && (await panel.innerText()).includes('Session expirée'));
  check('le refus n’a rien écrit', (await traktWrites(page)).length === 0);
  const studioMessage = await eventually(() => page.locator('app-trakt-studio .bar-status').innerText(), t => t.includes('Connexion requise'));
  check('message de l’atelier cohérent (connexion requise, pas « réessaie »)', studioMessage.includes('Connexion requise'), studioMessage);
  await shot('3-connexion');
  await control(page, { authenticated: false });
  await page.getByLabel('Mot de passe d’administration').fill('faux');
  await panel.getByRole('button', { name: 'Se connecter' }).click();
  check('mauvais mot de passe signalé', (await eventually(() => panel.innerText(), t => t.includes('incorrect'))).includes('incorrect'));
  await page.getByLabel('Mot de passe d’administration').fill('fictif');
  await panel.getByRole('button', { name: 'Se connecter' }).click();
  check('connecté : panneau fermé, session affichée', (await eventually(() => panel.count(), n => n === 0)) === 0
        && (await page.locator('.who.on').count()) === 1);
  await page.getByRole('button', { name: '+ YouTube' }).click();
  const writes = await eventually(() => traktWrites(page), w => w.length === 1);
  check('écriture acceptée avec la session (PUT nav)', writes.length === 1 && writes[0].startsWith('PUT /api/trakt/nav'), writes.join(', '));

  // 5. Brouillon conservé d'un module à l'autre, pastille et avertissement
  await tab(mobile ? 'Sources' : 'Sources et qualité').click();
  await page.waitForSelector('app-aggregator-page .syncbar');
  await page.getByRole('radio', { name: 'Refuser' }).click();
  check('pastille « non enregistré » sur l’onglet', (await eventually(() => tab(mobile ? 'Sources' : 'Sources et qualité').locator('.dirty').count(), n => n === 1)) === 1);
  await tab('Écrans').click();
  await page.waitForSelector('app-trakt-studio .rail-item');
  await tab(mobile ? 'Sources' : 'Sources et qualité').click();
  await page.waitForSelector('app-aggregator-page .syncbar');
  const kept = await eventually(() => page.getByRole('radio', { name: 'Refuser' }).getAttribute('aria-checked'), v => v === 'true');
  check('brouillon conservé après navigation', kept === 'true' && /non enregistrées/.test(await page.locator('.syncbar').innerText()));
  await shot('4-brouillon');
  await page.reload({ waitUntil: 'load' });
  check('avertissement avant de quitter avec un brouillon', leaveWarnings === 1, String(leaveWarnings));

  // 6. Nexus : une seule entrée Bingie
  await page.goto(BASE + '/dashboard', { waitUntil: 'load' });
  const nav = await page.locator('nxs-sidebar').innerText();
  check('barre latérale : Bingie présent, plus de Trakt ni d’Aggregator', nav.includes('Bingie') && !/\bTrakt\b/.test(nav) && !nav.includes('Aggregator'));
  if (!mobile) {
    await page.locator('nxs-sidebar').getByText('Bingie').click();
    check('l’entrée Bingie ouvre l’espace', (await eventually(() => path(page), p => p === '/bingie/ecrans')) === '/bingie/ecrans', path(page));
  }

  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth);
  check('aucun débordement horizontal', !overflow);
  check('aucune erreur JS ni dialogue inattendu', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  for (const [ok, label, detail] of results) console.log(ok, label, detail ? '— ' + detail : '');
})();
