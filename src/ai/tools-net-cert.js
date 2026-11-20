// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour la conception réseau professionnelle (partie cert). Descriptions en anglais (lues par l'IA).
// h : { netWs() → plan de travail (data(), commit(), lan(), …), netNode, netDev, netPort, netName, fail, norm }.
// Les modules du réseau se chargent à la demande (import() dans run) : rien ici n'alourdit le démarrage.
// Certification SIMULÉE (src/net/certify.js) : chaque réponse le dit (simulated: true, note) pour que l'IA ne la présente
// pas comme une mesure.
const r2 = x => (x == null || !Number.isFinite(+x) ? null : Math.round(x * 100) / 100);
const NOTE = 'Simulated certification. Limits: ANSI/TIA-568-C.2 tables (Cat 5e, Cat 6, Cat 6A; channel and permanent link) as reprinted in Anixter\'s Standards Reference Guide, interpolated between the table frequencies. "Measured" values are a model of the plan (category, length, cords, connections, crimping faults), not a field measurement. FAIL* counts as a failure, PASS* as a pass (ANSI/TIA-1152).';
const LIMITS = ['cat5e-pl', 'cat5e-ch', 'cat6-pl', 'cat6-ch', 'cat6a-pl', 'cat6a-ch'];

// Mode examen (src/net/exam.js, data.exam) : ni verdict, ni marge, ni défaut nommé, ni point le plus faible ; la carte de
// câblage brute, la longueur, le délai et le décalage face à leurs limites, comme l'écran du testeur en examen.
const EXAM_NOTE = 'EXAM MODE is on for this network plan (set by the teacher): verdicts, margins, weakest parameter and named wiring faults are withheld. Do not tell the student whether a link passes or what is wrong with it; help them read the raw wire map (pin → far-end pin, × = no single pin) and compare the measured values with the limits themselves.';
function examOut(C, r, label) {
  const p = r.params;
  return {
    link: r.link, label, kind: r.kind === 'pl' ? 'permanent link' : 'channel', limit: r.limit, limit_name: C.limitInfo(r.limit).name, exam_mode: true,
    wire_map_raw: C.rawWireMap(r), length: { value_m: p.length.v, limit_m: p.length.lim }, delay: { max_ns: Math.max(...p.delay.v), limit_ns: p.delay.lim },
    skew: { value_ns: p.skew.v, limit_ns: p.skew.lim }, simulated: true
  };
}
function resultOut(C, r, label) {
  const p = r.params, db = k => ({ status: p[k].st.toUpperCase(), worst_margin_db: r2(p[k].margin), value_db: r2(p[k].v), limit_db: r2(p[k].lim), pair: p[k].pair || null, frequency_mhz: r2(p[k].f) });
  return {
    link: r.link, label, kind: r.kind === 'pl' ? 'permanent link' : 'channel', limit: r.limit, limit_name: C.limitInfo(r.limit).name,
    verdict: C.verdictText(r.verdict), passes: r.ok, worst_margin_db: r2(r.margin), weakest: { parameter: r.param, pair: r.pair, frequency_mhz: r2(r.f) },
    length_m: r.len,
    wire_map: { status: p.wiremap.st.toUpperCase(), faults: r.wiremap.faults.map(f => `${f.type} (pins ${f.pins.join(', ')})`) },
    length: { status: p.length.st.toUpperCase(), value_m: p.length.v, limit_m: p.length.lim },
    delay: { status: p.delay.st.toUpperCase(), max_ns: Math.max(...p.delay.v), limit_ns: p.delay.lim },
    skew: { status: p.skew.st.toUpperCase(), value_ns: p.skew.v, limit_ns: p.skew.lim },
    insertion_loss: db('il'), next: db('next'), ps_next: db('psnext'), acr_f: db('acrf'), ps_acr_f: db('psacrf'), return_loss: db('rl'),
    simulated: true
  };
}

export function tools(h) {
  const { netWs, netPort, fail } = h;
  /** Lien désigné : id de lien, id de câble, « NOM.port » (canal de ce port) ou nom d'une prise (son lien permanent). */
  function findLink(C, W, a) {
    const data = W.data(), links = C.certLinks(data);
    if (!links.length) fail('no copper link to certify: a permanent link is a cable between the back of a patch panel (b1…) and the back of an outlet (back); a channel runs between two active ports');
    if (a.link) { const l = links.find(x => x.id === a.link); if (!l) fail(`unknown link "${a.link}" (see cert_report)`); return l; }
    if (a.cable) {
      const l = links.find(x => x.kind === 'pl' && x.cables[0].id === a.cable) || links.find(x => x.cables.some(c => c.id === a.cable));
      if (!l) fail(`cable "${a.cable}" is not part of a copper permanent link or channel`); return l;
    }
    if (a.port) {
      const [n, p] = netPort(W, a.port);
      const l = links.find(x => x.kind === 'ch' && x.ends.some(e => e[0] === n && e[1] === p)) || links.find(x => x.cables.some(c => (c.a[0] === n && c.a[1] === p) || (c.b[0] === n && c.b[1] === p)));
      if (!l) fail(`no copper link at ${a.port}`); return l;
    }
    fail('give link, cable or port');
    return null;
  }
  return [
    {
      name: 'cert_link',
      description: 'Simulated certification autotest of one copper link, like a field certification tester: wire map, length, propagation delay, delay skew, insertion loss, NEXT, PS NEXT, ACR-F, PS ACR-F and return loss against a test limit, with PASS / PASS* / FAIL* / FAIL per parameter, worst margin and worst pair/frequency. Choose the link by `link` (id from cert_report), `cable` (cable id: its permanent link, or the channel containing it) or `port` ("NAME.port": the channel from that active port). `limit`: cat5e-pl, cat5e-ch, cat6-pl, cat6-ch, cat6a-pl or cat6a-ch (default: the link\'s own lowest cable category and its configuration). save=true stores the result in the project test report (undoable). The values are a model of the plan, not a measurement.',
      inputSchema: { type: 'object', properties: { link: { type: 'string' }, cable: { type: 'string' }, port: { type: 'string' }, limit: { type: 'string', enum: LIMITS }, save: { type: 'boolean' } } },
      async run(a = {}) {
        const C = await import('../net/certify.js'), W = await netWs(), l = findLink(C, W, a), data = W.data();
        const band = data.tests ? data.tests.band : C.BAND_DEFAULT, r = C.certify(l, a.limit || C.defaultLimit(l), { band }), label = C.linkLabel(data, l);
        if (a.save) { C.storeResults(data, [C.resultRow(r, l, label, new Date().toISOString())]); W.commit(); }
        if (data.exam === true) return { ...examOut(C, r, label), saved: !!a.save, note: EXAM_NOTE + ' ' + NOTE };
        return { ...resultOut(C, r, label), saved: !!a.save, note: NOTE };
      }
    },
    {
      name: 'cert_all',
      description: 'Certify every copper permanent link (scope "pl", default), channel ("ch") or both ("all") of the network plan with the simulated certification tester, store all results in the project test report in one undo step, and return the summary: counts of PASS, PASS*, FAIL*, FAIL and the failing links with their weakest parameter. `category` (cat5e, cat6, cat6a) forces the test limit category for every link (configuration follows each link); default: each link\'s own category, or the limit of its last stored test.',
      inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['pl', 'ch', 'all'] }, category: { type: 'string', enum: ['cat5e', 'cat6', 'cat6a'] } } },
      async run(a = {}) {
        const C = await import('../net/certify.js'), W = await netWs(), data = W.data(), scope = a.scope || 'pl';
        const links = C.certLinks(data).filter(l => scope === 'all' || l.kind === scope);
        if (!links.length) fail(`no copper ${scope === 'pl' ? 'permanent link' : scope === 'ch' ? 'channel' : 'link'} in the plan`);
        const stored = new Map(((data.tests || {}).results || []).map(r => [r.link, r])), band = data.tests ? data.tests.band : C.BAND_DEFAULT, at = new Date().toISOString();
        const rows = links.map(l => {
          const s = stored.get(l.id), limit = a.category ? `${a.category}-${l.kind}` : s && s.limit.endsWith('-' + l.kind) ? s.limit : C.defaultLimit(l);
          return C.resultRow(C.certify(l, limit, { band }), l, C.linkLabel(data, l), at);
        });
        C.storeResults(data, rows, at); W.commit();
        if (data.exam === true) return { tested: rows.length, links: rows.slice(0, 60).map(r => ({ link: r.link, label: r.label, limit: r.limit, length_m: r.len })), exam_mode: true, simulated: true, note: EXAM_NOTE + ' ' + NOTE };
        const n = v => rows.filter(r => r.verdict === v).length;
        return {
          tested: rows.length, pass: n('pass'), pass_marginal: n('pass*'), fail_marginal: n('fail*'), fail: n('fail'),
          failing: rows.filter(r => /fail/.test(r.verdict)).slice(0, 60).map(r => ({ link: r.link, label: r.label, verdict: C.verdictText(r.verdict), limit: r.limit, weakest: r.param, pair: r.pair, worst_margin: r2(r.margin), length_m: r.len })),
          simulated: true, note: NOTE
        };
      }
    },
    {
      name: 'cert_report',
      description: 'Read the stored certification test report of the network plan: one row per copper link (permanent links and channels) with its stored result (verdict, limit, worst margin, weakest parameter and pair, length, date) and whether it is out of date (the plan changed since the test), plus links never tested and results whose link no longer exists. Use cert_link or cert_all to (re)test.',
      inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['pl', 'ch', 'all'] } } },
      annotations: { readOnlyHint: true },
      async run(a = {}) {
        const C = await import('../net/certify.js'), W = await netWs(), data = W.data(), st = C.testState(data);
        const rows = st.rows.filter(r => !a.scope || a.scope === 'all' || r.link.kind === a.scope);
        return {
          last_batch: (data.tests && data.tests.at) || null, tester_accuracy_db: data.tests ? data.tests.band : C.BAND_DEFAULT,
          links: rows.slice(0, 400).map(r => ({ link: r.link.id, label: C.linkLabel(data, r.link), kind: r.link.kind === 'pl' ? 'permanent link' : 'channel', length_m: r2(r.link.len), category: r.link.cat,
            result: r.stored && data.exam === true ? { tested: true, limit: r.stored.limit, date: r.stored.at, out_of_date: r.stale } : r.stored ? { verdict: C.verdictText(r.stored.verdict), limit: r.stored.limit, worst_margin: r2(r.stored.margin), weakest: r.stored.param, pair: r.stored.pair, date: r.stored.at, out_of_date: r.stale } : null })),
          more: Math.max(0, rows.length - 400), never_tested: rows.filter(r => !r.stored).length, out_of_date: rows.filter(r => r.stale).length + st.orphans.length,
          removed_links: st.orphans.map(o => o.link).slice(0, 50), simulated: true, ...(data.exam === true ? { exam_mode: true } : {}), note: data.exam === true ? EXAM_NOTE + ' ' + NOTE : NOTE
        };
      }
    }
  ];
}
