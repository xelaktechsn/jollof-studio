# ESP32 "faithful mode" through QEMU: trial report (roadmap step 4.4)

Question: can real ESP32 Arduino firmware run locally and offline in Espressif's QEMU, launched as a
separate process (Tauri sidecar), and drive the app's simulated pins and modules?

**Recommendation: GO WITH CONDITIONS.** Real firmware boots and runs: Serial in both directions, GPIO
outputs, GPIO inputs and interrupts, ADC, PWM, and I2C with the one sensor QEMU models. Wi-Fi does not
work, and the app's I2C/SPI module models cannot be attached without extra work. The conditions are listed
at the end (section 11).

Trial date: 2026-11-07. Host: Intel Core i7-9750H (6 cores / 12 threads, 2.6 GHz), macOS 26.5.2, Node 22.18.
The host was shared with other work during the trial (load average 4 to 9), so timings are pessimistic and
ranges are given. Apple Silicon, Windows and Linux were **not** tested.

---

## 1. What was tried

| Piece | Version |
|---|---|
| Espressif QEMU fork | `esp-develop-9.2.2-20250817` (QEMU 9.2.2), prebuilt `x86_64-apple-darwin` release asset |
| arduino-esp32 core | 3.0.7 (ESP-IDF 5.1); it was already installed. The latest core is 3.3.12 and was not tested. |
| arduino-cli | 1.5.1 |
| FQBN | `esp32:esp32:esp32:FlashMode=dio` (the reason for DIO is explained in section 6) |

The prototype lives in `scripts/esp32-qemu/`. Nothing is wired into the app UI.

- `qemu-esp32.mjs` starts the QEMU process and drives it from outside. UART0 uses the process's
  stdin/stdout. QMP runs over a local TCP socket that QEMU connects to as a client. GPIO and LEDC register
  writes are decoded from QEMU's own trace output. UART1 carries a side-channel to the shim.
- `jollof_qemu_shim.cpp` is a small file added to the sketch, for the emulator only. It overrides the
  arduino-esp32 *weak* functions `digitalRead`, `analogRead`, `attachInterrupt`, `detachInterrupt`,
  `pinMode`, `digitalWrite` and `initVariant`. It reads input levels pushed by the host over UART1, mirrors
  pin mode and write calls with virtual-time stamps, and turns off the TG0/TG1 hardware watchdogs (see 6.4).
- `trial.mjs` compiles the test sketches, runs them, and prints the measurements as JSON. Scenarios:
  `blink`, `i2c`, `input`, `hang`, `wifi`, `all`.

No code was taken from QEMU, Velxio or any other simulator. Register offsets come from the ESP32 Technical
Reference Manual and ESP-IDF's public headers. The fork's source was read only to understand its behaviour.
The host-side protocol was designed for this trial.

## 2. Exact commands

```sh
W=/path/to/scratch/esp32            # any scratch directory

# 1) QEMU, prebuilt by Espressif (~4.1 MB download)
curl -LO https://github.com/espressif/qemu/releases/download/esp-develop-9.2.2-20250817/qemu-xtensa-softmmu-esp_develop_9.2.2_20250817-x86_64-apple-darwin.tar.xz
mkdir -p $W/qemu && tar -xJf qemu-xtensa-softmmu-*.tar.xz -C $W/qemu
otool -L $W/qemu/qemu/bin/qemu-system-xtensa   # → needs Homebrew pixman, libgcrypt, sdl2

# 2) Its dynamic libraries without installing anything system-wide. The binary looks for them under
#    /usr/local/opt/...; dyld falls back to DYLD_FALLBACK_LIBRARY_PATH by file name.
#    libgcrypt 1.12.3 "sonoma" bottle from ghcr.io (Homebrew has no Intel bottle for 1.12.4),
#    libgpg-error via `brew fetch`, libintl/pixman/SDL2 copied from an existing Homebrew.
mkdir -p $W/libs && cp libgcrypt.20.dylib libgpg-error.0.dylib libintl.8.dylib libpixman-1.0.dylib libSDL2-2.0.0.dylib $W/libs/
export DYLD_FALLBACK_LIBRARY_PATH=$W/libs:/usr/lib
$W/qemu/qemu/bin/qemu-system-xtensa --version   # QEMU emulator version 9.2.2 (esp_develop_9.2.2_20250817)

# 3) Compile. The core writes <sketch>.ino.merged.bin, a ready-to-boot 4 MB flash image.
arduino-cli compile --fqbn esp32:esp32:esp32:FlashMode=dio --output-dir $W/build/blink $W/sketches/blink

# 4) Run (Ctrl-C to quit; QEMU writes into the image, so use a copy)
cp $W/build/blink/blink.ino.merged.bin $W/flash.bin
$W/qemu/qemu/bin/qemu-system-xtensa -machine esp32 -display none -monitor none \
  -drive file=$W/flash.bin,if=mtd,format=raw -serial stdio

# 5) Prototype bench (from the repository root)
JOLLOF_QEMU=$W/qemu/qemu/bin/qemu-system-xtensa JOLLOF_QEMU_LIBS=$W/libs JOLLOF_ESP32_WORK=$W/work \
  node scripts/esp32-qemu/trial.mjs all            # options: --no-trace, --seconds N, --icount shift=2
```

The QEMU command line used by the prototype (`qemu-esp32.mjs`) is:

```
qemu-system-xtensa -machine esp32 -display none -monitor none
  -drive file=flash.bin,if=mtd,format=raw
  -serial stdio                                                  # UART0 = Serial
  -chardev socket,id=side,host=127.0.0.1,port=P1 -serial chardev:side   # UART1 = shim side-channel
  -chardev socket,id=qmp,host=127.0.0.1,port=P2 -mon chardev=qmp,mode=control
  -trace memory_region_ops_write                                # optional: register writes on stderr
```

## 3. Measurements

| Measure | Result |
|---|---|
| QEMU download (macOS x86_64) | 4.1 MB `.tar.xz` (macOS arm64 3.9 MB, Linux x86_64 15.7 MB, Windows x86_64 34.7 MB with DLLs) |
| QEMU on disk | `qemu-system-xtensa` 19.4 MB, ESP32 ROMs 0.9 MB (1.6 MB for all chips), dylibs 3.5 MB (1.9 MB without SDL2) |
| arduino-esp32 core download | 3.0.7: **1.08 GB**, 3.4 GB on disk (arduino-cli installs every chip's toolchain). 3.3.12: **1.82 GB** |
| Compile, first build of a new board-option set (core is built) | 79 to 93 s |
| Compile, new sketch (core cached) | 32 to 44 s |
| Compile, edit and recompile | 13 s |
| Firmware size (app partition) | blink 281 KB, I2C 298 KB, input + shim 289 KB, WiFi.h 902 KB; flash image always 4 MB |
| Process start to first UART byte (ROM banner) | 440 to 465 ms |
| Process start to `setup()` | 1.4 to 1.9 s typical (one run at 3.7 s under heavy host load). Guest `millis()` is 580 to 740 at `setup()`. With `-icount shift=2` it is 11.3 s. |
| Real-time factor (guest `millis()` against wall clock) | **1.000**: the guest clock follows the host clock in the default mode |
| CPU speed: 12 M instructions (6-instruction `loop` body × 2 M) | 25 to 37 ms, so **320 to 470 MIPS**. That is faster than a real 240 MHz ESP32 (about 60 ms estimated). Not cycle-accurate. |
| Host CPU, idle blink | 0.17 cores without trace, 0.24 to 0.27 cores with the GPIO trace |
| Trace volume | 18,000 to 26,000 lines/s, mostly timer and watchdog register writes |
| GPIO output timing seen through the trace (blink 250 ms) | median 250.3 ms, min 246.4 ms, max 252.7 ms (host-clock stamps, ±4 ms) |
| Input to firmware to output round trip (host sets D4, firmware copies it to D2) | median 1.8 to 2.5 ms, max 3.2 to 4.3 ms, through either the shim or the trace |
| Serial host → board → host echo | 13 to 14 ms (bounded by the sketch's `loop()` period) |
| QMP round trip (`query-status`) | median 0.33 to 0.37 ms, max 0.74 ms |
| Change TMP105 temperature over QMP until the firmware reads it | 96 ms (one `loop()` period of the sketch) |
| `-icount shift=3,sleep=off` (deterministic, skips idle time) | 9.2× real time once booted, 1.5 cores, 6.9 s to `setup()` |

## 4. What works

| Feature | Status | How |
|---|---|---|
| Boot of real arduino-esp32 firmware | ✅ with `FlashMode=dio` | QIO (the core's default) asserts at startup: `qio_mode: Failed to set QIE bit` |
| `Serial` TX/RX | ✅ | UART0 on the process's stdio. QEMU sends TX bytes immediately. RX goes through a 128-byte FIFO. |
| `digitalWrite` / `pinMode` (outputs) | ✅ observed, no fork | Two paths, both working: (a) QEMU trace of writes to `GPIO_OUT_W1TS/W1TC/ENABLE`; (b) shim frames with virtual µs stamps |
| `analogWrite` / LEDC PWM | ✅ observed (trace) | Decoded from `GPIO_FUNCn_OUT_SEL` plus LEDC duty and timer registers: `analogWrite(25, 64)` → duty 0.25 at 1000 Hz. Servo libraries and `tone()` also use LEDC (not tested). |
| `digitalRead` | ✅ **shim only** | QEMU's GPIO model always returns 0, so the shim returns host-pushed levels |
| `attachInterrupt` | ✅ shim only | The shim polls UART1 every 1 ms and calls the handler on edges (19 out of 19 real edges counted) |
| `analogRead` | ✅ shim only | QEMU's ADC returns 0. The shim returns host-pushed raw values (checked: 1001 to 1019 came through). |
| I2C (`Wire`) | ✅ **TMP105 at 0x48 only** | Real Wire driver on QEMU's I2C controller. The scanner finds 0x48 and reads 25.0 °C. `qom-set … temperature 31500` gives 31.5 °C. |
| Pause / resume | ✅ | QMP `stop` / `cont` (`system_reset` exists for reset) |
| I2C modules of the app (LCD, SSD1306, BMP280, MPU6050) | ❌ | Not attachable, see section 7 |
| SPI modules (MFRC522, nRF24, SPI displays) | ❌ | Same situation as I2C |
| Timed one-wire and bit-banged protocols (DHT, DS18B20, HC-SR04, IR) | ❌ | No GPIO timing model. With the shim, inputs are sampled levels (1 ms granularity), not µs edges. |
| WS2812 (RMT) | ❌ | RMT is not modelled |
| **Wi-Fi** (`WiFi.h`) | ❌ | `WiFi.mode(WIFI_STA)` panics (`LoadStorePIFAddrError`, EXCVADDR `0x60033c00`, the Wi-Fi MAC/baseband block is not emulated), then the board boot-loops |

## 5. GPIO: how an external process can see and set pins

What the fork actually models matters here: `hw/gpio/esp32_gpio.c` in the Espressif fork is a **stub**. Writes
are discarded, and reads return 0, except the strap register. So:

| Option | Verdict |
|---|---|
| Poll `GPIO_OUT_REG` (0x3FF44004) with QMP/HMP `xp` or the gdbstub | ❌ **Impossible**: the register always reads 0, so there is nothing to poll. |
| QEMU trace `memory_region_ops_write` (already in the release binary, `-trace …` with no fork) | ✅ Outputs and PWM. You see every write with its value. The cost is 18 to 26 k trace lines/s (+0.07 to 0.1 core) and host-time stamps only. It is a debug feature, so it is not a stable interface. |
| Firmware shim on UART1 (weak-symbol overrides) | ✅ **The only no-fork way to get inputs.** Virtual µs stamps, very low overhead. It only sees Arduino API calls: it misses direct register writes and libraries that use peripherals (RMT, LEDC through `ledcWrite`). |
| Custom QEMU device: a real `esp32.gpio` model that sends pin changes on a chardev and takes input levels back | Best fidelity and replaces the trace. Needs our own build of the fork (GPL, published). About 2 to 3 days of C plus build CI. |
| gdbstub breakpoints on `__digitalWrite` | Rejected: stops the VM on every call. |

Prototype results: the round trip "host changes D4 → firmware reads it → firmware writes D2 → host sees it"
takes a median of 1.8 to 2.5 ms. That is dominated by the shim's 1 ms poll and the sketch's `delay(1)`, and
is fine for buttons, switches and slow sensors.

## 6. Problems found

### 6.1 QIO flash mode
The core's default `FlashMode=qio` makes the firmware assert during start-up
(`assert failed: do_core_init startup.c:350 (flash_ret == ESP_OK)`), because QEMU's flash model refuses the
QE bit. **Compile with `FlashMode=dio`.** This changes nothing for real boards: DIO works on every ESP32
module. The faithful-mode compile is a separate build from the upload build anyway.

### 6.2 Prebuilt macOS binaries are not self-contained
- They link Homebrew's `pixman`, `libgcrypt` (needed for the crypto accelerator models) and `SDL2` by
  absolute Homebrew paths. A user without Homebrew cannot run them.
- The newest release's (`20260417`) asset named `x86_64-apple-darwin` is actually an **arm64** binary
  ("bad CPU type"), and it links `/opt/homebrew/...` paths.
- Homebrew no longer ships an Intel bottle for the current libgcrypt.
- Under the macOS hardened runtime, `DYLD_*` variables are ignored, and TCG needs the `allow-jit`
  entitlement.

So for distribution, **build QEMU ourselves** from the fork: `--target-list=xtensa-softmmu`, no
SDL/GTK/Cocoa/VNC, gcrypt and pixman bundled or static, `@rpath` install names, signed and notarized.

### 6.3 I2C devices cannot be added from the command line
`-device tmp105,…` fails: `No 'i2c-bus' bus found`. The fork's source says so explicitly: SoC peripherals
sit on a private bus, so `-device` cannot reach them. Instead, the `esp32` machine **hard-wires one TMP105 at
0x48 on I2C0**. That is the only I2C slave available without a fork.

### 6.4 Spurious watchdog resets (free-running mode)
Some runs show `rst:0x8 (TG1WDT_SYS_RESET)` followed by `rst:0x7 (TG0WDT_SYS_RESET)`:

- Reproducible but intermittent with "Wire transaction + `Serial.available()` in `loop()`" (the `hang`
  scenario): 4 resets in 12 s in one run, 0 in 8 s in another.
- Seen once on a plain I2C sketch, and once during the Wi-Fi sketch's boot.
- Never seen on blink, or on a Serial-only sketch.

At the moment of the hang both CPUs sit in `waiti` (idle), so this is not a firmware spin: tick and timer
interrupts stop arriving in time.

- With `-icount` (deterministic time) the resets disappear.
- With the shim's watchdog switch-off (TG0/TG1 `WDTCONFIG0 = 0` at start-up and in `initVariant()`) the
  same sketch ran 2 × 12 s with **0 resets** and 94 to 106 readings.

The root cause is not found. Candidates are timer or interrupt delivery to the idle second core in the
fork, and host scheduling: the guest clock follows the host clock, so any host stall counts against the
300 ms interrupt-watchdog timeout. The fork has had no ESP32 UART, interrupt-controller or timer changes
since this release (recent activity is mostly RISC-V chips). The trade-off of the workaround is that a
sketch that really hangs is no longer reset; the app has to notice that nothing progresses.

### 6.5 Time model
In the default mode the guest clock **is** the host clock (real-time factor 1.000). This has consequences:

- The board cannot be slowed down or sped up like the AVR runtime's `run(dt)`.
- Pause is QMP `stop`.
- The CPU runs 1.5 to 2× faster than the real chip, so busy-loop timings differ. `delay()`, `millis()` and
  timers stay correct.
- `-icount` makes time deterministic, which is good for headless tests: 9.2× real time on an idle-heavy
  sketch with `sleep=off`. But it boots in 3 to 11 s, so it does not suit the live UI.

## 7. I2C and SPI to the app's device models (`src/emu/devices`)

The app's models talk bytes: `connect(addr, write)`, `write(b)`, `read(ack)`, `stop()`, plus `transfer(b)`
for SPI. Two designs:

**A. Firmware shim replaces the I2C HAL (no QEMU fork).** `esp32-hal-i2c.c` symbols are *not* weak.
However, if the shim defines every function that `Wire.cpp` uses (`i2cInit`, `i2cDeinit`, `i2cIsInit`,
`i2cWrite`, `i2cRead`, `i2cWriteReadNonStop`, `i2cSetClock`, `i2cGetClock`), the archive member is never
pulled in. Transactions then go over UART1 as request/response frames:

- Writes need no reply.
- Reads block the calling task for one host round trip, which is under 1 ms locally.

Estimate: 3 days for I2C and about 3 more for SPI (`spiTransfer*`). The risk is that it breaks whenever the
core's HAL changes (3.0 → 3.3 already changed it), so it needs a test per core version.

**B. A bridge device in our QEMU build.** An `i2c-slave` device ("jollof-i2c-bridge") on I2C0/I2C1 that
forwards `event`/`send`/`recv` to a chardev, and the same for SSI.

- Reads are synchronous inside the vCPU's register write, so each read byte costs one round trip.
  Write-mostly devices (SSD1306, LCD) are fast; register reads (BMP280, MPU6050) take a few bytes per sample.
- The bridge stays a thin, generic, published GPL transport. The device logic stays in our JS models.

Estimate: 3 to 4 days per bus, on top of the build CI from 6.2. B is the cleaner long-term route if we build
QEMU ourselves anyway. A is the route if we stay on Espressif's binaries.

## 8. Wi-Fi

- Espressif's QEMU has no Wi-Fi radio model, and Arduino's Wi-Fi stack crashes on the first `WiFi.mode()`.
- The fork does emulate an Ethernet MAC (`open_eth`, with `-nic user,model=open_eth`). But ESP-IDF only
  drives it when built with `CONFIG_ETH_USE_OPENETH`, and the precompiled arduino-esp32 libraries have it
  **disabled** (`# CONFIG_ETH_USE_OPENETH is not set`).
- Making `WiFi.h` sketches work would need a fake Wi-Fi library on the firmware side (STA/AP state, lwIP over
  a host tunnel). That is more than 2 weeks of work, so it is out of scope.

Consequence for the app: **the existing simulated Wi-Fi sandbox (interpreter mode) stays the way to run
Wi-Fi sketches.** ESP32 faithful mode must detect `#include <WiFi.h>` (also `WebServer.h`, `HTTPClient.h`,
`WiFiClient*.h`, `esp_now.h`, `BluetoothSerial.h`) and stay in interpreter mode with a clear message,
instead of showing a boot loop.

## 9. Licensing

- **QEMU (Espressif fork) is GPL-2.0.** Espressif's files are "GPL-2.0 or later", and some upstream files
  carry other GPL-compatible licenses. It stays a **separate executable** started with
  `spawn`/`Command`. It talks to the app only through documented interfaces: command-line arguments, stdio,
  QMP JSON, and chardev sockets. The FSF treats pipes and sockets between programs as communication between
  separate programs, so shipping QEMU next to the app is *mere aggregation*. That holds for the AGPL free
  edition and the commercial Pro edition alike. Rules to keep:
  - never link QEMU code or headers into the Rust or JS side;
  - never copy QEMU code into the app;
  - keep any QEMU patches (GPIO model, I2C/SPI bridges) generic transports, published under GPL. They
    cannot be Pro-only features. Put the valuable logic (device models, UI) in the app.
- **Distributing the QEMU binary** follows GPL-2 §3:
  - ship the GPL text;
  - ship the *complete corresponding source* of the exact build: the fork's commit, our patches, and the
    build scripts and CI configuration;
  - either put the source next to each binary on the same download page (simplest, §3 last paragraph), or
    include a written offer valid for 3 years. §3(c) is not usable for commercial distribution.
  - The Pro EULA must state that the QEMU component is under the GPL and is not restricted by the EULA.
  - `THIRD_PARTY.md` and `scripts/licenses.mjs` must list it.
- **Bundled libraries** in Espressif's build: libgcrypt and libgpg-error (LGPL-2.1+), libintl (LGPL-2.1+),
  pixman (MIT), SDL2 (zlib), glib (LGPL-2.1+, static). Our own build should drop SDL2/libintl. LGPL
  libraries are fine when dynamically linked, or statically linked inside the GPL QEMU with source
  available.
- **ESP32 ROM images** (`esp32-v3-rom.bin`) are Espressif's own closed ROM code, shipped in the fork's
  `pc-bios/`. Espressif publishes the same ROMs as ELF files under **Apache-2.0** (`esp-rom-elfs`). Confirm
  the redistribution terms for the `.bin` with Espressif before shipping, and include the Apache-2.0 notice.
- **arduino-esp32 core and ESP-IDF** (LGPL-2.1 core, Apache-2.0 IDF, binary Wi-Fi blobs) are downloaded by
  arduino-cli on the user's machine, as they are today for uploads. We do not redistribute them.
- **The shim is compiled into the user's firmware.** It currently carries the repository's AGPL header. The
  emulator-only firmware is never distributed, so this is harmless in practice. It would still be cleaner to
  license this one file permissively (MIT or 0BSD); the copyright holder can do that. Decision needed.
- Velxio (AGPL) was not consulted, and no simulator code was reused.

## 10. App size and integration impact

- **Installer:** add about 22 MB uncompressed per macOS architecture with Espressif's build (19.4 MB binary,
  0.9 MB ESP32 ROMs, about 1.9 MB of libraries). That is about 4 to 5 MB compressed, or twice that for a
  universal macOS build. Windows: Espressif's package is 34.7 MB compressed, and our own minimal build
  should be smaller. For comparison, the app's web bundle (`dist`) is 17 MB.
  - Alternative: **download QEMU on first use** of ESP32 faithful mode, like the board core. The installer
    stays unchanged, and the GPL source sits on the same download page.
- **First use:** the 1.1 to 1.8 GB board core download dwarfs everything. It is already needed today to
  upload to a real ESP32.
- **Changes needed outside this prototype** (not made here, since these files were out of scope):
  - `src-tauri/src/lib.rs` `check_cli_args_in`: accept the FQBN `esp32:esp32:esp32:FlashMode=dio`. The
    current `fqbn` check rejects `=`; allowlist this exact string.
  - `read_build`: allow `merged.bin` (today it allows only `jollof_sketch.ino.bin`, the app partition).
    Alternatively, assemble the image from bootloader + partitions + `boot_app0` + app.
  - `write_sketch`: write `jollof_qemu_shim.cpp` next to the `.ino`.
  - New Rust side for the sidecar: spawn, own the sockets (the webview cannot open TCP), stream UART0, the
    side-channel and the trace to the webview over a `tauri::ipc::Channel`. Accept only a fixed set of QMP
    commands (`stop`, `cont`, `system_reset`, `qom-set` on known device paths). The webview must never be
    able to pass QEMU arguments.
  - New JS backend `src/emu/esp32.js` with the same interface as `src/emu/avr.js`. Mapping:

    | Interface | ESP32 / QEMU source |
    |---|---|
    | `pins` records `{ mode, d, pwm, freq }` | shim and trace events, keyed by the esp32 profile's keys (D2, D4, VP…) through GPIO numbers |
    | `run(dt)` | drains queued events and pushes changed inputs (`hw.read`) and ADC values (`A`) to the shim. QEMU runs by itself, so there is no stepping. |
    | `clock()` | last virtual µs from the shim, plus elapsed host time |
    | `takeSerial` / `send` | UART0 |
    | `state` / `error` | process exit, "Guru Meditation" and reset lines parsed from UART0 |
    | pause | QMP `stop` / `cont` |
    | modules | `attachDevices` gets `ctx.i2c.setHandler` / `ctx.spiBus` from the bridge of section 7 |

## 11. Effort estimate for a production integration (one developer)

| Piece | Days |
|---|---|
| Our own build of the fork in CI (macOS x64 and arm64, Windows x64, Linux x64 and arm64), minimal dependencies, signing and notarization (`allow-jit`), published source tarball | 4 to 6 |
| Tauri sidecar bridge (Rust): process lifecycle, sockets, event channel, QMP allowlist | 2 to 3 |
| Compile pipeline: DIO FQBN, shim injection, merged image (the `src-tauri` changes from section 10) | 1 |
| `src/emu/esp32.js` runtime (interface above), panic and reset detection, messages, `EMULATED` entry | 3 to 4 |
| Shim hardening: `attachInterruptArg`, `analogReadMilliVolts`, `touchRead`, `ledcWrite` mirroring, tests | 2 |
| PWM, servo and `tone` from LEDC (trace decoder from the prototype, or a fork GPIO/LEDC model) | 1 to 2 |
| Stability: watchdog workaround, soak tests on Windows, Linux and Apple Silicon (untested here) | 2 to 3 |
| **MVP subtotal**: blink, Serial, inputs, ADC, interrupts, PWM, TMP105-only I2C, no Wi-Fi | **15 to 21 (3 to 4 weeks)** |
| GPIO model plus chardev pin protocol in the fork (replaces the trace) | 2 to 3 |
| I2C bridge to the JS models (design A or B, section 7) | 3 to 4 |
| SPI bridge to the JS models | 3 to 4 |
| **Parity with the Uno faithful mode's module set (except timed one-wire protocols)** | **+8 to 11** |
| Timed GPIO protocols (DHT, DS18B20, HC-SR04, IR) and RMT (WS2812) | weeks (needs a timing model in the fork); not recommended |
| Wi-Fi | not feasible with QEMU; keep the interpreter's sandbox |

## 12. Recommendation: GO WITH CONDITIONS

Real ESP32 firmware does run offline in a separate GPL process. The pieces needed for most beginner
projects already work in the prototype with no fork: boot, Serial, outputs, inputs, interrupts, ADC, PWM and
basic I2C. Timing and CPU cost are acceptable: about 1.5 s to `setup()`, 0.2 cores when idle, and a 2 ms
input round trip.

Conditions:

1. **Build and ship our own QEMU** (section 6.2). Espressif's macOS assets depend on Homebrew and one is
   mislabelled. Publish the full corresponding source with every binary (section 9).
2. **Always inject the shim**, and decide its license: permissive is recommended because it is linked into
   user firmware. It is required for inputs, ADC and interrupts and against spurious watchdog resets.
3. **Scope the first release as "ESP32 faithful (beta)":** no Wi-Fi or Bluetooth (route those sketches to
   the interpreter's Wi-Fi sandbox with a message), and I2C/SPI modules only once a bridge (section 7)
   exists. Until then, only the built-in TMP105 is available.
4. **Make the `src-tauri` allowlist and build-reading changes** from section 10, with tests. The webview must
   never control QEMU arguments.
5. **Re-run `scripts/esp32-qemu/trial.mjs all` on Apple Silicon, Windows and Linux,** and on the current core
   (3.3.x), before committing. Boot time, the watchdog issue and DIO behaviour must hold there too.

If condition 1 or 3 is unacceptable (no CI build of QEMU, or Wi-Fi is a must-have), the answer becomes
**NO-GO**. In that case ESP32 should stay interpreter-only, with the effort going to the RP2040 and AVR
faithful modes.
