// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ce que le simulateur sait exécuter d'un programme Arduino : fonctions du cœur,
// constantes, classes des bibliothèques. Le compilateur s'en sert pour vérifier le
// code et connaître le type des valeurs, l'exécuteur (runtime.js) les implémente.

/** Types de retour : void, bool, char, float, str, any, i8 u8 i16 u16 i32 u32 i64, arg0 (type du 1er argument), num. */
import { tl } from '../i18n/index.js';
const f = (args, ret, o = {}) => ({ args, ret, ...o });
const MATH1 = ['sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'log10', 'fabs', 'floor', 'ceil', 'trunc'];

/**
 * Fonctions du cœur Arduino. args : nombre exact, ou [min, max]. block : peut suspendre le programme.
 * raw : l'argument peut être un tableau (makeKeymap).
 */
export const FN = {
  pinMode: f(2, 'void'), digitalWrite: f(2, 'void'), digitalRead: f(1, 'int'),
  analogRead: f(1, 'int'), analogWrite: f(2, 'void'),
  analogReadResolution: f(1, 'void'), analogWriteResolution: f(1, 'void'), analogSetAttenuation: f(1, 'void'), analogReference: f(1, 'void'),
  delay: f(1, 'void', { block: true }), delayMicroseconds: f(1, 'void', { block: true }), yield: f(0, 'void', { block: true }),
  millis: f(0, 'u32'), micros: f(0, 'u32'),
  tone: f([2, 3], 'void'), noTone: f(1, 'void'), pulseIn: f([2, 3], 'u32', { wait: true }), pulseInLong: f([2, 3], 'u32', { wait: true }),
  map: f(5, 'i32'), constrain: f(3, 'arg0'), min: f(2, 'num'), max: f(2, 'num'), abs: f(1, 'arg0'), sq: f(1, 'arg0'),
  ...Object.fromEntries(MATH1.map(n => [n, f(1, 'float')])),
  pow: f(2, 'float'), atan2: f(2, 'float'), fmod: f(2, 'float'), hypot: f(2, 'float'),
  round: f(1, 'i32'), isnan: f(1, 'bool'), isinf: f(1, 'bool'),
  random: f([1, 2], 'i32'), randomSeed: f(1, 'void'),
  bit: f(1, 'u32'), bitRead: f(2, 'int'), highByte: f(1, 'u8'), lowByte: f(1, 'u8'),
  // bitWrite, bitSet, bitClear modifient leur premier argument : traités à part par le compilateur.
  bitWrite: f(3, 'void', { lvalue: true }), bitSet: f(2, 'void', { lvalue: true }), bitClear: f(2, 'void', { lvalue: true }),
  attachInterrupt: f(3, 'void'), detachInterrupt: f(1, 'void'), digitalPinToInterrupt: f(1, 'int'),
  interrupts: f(0, 'void'), noInterrupts: f(0, 'void'),
  F: f(1, 'str'),
  isDigit: f(1, 'bool'), isAlpha: f(1, 'bool'), isAlphaNumeric: f(1, 'bool'), isSpace: f(1, 'bool'),
  isUpperCase: f(1, 'bool'), isLowerCase: f(1, 'bool'), isPunct: f(1, 'bool'),
  ledcSetup: f(3, 'u32'), ledcAttachPin: f(2, 'void'), ledcAttach: f([2, 3], 'bool'), ledcWrite: f(2, 'void'), ledcWriteTone: f(2, 'void'), ledcDetachPin: f(1, 'void'),
  // ESP32 : convertisseur numérique-analogique (broches 25 et 26), entrées tactiles, lecture en millivolts.
  dacWrite: f(2, 'void'), touchRead: f(1, 'u16'), analogReadMilliVolts: f(1, 'u32'),
  // Keypad.h : makeKeymap(touches) rend le tableau des touches tel quel.
  makeKeymap: f(1, 'any', { raw: true }),
  // IRremote : protocoles décodés, affichés sur le port série donné (&Serial).
  printActiveIRProtocols: f(1, 'void', { raw: true }),
  // Copie d'octets : memcpy(&valeur, donnees, sizeof(valeur)) (réception ESP-NOW), memset(tableau, 0, n).
  memcpy: f(3, 'void', { raw: true, ref: [0, 1] }), memset: f(3, 'void', { raw: true, ref: [0] }),
  // ESP-NOW (esp_now.h sur ESP32, espnow.h sur ESP8266) : messages directs entre cartes, sans point d'accès.
  esp_now_init: f(0, 'int'), esp_now_deinit: f(0, 'int'), esp_now_add_peer: f([1, 5], 'int', { raw: true }), esp_now_del_peer: f(1, 'int', { raw: true }),
  esp_now_is_peer_exist: f(1, 'bool', { raw: true }), esp_now_send: f(3, 'int', { raw: true, ref: [1] }),
  esp_now_register_send_cb: f(1, 'int', { raw: true }), esp_now_register_recv_cb: f(1, 'int', { raw: true }),
  esp_now_unregister_send_cb: f(0, 'int'), esp_now_unregister_recv_cb: f(0, 'int'), esp_now_set_self_role: f(1, 'int'),
  esp_now_recv_cb_t: f(1, 'any', { raw: true }), esp_now_send_cb_t: f(1, 'any', { raw: true })
};

/** Constantes communes à toutes les cartes. */
export const CONSTS = {
  HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3,
  CHANGE: 1, FALLING: 2, RISING: 3, NOT_AN_INTERRUPT: -1,
  DEC: 10, HEX: 16, OCT: 8, BIN: 2, LSBFIRST: 0, MSBFIRST: 1,
  PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EULER: Math.E,
  NULL: 0, nullptr: 0,
  DHT11: 11, DHT21: 21, DHT22: 22, AM2301: 21,
  SSD1306_SWITCHCAPVCC: 2, SSD1306_EXTERNALVCC: 1, SSD1306_WHITE: 1, SSD1306_BLACK: 0, SSD1306_INVERSE: 2, WHITE: 1, BLACK: 0, INVERSE: 2,
  NEO_GRB: 0x52, NEO_RGB: 0x06, NEO_GRBW: 0xd2, NEO_RGBW: 0xc6, NEO_KHZ800: 0, NEO_KHZ400: 0x100,
  SERIAL_8N1: 0x800001c,
  MPU6050_RANGE_2_G: 0, MPU6050_RANGE_4_G: 1, MPU6050_RANGE_8_G: 2, MPU6050_RANGE_16_G: 3,
  MPU6050_RANGE_250_DEG: 0, MPU6050_RANGE_500_DEG: 1, MPU6050_RANGE_1000_DEG: 2, MPU6050_RANGE_2000_DEG: 3,
  MPU6050_BAND_260_HZ: 0, MPU6050_BAND_184_HZ: 1, MPU6050_BAND_94_HZ: 2, MPU6050_BAND_44_HZ: 3, MPU6050_BAND_21_HZ: 4, MPU6050_BAND_10_HZ: 5, MPU6050_BAND_5_HZ: 6,
  ADC_11db: 3, ADC_6db: 2, ADC_2_5db: 1, ADC_0db: 0,
  // DallasTemperature : valeurs rendues quand la sonde ne répond pas.
  DEVICE_DISCONNECTED_C: -127, DEVICE_DISCONNECTED_F: -196.6, DEVICE_DISCONNECTED_RAW: -7040,
  // IRremote (v4) : retour de la LED de la carte, drapeaux et protocole des trames décodées.
  ENABLE_LED_FEEDBACK: 1, DISABLE_LED_FEEDBACK: 0, USE_DEFAULT_FEEDBACK_LED_PIN: 0,
  IRDATA_FLAGS_IS_REPEAT: 1, IRDATA_FLAGS_IS_AUTO_REPEAT: 2, IRDATA_FLAGS_PARITY_FAILED: 4, UNKNOWN: 0, NEC: 8,
  // Keypad : aucune touche, états d'une touche.
  NO_KEY: 0, IDLE: 0, PRESSED: 1, HOLD: 2, RELEASED: 3,
  // RF24 : puissance d'émission, débit, contrôle d'erreur.
  RF24_PA_MIN: 0, RF24_PA_LOW: 1, RF24_PA_HIGH: 2, RF24_PA_MAX: 3, RF24_PA_ERROR: 4,
  RF24_1MBPS: 0, RF24_2MBPS: 1, RF24_250KBPS: 2, RF24_CRC_DISABLED: 0, RF24_CRC_8: 1, RF24_CRC_16: 2,
  // Wi-Fi (ESP32, ESP8266) : modes, états de la connexion, sécurité des réseaux trouvés.
  WIFI_OFF: 0, WIFI_STA: 1, WIFI_AP: 2, WIFI_AP_STA: 3, WIFI_MODE_STA: 1, WIFI_MODE_AP: 2, WIFI_MODE_APSTA: 3,
  WL_NO_SHIELD: 255, WL_IDLE_STATUS: 0, WL_NO_SSID_AVAIL: 1, WL_SCAN_COMPLETED: 2, WL_CONNECTED: 3, WL_CONNECT_FAILED: 4, WL_CONNECTION_LOST: 5, WL_DISCONNECTED: 6,
  WIFI_AUTH_OPEN: 0, WIFI_AUTH_WPA2_PSK: 3, ENC_TYPE_NONE: 7, ENC_TYPE_CCMP: 4,
  // Serveur web : méthodes HTTP ; client HTTP : codes de retour (négatifs : erreur de connexion).
  HTTP_ANY: 0, HTTP_GET: 1, HTTP_HEAD: 2, HTTP_POST: 3, HTTP_PUT: 4, HTTP_PATCH: 5, HTTP_DELETE: 6, HTTP_OPTIONS: 7,
  HTTP_CODE_OK: 200, HTTP_CODE_MOVED_PERMANENTLY: 301, HTTP_CODE_FOUND: 302, HTTP_CODE_BAD_REQUEST: 400, HTTP_CODE_NOT_FOUND: 404, HTTP_CODE_INTERNAL_SERVER_ERROR: 500,
  HTTPC_ERROR_CONNECTION_REFUSED: -1, HTTPC_ERROR_SEND_HEADER_FAILED: -2, HTTPC_ERROR_SEND_PAYLOAD_FAILED: -3, HTTPC_ERROR_NOT_CONNECTED: -4,
  HTTPC_ERROR_CONNECTION_LOST: -5, HTTPC_ERROR_NO_STREAM: -6, HTTPC_ERROR_NO_HTTP_SERVER: -7, HTTPC_ERROR_TOO_LESS_RAM: -8,
  HTTPC_ERROR_ENCODING: -9, HTTPC_ERROR_STREAM_WRITE: -10, HTTPC_ERROR_READ_TIMEOUT: -11, CONTENT_LENGTH_UNKNOWN: -1,
  // ESP-NOW : codes d'erreur et état d'un envoi ; rôles de l'ESP8266.
  ESP_OK: 0, ESP_FAIL: -1, ESP_ERR_WIFI_NOT_INIT: 0x3001, ESP_ERR_ESPNOW_NOT_INIT: 0x3065, ESP_ERR_ESPNOW_ARG: 0x3066, ESP_ERR_ESPNOW_NOT_FOUND: 0x3069, ESP_ERR_ESPNOW_EXIST: 0x306a,
  ESP_NOW_SEND_SUCCESS: 0, ESP_NOW_SEND_FAIL: 1, ESP_NOW_MAX_DATA_LEN: 250, ESP_NOW_ETH_ALEN: 6,
  ESP_NOW_ROLE_IDLE: 0, ESP_NOW_ROLE_CONTROLLER: 1, ESP_NOW_ROLE_SLAVE: 2, ESP_NOW_ROLE_COMBO: 3,
  // Bluetooth (BluetoothSerial) : rôle de la carte.
  ESP_SPP_ROLE_MASTER: 0, ESP_SPP_ROLE_SLAVE: 1
};
/** Types des constantes non entières (les autres sont des int). */
export const CONST_TYPES = { PI: 'float', HALF_PI: 'float', TWO_PI: 'float', DEG_TO_RAD: 'float', RAD_TO_DEG: 'float', EULER: 'float', DEVICE_DISCONNECTED_F: 'float' };

/**
 * Constantes propres à chaque carte : numéros des entrées analogiques, LED intégrée.
 * Sur l'ESP8266, D0…D8 désignent les broches de la NodeMCU.
 */
export const BOARD_CONSTS = {
  uno: { LED_BUILTIN: 13, A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, SDA: 18, SCL: 19, SS: 10, MOSI: 11, MISO: 12, SCK: 13 },
  nano: { LED_BUILTIN: 13, A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, A6: 20, A7: 21, SDA: 18, SCL: 19, SS: 10, MOSI: 11, MISO: 12, SCK: 13 },
  esp32: {
    LED_BUILTIN: 2, A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, SDA: 21, SCL: 22, SS: 5, MOSI: 23, MISO: 19, SCK: 18, TX: 1, RX: 3,
    T0: 4, T1: 0, T2: 2, T3: 15, T4: 13, T5: 12, T6: 14, T7: 27, T8: 33, T9: 32, DAC1: 25, DAC2: 26
  },
  nodemcu: { LED_BUILTIN: 2, D0: 16, D1: 5, D2: 4, D3: 0, D4: 2, D5: 14, D6: 12, D7: 13, D8: 15, A0: 17, RX: 3, TX: 1, SDA: 4, SCL: 5 },
  pico: { LED_BUILTIN: 25, A0: 26, A1: 27, A2: 28, SDA: 4, SCL: 5 },
  // ESP32-S3 (variante esp32s3 du cœur arduino-esp32) : LED_BUILTIN désigne la LED RVB de la carte (48 + nombre de GPIO),
  // A0 à A19 = GPIO 1 à 20, entrées tactiles T1 à T14 = GPIO 1 à 14.
  esp32s3: {
    LED_BUILTIN: 97, RGB_BUILTIN: 97, TX: 43, RX: 44, SDA: 8, SCL: 9, SS: 10, MOSI: 11, MISO: 13, SCK: 12,
    ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`A${i}`, i + 1])), ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`T${i + 1}`, i + 1]))
  },
  // ESP32-C3 SuperMini (variante nologo_esp32c3_super_mini) : LED bleue sur GPIO 8.
  esp32c3: { LED_BUILTIN: 8, TX: 21, RX: 20, SDA: 8, SCL: 9, SS: 7, MOSI: 6, MISO: 5, SCK: 4, A0: 0, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 },
  mega: {
    LED_BUILTIN: 13, ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`A${i}`, 54 + i])),
    SDA: 20, SCL: 21, SS: 53, MOSI: 51, MISO: 50, SCK: 52
  }
};
/** Taille de int selon la carte : 16 bits sur les AVR, 32 bits ailleurs. */
export const INT_BITS = { uno: 16, nano: 16, mega: 16 };
/**
 * Cartes AVR : numéro de A0 (analogRead(0) lit A0), nombre d'entrées analogiques, broches des interruptions externes
 * dans l'ordre de leur numéro (attachInterrupt(0, …) : la première) et taille de l'EEPROM en octets.
 */
export const AVR_INFO = {
  uno: { a0: 14, an: 8, irq: [2, 3], ee: 1024 },
  nano: { a0: 14, an: 8, irq: [2, 3], ee: 1024 },
  mega: { a0: 54, an: 16, irq: [2, 3, 21, 20, 19, 18], ee: 4096 }
};


/**
 * Classes des bibliothèques simulées : méthodes et type de leur résultat.
 * block : la méthode suspend le programme (Stepper.step tourne pendant un moment).
 * ref : indices des arguments passés par adresse (&valeur, tableau) que la méthode lit ou remplit
 *       (radio.read(&donnee, sizeof(donnee)), getTextBounds(…, &x1, &y1, &l, &h)).
 * field : champ de l'objet (pas une méthode), avec son type : IrReceiver.decodedIRData.command.
 * static : méthode de la classe, appelée par Classe::methode(…) (ESP32PWM::allocateTimer(0)).
 */
const m = (ret, o = {}) => ({ ret, ...o });
const fd = t => ({ field: t });
const PRINT = { print: m('u32', { print: true }), println: m('u32', { print: true }), write: m('u32') };
const SERIAL = {
  begin: m('void'), end: m('void'), ...PRINT, printf: m('u32'), available: m('int'), read: m('int'), peek: m('int'),
  readString: m('str'), readStringUntil: m('str'), parseInt: m('i32'), parseFloat: m('float'), flush: m('void'), setTimeout: m('void'),
  availableForWrite: m('int')
};
const GFX = {
  begin: m('bool'), clearDisplay: m('void'), display: m('void'), setTextSize: m('void'), setTextColor: m('void'), setCursor: m('void'),
  ...PRINT, drawPixel: m('void'), drawLine: m('void'), drawFastHLine: m('void'), drawFastVLine: m('void'), drawRect: m('void'), fillRect: m('void'),
  drawRoundRect: m('void'), fillRoundRect: m('void'), drawCircle: m('void'), fillCircle: m('void'), drawTriangle: m('void'), fillTriangle: m('void'),
  invertDisplay: m('void'), width: m('i16'), height: m('i16'), setRotation: m('void'), cp437: m('void'), dim: m('void'), setTextWrap: m('void'),
  fillScreen: m('void'), getCursorX: m('i16'), getCursorY: m('i16'),
  drawBitmap: m('void'), drawXBitmap: m('void'), drawChar: m('void'), getTextBounds: m('void', { ref: [3, 4, 5, 6] })
};
export const CLASSES = {
  HardwareSerial: SERIAL,
  SoftwareSerial: { ...SERIAL, listen: m('bool'), isListening: m('bool') },
  TwoWire: { begin: m('void'), setClock: m('void'), setPins: m('bool'), beginTransmission: m('void'), endTransmission: m('u8'), requestFrom: m('u8'), available: m('int'), read: m('int'), peek: m('int'), write: m('u32') },
  SPIClass: { begin: m('void'), end: m('void'), transfer: m('u8'), transfer16: m('u16'), beginTransaction: m('void'), endTransaction: m('void') },
  DHT: { begin: m('void'), readTemperature: m('float'), readHumidity: m('float'), computeHeatIndex: m('float'), convertCtoF: m('float'), convertFtoC: m('float'), read: m('bool') },
  OneWire: { reset: m('u8'), search: m('bool'), reset_search: m('void'), crc8: m('u8'), select: m('void'), skip: m('void'), write: m('void'), read: m('u8') },
  DallasTemperature: {
    begin: m('void'), requestTemperatures: m('void', { block: true }), requestTemperaturesByIndex: m('void', { block: true }), requestTemperaturesByAddress: m('void', { block: true }),
    getTempCByIndex: m('float'), getTempFByIndex: m('float'), getTempC: m('float'), getTempF: m('float'), getAddress: m('bool'), getDeviceCount: m('u8'), getDS18Count: m('u8'),
    setResolution: m('void'), getResolution: m('u8'), setWaitForConversion: m('void'), getWaitForConversion: m('bool'), isConversionComplete: m('bool'),
    millisToWaitForConversion: m('i16'), isParasitePowerMode: m('bool'), validAddress: m('bool'), isConnected: m('bool'),
    toFahrenheit: m('float', { static: true }), toCelsius: m('float', { static: true })
  },
  Adafruit_BMP280: { begin: m('bool'), readTemperature: m('float'), readPressure: m('float'), readAltitude: m('float'), setSampling: m('void'), sensorID: m('u32'), takeForcedMeasurement: m('bool'), getStatus: m('u8') },
  Adafruit_BME280: {
    begin: m('bool'), readTemperature: m('float'), readPressure: m('float'), readHumidity: m('float'), readAltitude: m('float'), seaLevelForAltitude: m('float'),
    setSampling: m('void'), sensorID: m('u32'), takeForcedMeasurement: m('bool'), setTemperatureCompensation: m('void'), getTemperatureCompensation: m('float')
  },
  BH1750: { begin: m('bool'), configure: m('bool'), setMTreg: m('bool'), measurementReady: m('bool'), readLightLevel: m('float') },
  // HX711 (bibliothèque de Bogdan Necula) : 10 mesures par seconde ; une lecture attend la suivante si elle n'est pas prête.
  HX711: {
    begin: m('void'), is_ready: m('bool'), wait_ready: m('void', { block: true }), wait_ready_retry: m('bool', { block: true }), wait_ready_timeout: m('bool', { block: true }),
    set_gain: m('void'), read: m('i32', { block: true }), read_average: m('i32', { block: true }), get_value: m('float', { block: true }), get_units: m('float', { block: true }),
    tare: m('void', { block: true }), set_scale: m('void'), get_scale: m('float'), set_offset: m('void'), get_offset: m('i32'), power_down: m('void'), power_up: m('void')
  },
  Adafruit_MPU6050: {
    begin: m('bool'), getEvent: m('bool'), setAccelerometerRange: m('void'), setGyroRange: m('void'), setFilterBandwidth: m('void'),
    getAccelerometerRange: m('u8'), getGyroRange: m('u8'), getFilterBandwidth: m('u8')
  },
  // MPU6050 (bibliothèque I2Cdev / Electronic Cats) : valeurs brutes 16 bits, passées par adresse.
  MPU6050: {
    initialize: m('void'), testConnection: m('bool'), getAcceleration: m('void', { ref: [0, 1, 2] }), getRotation: m('void', { ref: [0, 1, 2] }),
    getMotion6: m('void', { ref: [0, 1, 2, 3, 4, 5] }), getTemperature: m('i16'), getAccelerationX: m('i16'), getAccelerationY: m('i16'), getAccelerationZ: m('i16'),
    getRotationX: m('i16'), getRotationY: m('i16'), getRotationZ: m('i16'), setFullScaleAccelRange: m('void'), setFullScaleGyroRange: m('void'),
    getFullScaleAccelRange: m('u8'), getFullScaleGyroRange: m('u8'), setSleepEnabled: m('void')
  },
  LiquidCrystal_I2C: {
    init: m('void'), begin: m('void'), backlight: m('void'), noBacklight: m('void'), clear: m('void'), home: m('void'), setCursor: m('void'),
    ...PRINT, display: m('void'), noDisplay: m('void'), blink: m('void'), noBlink: m('void'), cursor: m('void'), noCursor: m('void'),
    createChar: m('void'), scrollDisplayLeft: m('void'), scrollDisplayRight: m('void'), setBacklight: m('void')
  },
  Adafruit_SSD1306: GFX,
  Servo: {
    attach: m('u8'), detach: m('void'), write: m('void'), writeMicroseconds: m('void'), read: m('i32'), readMicroseconds: m('i32'), attached: m('bool'),
    setPeriodHertz: m('void')
  },
  // ESP32Servo : réservation des minuteries de la PWM (sans effet dans le simulateur).
  ESP32PWM: { allocateTimer: m('void', { static: true }) },
  Adafruit_NeoPixel: {
    begin: m('void'), show: m('void'), clear: m('void'), setPixelColor: m('void'), getPixelColor: m('u32'), Color: m('u32'), ColorHSV: m('u32'), gamma32: m('u32'),
    fill: m('void'), setBrightness: m('void'), getBrightness: m('u8'), numPixels: m('u16'), setPin: m('void'), updateLength: m('void')
  },
  Stepper: { setSpeed: m('void'), step: m('void', { block: true }), version: m('i32') },
  sensors_event_t: {},
  // IRremote : IrReceiver (API v4) et IRrecv irrecv(broche) + decode(&results) (ancienne API).
  IRrecv: {
    begin: m('void'), enableIRIn: m('void'), decode: m('bool'), resume: m('void'), start: m('void'), stop: m('void'), isIdle: m('bool'),
    printIRResultShort: m('void'), printIRResultMinimal: m('void'), printIRSendUsage: m('void'), printIRResultRawFormatted: m('void'), decodedIRData: fd('IRData')
  },
  IRData: { command: fd('u16'), address: fd('u16'), protocol: fd('int'), flags: fd('u8'), decodedRawData: fd('u32'), numberOfBits: fd('u16') },
  decode_results: { value: fd('u32'), decode_type: fd('int'), bits: fd('int') },
  // MFRC522 : lecteur RFID en SPI.
  MFRC522: {
    PCD_Init: m('void'), PCD_Reset: m('void'), PCD_AntennaOn: m('void'), PCD_AntennaOff: m('void'), PCD_SetAntennaGain: m('void'), PCD_GetAntennaGain: m('u8'),
    PCD_PerformSelfTest: m('bool'), PCD_DumpVersionToSerial: m('void'), PCD_StopCrypto1: m('void'), PCD_SoftPowerDown: m('void'), PCD_SoftPowerUp: m('void'),
    PICC_IsNewCardPresent: m('bool'), PICC_ReadCardSerial: m('bool'), PICC_HaltA: m('u8'), PICC_GetType: m('u8'), PICC_GetTypeName: m('str'),
    PICC_DumpToSerial: m('void'), PICC_DumpDetailsToSerial: m('void'),
    PCD_Authenticate: m('u8'), MIFARE_Read: m('u8', { ref: [1, 2] }), MIFARE_Write: m('u8'), GetStatusCodeName: m('str'),
    uid: fd('Uid')
  },
  Uid: { size: fd('u8'), uidByte: fd('u8[]'), sak: fd('u8') },
  MIFARE_Key: { keyByte: fd('u8[]') },
  // Keypad : clavier matriciel.
  Keypad: {
    getKey: m('char'), waitForKey: m('char', { block: true }), getState: m('int'), isPressed: m('bool'), keyStateChanged: m('bool'),
    setDebounceTime: m('void'), setHoldTime: m('void'), numKeys: m('u8')
  },
  // RF24 : module radio nRF24L01.
  RF24: {
    begin: m('bool'), isChipConnected: m('bool'), openWritingPipe: m('void'), openReadingPipe: m('void'), closeReadingPipe: m('void'),
    setPALevel: m('void'), getPALevel: m('u8'), setChannel: m('void'), getChannel: m('u8'), setDataRate: m('bool'), getDataRate: m('u8'),
    setRetries: m('void'), setAutoAck: m('void'), setPayloadSize: m('void'), getPayloadSize: m('u8'), enableDynamicPayloads: m('void'),
    disableDynamicPayloads: m('void'), getDynamicPayloadSize: m('u8'), enableAckPayload: m('void'), setCRCLength: m('void'), setAddressWidth: m('void'),
    startListening: m('void'), stopListening: m('void'), write: m('bool', { ref: [0], block: true }), available: m('bool', { ref: [0] }),
    read: m('void', { ref: [0] }), powerUp: m('void'), powerDown: m('void'), flush_rx: m('void'), flush_tx: m('void'),
    testCarrier: m('bool'), testRPD: m('bool'), printDetails: m('void'), printPrettyDetails: m('void'), failureDetected: fd('bool')
  },
  // Mémoires qui survivent au redémarrage : EEPROM (1 Ko sur l'Uno, émulée en flash sur ESP : begin(taille) et commit()),
  // Preferences (ESP32 : clés rangées par espace de noms).
  EEPROMClass: {
    begin: m('bool'), read: m('u8'), write: m('void'), update: m('void'), get: m('any', { ref: [1] }), put: m('any', { ref: [1] }),
    length: m('u16'), commit: m('bool'), end: m('void')
  },
  Preferences: {
    begin: m('bool'), end: m('void'), clear: m('bool'), remove: m('bool'), isKey: m('bool'), freeEntries: m('u32'),
    putInt: m('u32'), putUInt: m('u32'), putLong: m('u32'), putULong: m('u32'), putShort: m('u32'), putUShort: m('u32'), putChar: m('u32'), putUChar: m('u32'),
    putFloat: m('u32'), putDouble: m('u32'), putBool: m('u32'), putString: m('u32'), putBytes: m('u32', { ref: [1] }),
    getInt: m('i32'), getUInt: m('u32'), getLong: m('i32'), getULong: m('u32'), getShort: m('i16'), getUShort: m('u16'), getChar: m('i8'), getUChar: m('u8'),
    getFloat: m('float'), getDouble: m('float'), getBool: m('bool'), getString: m('str'), getBytes: m('u32', { ref: [1] }), getBytesLength: m('u32')
  },
  // ESP32 : port série Bluetooth (SerialBT.begin("Nom")), vers le téléphone du panneau « Périphériques ».
  BluetoothSerial: { ...SERIAL, begin: m('bool'), connected: m('bool'), hasClient: m('bool'), setPin: m('bool'), disconnect: m('bool') },
  // Wi-Fi simulé : réseaux du panneau « Périphériques », aucun accès au vrai réseau.
  WiFiClass: {
    mode: m('bool'), getMode: m('int'), begin: m('int'), status: m('int'), isConnected: m('bool'), disconnect: m('bool'), reconnect: m('bool'),
    localIP: m('obj:IPAddress'), gatewayIP: m('obj:IPAddress'), subnetMask: m('obj:IPAddress'), dnsIP: m('obj:IPAddress'), softAPIP: m('obj:IPAddress'),
    macAddress: m('str'), softAPmacAddress: m('str'), RSSI: m('i32'), SSID: m('str'), BSSIDstr: m('str'), channel: m('i32'), encryptionType: m('int'),
    scanNetworks: m('i16', { block: true }), scanDelete: m('void'), softAP: m('bool'), softAPdisconnect: m('bool'), softAPgetStationNum: m('int'),
    config: m('bool'), setHostname: m('bool'), getHostname: m('str'), hostname: m('str'), setAutoReconnect: m('bool'), persistent: m('void'), setSleep: m('bool')
  },
  IPAddress: { toString: m('str'), fromString: m('bool') },
  MDNSResponder: { begin: m('bool'), end: m('void'), addService: m('void'), update: m('void') },
  // Serveur web d'une carte : le « Navigateur » du panneau « Périphériques » lui envoie ses requêtes.
  WebServer: {
    on: m('void'), onNotFound: m('void'), begin: m('void'), close: m('void'), stop: m('void'), handleClient: m('void', { block: true }),
    send: m('void'), send_P: m('void'), sendHeader: m('void'), sendContent: m('void'), setContentLength: m('void'),
    arg: m('str'), argName: m('str'), args: m('int'), hasArg: m('bool'), uri: m('str'), method: m('int'), header: m('str'), hasHeader: m('bool')
  },
  // Client HTTP : seuls répondent meteo.jollof, journal.jollof, heure.jollof et les serveurs web des cartes du montage.
  HTTPClient: {
    begin: m('bool'), end: m('void'), GET: m('int', { block: true }), POST: m('int', { block: true }), PUT: m('int', { block: true }),
    addHeader: m('void'), getString: m('str'), getSize: m('int'), errorToString: m('str'), setTimeout: m('void'), setConnectTimeout: m('void'), connected: m('bool')
  },
  WiFiClient: { stop: m('void'), connected: m('u8'), connect: m('int'), available: m('int'), read: m('int'), ...PRINT },
  // ESP-NOW : description d'un pair (adresse MAC, canal, chiffrement) et de l'émetteur d'un message reçu.
  esp_now_peer_info_t: { peer_addr: fd('u8[]'), channel: fd('u8'), encrypt: fd('bool'), ifidx: fd('int') },
  esp_now_recv_info_t: { src_addr: fd('u8[]'), des_addr: fd('u8[]') },
  wifi_tx_info_t: { des_addr: fd('u8[]'), src_addr: fd('u8[]') }
};
CLASSES.ESP8266WebServer = CLASSES.WebServer;
/** Objets globaux prédéfinis. */
export const OBJECTS = {
  Serial: 'HardwareSerial', Serial1: 'HardwareSerial', Serial2: 'HardwareSerial', Serial3: 'HardwareSerial', Wire: 'TwoWire', SPI: 'SPIClass', IrReceiver: 'IRrecv',
  EEPROM: 'EEPROMClass', WiFi: 'WiFiClass', MDNS: 'MDNSResponder'
};
/**
 * Bibliothèques, objets et classes propres à certaines cartes : un programme pour une autre carte ne compile pas
 * (code J1111). Valeur : cartes qui les ont, et conseil quand la carte choisie ne les a pas.
 */
/** Familles de code des cartes ESP32 : l'ESP32 d'origine, l'ESP32-S3 et l'ESP32-C3 (Wi-Fi, même cœur arduino-esp32). */
export const ESP32_KINDS = ['esp32', 'esp32s3', 'esp32c3'];
export const isEsp32 = kind => ESP32_KINDS.includes(kind);
const ESP = ESP32_KINDS, WIFI_BOARDS = [...ESP32_KINDS, 'nodemcu'];
export const BOARD_ONLY = {
  include: {
    // Bluetooth classique (BluetoothSerial) : l'ESP32 d'origine seulement ; l'ESP32-S3 et l'ESP32-C3 n'ont que le BLE.
    'WiFi.h': ESP, 'WebServer.h': ESP, 'HTTPClient.h': ESP, 'esp_now.h': ESP, 'BluetoothSerial.h': ['esp32'], 'Preferences.h': ESP, 'ESPmDNS.h': ESP,
    'ESP8266WiFi.h': ['nodemcu'], 'ESP8266WebServer.h': ['nodemcu'], 'ESP8266HTTPClient.h': ['nodemcu'], 'espnow.h': ['nodemcu'], 'ESP8266mDNS.h': ['nodemcu'],
    'WiFiClient.h': WIFI_BOARDS
  },
  object: { WiFi: WIFI_BOARDS, MDNS: WIFI_BOARDS },
  class: { BluetoothSerial: ['esp32'], WebServer: ESP, ESP8266WebServer: ['nodemcu'], HTTPClient: WIFI_BOARDS, WiFiClient: WIFI_BOARDS, Preferences: ESP },
  fn: /^esp_now_/
};
/** Même bibliothèque sous un autre nom sur l'autre carte Wi-Fi. */
export const INCLUDE_TWIN = {
  'WiFi.h': 'ESP8266WiFi.h', 'ESP8266WiFi.h': 'WiFi.h', 'WebServer.h': 'ESP8266WebServer.h', 'ESP8266WebServer.h': 'WebServer.h',
  'HTTPClient.h': 'ESP8266HTTPClient.h', 'ESP8266HTTPClient.h': 'HTTPClient.h', 'esp_now.h': 'espnow.h', 'espnow.h': 'esp_now.h', 'ESPmDNS.h': 'ESP8266mDNS.h', 'ESP8266mDNS.h': 'ESPmDNS.h'
};
/** Constantes d'une classe, écrites Classe::NOM (Adafruit_BMP280::MODE_NORMAL, MFRC522::PICC_TYPE_MIFARE_1K). */
export const CLASS_CONSTS = {
  Adafruit_BMP280: {
    MODE_SLEEP: 0, MODE_FORCED: 1, MODE_NORMAL: 3, MODE_SOFT_RESET_CODE: 0xb6,
    SAMPLING_NONE: 0, SAMPLING_X1: 1, SAMPLING_X2: 2, SAMPLING_X4: 3, SAMPLING_X8: 4, SAMPLING_X16: 5,
    FILTER_OFF: 0, FILTER_X2: 1, FILTER_X4: 2, FILTER_X8: 3, FILTER_X16: 4,
    STANDBY_MS_1: 0, STANDBY_MS_63: 1, STANDBY_MS_125: 2, STANDBY_MS_250: 3, STANDBY_MS_500: 4, STANDBY_MS_1000: 5, STANDBY_MS_2000: 6, STANDBY_MS_4000: 7
  },
  Adafruit_BME280: {
    MODE_SLEEP: 0, MODE_FORCED: 1, MODE_NORMAL: 3,
    SAMPLING_NONE: 0, SAMPLING_X1: 1, SAMPLING_X2: 2, SAMPLING_X4: 3, SAMPLING_X8: 4, SAMPLING_X16: 5,
    FILTER_OFF: 0, FILTER_X2: 1, FILTER_X4: 2, FILTER_X8: 3, FILTER_X16: 4,
    STANDBY_MS_0_5: 0, STANDBY_MS_10: 6, STANDBY_MS_20: 7, STANDBY_MS_62_5: 1, STANDBY_MS_125: 2, STANDBY_MS_250: 3, STANDBY_MS_500: 4, STANDBY_MS_1000: 5
  },
  BH1750: {
    UNCONFIGURED: 0, CONTINUOUS_HIGH_RES_MODE: 0x10, CONTINUOUS_HIGH_RES_MODE_2: 0x11, CONTINUOUS_LOW_RES_MODE: 0x13,
    ONE_TIME_HIGH_RES_MODE: 0x20, ONE_TIME_HIGH_RES_MODE_2: 0x21, ONE_TIME_LOW_RES_MODE: 0x23
  },
  MFRC522: {
    PICC_TYPE_UNKNOWN: 0, PICC_TYPE_ISO_14443_4: 1, PICC_TYPE_ISO_18092: 2, PICC_TYPE_MIFARE_MINI: 3, PICC_TYPE_MIFARE_1K: 4, PICC_TYPE_MIFARE_4K: 5,
    PICC_TYPE_MIFARE_UL: 6, PICC_TYPE_MIFARE_PLUS: 7, PICC_TYPE_MIFARE_DESFIRE: 8, PICC_TYPE_TNP3XXX: 9, PICC_TYPE_NOT_COMPLETE: 0xff,
    STATUS_OK: 0, STATUS_ERROR: 1, STATUS_COLLISION: 2, STATUS_TIMEOUT: 3, STATUS_NO_ROOM: 4, STATUS_INTERNAL_ERROR: 5, STATUS_INVALID: 6,
    STATUS_CRC_WRONG: 7, STATUS_MIFARE_NACK: 0xff, PICC_CMD_MF_AUTH_KEY_A: 0x60, PICC_CMD_MF_AUTH_KEY_B: 0x61, MF_KEY_SIZE: 6
  }
};
/**
 * Types propres aux bibliothèques : DeviceAddress (8 octets), MFRC522::PICC_Type… t : type de base (comme les
 * retours de méthode), dims : tailles du tableau, c : objet d'une classe.
 */
export const TYPE_ALIASES = {
  DeviceAddress: { t: 'u8', dims: [8] },
  KeypadEvent: { t: 'char' },
  'MFRC522::PICC_Type': { t: 'u8' }, 'MFRC522::StatusCode': { t: 'u8' }, 'MFRC522::MIFARE_Key': { c: 'MIFARE_Key' }, 'MFRC522::Uid': { c: 'Uid' },
  esp_err_t: { t: 'int' }, esp_now_send_status_t: { t: 'int' }, wl_status_t: { t: 'int' }, HTTPMethod: { t: 'int' }, wifi_mode_t: { t: 'int' }
};

/** Bibliothèques connues : #include accepté sans avertissement. */
export const KNOWN_INCLUDES = new Set([
  'Arduino.h', 'Wire.h', 'SPI.h', 'DHT.h', 'DHT_U.h', 'Adafruit_Sensor.h', 'OneWire.h', 'DallasTemperature.h', 'Adafruit_BMP280.h', 'Adafruit_BME280.h', 'BH1750.h', 'HX711.h',
  'Adafruit_MPU6050.h', 'LiquidCrystal_I2C.h', 'Adafruit_GFX.h', 'Adafruit_SSD1306.h', 'Servo.h', 'ESP32Servo.h', 'Adafruit_NeoPixel.h',
  'Stepper.h', 'SoftwareSerial.h', 'math.h', 'stdlib.h', 'string.h', 'stdint.h', 'avr/pgmspace.h', 'pgmspace.h',
  'IRremote.h', 'IRremote.hpp', 'MFRC522.h', 'RF24.h', 'nRF24L01.h', 'Keypad.h', 'printf.h', 'MPU6050.h', 'I2Cdev.h',
  'EEPROM.h', 'Preferences.h', 'BluetoothSerial.h', 'WiFi.h', 'ESP8266WiFi.h', 'WiFiClient.h', 'WebServer.h', 'ESP8266WebServer.h',
  'HTTPClient.h', 'ESP8266HTTPClient.h', 'esp_now.h', 'espnow.h', 'ESPmDNS.h', 'ESP8266mDNS.h', 'esp_wifi.h'
]);
/** Bibliothèques reconnues mais non simulées : un message clair plutôt qu'une erreur obscure. */
export const UNSUPPORTED_INCLUDES = {
  'PubSubClient.h': 'MQTT', 'SD.h': tl('la carte SD'), 'WiFiClientSecure.h': 'HTTPS', 'ESPAsyncWebServer.h': tl('le serveur web asynchrone'),
  'ArduinoJson.h': 'ArduinoJson', 'WiFiUdp.h': 'UDP', 'NTPClient.h': 'NTP'
};
