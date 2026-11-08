# Jollof Studio — notice

Copyright (C) 2026 Mamadou Sarr

Jollof Studio is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version, **with the additional terms below**.

Jollof Studio is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Affero General Public License for more details. A copy is in the [LICENSE](LICENSE) file.

If you run a modified version of Jollof Studio on a server that other people use (for example a
school server or a website), section 13 of the license requires you to offer them the complete
source code of your version.

## Additional terms (section 7 of the GNU AGPL v3)

1. **Attribution — section 7(b).** Every copy, every modified version and every work based on
   Jollof Studio must keep:
   - the notice `Copyright (C) 2026 Mamadou Sarr` in the source files and in the Appropriate
     Legal Notices of the program;
   - the attribution **“Based on Jollof Studio by Mamadou Sarr”**, with a link to the original
     project, displayed in the Appropriate Legal Notices shown to users (in Jollof Studio:
     Documentation → Crédits et licences).
2. **Marking modified versions — section 7(c).** A modified version must be marked as different
   from the original and must not present itself as the official Jollof Studio.
3. **Trademarks — section 7(e).** This license grants no right to use the name “Jollof Studio”,
   its logo or its icons as trademarks. A modified version is distributed under another name,
   unless Mamadou Sarr gives written permission.

## Additional permission for the ESP32 emulator shim (section 7 of the GNU AGPL v3)

`src/emu/esp32-shim/jollof_qemu_shim.cpp` is compiled into the user's own Arduino program when it runs in the
ESP32 faithful mode. Its header grants an additional permission, in the spirit of the GCC Runtime Library
Exception: compiling this file and linking it with any program (an Arduino sketch, its libraries, the ESP32 core)
does not by itself cause that program to be covered by the GNU AGPL. The file itself stays under the AGPL.

## ESP32 emulator (QEMU)

The ESP32 faithful mode runs Espressif's fork of QEMU (GNU GPL version 2) as a **separate program**, downloaded on
first use; Jollof Studio is not linked with it and talks to it only through local sockets and its standard error
output. Each QEMU package carries its licence (COPYING, LICENSE), the exact source it was built from (SOURCE.md) and
the build script; the complete corresponding source is published next to the binaries
(`scripts/esp32-qemu/build-qemu.sh`, `.github/workflows/qemu-esp32.yml`).

## Commercial licence

The copyright holder also offers Jollof Studio under a separate commercial licence, for those who
cannot meet the AGPL (for example to keep their changes private or to ship it inside a closed
product). See [COMMERCIAL.md](COMMERCIAL.md).

Contributions are accepted under the Contributor License Agreement in [CLA.md](CLA.md), which keeps
this dual licensing possible.

## Third-party components

Jollof Studio includes components from other authors under their own licences (MIT, Apache-2.0,
LGPL-2.1, CC-BY-SA-4.0, SIL OFL 1.1…). They are listed in [THIRD_PARTY.md](THIRD_PARTY.md) and in
the application (Documentation → Crédits et licences).

---

*Draft prepared with an AI assistant. Have a lawyer review this notice, the additional terms,
COMMERCIAL.md and CLA.md before relying on them.*
