# Jollof Studio architecture

Jollof Studio is a desktop app (Tauri 2, Rust) whose interface is plain JavaScript (Vite, Three.js).
The same interface also runs in a browser. Source comments and UI text are in French; this document
is the English entry point for contributors.

## Big picture

```
index.html ─ boot.js ─ main.js ──┬─ library/   parts catalogue (3D builders), docs, credits
                                 ├─ sim/       circuit analysis, DC solver, autowiring, faults, sensors, actuators
                                 ├─ check/     the checker: proves a circuit safe in every reachable state
                                 ├─ prog/      Arduino-subset compiler, runtime, rules, blocks, code panel
                                 ├─ schematic/ 2D schematic (live view + printable sheets)
                                 ├─ logic/     digital logic workspace (gates, flip-flops, counters), its own editor and simulator
                                 ├─ school/    classroom client (talks to server/)
                                 ├─ video/     timeline and video export
                                 └─ i18n/      tl() + English dictionary (en.js)
src-tauri/  native side: files, autosave, arduino-cli bridge
server/     school server (NestJS + PostgreSQL)
```

`src/main.js` owns the scene, the editor state (`S.comps`, `S.wires`), the simulation loop and the
`moduleApi` object that optional modules receive.

## Parts

A part type (for example `led-red`, `dht22`, `l298n`) is a string key used across several files:

| File | What it defines |
| --- | --- |
| `src/library/catalog.js` | `LIBRARY` entry (name, category, prefix) and the 3D builder; pin names come from the builder (`kit.js` helpers) |
| `src/sim/parts.js` | `PARTS[type]`: what each pin expects (`pwr`, `gnd`, `io` + `need`), voltage ranges, `lv5`/`lv3`, `via`, `pull`, `ma`, `stage`… |
| `src/sim/dc.js` | how the solver models it (resistor, diode, source, Norton, capacitor, BJT, FET) |
| `src/sim/models.js` | sensor behaviour (`MODELS`) and interactive peripherals |
| `src/sim/actuators.js` | how outputs move (LEDs, motors, servo, relay…) |
| `src/schematic/sheet.js` | schematic symbol |
| `src/library/docs.js` | the documentation page |
| `src/check/limits.js` | machine-readable ratings the checker proves |

Imported 3D models can become parts without code: `src/sim/custom.js` builds a board profile or a
module spec from pin names (`c.spec`, `c.prof`).

## Circuit analysis and solver

- `src/sim/circuit.js` `analyze(comps, wires)` groups pins into nets (wires, breadboard strips,
  closed contacts) and gives `net`, `wnet` (through resistors), `reach` and `issues` (shorts).
  `inspect(comp, A, spec)` checks one part against its spec and finds the board pin behind each
  signal, through dividers and level shifters too (`bridge`).
- `src/sim/dc.js` `solveDC(comps, A, ctx)` is a modified nodal analysis solver with piecewise-linear
  diodes and transistors. It averages PWM, steps capacitors in time (backward Euler) when `ctx.dt`
  is given, and caches the topology per analysis.
- `src/sim/autowire.js` plans wiring for a part on a board, including driver stages, dividers,
  level shifters and breadboard junctions.

## The checker

`src/check/check.js` runs three passes: wiring structure (`collectFaults`), program ↔ circuit
(`program.js` reads pins from the program text), and the DC solver in every reachable state
(`states.js`). The circuit is split into independent sub-circuits at stiff nodes (ground, 5 V,
3.3 V), so the proof costs the sum of each part's states instead of their product. Diagnostics have
stable codes (`codes.js`), explanations (`explain.js`) and a rustc-like text format (`format.js`).
It runs in a Web Worker (`check.worker.js`) and from the command line (`cli.mjs`).

## Digital logic workspace

`src/logic/` is a second workspace next to the 3D circuit, switched with the "Électronique | Logique"
control in the app bar. It is installed as a module (`installLogic(moduleApi)`), keeps its circuit in the
project file under `settings.modules.logic` (`{ view, style, circuit: { elements, wires, blocks? } }`), and owns the
undo stack while it is shown (`moduleApi.history(hook)`).

| File | Role |
| --- | --- |
| `elements.js` | element library: pins in grid units, behaviour (`ev(inputs, props, state)`), ANSI and IEC symbols as abstract draw ops |
| `sim.js` | netlist (wires, junctions, same-name labels, buses bit by bit), event-driven unit-delay simulation with levels 0/1/X/Z, weak drivers (pull resistors), power-up settle, `truthTable`, `runSequence` |
| `blocks.js` | user blocks (subcircuits): interface from named inputs/outputs, `flatten` for simulation, `syncBlocks` |
| `clean.js` | sanitises a circuit read from a file (types, props, ids, blocks) |
| `boolean.js` | expression parser, Quine-McCluskey minimisation, Karnaugh layout |
| `check.js` | lab checks: `logic-table`, `logic-seq`, `logic-parts`, `expr`, `table-fill` |
| `route.js`, `render.js` | orthogonal wire routing; symbols to SVG and to PDF |
| `editor.js`, `panel.js`, `index.js` | SVG editor, inspector tabs (Circuit, Table, Timing), app integration |

The simulation evaluates every element touched by a change on the levels of the same instant, then applies
all output changes together, so a flip-flop samples D before its own clock edge propagates. At power-up a
sequential pass gives feedback loops (gate latches) a stable state and no clock edge is counted.

**Buses.** A pin can carry several bits: `pin.bus` lists the per-bit keys (`pinKeys(pin)`), and the netlist
unions a wire's bits one by one. Wires between pins of different widths are refused by the editor and, if
read from a file, reported in `sim.bad` and ignored. Junctions and labels take the width of their bus; the
`split` element joins a bus to its separate bits. Number-like parts (adder, ALU, register, counter, ROM…)
have a `bus` prop that groups each number on one pin; internal bit names stay the same, so `ev()` and
truth tables don't change.

**Blocks.** `circuit.blocks = [{ id, name, circuit }]`; an element `{ type: 'block', p: { ref, io } }` places
one. Its pins are the named inputs (switch, button, clock, DIP, number input) and outputs (LED, probe,
buzzer, displays) of its circuit; `p.io` caches that interface for drawing and is refreshed by
`syncBlocks`. Before simulating, `flatten` copies each block's circuit in place (ids `instance/inner`), turns
its named inputs/outputs into passive `port` elements and links them to the block's pins with hidden `~`
wires; labels inside a block stay local. A block may contain other blocks, never itself (`usesBlock`).
Opening a block swaps the editor's circuit; each circuit keeps its own undo history and view
(`editor.load(c, { ctx })`).

Logic labs live in `src/lab/logic/*.json` (`domain: "logic"`, `start.logic` and `solution.logic` circuits);
`node src/lab/validate.mjs` checks them with the same engine.

## Project kinds

`src/ui/kind.js` defines the project kinds (`elec`, `analog`, `pneu`, `epneu`, `logic`) and the workspaces each one
shows (`spacesOf`); only `epneu` shows two (bench and pneumatic circuit). The kind is saved as `settings.kind`;
`inferKind` derives it for older files (pneumatic elements with bench parts → `epneu`, without → `pneu`, a logic
circuit alone → `logic`). `main.js` `setKind` sets `.app[data-kind]` (CSS hides the workspace switch outside `epneu`),
moves to a workspace of the kind and repaints; `ensureSpace` widens the kind when a workspace opens or receives
content (modules call it), and `changed()` widens `pneu` → `epneu` when a bench part appears and `analog` → `elec`
when a board does, so nothing hidden is ever simulated. `newProject(kind)` asks for the kind when none is given
(`chooseKind`). In the pneumatic module `linked()` (kind `epneu`) gates every exchange with the bench (coils, sensors,
bench inputs of the GRAFCET, split view, bench vignette).

The checker report is project-wide: `check/ui.js` merges `app.extra()` diagnostics (pneumatic module `diags()`:
J0701/J0702 circuit, J0703 GRAFCET, J0704 bench part whose tag no element carries) into the result, with the same
explanations (`explain.js`) and accepted-warning mechanism (matched by `key`).

## MA-ISA supervision

The simulator runs in the webview, so supervision is fed from there. `main.js` keeps one simulated clock (`S.simT`,
the sum of the capped steps, reset at start) and calls `moduleApi.onSimTick(fn)` after each finished circuit step
(10 per second). `src/supervision/signals.js` builds the snapshot (`NAME.pressed`, `NAME.on`, `BOARD.PIN` volts,
`CYL.x`; unknown value = `null`, never zero) and `src/supervision/index.js` sends it, in order, through the single
Tauri command `supervision(cmd, args)` (`src-tauri/src/supervision_cmd.rs`), then draws the returned frame at most
20 times per second. All logic is in the Tauri-free crate `src-tauri/supervision` (`api::Session::handle`), built on
the published crate `maisa-core`, used unchanged: `config.rs` (fixed capacity of 16 channels, padding with
non-required always-invalid channels, validation, `initial_latch`), `channels.rs` (axis `p`, relationship
"A reaches X within T after B rises" with documented cancel and retrigger rules), `faults.rs` (stuck, offset/drift,
burst, loss, stuck actuator, applied to a copy of the observed values only), `supervisor.rs` (`Monitor<16>` and
`InterventionEngine<8>`; operator `k` and `r` are held levels because the crate's state machine needs them held,
`a` is a pulse; `External.s` = engine escalation; `External.h` = optional hard limits), `design.rs` (requirements
to parameters with the crate's design functions). Config and latch are saved in `settings.modules.supervision`; a
project never saved with supervision starts unlatched, an unreadable saved latch starts latched. The simulation has
no pause: stopped means no ticks. `examples/bridge.rs` serves the same `Session` over local HTTP for browser tests
(dev only, `localStorage['jollof-supervision-bridge']`). Tests: `cargo test` in the crate (23), `signals.test.mjs`.

## Pneumatic workspace

`src/pneu` is a third workspace next to electronics and logic, with the same pattern: element definitions
(`elements.js`: ISO-1219-style symbols drawn as SVG, ports with their ISO numbers), a pure simulation (`sim.js`),
an SVG editor (`editor.js`), a static check (`check.js`) and the integration (`index.js`: switch button, library,
inspector tab, `pneu` project module, own undo history).

The simulation is discrete, with no physical model. Each step, valves take their position from their actuators
(solenoid, push button, air pilot, spring; a bistable valve keeps its last one). Every port is then pressurised,
exhausted or closed: a closed port keeps the air it had. This is a widest-path search from the supplies and from the
open ports, along tubes and internal passages; OR/AND valves decide from their inputs computed without their own
passages. A cylinder moves when one chamber is pressurised and the other can exhaust. Its speed is
1 / stroke time, times the narrowest flow-control opening on the path.

A circuit can switch to the physical model (`physics.js`, `circuit.model = 'physical'`), using the same valve
positions and passages (`valvePos`, `passages` in `sim.js`). Each volume is the set of ports joined by tubes, with
tube, port and chamber volumes. Pressures follow isothermal air, p·V = m·r·T. Every passage has an ISO 6358 sonic
conductance (choked below b = 0.5), and the flow per step is limited so it cannot overshoot equalisation. Pistons
integrate force = pressure × area − load − spring − friction over the moving mass, with stops at both ends.
`physics.test.mjs` checks the numbers against formulas: choked flow, F = p·A, stalling against a load, meter-out
slowing, a 5/3 closed centre stopping mid-stroke, and spring return.

Unlike logic, it shares the electronics simulation. `moduleApi.onSimFrame` runs it after programs and actuators. A
valve solenoid reads the `coilOn` state of the `coil24` part with the same name, computed from the DC solution
(energised above 18 V). Cylinder end positions and pressure switches set `inp.pressed` on the `cylsensor` and `pressostat` parts with the matching names. Assistants drive the workspace through the `pneumatic_*` MCP tools, and lab steps can check tubes (`pneu-tube`), cylinder positions and valve push buttons (`watch` on an element id; `id:R` is the 12-side button).
Pneumatics labs live in `src/lab/pneu/*.json` (`domain: "pneu"`, the electronics format with the circuit in
`start.settings.modules.pneu` and the tubes in `solution.pneu`). They open the pneumatic workspace unless
`workspace: "elec"`. `validate.mjs` simulates their pneumatic-only `watch` steps on the solution circuit.
The ready-made circuits of the Examples menu are in `src/pneu/examples.js`.

Bench links. `links.js` lists the tags that tie the circuit to the bench (`tagsOf`: valve coil tags → `coil24`,
cylinder sensor tags → `cylsensor`, pressure-switch tags → `pressostat`). `index.js` resolves each one to its bench
part and board pin (a sensor through `inspect().io`, a coil through the base of the low-side transistor on its `-`
net), and `linkBench` adds the missing parts under the tag name and auto-wires them (`moduleApi.addComp`,
`autoWire`, `settle`). The split view moves the pneumatic host into a fourth grid column (`.app.pnSplitOn`, created
on first use, widths as `--pnBenchFr`/`--pnSplitFr`, a `pnhost` size container stacks the GRAFCET under the circuit
when narrow) and draws the control chain above it; it opens on simulation start for a project with both a circuit
and a linked bench part (`jollof-pn-split` = `off` after the user closes it) and restores the previous layout on
stop. Undo follows the pane last clicked (`moduleApi.history`). Live values are patched in place every 100 ms.

The 3D machine view (`machine.js`) is imported on first use. `SCENES` is its registry (`cylinders`, `door`, `bus` =
door with `skin: 'bus'`, `press`, `station`, `pantograph`, `sorter`): cylinder roles (`cyl`, `clamp`, `drill`) and
controls `{ role, mode: 'hold' | 'toggle' | 'click', defaults }` (`open`, `obstacle`, `emergency`, `left`, `right`,
`start`, `up`, `send`), from which `index.js` builds the header; a role resolves to `scene[role]`, else a known
default name, else a bench button. The view only displays, except the sorter, which holds its `detect` role while a
parcel cuts the photocell (released on stop, close and dispose). `circuit.scene` (kind and role names, at most 12
characters, cleaned by `clean.js`, saved with the circuit) picks the scene, and `index.js` feeds it the
simulation state each frame (cylinder positions, chamber pressures, sensor tags, coils, bound inputs). The door's
open button and obstacle resolve to a GRAFCET panel input, a valve push button or a bench button of that name.

Sequences. Roller valves are `v32` with `act: 'roller'`, `cam` (cylinder label or id) and `end` ('1' rod out, '0'
rod in); both models actuate them from the cylinder position of the previous step (`camOn` in `sim.js`). `seq.js`
records finished strokes (`A+`, `A-`) and draws the displacement-step diagram. `grafcet.js` is the GRAFCET
(IEC 60848), stored as `circuit.grafcet`: a list of items, steps `{ n, init, act, r, to, alt }`, parallel blocks
`{ par: [[items]…], r, to }` (AND divergence and convergence) and macro-steps `{ n, macro, exp: [items], r, to }`;
compiling flattens it into transitions with several upstream and downstream steps (paths such as `2/0/1` point back
to the drawn item); actions can be continuous, conditional, stored at activation (`Y1:=1`, counters `C:=C+1` compared as `C>=3`) or
forcing orders on another partial GRAFCET (`F/G1:{0}`, `{}`, `{*}`, `{INIT}`, applied before evolution, the forced
GRAFCET does not evolve); steps can enclose an encapsulation (`enc`), active only while they are; `parts` holds the
other named partial GRAFCETs (paths `P0:…`); receptivities reuse the logic
expression parser after rewriting delays (`3s/X2`) and edges (`↑dcy`) into internal variables; a scan clears all
clearable transitions at once (activation wins) and repeats until stable, then emits the actions. `run.js` is the one
step shared by the app, the lab validator and the tests: GRAFCET scan (inputs: panel buttons `@name`, cylinder and
pressure-switch tags, bench inputs), its outputs OR-ed with the bench coils, the pneumatic step, the recorder.
`grafview.js` is the panel, `grafcode.js` (loaded on demand) writes the board program through the rules code
generator (`createGenContext`); it settles running wire animations first, since the analysis only sees finished
wires. Lab check `pneu-seq` compares the recorded strokes with an expected cycle; the
validator simulates it on the solution (tubes, GRAFCET) and checks that the start does not already pass.

Labs can carry `keep` on a step (the idea to remember, shown under the text; on question steps only once answered)
and `takeaways` on the lab (shown when finished and printed in the report); a last step without a check is finished
with « Terminer ». Board-driven labs are proven outside the validator by replaying their solution in the app.

Tutorials are labs with `tutorial: true` (series `tuto`), an empty `start` and the whole finished project in
`solution.project`. Their checks never use generated ids: `parts` (bench parts by type and name, `{ board: true }`),
`wired` (`benchState`: no required pin free, no wiring error), `pneu-parts` (elements and settings), `pneu-tube` with
`~type:port` refs, `grafcet` (no errors, drives `outputs`, reads `reads`), `ui` (`sim`, `split`, `pneu`, `elec`,
`grafcet`, `3d`). In the app, these checks are polled (`AUTO_CHECKS`; a program is compiled once per version), a
passed step advances after a short pause, a coach card mirrors the current step on the workspace, and step `spot`
selectors are ringed only where the target is visible (`elementFromPoint`). `validate.mjs` requires the solution
project to pass and the empty start to fail each check, and simulates the tutorial's `pneu-seq` with the GRAFCET in
charge and the `when` bench buttons held.
Those parts are contacts like buttons (`isContact` in `parts.js`), so the solver, the checker's state enumeration and
the programs read them unchanged. The coil is driven like a pump: autowire builds the transistor stage from an
external 24 V source (`psu24`, an `ext` target that every coil shares).

## Programs

- `src/prog/lang.js` compiles an Arduino C++ subset to JavaScript generators; `src/prog/runtime.js`
  runs them in virtual time and simulates Arduino libraries at the call level (LCD, sensors, radio,
  Wi-Fi sandbox…).
- The runtime object exposes `pins` (a Map of pin states), `run(dt)`, `clock()`, serial I/O and a
  debugger. `src/prog/panel.js` launches runtimes and bridges them to the circuit with `makeHw`.
- Pin states feed the solver (`main.js` `dcCtx`), the actuators and the oscilloscope (`sim/bench.js`).
- Planned: a second backend that runs real compiled firmware in emulators (avr8js, rp2040js) behind
  the same runtime interface.

## Editions

The free edition is this repository. The Pro edition adds modules from a separate private
repository; `vite.config.js` resolves `virtual:jollof-pro` to it in `--mode pro` and to an empty
module otherwise. Pro code imports public code through the `@jollof/` alias.
Pro adds only the classroom (`src/school`, loaded with `import()` in `--mode pro` only, plus the
teacher tools of the private repository) and the teaching mode; the free edition shows no Pro
button, badge or upsell. Uploading to a real board (`src/hil/upload.js`) and the assembly guide
(`src/schematic/guide.js`) are in both editions.

## Startup

The app should be usable as fast as possible, so startup does only what the first screen needs:

- `index.html` preloads the main chunk (`<link rel="modulepreload">`, added by `vite.config.js`), so it downloads
  and compiles while styles, fonts and the dictionary load.
- The library shows pin counts from data (`pinCountOf` in `src/check/load.js`, board entries carry `pins`), never by
  building 3D models; `src/sim/autowire.test.mjs` checks both agree. Standard parts ship their thumbnails in
  `public/thumbs` like the built-in ones; only the user's own parts are rendered.
- In realistic mode the project is first drawn with the drawn models; the CAD parts are set in place when their
  files arrive (`cadArrived` in `src/main.js`), when the user is not dragging or simulating.
- The splash screen (`src/ui/splash.js`, shown by `boot.js` before the main module loads) never delays loading: it animates while `main.js` loads in parallel (about 1.2 s, Web Animations API, built from the `brand.js` logo) and fades out when both the animation and the first frame (`jollof:ready`, dispatched with the `jollof:frame` mark) are done; a click or key skips it, reduced motion shows the logo still, and it removes itself after 10 s if the app never starts.
- Lab contents (`src/lab/tps.js`) load when the lab library opens; the Pro edition fetches the classroom and its
  modules in parallel at the start.
- `performance.mark('jollof:…')` marks each phase (boot, main, scene, library, project, frame, cad): see them in the
  browser's performance tools. Measure a production build (`npm run build` then `npx vite preview`): the dev server
  loads hundreds of separate modules and is much slower.

## Tests

`node --test $(find src -name "*.test.mjs")` runs every suite (solver, checker, autowiring,
compiler, libraries, schematic, logic…). `node src/lab/validate.mjs` validates the lab exercises (electronics, pneumatics and logic).

## Licence

AGPL-3.0-or-later with additional terms ([NOTICE.md](../NOTICE.md)); contributions under the
[CLA](../CLA.md).
