// The Toolbox's panels: each one opens as its own small window, with content, and closes again
'use strict';

const PANELS = [['init', 'Initiative'], ['chars', 'Character cards'], ['timer', 'Countdown'], ['dice', 'Dice'], ['moments', 'Screen effects'], ['snaps', 'Snapshots'], ['sound', 'Soundboard'],
  ['spotify', 'Spotify'], ['handouts', 'Handouts'], ['atlas', 'Cartographer'], ['notes', 'Session log'], ['break', 'Break'], ['lights', 'Room lights'], ['players', 'Player phones'], ['remote', 'Gamemaster remote']];

module.exports = (area) => {
  area.title('Toolbox panels');
  area.before(async (K) => { await K.openDemo(); await K.send(); });

  area.quick('the Toolbox lists every panel and map tool', async (t) => {
    t.gm().webContents.focus();
    await t.key('Q');
    await t.until(() => t.popTitle(), 3000, 'the Toolbox');
    const tiles = await t.g(`[...document.querySelectorAll('#pop .tb-tile')].map((x) => x.textContent.trim())`);
    const known = await t.g(`Play.TB.PANELS.map((p) => p.id)`);
    t.eq([...known].sort(), [...PANELS.map((p) => p[0]), 'mapnotes'].sort(), 'the panels the app knows (a new one needs a check here)');
    t.ok(tiles.length >= known.length - 1 + 8, 'a tile for every panel and map tool', tiles.length); // (Third Builder (third-marks-tool): 8 map tools; Map notes have no tile, they are in Marks)
  });

  for (const [id, label] of PANELS) {
    area.quick(`${label} opens from the Toolbox and closes again`, async (t) => {
      await t.g(`document.querySelector('.rail-btn[data-id="toolbox"]').click()`);
      await t.until(() => t.popTitle(), 3000, 'the Toolbox');
      const short = await t.g(`(() => { const p = Play.TB.PANELS.find((x) => x.id === ${JSON.stringify(id)}); return p ? [p.label, p.short || p.label] : null; })()`);
      t.ok(short, `the app knows the panel ${id}`);
      t.eq(short[0], label, 'the name of the panel');
      const ok = await t.g(`(() => { const want = ${JSON.stringify(short)}; const b = [...document.querySelectorAll('#pop .tb-tile')].find((x) => want.some((w) => x.textContent.trim() === w || x.textContent.trim().startsWith(w))); if (!b) return false; b.click(); return true; })()`);
      t.ok(ok, `the Toolbox has a ${label} tile`);
      const p = await t.until(async () => (await t.panels()).find((x) => x.id === id), 4000, `the ${label} panel`);
      t.ok(p.title && p.title.length > 1, 'the panel has a title', p);
      await t.sleep(400);
      const chars = await t.g(`document.querySelector('.fp[data-id="${id}"]').textContent.length`);
      t.ok(chars > p.title.length + 8, 'the panel has content', chars);
      const box = await t.rect(`.fp[data-id="${id}"]`);
      t.ok(box.w > 150 && box.h > 60 && box.x >= 0 && box.y >= 0 && box.x + box.w <= (await t.g('innerWidth')) + 1, 'the panel lies inside the window', box);
      const pv = await t.rect('#table-ctl');
      t.ok(!(box.x < pv.x + pv.w && box.x + box.w > pv.x && box.y < pv.y + pv.h && box.y + box.h > pv.y), 'it does not cover the preview of the TV (B2)', { box, pv });
      await t.g(`Play.Floats.hide(${JSON.stringify(id)})`);
      await t.until(async () => !(await t.panels()).some((x) => x.id === id), 3000, 'the panel to close');
    });
  }

  // B2 (open point): a panel left on the preview last time, or reached by a preview made bigger, moves just left of it
  area.quick('a panel never opens on the preview, and moves aside when the preview grows', async (t) => {
    const over = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const pv = await t.rect('#table-ctl');
    const st = await t.rect('#stage');
    // left on the preview last time (as if dragged there before the preview was made bigger), then closed
    await t.g(`Play.TB.openPanel('dice')`);
    await t.until(async () => (await t.panels()).some((x) => x.id === 'dice'), 4000, 'Dice');
    await t.g(`(() => { const e = document.querySelector('.fp[data-id="dice"]'); e.style.left = '${Math.round(pv.x - st.x + 20)}px'; e.style.top = '${Math.round(pv.y - st.y + 10)}px'; Play.Floats.hide('dice'); })()`);
    await t.g(`Play.TB.openPanel('dice')`);
    await t.until(async () => (await t.panels()).some((x) => x.id === 'dice'), 4000, 'Dice again');
    const d = await t.rect('.fp[data-id="dice"]');
    t.ok(!over(d, pv) && d.x + d.w <= pv.x, 'left last time on the preview: it opens just left of it', { d, pv });
    t.ok(Math.abs(d.y - pv.y - 10) < 2, 'at the height it had', { d, pv });
    // the preview made wider: the panel it reaches moves along
    const w0 = pv.w;
    await t.g(`(() => { document.getElementById('table-ctl').style.width = '${Math.round(w0 + 260)}px'; Play.Floats.avoidPreview(); })()`);
    const pv2 = await t.rect('#table-ctl'); const d2 = await t.rect('.fp[data-id="dice"]');
    t.ok(pv2.w > w0 + 200 && !over(d2, pv2), 'a bigger preview pushes it aside', { d2, pv2 });
    await t.g(`(() => { document.getElementById('table-ctl').style.width = '${Math.round(w0)}px'; Play.Floats.hide('dice'); })()`);
  });

  // H4 (open point): explanations behind "?", not in the panels (Player phones, Character cards, Handouts)
  area.quick('Player phones, Character cards and Handouts: explanations behind "?", not in the panel', async (t) => {
    const gone = { players: ['A player scans the code', 'Sight, darkvision and light', 'Everyone walks their speed once', 'In a fight only the player'], chars: ['Everything here is only for you'], handouts: ['Click a handout to show it'] };
    for (const [id, lines] of Object.entries(gone)) {
      await t.g(`Play.TB.openPanel(${JSON.stringify(id)})`);
      await t.until(async () => (await t.panels()).some((x) => x.id === id), 4000, id);
      await t.sleep(300);
      const p = await t.g(`(() => { const e = document.querySelector('.fp[data-id="${id}"]'); return { text: e.querySelector('.fp-body').textContent, help: !!e.querySelector('.fp-head .help-q') }; })()`);
      t.ok(lines.every((l) => !p.text.includes(l)), `${id}: no explanation in the panel`, lines.filter((l) => p.text.includes(l)));
      t.ok(p.help, `${id}: a "?" in its title bar`);
      await t.g(`Play.Floats.hide(${JSON.stringify(id)})`);
    }
    // H4, part 2: Room lights' tuning lines, the card's Extra moves line, the Handout table's empty line; E4: the log
    // switch in the Session log, not in Handouts
    const tipsOf = async (id) => (await t.g(`Play.TB.PANEL_TIPS[${JSON.stringify(id)}]`)).join(' ');
    t.ok(/Brightest and Darkest/.test(await tipsOf('lights')) && /next to Dash/.test(await tipsOf('chars')), 'Room lights and Character cards: their "?" say it now');
    await t.g(`Play.TB.openPanel('handouts')`);
    await t.until(async () => (await t.panels()).some((x) => x.id === 'handouts'), 4000, 'Handouts');
    t.ok(!(await t.g(`document.querySelector('.fp[data-id="handouts"]').textContent`)).includes('Handout shown'), 'Handouts: no log switch');
    await t.g(`Play.Floats.hide('handouts')`);
    await t.g(`Play.TB.openPanel('notes')`);
    await t.until(async () => (await t.panels()).some((x) => x.id === 'notes'), 4000, 'Session log');
    t.ok((await t.g(`document.querySelector('.fp[data-id="notes"]').textContent`)).includes('Write "Handout shown" into the log'), 'Session log: the log switch');
    await t.g(`Play.Floats.hide('notes')`);
    // what left the Player phones panel is behind its "?" (the Guide's Help shows these)
    const tips = (await t.g(`Play.TB.PANEL_TIPS.players`)).join(' ');
    t.ok(['one square per push', 'Pace Movement', 'Sight, darkvision and light', 'only the player whose turn it is moves'].every((s) => tips.includes(s)), 'Player phones: its "?" says it now', tips);
  });

  area.quick('several panels stay open side by side', async (t) => {
    for (const id of ['init', 'timer', 'dice']) await t.g(`Play.TB.openPanel(${JSON.stringify(id)})`);
    await t.sleep(400);
    const ids = (await t.panels()).map((x) => x.id);
    for (const id of ['init', 'timer', 'dice']) t.has(ids, id, 'open panels');
  });

  area.quick('J picks Marks with Only me (a note)', async (t) => { // (Third Builder (third-marks-tool))
    t.gm().webContents.focus();
    await t.key('J');
    await t.sleep(300);
    t.eq(await t.tool(), 'mark', 'the tool after J');
    t.eq(await t.popTitle(), 'Marks', 'its panel');
    t.eq(await t.g(`[Play.ui.mark.mode, Play.ui.mark.me]`), ['label', true], 'a label only you see');
    await t.g(`Play.ui.mark.me = false`);
  });
};
