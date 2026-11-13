// Beta 4.6: a campaign as one file (main: transfer.js)
//   Export…   on a campaign's menu (start screen, campaign page): Share as an adventure or Full copy, the whole
//             campaign or one chapter, how big it gets; then where to save it
//   Import    the start screen's "Import a campaign" tile, or a .tablescape file double-clicked
//   progress  the little maid runs inside a ring that fills up; Cancel stops it and leaves nothing half done
'use strict';

const TransferUI = (() => {
  const { h, iconEl, toast, dialog } = UI;
  const T = (a, p) => window.ts.transfer(a, p);
  const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const KINDS = [
    { id: 'adventure', label: 'Share as an adventure', icon: 'book', text: 'As you prepared it, for another DM: fog covered again, nothing from your sessions; your players and session log stay here.' },
    { id: 'full', label: 'Full copy', icon: 'copy', text: 'Everything as it is now, fog and session log included: for another PC of yours, or to keep.' },
  ];

  // ---------- the ring with the maid ----------
  let ring = null;
  let exporting = '';
  function showRing(title) {
    closeRing();
    const R = 54; const C = 2 * Math.PI * R;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 128 128'); svg.setAttribute('class', 'tr-ring');
    const track = document.createElementNS(NS, 'circle'); const arc = document.createElementNS(NS, 'circle');
    for (const c of [track, arc]) { c.setAttribute('cx', '64'); c.setAttribute('cy', '64'); c.setAttribute('r', String(R)); }
    track.setAttribute('class', 'tr-track'); arc.setAttribute('class', 'tr-arc');
    arc.style.strokeDasharray = `${C}`; arc.style.strokeDashoffset = `${C}`;
    svg.append(track, arc);
    const maid = h('img', { class: 'tr-maid', src: 'maid-run.webp', alt: '' });
    const pct = h('div', { class: 'tr-pct' }, '0%');
    const line = h('div', { class: 'tr-line faint' }, 'Getting ready …');
    const file = h('div', { class: 'tr-file faint' });
    const cancel = h('button', { class: 'btn', onclick: () => { cancel.disabled = true; cancel.textContent = 'Stopping …'; T('cancel'); } }, 'Cancel');
    const actions = h('div', { class: 'tr-actions' }, cancel);
    const titleEl = h('h2', { class: 'tr-title' }, title);
    const box = h('div', { class: 'modal tr-box', role: 'dialog', 'aria-label': title }, titleEl, h('div', { class: 'tr-circle' }, svg, maid), pct, line, file, actions);
    const back = h('div', { class: 'modal-back tr-back' }, box);
    document.body.append(back);
    ring = { back, arc, C, maid, pct, line, file, actions, titleEl, verb: title };
    return ring;
  }
  function closeRing() { if (ring) { ring.back.remove(); ring = null; } }
  function onProgress(e) {
    if (!ring) return;
    const k = e.totalBytes > 0 ? Math.min(1, e.bytes / e.totalBytes) : e.total ? e.done / e.total : 0;
    ring.arc.style.strokeDashoffset = `${ring.C * (1 - k)}`;
    ring.pct.textContent = `${Math.floor(k * 100)}%`;
    ring.line.textContent = `${Math.min(e.done + 1, e.total)} of ${plural(e.total, 'file', 'files')} · ${size(e.bytes)} of ${size(e.totalBytes || 0)}`;
    ring.file.textContent = e.name ? String(e.name).split('/').pop() : '';
  }
  // done: she stands still, the ring is full, buttons for what comes next
  function ringDone(title, text, buttons) {
    if (!ring) return;
    ring.arc.style.strokeDashoffset = '0';
    ring.back.classList.add('done');
    ring.maid.src = 'maid.webp';
    ring.pct.replaceChildren(iconEl('check'));
    ring.titleEl.textContent = title;
    ring.line.textContent = text;
    ring.file.textContent = '';
    ring.actions.replaceChildren(...buttons);
  }

  // ---------- export ----------
  async function exportDialog(c) {
    let kind = 'adventure'; let chapterId = '';
    const kinds = h('div', { class: 'tr-kinds' });
    const chapterSel = h('select', { class: 'tr-chapter', 'aria-label': 'What to export', onchange: () => { chapterId = chapterSel.value; refresh(); } });
    const sum = h('div', { class: 'tr-sum' }, UI.loader('Counting …'));
    const go = h('button', { class: 'btn primary', disabled: true, onclick: () => run() }, iconEl('file-export'), 'Export …');
    const dlg = dialog(`Export ${c.name}`, h('div', { class: 'stack tr-export' },
      kinds,
      h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, 'What'), chapterSel),
      sum,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Cancel'), go)), { wide: true });
    const drawKinds = () => kinds.replaceChildren(...KINDS.map((k) => h('button', { class: `tr-kind ${k.id === kind ? 'on' : ''}`, onclick: () => { kind = k.id; drawKinds(); refresh(); } },
      iconEl(k.icon), h('b', {}, k.label), h('span', {}, k.text))));
    drawKinds();
    let seq = 0; let filled = false;
    async function refresh() {
      const my = ++seq;
      go.disabled = true;
      const r = await T('plan', { id: c.id, kind, chapterId: chapterId || null });
      if (my !== seq) return;
      if (!r || !r.ok) { sum.replaceChildren(h('p', { class: 'danger-text' }, (r && r.error) || 'That did not work.')); return; }
      if (!filled) {
        filled = true;
        chapterSel.append(h('option', { value: '' }, `The whole campaign (${plural(r.chapters.length, 'chapter', 'chapters')})`),
          ...r.chapters.map((ch) => h('option', { value: ch.id }, `Chapter: ${ch.name} (${plural(ch.maps, 'map', 'maps')})`)));
        chapterSel.disabled = r.chapters.length < 2 && !r.chapters[0];
      }
      sum.replaceChildren(...[
        h('div', { class: 'tr-sum-line' }, iconEl('package'), h('span', {}, `${plural(r.maps, 'map', 'maps')} · ${plural(r.files, 'file', 'files')} · about ${size(r.bytes)}`)),
        r.missing.length ? h('div', { class: 'tr-sum-line warn' }, iconEl('alert-triangle'), h('span', { 'data-tip': r.missing.slice(0, 12).join('\n') }, `${plural(r.missing.length, 'file is', 'files are')} missing and stay${r.missing.length === 1 ? 's' : ''} out`)) : null].filter(Boolean));
      go.disabled = false;
    }
    refresh();
    async function run() {
      dlg.close();
      exporting = c.name;
      const r = await T('export', { id: c.id, kind, chapterId: chapterId || null });
      if (r && r.cancelled) { const had = !!ring; closeRing(); if (had) toast('Stopped: nothing was kept', { ms: 2200 }); return; }
      if (!r || !r.ok) { closeRing(); toast((r && r.error) || 'The export did not work.', { kind: 'error' }); return; }
      ringDone('Exported', `${r.name} · ${size(r.bytes)}`, [
        h('button', { class: 'btn', onclick: () => T('reveal', { file: r.file }) }, iconEl('folder'), 'Show the file'),
        h('button', { class: 'btn primary', onclick: closeRing }, 'Done')]);
    }
  }

  // ---------- import ----------
  async function importPick() {
    const info = await T('pick');
    if (!info || info.cancelled) return;
    if (!info.ok) { toast(info.error || 'That file can\'t be read.', { kind: 'error' }); return; }
    importDialog(info);
  }
  async function importFile(file) {
    const info = await T('inspect', { file });
    if (!info || !info.ok) { toast((info && info.error) || 'That file can\'t be read.', { kind: 'error' }); return; }
    importDialog(info);
  }
  function importDialog(info) {
    const kind = KINDS.find((k) => k.id === info.kind) || KINDS[1];
    const go = h('button', { class: 'btn primary', onclick: () => run() }, iconEl('file-import'), 'Import');
    const dlg = dialog(`Import ${info.name}`, h('div', { class: 'stack tr-import' },
      h('div', { class: 'tr-sum-line' }, iconEl(kind.icon), h('span', {}, info.kind === 'adventure' ? 'An adventure, as it was prepared' : 'A full copy, as it was played')),
      h('div', { class: 'tr-sum-line' }, iconEl('package'), h('span', {}, `${plural(info.maps || 0, 'map', 'maps')} · ${plural(info.files, 'file', 'files')} · ${size(info.bytes)}`)),
      info.have ? h('div', { class: 'tr-sum-line faint' }, iconEl('check'), h('span', {}, `${plural(info.have, 'file looks', 'files look')} like ${info.have === 1 ? 'one' : 'ones'} in your library already: the same ones are used, not copied twice`)) : null,
      h('p', { class: 'faint' }, 'The files go into your library, the campaign appears next to your others.'),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Cancel'), go)));
    async function run() {
      dlg.close();
      showRing(`Unpacking ${info.name}`);
      const r = await T('import', { file: info.file });
      if (r && r.cancelled) { closeRing(); toast('Stopped: nothing was kept', { ms: 2200 }); return; }
      if (!r || !r.ok) { closeRing(); toast((r && r.error) || 'The import did not work.', { kind: 'error' }); return; }
      const notes = [plural(r.maps, 'map', 'maps'), plural(r.files, 'file', 'files')];
      if (r.reused) notes.push(`${r.reused} ${r.reused === 1 ? 'was' : 'were'} already in your library`);
      if (r.renamed) notes.push(`${r.renamed} renamed (a different file had the name)`);
      ringDone('Imported', `${r.name} · ${notes.join(' · ')}`, [
        h('button', { class: 'btn', onclick: () => { closeRing(); Home.show(true); } }, 'Done'),
        h('button', { class: 'btn primary', onclick: async () => { closeRing(); await window.ts.cmd('campaign.open', { id: r.id }); } }, iconEl('player-play'), 'Open the campaign')]);
      Home.show(true);
    }
  }

  function start() {
    window.ts.onEvent((e) => {
      if (!e) return;
      if (e.kind === 'transfer') { if (!ring && e.what === 'export') showRing(`Packing ${exporting}`); onProgress(e); }
      if (e.kind === 'importFile' && e.file) importFile(e.file);
    });
    T('pending').then((r) => { if (r && r.file) importFile(r.file); }).catch(() => {});
  }
  return { start, exportDialog, importPick, importFile };
})();
