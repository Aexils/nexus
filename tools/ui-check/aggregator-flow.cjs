// Parcours complet de la page Aggregator dans Chromium (faux Nexus local, données fictives).
const { chromium } = require('playwright');
const OUT = process.argv[2], BASE = 'http://127.0.0.1:4312';
const results = [];
const check = (label, ok, detail = '') => { results.push([ok ? 'OK ' : 'ÉCHEC', label, detail]); };
const control = (page, body) => page.evaluate(b => fetch('/mock/control', { method: 'POST', body: JSON.stringify(b) }).then(r => r.status), body);
const mockState = page => page.evaluate(() => fetch('/mock/state').then(r => r.json()));
const syncText = page => page.locator('.syncbar').innerText();
async function eventually(read, test, ms = 3000) {
  const end = Date.now() + ms; let value = await read();
  while (!test(value) && Date.now() < end) { await new Promise(r => setTimeout(r, 100)); value = await read(); }
  return value;
}

async function overflow(page) {
  return page.evaluate(() => {
    const view = innerWidth;
    const wide = [...document.querySelectorAll('app-bingie-shell *')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > view + 1 || r.left < -1); })
      .map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.')).slice(0, 5);
    return { page: document.scrollingElement.scrollWidth > view, wide };
  });
}

async function flow(browser, name, viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let leaveWarnings = 0;
  page.on('dialog', d => {
    if (d.type() === 'beforeunload') { leaveWarnings++; return d.accept(); }  // quitter avec des modifications : avertissement voulu
    errors.push('dialogue ' + d.type()); d.dismiss();
  });
  await page.goto(BASE + '/bingie/reglages', { waitUntil: 'load' });
  await page.getByRole('navigation', { name: 'Réglages par application' }).getByRole('link', { name: 'Aggregator' }).click();
  await page.waitForURL('**/bingie/reglages/aggregator');
  await page.locator('app-aggregator-page').waitFor();
  await control(page, { authenticated: true, down: false, next_put: null, csrf: 'csrf-fictif' });
  await page.goto(BASE + '/bingie/reglages/aggregator', { waitUntil: 'load' });
  const shot = async step => page.screenshot({ path: `${OUT}/${name}-${step}.png`, fullPage: !mobile });

  // 1. Version 0
  // Ouverture : « chargement… » puis l'état réel ; on attend celui-ci, sans relâcher la condition.
  const opened = await eventually(() => syncText(page), t => /v0\b/.test(t) && /non publié/.test(t));
  check(`${name} : version 0 chargée`, /v0\b/.test(opened) && /non publié/.test(opened), opened.replace(/\n/g, ' | '));
  const duration = page.getByRole('spinbutton', { name: 'Durée de confirmation' });
  check(`${name} : durée proposée 20 s, bornes 2–60`, await duration.inputValue() === '20'
    && await duration.getAttribute('min') === '2' && await duration.getAttribute('max') === '60');
  await shot('1-chargement');
  await duration.fill('10'); await duration.press('Tab');
  check(`${name} : durée 10 s en brouillon`, /non enregistrées/.test(await eventually(() => syncText(page), t => /non enregistrées/.test(t))));

  // 2. Création et modification d'un profil
  await page.getByRole('button', { name: 'Nouveau' }).click();
  const title = page.locator('.title-input');
  await title.fill('Salon test'); await title.press('Enter'); await title.blur();
  check(`${name} : profil créé et renommé`, (await eventually(() => page.locator('.profile-list').innerText(), t => t.includes('Salon test'))).includes('Salon test'));
  check(`${name} : modification signalée`, /non enregistrées/.test(await syncText(page)) && await page.locator('.syncbar.dirty').count() === 1);
  const rule = () => page.locator('.rule').first();
  await rule().getByRole('button', { name: '4K', exact: true }).click();
  await rule().getByRole('button', { name: 'SDR', exact: true }).click();
  await rule().getByRole('button', { name: 'MULTi', exact: true }).click();
  const lang = rule().getByLabel('Ajouter une langue audio');
  await lang.fill('fr'); await lang.press('Enter');
  await page.getByRole('button', { name: 'Ajouter une règle' }).click();
  await page.getByRole('button', { name: 'Ajouter une règle' }).click();
  const descs = async () => page.locator('.rule .rule-desc').allInnerTexts();
  check(`${name} : règle composée par puces`, (await descs())[0] === '1080p ou 4K · SDR · MULTi · audio fr', (await descs())[0]);

  // 3. Réorganisation : boutons, puis glisser-déposer (souris) sur bureau
  await page.locator('.rule').nth(0).getByRole('button', { name: 'Descendre' }).click();
  const down = await eventually(descs, d => d[1] === '1080p ou 4K · SDR · MULTi · audio fr');
  check(`${name} : règle descendue par bouton`, down[1] === '1080p ou 4K · SDR · MULTi · audio fr', down.join(' / '));
  if (!mobile) {
    check(`${name} : ordre avant glisser-déposer`, (await descs())[0] !== '1080p ou 4K · SDR · MULTi · audio fr', (await descs()).join(' / '));
    const handle = page.locator('.rule').nth(1).locator('.handle');
    const target = page.locator('.rule').nth(0);
    const from = await handle.boundingBox(), to = await target.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + 4, from.y - (from.y - to.y + 10) * i / 12);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const up = await eventually(descs, d => d[0] === '1080p ou 4K · SDR · MULTi · audio fr');
    check(`${name} : règle remontée par glisser-déposer`, up[0] === '1080p ou 4K · SDR · MULTi · audio fr', up.join(' / '));
  }
  const tiers = async () => page.locator('.tier-list .tier-name').allInnerTexts();
  await page.locator('.tier-list .tier').nth(1).getByRole('button', { name: 'Monter' }).click();
  const order = await eventually(tiers, t => t.slice(0, 2).join(',') === 'vStream,Jellyfin');
  check(`${name} : vStream avant Jellyfin`, order.slice(0, 2).join(',') === 'vStream,Jellyfin', order.join(','));
  const active = page.locator('.profile-list li.selected .state');
  await active.click();
  check(`${name} : profil activé`, (await eventually(() => active.innerText(), t => t.trim() === 'actif')).trim() === 'actif');
  await shot('2-edition');

  // 4. Aperçu sans enregistrement (vrai moteur, releases fictives)
  const before = await mockState(page);
  await page.getByLabel('Identifiant TMDb').fill('123');
  await page.waitForSelector('.preview .row:not(.empty)', { timeout: 5000 });
  const first = await page.locator('.preview .row.first .row-name').innerText();
  const after = await mockState(page);
  check(`${name} : aperçu affiché sans enregistrement`, after.previews > before.previews && after.puts === before.puts && after.state.version === 0, first);
  await page.locator('.preview').scrollIntoViewIfNeeded();
  await shot('3-apercu');

  // 5. Enregistrement réussi (faux Nexus seulement)
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(400);
  check(`${name} : enregistré, version 1`, /v1\b/.test(await syncText(page)) && /enregistré dans le backend/.test(await syncText(page)), await syncText(page));
  check(`${name} : durée confirmée par le backend`, (await mockState(page)).state.preferences.playback.confirm_duration === 10);

  // 5 bis. Profil de compatibilité matérielle : Standard par défaut, Raspberry Pi 5 sur demande
  const hardware = page.getByLabel('Profil de compatibilité matérielle');
  const playbackSaved = async () => (await mockState(page)).state.preferences.playback || {};
  check(`${name} : profil matériel Standard par défaut, rien d’enregistré`, await hardware.inputValue() === 'standard'
    && !('hardware_profile' in await playbackSaved()));
  const attempts = async () => page.locator('.preview .row:not(.refused):not(.group) .row-name').allInnerTexts();
  const position = (rows, codec) => rows.findIndex(r => r.includes('2160p ' + codec));
  const standard = await attempts();
  check(`${name} : Standard, H.264 4K essayée avant HEVC 4K`, position(standard, 'h264') >= 0
    && position(standard, 'h264') < position(standard, 'hevc'), standard.join(' / '));
  await hardware.selectOption('rpi5');
  const rpi5 = await eventually(attempts, r => position(r, 'hevc') < position(r, 'h264'));
  check(`${name} : Raspberry Pi 5, HEVC 4K avant H.264 4K dans l’aperçu`, position(rpi5, 'hevc') >= 0
    && position(rpi5, 'hevc') < position(rpi5, 'h264') && rpi5.length === standard.length, rpi5.join(' / '));
  check(`${name} : explication du décodage logiciel`, /décodage logiciel/.test(await page.locator('.preview').innerText()));
  await page.locator('.playback-settings').scrollIntoViewIfNeeded();
  await shot('3b-profil-materiel');
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(400);
  check(`${name} : Raspberry Pi 5 enregistré dans playback.hardware_profile`, (await playbackSaved()).hardware_profile === 'rpi5'
    && (await playbackSaved()).confirm_duration === 10);
  await hardware.selectOption('standard');
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(400);
  check(`${name} : Standard retire le champ, les autres réglages restent`, !('hardware_profile' in await playbackSaved())
    && (await playbackSaved()).confirm_duration === 10);

  // 6. Validation 422 : taille minimale au-dessus de la maximale
  await page.getByLabel('Taille min. (Go)').fill('10'); await page.getByLabel('Taille min. (Go)').press('Tab');
  await page.getByLabel('Taille max. (Go)').fill('2'); await page.getByLabel('Taille max. (Go)').press('Tab');
  await page.waitForTimeout(900);
  const previewError = await page.locator('.preview .bad').innerText().catch(() => '');
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(400);
  check(`${name} : 422 lisible (aperçu et enregistrement)`, /refusé par le moteur/.test(await syncText(page)) && /minimale/.test(previewError), previewError);
  await shot('4-erreur-422');
  await page.getByLabel('Taille min. (Go)').fill(''); await page.getByLabel('Taille min. (Go)').press('Tab');
  await page.getByLabel('Taille max. (Go)').fill(''); await page.getByLabel('Taille max. (Go)').press('Tab');

  // 7. Conflit 409 : brouillon gardé, rechargement proposé
  await page.getByRole('button', { name: 'Ajouter une règle' }).click();
  await control(page, { next_put: 409 });
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(400);
  check(`${name} : conflit 409 sans écrasement`, /modifié ailleurs/.test(await syncText(page)) && await page.getByRole('button', { name: 'Recharger' }).count() === 1);
  await shot('5-conflit-409');

  // 8. Session expirée, puis reconnexion
  await control(page, { authenticated: false });
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(500);
  check(`${name} : session expirée -> connexion proposée`, /connexion requise/.test(await syncText(page)) && await page.locator('form.login').count() === 1);
  await shot('6-session-expiree');
  await page.getByLabel('Mot de passe d’administration').fill('faux'); await page.locator('form.login').getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForTimeout(300);
  check(`${name} : mauvais mot de passe signalé`, (await page.locator('form.login .bad').innerText()).includes('incorrect'));
  await page.getByLabel('Mot de passe d’administration').fill('fictif'); await page.locator('form.login').getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForTimeout(300);
  check(`${name} : reconnecté`, await page.locator('form.login').count() === 0);

  // 9. Jeton anti-CSRF périmé
  await control(page, { csrf: 'jeton-rotatif' });
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(400);
  check(`${name} : requête sans bon jeton CSRF refusée`, /connexion requise/.test(await syncText(page)), await syncText(page));
  await control(page, { csrf: 'csrf-fictif' });

  // 10. Backend indisponible
  await control(page, { down: true });
  await page.reload({ waitUntil: 'load' });
  check(`${name} : avertissement avant de quitter avec des modifications`, leaveWarnings === 1, String(leaveWarnings));
  check(`${name} : backend injoignable signalé`, /injoignable/.test(await eventually(() => syncText(page), t => /injoignable/.test(t))) && await page.getByRole('button', { name: 'Recharger' }).count() === 1);
  await shot('7-indisponible');
  await control(page, { down: false });
  await page.getByRole('button', { name: 'Recharger' }).click(); await page.waitForTimeout(400);
  check(`${name} : rechargé après retour du backend`, /enregistré dans le backend/.test(await syncText(page)));

  // Clavier : un bouton de puce reçoit le focus et l'active avec Espace
  await page.locator('.profile-list li').last().locator('.profile').focus();
  await page.keyboard.press('Tab');  // focus déplacé au clavier : :focus-visible doit s'appliquer
  const focusVisible = await page.evaluate(() => document.activeElement.matches(':focus-visible')
    && getComputedStyle(document.activeElement).outlineStyle !== 'none');
  check(`${name} : focus clavier visible`, focusVisible);

  const o = await overflow(page);
  check(`${name} : aucun débordement`, !o.page && o.wide.length === 0, JSON.stringify(o));
  check(`${name} : aucune erreur JS ni dialogue`, errors.length === 0, errors.join(' | '));
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  if (process.argv[3] === 'mobile') await flow(browser, 'mobile', { width: 390, height: 844 }, true);
  else await flow(browser, 'bureau', { width: 1440, height: 900 }, false);
  await browser.close();
  for (const [ok, label, detail] of results) console.log(ok, label, detail ? '— ' + detail : '');
  if (results.some(([status]) => status === 'ÉCHEC')) process.exitCode = 1;
})();
