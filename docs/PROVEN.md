# What Jollof Studio proves, and what it assumes

Jollof Studio's checker works like a compiler. It does not let a circuit or program reach the real world, such as a plugged-in board, a printed wiring guide or a submitted assignment, while an error remains. This page says exactly what that guarantee covers, which models it rests on, how they were checked against a reference simulator, and where each limit comes from.

**In short:** for every reachable state of the circuit, within the models below, no part exceeds its datasheet limits, every wire goes somewhere sensible, and the program agrees with the wiring. It is not a guarantee about timing, radio, heat beyond the cases listed, or anything the models leave out.

## 1. What is checked

The checker (`src/check/check.js`) runs three passes. Each finding has a stable code (`J0101`…, listed in `src/check/codes.js`) with an explanation page, the state that triggers it (a counter-example), and a fix.

| Pass | What it looks at | Examples of findings |
|---|---|---|
| Wiring structure | Every pin, net and wire (`circuit.js`, `faults.js`) | Supply shorted to ground; a module with no ground; 5 V on a 3.3 V-only pin; a missing pull-up on a 1-Wire bus; a motor wired straight to a GPIO; two I2C modules at the same address |
| Program ↔ circuit | The program's pin facts (`program.js`) against the wiring | `analogWrite` on a pin with no PWM; `analogRead` on a digital-only pin; an output driven against another output; an input read with no defined level; a pin driven but connected to nothing |
| Electrical, in every state | The circuit solved by `dc.js` in each reachable state, against `limits.js` | LED or GPIO over its current; a resistor over 1/4 W; a regulator over its thermal budget; a part supplied outside its voltage range; a reversed electrolytic capacitor; a battery drained too fast |

## 2. What "every reachable state" means

A state assigns a value to everything that can change while the circuit runs (`src/check/states.js`):

- each button released or pressed, and each relay at rest or energised;
- each potentiometer at both ends and the middle;
- each sensor output at both extremes of its datasheet range;
- each function generator at both ends of its output (offset ± amplitude), and each NE555 with its output high and low;
- each board pin the program drives, low and high.

The high state also bounds PWM, because the current during a pulse is the high-state current.

The checker splits the circuit into **independent sub-circuits**. The cut points are nodes whose voltage depends on nothing else: grounds, a board's 5 V and 3.3 V pins, and VIN when only USB powers it. Each sub-circuit is solved in all of its combinations, and the cost is their sum rather than their product. The proof still covers the product, because one sub-circuit cannot see the state of another.

A component joins all of its other pins into one sub-circuit, which is the conservative choice: a module, a relay with its contacts, a driver with its motors. As an example, 30 independent buttons give 2^30 states, checked in about 25 ms.

**Exhaustive** means every combination was solved, as long as each sub-circuit has at most 4,096 states. Past that, the checker tries the corners, then one variable at a time, then random states. It then reports that the result is **not exhaustive**, and does not claim a proof.

**Programs the checker cannot read precisely** are over-approximated: every wired pin is treated as possibly driven both ways. This covers a sketch the beginner interpreter cannot parse, a program in faithful (real-firmware) mode, and MicroPython. This can add warnings, but it cannot hide an error.

## 3. Models and their assumptions

The solver (`src/sim/dc.js`) finds the DC operating point of the circuit with modified nodal analysis and piecewise-linear models. It runs in a few milliseconds, so the proof can try thousands of states.

| Element | Model | Assumption it makes |
|---|---|---|
| Resistor, pot, switch, relay contact | Linear conductance; a closed contact is 0.05 Ω | Ideal value, no tolerance spread |
| LED | Ideal diode, then a fixed threshold (red 2.0 V … blue/white 3.0 V), then 15 Ω | The threshold does not move with current. A real LED conducts slightly below it (see §4) |
| Diode 1N4007 | 0.7 V threshold, then 0.5 Ω | Same as the LED |
| GPIO output | 25 Ω to the logic level | Typical output resistance, not the worst case |
| Internal pull-up | 35 kΩ to the logic level | Middle of the 20–50 kΩ datasheet range |
| Board 5 V / 3.3 V pins | Stiff source, 0.05 Ω | The board regulator holds its voltage |
| Batteries | Source with internal resistance (9 V: 1.5 Ω, 18650: 0.05 Ω) | Fresh cell |
| LM7805 | Regulated output while IN − OUT keeps its headroom; current taken from IN | Dropout and thermal limit are checked separately |
| NPN transistor | Off / active (Ic = β·Ib, β = 200, Vbe = 0.65 V) / saturated (Vce = 0.2 V) | Fixed β and Vbe |
| MOSFET | Switch: on above Vgs(th) = 1.3 V, 6 Ω when on | No linear region |
| Capacitor | Open in DC; backward Euler companion model in transient | Ideal, no ESR |
| PWM, tone(), servo pulses | The period is cut at each duty cycle and every slice is solved; the reading is their average, as a multimeter would show it | Peak current is checked separately in the high state |
| Sensors and modules | Outputs are Norton sources over their datasheet range; supply current is a fixed `ma` | Typical consumption |
| Inductor 10 mH | 24 Ω in DC (its wire); backward Euler companion model in transient, like capacitors | Ideal core: no saturation (flagged above 110 mA instead) |
| MOSFET IRLZ44N | Switch: on above VGS(th) = 1.5 V; RDS(on) = 0.0875 / (VGS − 1.5) Ω, never below 22 mΩ (datasheet points at 4 V and 5 V); body diode | No saturation region; RDS(on) below 4 V is an extrapolation |
| Op-amp LM358 | Ideal (gain 10⁵); output clamped to [5 mV, VCC − 1.5 V]; each input clamped to VCC − 1.5 V (common-mode range) | DC: no bandwidth or slew rate (ngspice macro-model has them) |
| Timer NE555 | Internal 5 k / 10 k divider (CONT at 2/3 VCC); output VCC − 1.4 V behind 3 Ω or 0.05 V behind 7 Ω; discharge 0.05 V behind 12.5 Ω; RESET below 0.7 V. The flip-flop is a state: both values are proven | Comparators are read once per time step in live simulation |
| Function generator | 50 Ω Thévenin source; in DC its mean (offset); proven at offset ± amplitude | Waveform averaged over each live step |

## 4. Validation against ngspice

ngspice is the reference open-source SPICE simulator. The suite `src/sim/spice.test.mjs` exports each circuit with `spiceDeck()` and solves it with ngspice, compiled to WebAssembly. It then compares every node voltage with `dc.js`.

The suite covers 80 circuits:

- the example projects;
- bench circuits: LED + resistor at both levels, a button with pull-up, a voltage divider, an NPN switch that is off, saturated or active, and a 9 V battery → diode → LM7805 → two LEDs;
- 60 seeded random networks of resistors, LEDs and diodes between 5 V, 3.3 V, GND and GPIO outputs.

| Comparison | What it shows | Result |
|---|---|---|
| **Same models** (`pwl`: the solver's own piecewise models given to ngspice) | The solver's arithmetic and state search are right | 272 nodes, maximum difference **2.1 mV**. Required: below 12 mV |
| **Physical models** (`phys`: exponential diodes calibrated at 10 mA, a Gummel-Poon NPN, a level-1 MOSFET) | How far the simplified models are from physics | Per circuit: median **1 mV**, 90th percentile **2 mV**, maximum **278 mV**. Required: below 0.35 V or 8 % on every node that carries current |

A third comparison covers the analog parts (18 circuits, 108 nodes): LM358 non-inverting, inverting and saturated, a follower outside its common-mode range, inductors, the IRLZ44N driven at 5 V and 3.3 V, and the NE555 in both flip-flop states. Same models: **2.0 mV** at most. Physical and macro-models (level-1 MOSFET with KP = 1 / k, an op-amp macro-model with a 0.7 MHz dominant pole and 0.3 V/µs slew rate, a behavioural NE555): **38 mV** at most. In transient, ngspice finds the RL time constant within 1.2 % of L / R, and the 1 kΩ / 10 kΩ / 100 nF astable at 672 Hz, 2 % below the datasheet formula 1.44 / ((RA + 2RB) C).

The largest gaps come from LEDs at very low current. There a real LED conducts below its nominal threshold, while the fixed-threshold model says it is off. This changes nothing about overload findings, which happen at high current where the two models agree. It does mean that a "LED off" finding below about 0.1 mA is approximate.

Reproduce with `node --test src/sim/spice.test.mjs`.

## 5. Where the limits come from

Each limit has a datasheet source:

- the limits in `src/check/limits.js`: LED current, resistor power, transistor, diode, capacitor voltage, regulator, driver, relay, battery, and the per-pin, total and supply-pin currents of each board;
- each supply range and current in `src/sim/parts.js`.

Each source names the publisher, the document and the section or table where the number appears. The list is in `src/check/sources.js`, and `src/check/sources.test.mjs` fails if a limit has no source.

Two kinds of number are used:

- a **warn** threshold, where the part wears or heats;
- a **max** threshold, from the datasheet's absolute maximum ratings, where it is destroyed.

Teaching margins (warn below max) are deliberate.

## 6. What is not covered

- **Timing and transients beyond the solver's step:**
  - inductive spikes (a missing flyback diode is flagged as a rule, but the spike is not simulated);
  - switching edges, ringing and EMC;
  - contact bounce, which the program view handles, not the electrical proof.
- **Heat** other than the LM7805 thermal budget and resistor power. There is no airflow, no enclosure, and no rise in ambient temperature.
- **Mechanics and radio:**
  - motor stall torque, servo load;
  - Wi-Fi, Bluetooth and nRF24 range.
- **Part-to-part spread:** limits use datasheet typical or maximum values, not a statistical tolerance analysis.
- **ESD, wrong polarity at the battery connector**, or anything that happens while wiring with power on.
- **Program semantics in faithful mode:**
  - The real firmware runs on an emulated processor, and the checker uses the over-approximation described in §2.
  - Bugs in the emulators (avr8js, rp2040js) or the device models (`src/emu/devices/`) are outside the proof. They are tested against real Arduino libraries in `src/emu/corpus/`.

## 7. Evidence you can run

| Command | What it checks |
|---|---|
| `node --test src/check/check.test.mjs` | The checker on hand-made faults and the examples |
| `node --test src/sim/dc.test.mjs` | Solver behaviour (LEDs, transistors, capacitors, PWM) |
| `node --test src/sim/spice.test.mjs` | Agreement with ngspice (§4) |
| `node --test src/sim/autowire.test.mjs` | The auto-wiring of every library part produces zero findings |
| `node --test src/sim/analog-models.test.mjs` | Inductor, LM358, IRLZ44N, NE555 (live oscillation), generator and oscilloscope tap against textbook formulas |
| `node src/check/cli.mjs exemples/*.jollof` | The checker on any project, from the command line |
| `node --test src/emu/corpus.test.mjs` | Real Arduino sketches and libraries on the emulated boards (needs arduino-cli) |
