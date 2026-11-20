// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Outils de l'IA pour la conception réseau professionnelle (partie plan). Descriptions en anglais (lues par l'IA).
// h : { netWs() → plan de travail (data(), commit(), lan(), …), netNode, netDev, netPort, netName, fail, norm }.
// Les modules du réseau se chargent à la demande (import() dans run) : rien ici n'alourdit le démarrage.
// Outils : plan_get, plan_add_building, plan_add_floor, plan_room, plan_detect_rooms, plan_wall, plan_place, path_add,
// cable_route.
export function tools(h) {
  const SITE = () => import('../net/site.js'), ROUTE = () => import('../net/route.js'), CHK = () => import('../net/checks/plan.js');
  const r3 = v => Math.round(v * 1000) / 1000;
  const num = (v, lo, hi, what) => { const x = +v; if (!Number.isFinite(x)) h.fail(`${what} must be a number`); return Math.max(lo, Math.min(hi, x)); };
  const pt = (p, what) => { if (!Array.isArray(p) || p.length < 2) h.fail(`${what}: give [x, y] in metres`); return [r3(num(p[0], -1e4, 1e4, what)), r3(num(p[1], -1e4, 1e4, what))]; };
  /** Étage désigné par id ou nom (« Niveau 1 », « RDC »), ou le seul étage. */
  async function floorRef(W, ref) {
    const { allFloors } = await SITE(), all = allFloors(W.data().site);
    if (!all.length) h.fail('no floor yet: create a building with plan_add_building');
    if (ref == null || ref === '') { if (all.length === 1) return all[0]; h.fail(`several floors: give "floor" (${all.map(x => `${x.f.id} = ${x.b.name} / ${x.f.name}`).join(', ')})`); }
    const r = String(ref), n = h.norm(r);
    const x = all.find(z => z.f.id === r) || all.find(z => h.norm(z.f.name) === n) || all.find(z => h.norm(`${z.b.name} ${z.f.name}`) === n);
    if (!x) h.fail(`no floor "${ref}". Floors: ${all.map(z => `${z.f.id} (${z.b.name} / ${z.f.name})`).join(', ')}`);
    return x;
  }
  async function planIssues(W, ids) {
    const { issues } = await CHK(), data = W.data();
    return issues(data, W.lan(), { name: id => h.netName(W, id) }).filter(i => !ids || ids.has(i.id)).map(i => `${i.code} ${i.text}`);
  }
  const commit = W => { W.commit(); };
  return [
    {
      name: 'plan_get',
      description: 'Read the network project\'s site model (Floor plans view): buildings, floors (level, elevation, heights), and for one floor (or the only one) its rooms (name, use, area m², polygon in metres), walls count, pathways (kind, length, fill %, cables), devices placed on it (x, y, mounting height) and the floor-plan problems (J1250–J1261: tray/conduit fill, conduit bends, power separation, outlets outside rooms, cables without pathway, missing telecom room, outlets beyond 90 m). Coordinates are metres, origin top-left, y down.',
      inputSchema: { type: 'object', properties: { floor: { type: 'string', description: 'floor id or name; default: the only floor' } } },
      annotations: { readOnlyHint: true },
      async run(a) {
        const W = await h.netWs(), data = W.data(), S = await SITE(), R = await ROUTE();
        const site = { name: data.site.name, segregation_class: data.site.seg, buildings: data.site.buildings.map(b => ({ id: b.id, name: b.name, x: b.x, y: b.y, floors: b.floors.map(f => ({ id: f.id, name: f.name, level: f.level, elevation_m: f.elev, floor_height_m: f.height, ceiling_m: f.ceil, rooms: f.rooms.length, walls: f.walls.length })) })) };
        if (!S.allFloors(data.site).length) return { site, note: 'no building yet: plan_add_building creates one' };
        const { f, b } = await floorRef(W, a.floor), byPath = R.cablesByPath(data);
        const ids = new Set([f.id, ...f.rooms.map(r => r.id)]);
        const paths = (data.paths || []).filter(p => p.floor === f.id).map(p => { const fl = R.fillOf(p, byPath.get(p.id) || []); ids.add(p.id); return { id: p.id, name: p.name, kind: p.kind, points: p.pts, z_m: p.z, size: p.dia ? `Ø${p.dia} mm` : p.w ? `${p.w}×${p.h} mm` : null, power: !!p.power, length_m: p.kind === 'outdoor' ? p.len : r3(S.polyLen(p.pts)), cables: fl.n, fill_pct: Math.round(fl.ratio * 100), fill_max_pct: Math.round(fl.max * 100), top_floor: p.top, to_floor: p.to }; });
        const devices = data.devices.filter(d => d.loc && d.loc.floor === f.id).map(d => { ids.add(d.id); const r = S.roomAt(f, d.loc.x, d.loc.y); return { device: d.name, id: d.id, type: d.type, x: d.loc.x, y: d.loc.y, h_m: d.loc.h, room: r ? r.name || r.usage : null }; });
        return {
          site, floor: { id: f.id, name: f.name, building: b.name },
          rooms: f.rooms.map(r => ({ id: r.id, name: r.name, use: r.usage, area_m2: r3(S.roomArea(r)), polygon: r.poly, holes: r.holes })),
          walls: f.walls.length, doors: f.doors.length, pathways: paths, devices,
          racks: (data.racks || []).filter(r => r.floor === f.id).map(r => ({ id: r.id, name: r.name, x: r.x, y: r.y, rot: r.rot })),
          problems: await planIssues(W, ids)
        };
      }
    },
    {
      name: 'plan_add_building',
      description: 'Create a building in the network project\'s site, with N floors stacked from level 0 (ground floor). Each floor gets its elevation from the floor-to-floor height. Returns the floor ids to use with plan_wall, plan_room, plan_place and path_add. Optional sample:true adds a realistic 40 × 18 m office floor (walls, doors, rooms, telecom room with rack and patch panel, corridor cable tray, J-hooks, power trunking, outlets, APs, camera, auto-routed permanent links) instead of empty floors.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, x: { type: 'number', description: 'site-plan position (m), used for lengths between buildings' }, y: { type: 'number' }, floors: { type: 'number', description: 'number of floors (default 1)' }, floor_height_m: { type: 'number', description: 'floor-to-floor height (default 3.5)' }, first_level: { type: 'number', description: 'level of the lowest floor (default 0; -1 for a basement)' }, sample: { type: 'boolean' } } },
      async run(a) {
        const W = await h.netWs(), data = W.data(), S = await SITE();
        if (a.sample) {
          const { addDemoFloor } = await import('../net/ui/plan-demo.js'); let newRack = null; try { newRack = (await import('../net/rack.js')).newRack; } catch (e) { /* baies indisponibles */ }
          const r = addDemoFloor(data, { newRack, name: a.name }); commit(W);
          return { building: r.building.id, floors: [{ id: r.floor.id, name: r.floor.name }], note: 'sample office floor added; use plan_get to read it' };
        }
        const used = S.siteIds(data.site), n = Math.round(num(a.floors ?? 1, 1, 60, 'floors')), H = num(a.floor_height_m ?? 3.5, 2, 30, 'floor_height_m'), l0 = Math.round(num(a.first_level ?? 0, -20, 200, 'first_level'));
        const b = { id: S.uid('', 'B', used), name: String(a.name || `Building ${data.site.buildings.length + 1}`).slice(0, 40), x: num(a.x ?? (data.site.buildings.length ? Math.max(...data.site.buildings.map(z => z.x)) + 80 : 0), -1e4, 1e4, 'x'), y: num(a.y ?? 0, -1e4, 1e4, 'y'), floors: [] };
        for (let i = 0; i < n; i++) { const level = l0 + i; b.floors.push({ id: S.uid('', 'F', used), name: level === 0 ? 'RDC' : `Niveau ${level}`, level, elev: r3(level * H), height: H, ceil: Math.min(H, 2.7), plenum: 0.6, raised: 0, walls: [], doors: [], rooms: [] }); }
        data.site.buildings.push(b); commit(W);
        return { building: b.id, floors: b.floors.map(f => ({ id: f.id, name: f.name, level: f.level, elevation_m: f.elev })) };
      }
    },
    {
      name: 'plan_add_floor',
      description: 'Add a floor to a building (above the top floor by default, or below the lowest with below:true). copy_from: a floor id or name whose walls, doors, rooms and pathways (not risers) are duplicated onto the new floor (typical floor of a multi-storey building).',
      inputSchema: { type: 'object', properties: { building: { type: 'string', description: 'building id or name (default: the only building)' }, name: { type: 'string' }, below: { type: 'boolean' }, floor_height_m: { type: 'number' }, copy_from: { type: 'string' } } },
      async run(a) {
        const W = await h.netWs(), data = W.data(), S = await SITE(), bs = data.site.buildings;
        if (!bs.length) h.fail('no building yet: plan_add_building');
        const b = a.building ? bs.find(x => x.id === a.building || h.norm(x.name) === h.norm(a.building)) : bs.length === 1 ? bs[0] : null;
        if (!b) h.fail(`give "building" (${bs.map(x => `${x.id} = ${x.name}`).join(', ')})`);
        const used = S.siteIds(data.site), fs = b.floors, top = fs.reduce((m, f) => (!m || f.level > m.level ? f : m), null), low = fs.reduce((m, f) => (!m || f.level < m.level ? f : m), null);
        const ref = a.below ? low : top, H = num(a.floor_height_m ?? (ref ? ref.height : 3.5), 2, 30, 'floor_height_m'), level = ref ? ref.level + (a.below ? -1 : 1) : 0;
        const f = { id: S.uid('', 'F', used), name: String(a.name || (level === 0 ? 'RDC' : `Niveau ${level}`)).slice(0, 40), level, elev: ref ? r3(a.below ? ref.elev - H : ref.elev + ref.height) : 0, height: H, ceil: ref ? ref.ceil : 2.7, plenum: ref ? ref.plenum : 0.6, raised: ref ? ref.raised : 0, walls: [], doors: [], rooms: [] };
        if (a.copy_from) {
          const src = (await floorRef(W, a.copy_from)).f, wm = new Map();
          for (const w of src.walls) { const id = S.uid('', 'w', used); wm.set(w.id, id); f.walls.push({ ...w, id, a: [...w.a], b: [...w.b] }); }
          for (const d of src.doors) if (wm.has(d.wall)) f.doors.push({ ...d, id: S.uid('', 'dr', used), wall: wm.get(d.wall) });
          for (const r of src.rooms) f.rooms.push({ ...r, id: S.uid('', 'rm', used), poly: r.poly.map(q => [...q]), ...(r.holes ? { holes: r.holes.map(hh => hh.map(q => [...q])) } : {}) });
          const pids = new Set((data.paths || []).map(p => p.id)); let i = 1;
          for (const p of (data.paths || []).filter(x => x.floor === src.id && x.kind !== 'riser' && x.kind !== 'outdoor')) { while (pids.has('pa' + i)) i++; pids.add('pa' + i); data.paths.push({ ...p, id: 'pa' + i, floor: f.id, pts: p.pts.map(q => [...q]) }); }
        }
        fs.push(f); fs.sort((x, y) => x.level - y.level); commit(W);
        return { floor: f.id, name: f.name, level: f.level, elevation_m: f.elev, copied: a.copy_from ? { walls: f.walls.length, rooms: f.rooms.length } : null };
      }
    },
    {
      name: 'plan_room',
      description: 'Add, edit or remove a room on a floor (holes: inner polygons such as a courtyard, excluded from its area). Give polygon [[x,y],…] (metres, ≥ 3 corners) or rect [x0, y0, x1, y1]. use: office, open (open-plan), classroom, lab, meeting, corridor, hall, tr (telecommunications room / floor distributor), er (equipment room), ef (entrance facility), storage, sanitary, other. To edit, give id (or the room name) plus the fields to change; remove:true deletes it. Rooms are not walls: draw walls with plan_wall.',
      inputSchema: { type: 'object', properties: { floor: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, use: { type: 'string' }, polygon: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, rect: { type: 'array', items: { type: 'number' } }, holes: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, description: 'inner polygons excluded from the room (courtyard, patio); [] removes them' }, remove: { type: 'boolean' } } },
      async run(a) {
        const W = await h.netWs(), S = await SITE(), { f } = await floorRef(W, a.floor);
        let r = a.id ? f.rooms.find(x => x.id === a.id || h.norm(x.name) === h.norm(a.id)) : null;
        if (a.id && !r) h.fail(`no room "${a.id}" on ${f.name}`);
        if (a.remove) { if (!r) h.fail('give the room id to remove'); f.rooms = f.rooms.filter(x => x !== r); commit(W); return { removed: r.id }; }
        let poly = null;
        if (a.rect) { if (a.rect.length !== 4) h.fail('rect: [x0, y0, x1, y1]'); const [x0, y0, x1, y1] = a.rect.map((v, i) => num(v, -1e4, 1e4, 'rect[' + i + ']')); poly = [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]]; }
        else if (a.polygon) { poly = a.polygon.map((p, i) => pt(p, 'polygon[' + i + ']')); if (poly.length < 3) h.fail('polygon: at least 3 corners'); }
        if (a.use && !S.USAGES[a.use]) h.fail(`use: one of ${Object.keys(S.USAGES).join(', ')}`);
        if (!r) { if (!poly) h.fail('give polygon or rect for a new room'); r = { id: S.uid('', 'rm', S.siteIds(W.data().site)), name: '', usage: 'office', poly }; f.rooms.push(r); }
        if (poly) r.poly = poly;
        if (Array.isArray(a.holes)) { const hs = a.holes.map((hh, k) => (hh || []).map((p, i) => pt(p, `holes[${k}][${i}]`))).filter(hh => hh.length >= 3); if (hs.length) r.holes = hs; else delete r.holes; } if (a.name != null) r.name = String(a.name).slice(0, 40); if (a.use) r.usage = a.use;
        if (S.roomArea(r) < 0.05) h.fail('the polygon has no area');
        commit(W);
        return { room: r.id, name: r.name, use: r.usage, area_m2: r3(S.roomArea(r)), holes: r.holes ? r.holes.length : 0 };
      }
    },
    {
      name: 'plan_detect_rooms',
      description: 'Create rooms automatically from the walls of a floor: every space closed by walls (wall ends closer than tolerance_m, default 0.15 m, are joined; T-junctions and crossings split walls; dangling walls are ignored) that no existing room covers becomes a room named "Pièce n" with the given use (default office). The room follows the wall axes. Rename or change use afterwards with plan_room.',
      inputSchema: { type: 'object', properties: { floor: { type: 'string' }, use: { type: 'string' }, tolerance_m: { type: 'number' } } },
      async run(a) {
        const W = await h.netWs(), S = await SITE(), { f } = await floorRef(W, a.floor);
        if (a.use && !S.USAGES[a.use]) h.fail(`use: one of ${Object.keys(S.USAGES).join(', ')}`);
        const { addDetectedRooms } = await import('../net/ui/plan-demo.js');
        const made = addDetectedRooms(W.data(), f, a.use || 'office', { tol: a.tolerance_m != null ? num(a.tolerance_m, 0.01, 2, 'tolerance_m') : undefined });
        if (made.length) commit(W);
        return { created: made.map(r => ({ id: r.id, name: r.name, use: r.usage, area_m2: r3(S.roomArea(r)), polygon: r.poly, holes: r.holes })), note: made.length ? undefined : 'no closed space without a room (close the walls, or draw rooms with plan_room)' };
      }
    },
    {
      name: 'plan_wall',
      description: 'Draw walls on a floor as a polyline through points [[x,y],…] (metres); closed:true also joins the last point to the first. material: concrete, brick, block, stone, drywall, plaster, glass, wood, metal, elevator (also used by the Wi-Fi coverage). thickness_m defaults to the material\'s usual thickness. doors: [{ segment: index of the wall in this polyline (0-based), at_m: distance from its start, width_m }]. remove: [wall ids] deletes walls (and their doors).',
      inputSchema: { type: 'object', properties: { floor: { type: 'string' }, points: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, closed: { type: 'boolean' }, material: { type: 'string' }, thickness_m: { type: 'number' }, doors: { type: 'array', items: { type: 'object' } }, remove: { type: 'array', items: { type: 'string' } } } },
      async run(a) {
        const W = await h.netWs(), S = await SITE(), { f } = await floorRef(W, a.floor);
        if (a.remove && a.remove.length) { const rm = new Set(a.remove); f.walls = f.walls.filter(w => !rm.has(w.id)); f.doors = f.doors.filter(d => !rm.has(d.wall)); }
        const out = [];
        if (a.points && a.points.length) {
          const P = a.points.map((p, i) => pt(p, 'points[' + i + ']')); if (a.closed && P.length > 2) P.push(P[0]);
          if (P.length < 2) h.fail('points: at least 2');
          const mat = a.material || 'block'; if (!S.MATERIALS[mat]) h.fail(`material: one of ${Object.keys(S.MATERIALS).join(', ')}`);
          const t = a.thickness_m != null ? num(a.thickness_m, 0.01, 2, 'thickness_m') : S.MATERIALS[mat].t, used = S.siteIds(W.data().site);
          for (let i = 1; i < P.length; i++) if (S.dist(P[i - 1], P[i]) > 0.01) { const w = { id: S.uid('', 'w', used), a: P[i - 1], b: P[i], t, mat }; f.walls.push(w); out.push(w); }
          for (const d of a.doors || []) {
            const w = out[d.segment | 0]; if (!w) h.fail(`doors: no wall segment ${d.segment}`);
            const L = S.dist(w.a, w.b), dw = num(d.width_m ?? 0.9, 0.5, L, 'width_m');
            f.doors.push({ id: S.uid('', 'dr', used), wall: w.id, at: r3(num(d.at_m ?? L / 2, dw / 2, L - dw / 2, 'at_m')), w: dw });
          }
        }
        commit(W);
        return { walls: out.map(w => ({ id: w.id, length_m: r3(S.dist(w.a, w.b)) })), total_walls: f.walls.length, doors: f.doors.length };
      }
    },
    {
      name: 'plan_place',
      description: 'Put a device on a floor plan at (x, y) metres with mounting height h_m (default: outlets 0.3, desk devices 0.75, access points and cameras at the ceiling, others 1.5). device: an existing device name/id, or type to create a new one (outlet, outlet2, ap, ap6, camera, phone, pc, printer, …). Devices in a rack get their position from the rack, not from here. Cables with auto route then get their real length.',
      inputSchema: { type: 'object', properties: { floor: { type: 'string' }, device: { type: 'string' }, type: { type: 'string' }, name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, h_m: { type: 'number' } }, required: ['x', 'y'] },
      async run(a) {
        const W = await h.netWs(), data = W.data(), S = await SITE(), { f } = await floorRef(W, a.floor);
        let d;
        if (a.device) d = h.netDev(W, a.device);
        else {
          const { DEVICES } = await import('../net/devices.js'); if (!a.type || !DEVICES[a.type]) h.fail('give device (existing) or a valid type');
          const { addDevice } = await import('../net/ui/plan-demo.js');
          d = addDevice(data, a.type, { x: Math.round(+a.x * 20), y: Math.round(+a.y * 20) }, null);
          if (a.name) d.name = String(a.name).slice(0, 24);
        }
        const H = a.h_m != null ? num(a.h_m, 0, 30, 'h_m') : /^(ap|camera)/.test(d.type) ? f.ceil : /^outlet/.test(d.type) ? 0.3 : /^(pc|laptop|phone|printer)/.test(d.type) ? 0.75 : 1.5;
        d.loc = { floor: f.id, x: r3(num(a.x, -1e4, 1e4, 'x')), y: r3(num(a.y, -1e4, 1e4, 'y')), h: r3(H) };
        commit(W);
        const r = S.roomAt(f, d.loc.x, d.loc.y);
        return { device: d.name, id: d.id, floor: f.id, x: d.loc.x, y: d.loc.y, h_m: d.loc.h, room: r ? r.name || r.usage : null, warning: r || !f.rooms.length ? undefined : 'outside every room (J1254)' };
      }
    },
    {
      name: 'path_add',
      description: 'Add (or edit with id) a cable pathway on a floor. kind: tray (sheet-metal cable tray), basket (wire mesh tray), conduit, trunking (surface raceway), ceiling (J-hooks above the false ceiling), floor (under a raised floor), riser (vertical, ONE point, links every floor of the building between floor and top_floor), outdoor (duct between buildings: points [start on this floor, end on to_floor], length_m). points in metres. z_m: height above the floor. width_mm/height_mm (trays) or diameter_mm (conduit inner Ø). power:true marks a power-cable route (for EN 50174-2 separation) with circuits (230 V 20 A count); shield: none|open|perforated|solid metallic containment. Pathways that touch or cross (within 0.3 m) join; auto-routed cables follow the shortest way along them. remove:true with id deletes it.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, floor: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' }, points: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, z_m: { type: 'number' }, width_mm: { type: 'number' }, height_mm: { type: 'number' }, diameter_mm: { type: 'number' }, bend_radius_mm: { type: 'number' }, power: { type: 'boolean' }, circuits: { type: 'number' }, shield: { type: 'string' }, top_floor: { type: 'string' }, to_floor: { type: 'string' }, length_m: { type: 'number' }, remove: { type: 'boolean' } } },
      async run(a) {
        const W = await h.netWs(), data = W.data(), R = await ROUTE(); data.paths = data.paths || [];
        let i = a.id ? data.paths.findIndex(p => p.id === a.id || h.norm(p.name) === h.norm(a.id)) : -1;
        if (a.id && i < 0) h.fail(`no pathway "${a.id}"`);
        if (a.remove) { if (i < 0) h.fail('give the pathway id to remove'); const [p] = data.paths.splice(i, 1); commit(W); return { removed: p.id }; }
        const old = i >= 0 ? data.paths[i] : null, kind = a.kind || (old ? old.kind : 'tray');
        if (!R.PATH_KINDS[kind]) h.fail(`kind: one of ${Object.keys(R.PATH_KINDS).join(', ')}`);
        const fl = a.floor != null || !old ? (await floorRef(W, a.floor)).f.id : old.floor;
        const p = { ...(old || {}), floor: fl, kind };
        if (a.points) p.pts = a.points.map((q, k) => pt(q, 'points[' + k + ']'));
        if (!p.pts) h.fail('points: [[x, y], …] in metres');
        if (a.name != null) p.name = a.name; if (a.z_m != null) p.z = a.z_m; if (a.width_mm != null) p.w = a.width_mm; if (a.height_mm != null) p.h = a.height_mm;
        if (a.diameter_mm != null) p.dia = a.diameter_mm; if (a.bend_radius_mm != null) p.rad = a.bend_radius_mm; if (a.power != null) p.power = !!a.power; if (a.circuits != null) p.circuits = a.circuits;
        if (a.shield) p.shield = a.shield; if (a.length_m != null) p.len = a.length_m;
        if (a.top_floor) p.top = (await floorRef(W, a.top_floor)).f.id; if (a.to_floor) p.to = (await floorRef(W, a.to_floor)).f.id;
        if (!old) { const ids = new Set(data.paths.map(x => x.id)); let n = 1; while (ids.has('pa' + n)) n++; p.id = 'pa' + n; }
        if (kind === 'riser' && p.pts.length !== 1) p.pts = p.pts.slice(0, 1);
        if (kind === 'outdoor' && p.pts.length < 2) h.fail('outdoor: points [start on this floor, end on to_floor]');
        const c = R.cleanPaths([p])[0]; if (!c) h.fail('pathway rejected (too few points?)');
        c.id = p.id; if (old) data.paths[i] = c; else data.paths.push(c);
        commit(W);
        const fresh = W.data().paths.find(x => x.id === c.id), cs = R.cablesByPath(W.data()).get(c.id) || [], f = R.fillOf(fresh, cs);
        return { pathway: c.id, kind: c.kind, cables: f.n, fill_pct: Math.round(f.ratio * 100), fill_max_pct: Math.round(f.max * 100), problems: await planIssues(W, new Set([c.id])) };
      }
    },
    {
      name: 'cable_route',
      description: 'Compute and explain the real length of a cable routed along the pathways: vertical drops at both ends, horizontal access to the nearest pathway, shortest way along trays/conduits/J-hooks, risers between floors, outdoor ducts, plus service slack (3 m at the telecom room end, 0.3 m at the outlet, editable design defaults). Give cable (id) or a and b (device names) of an existing cable; create:true with a and b lays a NEW permanent link between free ports (outlet wall side → patch panel back). auto:false switches the cable back to a manually typed length.',
      inputSchema: { type: 'object', properties: { cable: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' }, create: { type: 'boolean' }, auto: { type: 'boolean' }, cat: { type: 'string', enum: ['cat5e', 'cat6', 'cat6a'] } } },
      async run(a) {
        const W = await h.netWs(), data = W.data(), R = await ROUTE();
        let c = a.cable ? data.cables.find(x => x.id === a.cable) : null;
        if (a.cable && !c) h.fail(`no cable "${a.cable}"`);
        if (!c) {
          if (!a.a || !a.b) h.fail('give cable, or a and b');
          const A = h.netDev(W, a.a), B = h.netDev(W, a.b);
          c = data.cables.find(x => (x.a[0] === A.id && x.b[0] === B.id) || (x.a[0] === B.id && x.b[0] === A.id));
          if (!c || a.create) {
            if (!a.create) h.fail(`no cable between ${A.name} and ${B.name}: add create:true to lay a permanent link`);
            const { freePort, addLink } = await import('../net/ui/plan-demo.js'), pa = freePort(data, A), pb = freePort(data, B);
            if (!pa || !pb) h.fail(`no free port on ${!pa ? A.name : B.name}`);
            c = addLink(data, [A.id, pa], [B.id, pb], { route: 'auto', cat: a.cat || 'cat6' });
          }
        }
        if (a.auto === false) c.route = { mode: 'manual' }; else if (a.auto === true || a.create || !c.route) c.route = { mode: 'auto' };
        commit(W);
        const fresh = W.data().cables.find(x => x.id === c.id), r = fresh.route && fresh.route.mode === 'auto' ? R.routeCable(W.data(), fresh, true) : null;
        const names = id => h.netName(W, id);
        if (!r) return { cable: fresh.id, ends: [names(fresh.a[0]), names(fresh.b[0])], length_m: fresh.len, mode: fresh.route ? fresh.route.mode : 'manual', note: fresh.route && fresh.route.mode === 'auto' ? 'an end is not placed on a floor plan (plan_place) nor in a rack: length unchanged' : 'manual length' };
        const k = r.calc, P = W.data().paths || [];
        return {
          cable: fresh.id, ends: [names(fresh.a[0]), names(fresh.b[0])], length_m: fresh.len,
          breakdown: { along_pathways_m: k.path, drops_and_access_m: k.drops, service_slack_m: k.slack },
          pathways: k.paths.map(id => { const p = P.find(x => x.id === id); return p ? `${p.name || p.kind} (${id})` : id; }),
          fallback: k.fallback ? (k.fallback === 'noriser' ? 'no riser joins the two floors: right-angle estimate (J1256)' : 'no continuous pathway: right-angle estimate (J1255)') : null,
          floors: r.legs ? [...new Set(r.legs.map(l => l.floor))] : [],
          permanent_link_limit_m: 90
        };
      }
    }
  ];
}
