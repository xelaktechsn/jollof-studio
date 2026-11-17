// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//! Export du programme Ladder de l'automate au format PLCopen XML (TC6, version 2.01), que lisent CODESYS et les
//! logiciels bâtis dessus, OpenPLC Editor, Beremiz, et d'autres : l'élève conçoit et simule ici, puis charge le même
//! programme dans un vrai automate.
//!
//! Le programme devient un POU « program » en langage LD : chaque réseau est un graphe de la barre de gauche à la
//! barre de droite ; une dérivation (OU) est une divergence (plusieurs éléments branchés sur la même sortie) suivie
//! d'une convergence (un élément branché sur plusieurs sorties). Les temporisations et les compteurs sont des blocs
//! fonctionnels standard (TON, TOF, TP, CTU, CTD), leur durée et leur présélection des constantes. Une comparaison
//! (« C1 >= 3 ») est calculée juste avant son réseau dans une variable _CMPn (bloc GE, LT…), lue ensuite par un contact.
//! Les variables sont déclarées avec leur adresse IEC : %I0.0 → %IX0.0, %Q0.0 → %QX0.0, %M10 → %MX1.2. Le bit
//! système INIT (vrai au premier cycle) devient une variable initialisée à TRUE, remise à FALSE au dernier réseau.
//! Un nom qui n'est pas un identifiant IEC (1Y1, un mot réservé) est renommé, et la note le dit.

use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Bornes (les mêmes que l'éditeur, src/plc/ladder.js) : un programme reçu ne fait pas travailler sans fin.
const MAX_RUNGS: usize = 200;
const MAX_ITEMS: usize = 600;
const MAX_DEPTH: usize = 6;
const MAX_VARS: usize = 2000;

#[derive(Deserialize)]
pub struct Program {
    #[serde(default)]
    name: String,
    #[serde(default)]
    cycle: f64,
    #[serde(default)]
    rungs: Vec<Rung>,
}
#[derive(Deserialize)]
struct Rung {
    #[serde(default)]
    comment: String,
    #[serde(default)]
    items: Vec<Item>,
}
#[derive(Deserialize)]
struct Item {
    t: String,
    #[serde(default)]
    v: String,
    #[serde(default)]
    a: String,
    #[serde(default)]
    op: String,
    #[serde(default)]
    b: f64,
    #[serde(default)]
    pt: f64,
    #[serde(default)]
    pv: f64,
    #[serde(default)]
    r: String,
    #[serde(default)]
    branches: Vec<Vec<Item>>,
}
/// Variable de la table de l'automate : nom, nature (in, out, mem, timer, counter, step, sys), adresse affichée.
#[derive(Deserialize)]
pub struct Var {
    name: String,
    cls: String,
    #[serde(default)]
    addr: String,
}

#[derive(Serialize, Debug)]
pub struct Export {
    xml: String,
    notes: Vec<String>,
}

/// Commande : le programme et sa table des variables → texte XML et remarques.
#[tauri::command]
pub fn plc_export_xml(
    app: tauri::AppHandle,
    program: Program,
    vars: Vec<Var>,
) -> Result<Export, String> {
    export(
        &program,
        &vars,
        &app.package_info().version.to_string(),
        &now_iso(),
    )
}

/* ---------- Noms et adresses ---------- */

const RESERVED: &[&str] = &[
    "ABS",
    "ACTION",
    "AND",
    "ARRAY",
    "AT",
    "BOOL",
    "BY",
    "BYTE",
    "CASE",
    "CONFIGURATION",
    "CONSTANT",
    "CTD",
    "CTU",
    "CTUD",
    "DATE",
    "DINT",
    "DO",
    "DT",
    "DWORD",
    "ELSE",
    "ELSIF",
    "EN",
    "END_CASE",
    "END_FOR",
    "END_IF",
    "END_VAR",
    "END_WHILE",
    "ENO",
    "EQ",
    "EXIT",
    "FALSE",
    "FOR",
    "FUNCTION",
    "GE",
    "GT",
    "IF",
    "INT",
    "LE",
    "LINT",
    "LREAL",
    "LT",
    "MOD",
    "MOVE",
    "NE",
    "NOT",
    "OF",
    "OR",
    "PROGRAM",
    "REAL",
    "REPEAT",
    "RESOURCE",
    "RETURN",
    "R_TRIG",
    "F_TRIG",
    "SINT",
    "STEP",
    "STRING",
    "TASK",
    "THEN",
    "TIME",
    "TO",
    "TOD",
    "TOF",
    "TON",
    "TP",
    "TRANSITION",
    "TRUE",
    "TYPE",
    "UDINT",
    "UINT",
    "ULINT",
    "UNTIL",
    "USINT",
    "VAR",
    "WHILE",
    "WORD",
    "XOR",
    "SFC",
    "RS",
    "SR",
];

/// Identifiant IEC 61131-3 : commence par une lettre ou « _ », pas deux « _ » de suite, pas un mot réservé.
fn iec_ident(name: &str) -> String {
    let mut s: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    while s.contains("__") {
        s = s.replace("__", "_");
    }
    if s.is_empty() {
        s = "V".into();
    }
    if s.starts_with(|c: char| c.is_ascii_digit()) {
        s.insert(0, '_');
    }
    if RESERVED.contains(&s.to_ascii_uppercase().as_str()) {
        s.push_str("_V");
    }
    s
}

/// Adresse affichée par l'éditeur → adresse IEC d'un bit : %I0.3 → %IX0.3, %Q1.0 → %QX1.0, %M10 → %MX1.2.
fn iec_addr(addr: &str) -> Option<String> {
    let num = |s: &str| s.parse::<u32>().ok();
    if let Some(rest) = addr.strip_prefix("%I").or_else(|| addr.strip_prefix("%Q")) {
        let (w, b) = rest.split_once('.')?;
        let (w, b) = (num(w)?, num(b)?);
        return Some(format!("%{}X{w}.{b}", &addr[1..2]));
    }
    let m = num(addr.strip_prefix("%M")?)?;
    Some(format!("%MX{}.{}", m / 8, m % 8))
}

/// Nom de chaque variable du programme (clé : nom en minuscules) → identifiant IEC unique.
struct Names {
    map: HashMap<String, String>,
    taken: HashMap<String, String>,
    notes: Vec<String>,
}
impl Names {
    fn new() -> Self {
        Names {
            map: HashMap::new(),
            taken: HashMap::new(),
            notes: Vec::new(),
        }
    }
    fn get(&mut self, name: &str) -> String {
        let key = name.to_ascii_lowercase();
        if let Some(n) = self.map.get(&key) {
            return n.clone();
        }
        let base = iec_ident(name);
        let mut id = base.clone();
        let mut k = 2;
        while self.taken.contains_key(&id.to_ascii_uppercase()) {
            id = format!("{base}_{k}");
            k += 1;
        }
        if id != name {
            self.notes.push(format!(
                "{name} est renommé {id} (identifiant IEC 61131-3)."
            ));
        }
        self.taken.insert(id.to_ascii_uppercase(), key.clone());
        self.map.insert(key, id.clone());
        id
    }
}

/* ---------- Écriture XML ---------- */

struct X {
    w: Writer<Vec<u8>>,
}
type R = Result<(), String>;
fn xe(e: std::io::Error) -> String {
    e.to_string()
}
impl X {
    fn start(&mut self, name: &str, attrs: &[(&str, &str)]) -> R {
        let mut e = BytesStart::new(name);
        for (k, v) in attrs {
            e.push_attribute((*k, *v));
        }
        self.w.write_event(Event::Start(e)).map_err(xe)
    }
    fn end(&mut self, name: &str) -> R {
        self.w
            .write_event(Event::End(BytesEnd::new(name)))
            .map_err(xe)
    }
    fn empty(&mut self, name: &str, attrs: &[(&str, &str)]) -> R {
        let mut e = BytesStart::new(name);
        for (k, v) in attrs {
            e.push_attribute((*k, *v));
        }
        self.w.write_event(Event::Empty(e)).map_err(xe)
    }
    fn text(&mut self, name: &str, text: &str) -> R {
        self.start(name, &[])?;
        self.w
            .write_event(Event::Text(BytesText::new(text)))
            .map_err(xe)?;
        self.end(name)
    }
    fn pos(&mut self, tag: &str, x: i64, y: i64) -> R {
        self.empty(tag, &[("x", &x.to_string()), ("y", &y.to_string())])
    }
    fn doc(&mut self, text: &str) -> R {
        self.start("documentation", &[])?;
        self.text("xhtml:p", text)?;
        self.end("documentation")
    }
}

/// Sortie d'un élément : son identifiant et, pour un bloc, le paramètre (Q, OUT).
#[derive(Clone)]
struct Ref {
    id: u32,
    param: Option<&'static str>,
}

/* ---------- Corps LD ---------- */

const COL: i64 = 100;
const ROW: i64 = 80;
const X0: i64 = 40;

struct Ld {
    x: X,
    next: u32,
    names: Names,
    /// Nature des blocs par nom de variable (TON, CTU…), pour les déclarations.
    blocks: HashMap<String, &'static str>,
    cmp_vars: Vec<String>,
}
impl Ld {
    fn id(&mut self) -> u32 {
        self.next += 1;
        self.next
    }
    fn conn_in(&mut self, refs: &[Ref], rel_x: i64, rel_y: i64) -> R {
        self.x.start("connectionPointIn", &[])?;
        self.x.pos("relPosition", rel_x, rel_y)?;
        for r in refs {
            let id = r.id.to_string();
            match r.param {
                Some(p) => self
                    .x
                    .empty("connection", &[("refLocalId", &id), ("formalParameter", p)])?,
                None => self.x.empty("connection", &[("refLocalId", &id)])?,
            }
        }
        self.x.end("connectionPointIn")
    }
    fn conn_out(&mut self, rel_x: i64, rel_y: i64) -> R {
        self.x.start("connectionPointOut", &[])?;
        self.x.pos("relPosition", rel_x, rel_y)?;
        self.x.end("connectionPointOut")
    }
    fn left_rail(&mut self, y: i64) -> Result<Ref, String> {
        let id = self.id();
        self.x.start(
            "leftPowerRail",
            &[
                ("localId", &id.to_string()),
                ("height", "40"),
                ("width", "10"),
            ],
        )?;
        self.x.pos("position", 10, y)?;
        self.x
            .start("connectionPointOut", &[("formalParameter", "")])?;
        self.x.pos("relPosition", 10, 20)?;
        self.x.end("connectionPointOut")?;
        self.x.end("leftPowerRail")?;
        Ok(Ref { id, param: None })
    }
    fn right_rail(&mut self, refs: &[Ref], x: i64, y: i64) -> R {
        let id = self.id();
        self.x.start(
            "rightPowerRail",
            &[
                ("localId", &id.to_string()),
                ("height", "40"),
                ("width", "10"),
            ],
        )?;
        self.x.pos("position", x, y)?;
        for r in refs {
            self.conn_in(std::slice::from_ref(r), 0, 20)?;
        }
        self.x.end("rightPowerRail")
    }
    fn in_variable(&mut self, expr: &str, x: i64, y: i64) -> Result<Ref, String> {
        let id = self.id();
        self.x.start(
            "inVariable",
            &[
                ("localId", &id.to_string()),
                ("height", "20"),
                ("width", "70"),
                ("negated", "false"),
            ],
        )?;
        self.x.pos("position", x, y)?;
        self.conn_out(70, 10)?;
        self.x.text("expression", expr)?;
        self.x.end("inVariable")?;
        Ok(Ref { id, param: None })
    }
    /// Contact ou bobine : tag contact | coil, négation, front (contact) ou mémoire set/reset (bobine).
    #[allow(clippy::too_many_arguments)]
    fn simple(
        &mut self,
        tag: &str,
        var: &str,
        negated: bool,
        mode: (&str, &str),
        ins: &[Ref],
        x: i64,
        y: i64,
    ) -> Result<Ref, String> {
        let id = self.id();
        let ids = id.to_string();
        self.x.start(
            tag,
            &[
                ("localId", ids.as_str()),
                ("height", "20"),
                ("width", "21"),
                ("negated", if negated { "true" } else { "false" }),
                mode,
            ],
        )?;
        self.x.pos("position", x, y)?;
        self.conn_in(ins, 0, 10)?;
        self.conn_out(21, 10)?;
        self.x.text("variable", var)?;
        self.x.end(tag)?;
        Ok(Ref { id, param: None })
    }
    /// Bloc (fonction ou bloc fonctionnel) : entrées (paramètre, liaisons), sorties ; rend la sortie `out`.
    #[allow(clippy::too_many_arguments)]
    fn block(
        &mut self,
        type_name: &str,
        instance: Option<&str>,
        inputs: &[(&'static str, Vec<Ref>)],
        outputs: &[&'static str],
        out: &'static str,
        x: i64,
        y: i64,
    ) -> Result<Ref, String> {
        let id = self.id();
        let ids = id.to_string();
        let h = (20 * (inputs.len().max(outputs.len()) as i64 + 1)).to_string();
        let mut attrs = vec![
            ("localId", ids.as_str()),
            ("typeName", type_name),
            ("height", h.as_str()),
            ("width", "60"),
        ];
        if let Some(i) = instance {
            attrs.push(("instanceName", i));
        }
        self.x.start("block", &attrs)?;
        self.x.pos("position", x, y)?;
        self.x.start("inputVariables", &[])?;
        for (k, (p, refs)) in inputs.iter().enumerate() {
            self.x.start("variable", &[("formalParameter", p)])?;
            self.conn_in(refs, 0, 20 * (k as i64 + 1))?;
            self.x.end("variable")?;
        }
        self.x.end("inputVariables")?;
        self.x.empty("inOutVariables", &[])?;
        self.x.start("outputVariables", &[])?;
        for (k, p) in outputs.iter().enumerate() {
            self.x.start("variable", &[("formalParameter", p)])?;
            self.conn_out(60, 20 * (k as i64 + 1))?;
            self.x.end("variable")?;
        }
        self.x.end("outputVariables")?;
        self.x.end("block")?;
        Ok(Ref {
            id,
            param: Some(out),
        })
    }

    #[allow(clippy::too_many_arguments)]
    /// Éléments en série depuis `ins` ; col, row : case de départ. Rend (sorties, colonne suivante, dernière rangée).
    fn series(
        &mut self,
        items: &[Item],
        ins: Vec<Ref>,
        col: i64,
        row: i64,
        y0: i64,
        cmps: &mut std::collections::VecDeque<String>,
        depth: usize,
    ) -> Result<(Vec<Ref>, i64, i64), String> {
        if depth > MAX_DEPTH {
            return Err("Dérivations trop imbriquées".into());
        }
        let (mut cur, mut c, mut last_row) = (ins, col, row);
        for it in items {
            let (x, y) = (X0 + c * COL, y0 + row * ROW);
            let name = |v: &str, ld: &mut Self| -> Result<String, String> {
                if v.is_empty() {
                    Err("Élément sans nom : corrigez le programme avant d'exporter".into())
                } else {
                    Ok(ld.names.get(v))
                }
            };
            match it.t.as_str() {
                "par" => {
                    let mut outs = Vec::new();
                    let (mut end, mut r) = (c, row);
                    for b in &it.branches {
                        if b.is_empty() {
                            outs.extend(cur.iter().cloned());
                            continue;
                        }
                        let (o, e, lr) = self.series(b, cur.clone(), c, r, y0, cmps, depth + 1)?;
                        outs.extend(o);
                        end = end.max(e);
                        r = lr + 1;
                    }
                    last_row = last_row.max(r - 1);
                    cur = outs;
                    c = end;
                    continue;
                }
                "no" | "nc" | "p" | "n" => {
                    let v = name(&it.v, self)?;
                    let edge = match it.t.as_str() {
                        "p" => "rising",
                        "n" => "falling",
                        _ => "none",
                    };
                    cur = vec![self.simple(
                        "contact",
                        &v,
                        it.t == "nc",
                        ("edge", edge),
                        &cur,
                        x,
                        y,
                    )?];
                }
                "cmp" => {
                    let v = cmps.pop_front().ok_or("comparaison sans variable")?;
                    cur = vec![self.simple("contact", &v, false, ("edge", "none"), &cur, x, y)?];
                }
                "coil" | "ncoil" | "set" | "reset" => {
                    let v = name(&it.v, self)?;
                    let storage = match it.t.as_str() {
                        "set" => "set",
                        "reset" => "reset",
                        _ => "none",
                    };
                    cur = vec![self.simple(
                        "coil",
                        &v,
                        it.t == "ncoil",
                        ("storage", storage),
                        &cur,
                        x,
                        y,
                    )?];
                }
                "ton" | "tof" | "tp" => {
                    let v = name(&it.v, self)?;
                    let kind: &'static str = match it.t.as_str() {
                        "ton" => "TON",
                        "tof" => "TOF",
                        _ => "TP",
                    };
                    self.blocks.insert(v.clone(), kind);
                    let pt = self.in_variable(&time_lit(it.pt), x - 85, y + 40)?;
                    cur = vec![self.block(
                        kind,
                        Some(&v),
                        &[("IN", cur.clone()), ("PT", vec![pt])],
                        &["Q", "ET"],
                        "Q",
                        x,
                        y,
                    )?];
                }
                "ctu" | "ctd" => {
                    let v = name(&it.v, self)?;
                    let up = it.t == "ctu";
                    let kind: &'static str = if up { "CTU" } else { "CTD" };
                    self.blocks.insert(v.clone(), kind);
                    let aux = if it.r.is_empty() {
                        "FALSE".to_string()
                    } else {
                        self.names.get(&it.r)
                    };
                    let a = self.in_variable(&aux, x - 85, y + 40)?;
                    let pv =
                        self.in_variable(&format!("{}", it.pv.round() as i64), x - 85, y + 60)?;
                    cur = vec![self.block(
                        kind,
                        Some(&v),
                        &[
                            (if up { "CU" } else { "CD" }, cur.clone()),
                            (if up { "R" } else { "LD" }, vec![a]),
                            ("PV", vec![pv]),
                        ],
                        &["Q", "CV"],
                        "Q",
                        x,
                        y,
                    )?];
                }
                other => return Err(format!("Élément inconnu : {other}")),
            }
            c += 1;
        }
        Ok((cur, c, last_row))
    }
}

/// Durée en secondes → littéral IEC (T#2500ms).
fn time_lit(s: f64) -> String {
    format!("T#{}ms", (s.max(0.0) * 1000.0).round() as i64)
}

fn count(items: &[Item], depth: usize, n: &mut usize) -> R {
    if depth > MAX_DEPTH {
        return Err("Dérivations trop imbriquées".into());
    }
    for it in items {
        *n += 1;
        if *n > MAX_ITEMS {
            return Err("Programme trop long".into());
        }
        for b in &it.branches {
            count(b, depth + 1, n)?;
        }
    }
    Ok(())
}
fn walk<'a>(items: &'a [Item], f: &mut impl FnMut(&'a Item)) {
    for it in items {
        f(it);
        for b in &it.branches {
            walk(b, f);
        }
    }
}

/// Heure UTC au format xs:dateTime (sans dépendance de date).
fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    iso_of(secs)
}
fn iso_of(secs: i64) -> String {
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // Jours depuis 1970 → date civile (algorithme de H. Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Déclaration : nom, type, adresse, valeur initiale, note.
type Decl = (
    String,
    String,
    Option<String>,
    Option<&'static str>,
    Option<String>,
);

pub fn export(p: &Program, vars: &[Var], version: &str, when: &str) -> Result<Export, String> {
    if p.rungs.is_empty() {
        return Err("Programme vide : rien à exporter".into());
    }
    if p.rungs.len() > MAX_RUNGS || vars.len() > MAX_VARS {
        return Err("Programme trop long".into());
    }
    let mut n = 0;
    for r in &p.rungs {
        count(&r.items, 0, &mut n)?;
    }
    let pou = iec_ident(if p.name.is_empty() { "API1" } else { &p.name });
    let cycle = if p.cycle >= 1.0 {
        p.cycle.round() as i64
    } else {
        10
    };
    let mut ld = Ld {
        x: X {
            w: Writer::new_with_indent(Vec::new(), b' ', 2),
        },
        next: 0,
        names: Names::new(),
        blocks: HashMap::new(),
        cmp_vars: Vec::new(),
    };
    // Les variables de la table d'abord : leurs noms gardent la priorité sur ceux des comparaisons.
    for v in vars {
        ld.names.get(&v.name);
    }
    // Nature des temporisations et compteurs (pour lire T1.ET ou C1.CV dans une comparaison).
    let mut kinds: HashMap<String, &str> = HashMap::new();
    for r in &p.rungs {
        walk(&r.items, &mut |it| {
            if matches!(it.t.as_str(), "ton" | "tof" | "tp" | "ctu" | "ctd") && !it.v.is_empty() {
                kinds.insert(
                    it.v.to_ascii_lowercase(),
                    if it.t.starts_with('c') { "CV" } else { "ET" },
                );
            }
        });
    }

    // Corps LD : écrit à part, puis placé après l'interface (qui dépend des noms découverts en chemin).
    let mut body = X {
        w: Writer::new_with_indent(Vec::new(), b' ', 2),
    };
    std::mem::swap(&mut ld.x, &mut body);
    let mut y = 20i64;
    let uses_init = vars
        .iter()
        .any(|v| v.cls == "sys" && v.name.eq_ignore_ascii_case("init"));
    for r in &p.rungs {
        if !r.comment.trim().is_empty() {
            let id = ld.id();
            ld.x.start(
                "comment",
                &[
                    ("localId", &id.to_string()),
                    ("height", "30"),
                    ("width", "600"),
                ],
            )?;
            ld.x.pos("position", 10, y)?;
            ld.x.start("content", &[])?;
            ld.x.text("xhtml:p", r.comment.trim())?;
            ld.x.end("content")?;
            ld.x.end("comment")?;
            y += 40;
        }
        // Comparaisons du réseau : chacune calculée dans _CMPn, juste avant.
        let mut cmps = std::collections::VecDeque::new();
        let mut list = Vec::new();
        walk(&r.items, &mut |it| {
            if it.t == "cmp" {
                list.push(it);
            }
        });
        for it in list {
            if it.a.is_empty() {
                return Err(
                    "Comparaison sans variable : corrigez le programme avant d'exporter".into(),
                );
            }
            let var = format!("_CMP{}", ld.cmp_vars.len() + 1);
            ld.cmp_vars.push(var.clone());
            let field = kinds
                .get(&it.a.to_ascii_lowercase())
                .copied()
                .unwrap_or("CV");
            let a = format!("{}.{field}", ld.names.get(&it.a));
            let b = if field == "ET" {
                time_lit(it.b)
            } else {
                format!("{}", it.b.round() as i64)
            };
            let f = match it.op.as_str() {
                "=" => "EQ",
                "<>" => "NE",
                "<" => "LT",
                "<=" => "LE",
                ">" => "GT",
                _ => "GE",
            };
            let rail = ld.left_rail(y)?;
            let i1 = ld.in_variable(&a, X0 + 15, y + 30)?;
            let i2 = ld.in_variable(&b, X0 + 15, y + 50)?;
            let blk = ld.block(
                f,
                None,
                &[("EN", vec![rail]), ("IN1", vec![i1]), ("IN2", vec![i2])],
                &["ENO", "OUT"],
                "OUT",
                X0 + COL,
                y,
            )?;
            let coil = ld.simple(
                "coil",
                &var,
                false,
                ("storage", "none"),
                &[blk],
                X0 + 2 * COL,
                y,
            )?;
            ld.right_rail(&[coil], X0 + 3 * COL, y)?;
            cmps.push_back(var);
            y += ROW + 20;
        }
        let rail = ld.left_rail(y)?;
        let (outs, end, last_row) = ld.series(&r.items, vec![rail], 0, 0, y, &mut cmps, 0)?;
        ld.right_rail(&outs, X0 + end.max(1) * COL + 20, y)?;
        y += (last_row + 1) * ROW + 40;
    }
    if uses_init {
        let rail = ld.left_rail(y)?;
        let init = ld.names.get("INIT");
        let coil = ld.simple("coil", &init, false, ("storage", "reset"), &[rail], X0, y)?;
        ld.right_rail(&[coil], X0 + COL, y)?;
    }
    std::mem::swap(&mut ld.x, &mut body);
    let body = String::from_utf8(body.w.into_inner()).map_err(|e| e.to_string())?;

    // Déclarations : la table de l'automate, puis tout nom lu ou écrit qui n'y est pas (BOOL), puis les _CMPn.
    let mut decl: Vec<Decl> = Vec::new();
    let mut done = std::collections::HashSet::new();
    let mut notes = Vec::new();
    for v in vars {
        let id = ld.names.get(&v.name);
        if !done.insert(id.to_ascii_uppercase()) {
            continue;
        }
        let (ty, addr, init, note) = match v.cls.as_str() {
            "in" => (
                "BOOL".to_string(),
                iec_addr(&v.addr),
                None,
                Some("entrée".to_string()),
            ),
            "out" => (
                "BOOL".into(),
                iec_addr(&v.addr),
                None,
                Some("sortie".into()),
            ),
            "mem" => (
                "BOOL".into(),
                iec_addr(&v.addr),
                None,
                Some("mémoire".into()),
            ),
            "timer" | "counter" => (
                ld.blocks
                    .get(&id)
                    .copied()
                    .unwrap_or(if v.cls == "timer" { "TON" } else { "CTU" })
                    .to_string(),
                None,
                None,
                None,
            ),
            "step" => {
                notes.push(format!(
                    "{id} est une étape du GRAFCET : reliez-la à votre programme SFC (ou à une mémoire) dans le logiciel de l'automate."
                ));
                (
                    "BOOL".into(),
                    None,
                    None,
                    Some("étape du GRAFCET, à relier".into()),
                )
            }
            "sys" => (
                "BOOL".into(),
                None,
                Some("TRUE"),
                Some("vrai au premier cycle seulement".into()),
            ),
            _ => ("BOOL".into(), None, None, None),
        };
        decl.push((id, ty, addr, init, note));
    }
    let mut extra: Vec<(String, &'static str)> =
        ld.blocks.iter().map(|(k, v)| (k.clone(), *v)).collect();
    extra.sort();
    for (id, kind) in extra {
        if done.insert(id.to_ascii_uppercase()) {
            decl.push((id, kind.to_string(), None, None, None));
        }
    }
    let mut others: Vec<String> = ld.names.map.values().cloned().collect();
    others.sort();
    for id in others {
        if done.insert(id.to_ascii_uppercase()) {
            decl.push((id, "BOOL".into(), None, None, None));
        }
    }
    for c in &ld.cmp_vars {
        if done.insert(c.to_ascii_uppercase()) {
            decl.push((
                c.clone(),
                "BOOL".into(),
                None,
                None,
                Some("comparaison".into()),
            ));
        }
    }

    let mut x = X {
        w: Writer::new_with_indent(Vec::new(), b' ', 2),
    };
    x.w.write_event(Event::Decl(BytesDecl::new("1.0", Some("utf-8"), None)))
        .map_err(xe)?;
    x.start(
        "project",
        &[
            ("xmlns", "http://www.plcopen.org/xml/tc6_0201"),
            ("xmlns:xhtml", "http://www.w3.org/1999/xhtml"),
            ("xmlns:xsd", "http://www.w3.org/2001/XMLSchema"),
        ],
    )?;
    x.empty(
        "fileHeader",
        &[
            ("companyName", "Jollof Studio"),
            ("productName", "Jollof Studio"),
            ("productVersion", version),
            ("creationDateTime", when),
        ],
    )?;
    x.start(
        "contentHeader",
        &[("name", &pou), ("modificationDateTime", when)],
    )?;
    x.start("coordinateInfo", &[])?;
    for k in ["fbd", "ld", "sfc"] {
        x.start(k, &[])?;
        x.empty("scaling", &[("x", "1"), ("y", "1")])?;
        x.end(k)?;
    }
    x.end("coordinateInfo")?;
    x.end("contentHeader")?;
    x.start("types", &[])?;
    x.empty("dataTypes", &[])?;
    x.start("pous", &[])?;
    x.start("pou", &[("name", &pou), ("pouType", "program")])?;
    x.start("interface", &[])?;
    x.start("localVars", &[])?;
    for (id, ty, addr, init, note) in &decl {
        let mut attrs = vec![("name", id.as_str())];
        if let Some(a) = addr {
            attrs.push(("address", a.as_str()));
        }
        x.start("variable", &attrs)?;
        x.start("type", &[])?;
        if ty == "BOOL" {
            x.empty("BOOL", &[])?;
        } else {
            x.empty("derived", &[("name", ty)])?;
        }
        x.end("type")?;
        if let Some(v) = init {
            x.start("initialValue", &[])?;
            x.empty("simpleValue", &[("value", v)])?;
            x.end("initialValue")?;
        }
        if let Some(n) = note {
            x.doc(n)?;
        }
        x.end("variable")?;
    }
    x.end("localVars")?;
    x.end("interface")?;
    x.start("body", &[])?;
    x.start("LD", &[])?;
    // Corps écrit plus haut, inséré tel quel (déjà échappé).
    x.w.get_mut().extend_from_slice(b"\n");
    x.w.get_mut().extend_from_slice(body.as_bytes());
    x.end("LD")?;
    x.end("body")?;
    x.doc("Exporté de Jollof Studio (langage à contacts).")?;
    x.end("pou")?;
    x.end("pous")?;
    x.end("types")?;
    x.start("instances", &[])?;
    x.start("configurations", &[])?;
    x.start("configuration", &[("name", "Config0")])?;
    x.start("resource", &[("name", "Res0")])?;
    let interval = format!("T#{cycle}ms");
    x.start(
        "task",
        &[
            ("name", "MainTask"),
            ("interval", &interval),
            ("priority", "1"),
        ],
    )?;
    x.empty(
        "pouInstance",
        &[("name", &format!("{pou}_inst")), ("typeName", &pou)],
    )?;
    x.end("task")?;
    x.end("resource")?;
    x.end("configuration")?;
    x.end("configurations")?;
    x.end("instances")?;
    x.end("project")?;
    let xml = String::from_utf8(x.w.into_inner()).map_err(|e| e.to_string())?;
    let mut all = ld.names.notes;
    if !ld.cmp_vars.is_empty() {
        all.push(format!(
            "{} comparaison(s) calculée(s) avant leur réseau, dans les variables _CMPn.",
            ld.cmp_vars.len()
        ));
    }
    all.extend(notes);
    Ok(Export { xml, notes: all })
}

#[cfg(test)]
mod tests {
    use super::*;
    use quick_xml::events::Event;
    use quick_xml::Reader;

    fn prog(json: &str) -> Program {
        serde_json::from_str(json).unwrap()
    }
    fn vars(json: &str) -> Vec<Var> {
        serde_json::from_str(json).unwrap()
    }
    /// Le texte est un XML bien formé ; rend les éléments rencontrés (nom, attributs) pour les vérifications.
    fn parse(xml: &str) -> Vec<(String, HashMap<String, String>)> {
        let mut r = Reader::from_str(xml);
        let mut out = Vec::new();
        loop {
            match r.read_event().expect("XML bien formé") {
                Event::Start(e) | Event::Empty(e) => {
                    let name = e.name().as_ref().to_string();
                    let attrs = e
                        .attributes()
                        .map(|a| {
                            let a = a.unwrap();
                            (
                                a.key.as_ref().to_string(),
                                a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                                    .unwrap()
                                    .into_owned(),
                            )
                        })
                        .collect();
                    out.push((name, attrs));
                }
                Event::Eof => break,
                _ => {}
            }
        }
        out
    }

    #[test]
    fn identifiers_and_addresses_follow_iec_61131() {
        assert_eq!(iec_ident("1Y1"), "_1Y1");
        assert_eq!(iec_ident("dcy"), "dcy");
        assert_eq!(iec_ident("TON"), "TON_V");
        assert_eq!(iec_ident("a__b"), "a_b");
        assert_eq!(iec_addr("%I0.3").as_deref(), Some("%IX0.3"));
        assert_eq!(iec_addr("%Q1.0").as_deref(), Some("%QX1.0"));
        assert_eq!(iec_addr("%M10").as_deref(), Some("%MX1.2"));
        assert_eq!(iec_addr("%TM0"), None);
        assert_eq!(iso_of(0), "1970-01-01T00:00:00");
        assert_eq!(iso_of(1_763_200_000), "2025-11-15T09:46:40");
    }

    #[test]
    fn a_self_holding_rung_with_a_timer_and_a_counter_exports_to_ld() {
        let p = prog(
            r#"{"name":"API1","cycle":10,"rungs":[
              {"comment":"Marche / arrêt","items":[
                {"t":"par","branches":[[{"t":"p","v":"dcy"}],[{"t":"no","v":"KM"}]]},
                {"t":"nc","v":"arret"},{"t":"coil","v":"KM"}]},
              {"items":[{"t":"no","v":"KM"},{"t":"ton","v":"T1","pt":2.5},{"t":"set","v":"1Y1"}]},
              {"items":[{"t":"no","v":"a1"},{"t":"ctu","v":"C1","pv":3,"r":"raz"}]},
              {"items":[{"t":"cmp","a":"C1","op":">=","b":3},{"t":"reset","v":"1Y1"}]},
              {"items":[{"t":"no","v":"INIT"},{"t":"coil","v":"M1"}]}]}"#,
        );
        let v = vars(
            r#"[{"name":"dcy","cls":"in","addr":"%I0.0"},{"name":"arret","cls":"in","addr":"%I0.1"},
                {"name":"a1","cls":"in","addr":"%I0.2"},{"name":"raz","cls":"in","addr":"%I0.3"},
                {"name":"1Y1","cls":"out","addr":"%Q0.0"},{"name":"KM","cls":"mem","addr":"%M0"},
                {"name":"M1","cls":"mem","addr":"%M1"},{"name":"T1","cls":"timer","addr":"%TM0"},
                {"name":"C1","cls":"counter","addr":"%C0"},{"name":"INIT","cls":"sys","addr":"%S0"}]"#,
        );
        let e = export(&p, &v, "0.2.1", "2026-11-15T10:00:00").unwrap();
        if let Ok(d) = std::env::var("PLCOPEN_DUMP") {
            std::fs::write(d, &e.xml).unwrap();
        }
        let els = parse(&e.xml);
        let find = |n: &'static str| els.iter().filter(move |(k, _)| k == n);
        // Variables : adresses IEC, blocs typés, INIT initialisé, 1Y1 renommé.
        let var = |n: &str| {
            find("variable")
                .find(|(_, a)| a.get("name").map(String::as_str) == Some(n))
                .cloned()
        };
        assert_eq!(var("dcy").unwrap().1["address"], "%IX0.0");
        assert_eq!(var("_1Y1").unwrap().1["address"], "%QX0.0");
        assert_eq!(var("M1").unwrap().1["address"], "%MX0.1");
        assert!(find("derived").any(|(_, a)| a["name"] == "TON"));
        assert!(find("derived").any(|(_, a)| a["name"] == "CTU"));
        assert!(find("simpleValue").any(|(_, a)| a["value"] == "TRUE"));
        assert!(e.notes.iter().any(|n| n.contains("_1Y1")));
        // Corps : front montant, contact inversé, bobines S/R, blocs, comparaison GE, remise à zéro d'INIT.
        assert!(find("contact").any(|(_, a)| a["edge"] == "rising"));
        assert!(find("contact").any(|(_, a)| a["negated"] == "true"));
        assert!(find("coil").any(|(_, a)| a["storage"] == "set"));
        assert_eq!(
            find("coil")
                .filter(|(_, a)| a["storage"] == "reset")
                .count(),
            2
        );
        assert!(find("block").any(|(_, a)| a["typeName"] == "TON" && a["instanceName"] == "T1"));
        assert!(find("block").any(|(_, a)| a["typeName"] == "CTU" && a["instanceName"] == "C1"));
        assert!(find("block").any(|(_, a)| a["typeName"] == "GE"));
        assert!(e.xml.contains("<expression>T#2500ms</expression>"));
        assert!(e.xml.contains("<expression>C1.CV</expression>"));
        assert!(e.xml.contains(r#"interval="T#10ms""#));
        // Toute liaison vise un élément qui existe ; chaque identifiant est unique.
        let ids: Vec<&String> = els.iter().filter_map(|(_, a)| a.get("localId")).collect();
        let set: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(ids.len(), set.len());
        for (_, a) in find("connection") {
            assert!(
                set.contains(&&a["refLocalId"]),
                "liaison vers {}",
                a["refLocalId"]
            );
        }
        // La dérivation : le contact « arret » reçoit les deux branches (OU).
        let pos = e.xml.find("<variable>arret</variable>").unwrap();
        let head = &e.xml[..pos];
        let start = head.rfind("<contact").unwrap();
        assert_eq!(head[start..].matches("<connection ").count(), 2);
    }

    #[test]
    fn empty_or_broken_programs_are_refused() {
        assert!(export(&prog(r#"{"rungs":[]}"#), &[], "0", "x").is_err());
        assert!(export(
            &prog(r#"{"rungs":[{"items":[{"t":"coil","v":""}]}]}"#),
            &[],
            "0",
            "x"
        )
        .is_err());
        assert!(export(
            &prog(r#"{"rungs":[{"items":[{"t":"what","v":"a"}]}]}"#),
            &[],
            "0",
            "x"
        )
        .is_err());
        let mut deep = r#"{"t":"no","v":"a"}"#.to_string();
        for _ in 0..8 {
            deep = format!(r#"{{"t":"par","branches":[[{deep}]]}}"#);
        }
        let p = prog(&format!(r#"{{"rungs":[{{"items":[{deep}]}}]}}"#));
        assert!(export(&p, &[], "0", "x").is_err());
    }
}
