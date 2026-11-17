// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fonctions du cœur arduino-esp32 et de la bibliothèque OneWire remplacées par la cale du mode fidèle
// (src/emu/esp32-shim/jollof_qemu_shim.cpp, fonctions __wrap_…) à l'édition des liens. Fichier léger, partagé par
// la compilation de l'application (src/emu/compile.js) et celle des tests (src/emu/testkit.mjs) ; la commande
// arduino-cli correspondante est vérifiée côté Rust (src-tauri/src/lib.rs : une liste de --wrap, rien d'autre).
const I2C = ['i2cWrite', 'i2cRead', 'i2cWriteReadNonStop'];
const SPI = ['spiWriteByteNL', 'spiWriteByte', 'spiWriteShortNL', 'spiWriteWord', 'spiWriteLongNL', 'spiWriteLong', 'spiWriteNL', 'spiWrite',
  'spiWritePixelsNL', 'spiTransferByteNL', 'spiTransferByte', 'spiTransferShortNL', 'spiTransferWord', 'spiTransferLongNL', 'spiTransferLong',
  'spiTransferBytesNL', 'spiTransferBytes', 'spiTransfer', 'spiTransferBitsNL', 'spiTransferBits'];
const RMT = ['rmtInit', 'rmtDeinit', 'rmtSetEOT', 'rmtSetCarrier', 'rmtTransmitCompleted', 'rmtWrite', 'rmtWriteAsync', 'rmtWriteLooping'];
const UART = ['_testUartBegin', 'uartBegin', 'uartEnd', 'uartAvailable', 'uartAvailableForWrite', 'uartReadBytes', 'uartRead', 'uartPeek', 'uartWrite',
  'uartWriteBuf', 'uartFlush', 'uartFlushTxOnly', 'uartSetBaudRate', 'uartGetBaudRate', 'uartSetRxInvert', 'uartSetRxTimeout', 'uartSetRxFIFOFull',
  'uartIsDriverInstalled', 'uartSetPins', 'uart_get_RxPin', 'uart_get_TxPin', 'uartGetEventQueue', 'uartSetHwFlowCtrlMode', 'uartSetMode',
  'uartSetDebug', 'uartStartDetectBaudrate', 'uartDetectBaudrate'];
// OneWire (Paul Stoffregen, 2.3.x) : méthodes publiques, noms C++ décorés.
const ONEWIRE = ['_ZN7OneWire5resetEv', '_ZN7OneWire5writeEhh', '_ZN7OneWire11write_bytesEPKhtb', '_ZN7OneWire4readEv', '_ZN7OneWire10read_bytesEPht',
  '_ZN7OneWire6selectEPKh', '_ZN7OneWire4skipEv', '_ZN7OneWire9write_bitEh', '_ZN7OneWire8read_bitEv', '_ZN7OneWire7depowerEv',
  '_ZN7OneWire12reset_searchEv', '_ZN7OneWire13target_searchEh', '_ZN7OneWire6searchEPhb'];

// Temps : delayMicroseconds() compte pour les modules ce qui est demandé, pas ce que QEMU met à le faire ; micros() et
// millis() lus par le programme gardent le temps réel entre deux gestes sur les broches reliées.
const TIME = ['delayMicroseconds', 'micros', 'millis'];

export const ESP32_WRAPS = [...I2C, ...SPI, ...RMT, ...UART, ...ONEWIRE, ...TIME];
/** Propriété de compilation ajoutée à arduino-cli (--build-property) : build.extra_libs est vide dans le cœur esp32. */
export const ESP32_LINK_PROPERTY = 'build.extra_libs=-Wl,' + ESP32_WRAPS.map(s => '--wrap=' + s).join(',');
