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

## Tests

`node --test $(find src -name "*.test.mjs")` runs every suite (solver, checker, autowiring,
compiler, libraries, schematic…). `node src/lab/validate.mjs` validates the lab exercises.

## Licence

AGPL-3.0-or-later with additional terms ([NOTICE.md](../NOTICE.md)); contributions under the
[CLA](../CLA.md).
