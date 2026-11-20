// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Ce que le simulateur sait exécuter d'un programme Arduino : fonctions du cœur,
// constantes, classes des bibliothèques. Le compilateur s'en sert pour vérifier le
// code et connaître le type des valeurs, l'exécuteur (runtime.js) les implémente.

/** Types de retour : void, bool, char, float, str, any, i8 u8 i16 u16 i32 u32 i64, arg0 (type du 1er argument), num. */
import { tl } from '../i18n/index.js';
const f = (args, ret, o = {}) => ({ args, ret, ...o });
const MATH1 = ['sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'log10', 'fabs', 'floor', 'ceil', 'trunc',
  'sqrtf', 'sinf', 'cosf', 'tanf', 'expf', 'logf', 'log10f', 'fabsf', 'floorf', 'ceilf', 'truncf', 'roundf', 'cbrt'];
const raw = { raw: true };

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
  powf: f(2, 'float'), atan2f: f(2, 'float'), fmodf: f(2, 'float'), fmin: f(2, 'float'), fmax: f(2, 'float'), fminf: f(2, 'float'), fmaxf: f(2, 'float'),
  round: f(1, 'i32'), labs: f(1, 'i32'), lround: f(1, 'i32'), lroundf: f(1, 'i32'), isnan: f(1, 'bool'), isinf: f(1, 'bool'), isfinite: f(1, 'bool'),
  // ctype.h : caractères ASCII (rendent un int, comme en C).
  isdigit: f(1, 'int'), isalpha: f(1, 'int'), isalnum: f(1, 'int'), isspace: f(1, 'int'), isupper: f(1, 'int'), islower: f(1, 'int'),
  isxdigit: f(1, 'int'), ispunct: f(1, 'int'), isprint: f(1, 'int'), toupper: f(1, 'int'), tolower: f(1, 'int'),
  // Chaînes du C (string.h, stdlib.h, stdio.h) sur des tableaux de char. buf : arguments qui sont le tableau à remplir ;
  // fmt : position du format de printf (les arguments qui suivent gardent leur type C).
  strlen: f(1, 'size', raw), strcmp: f(2, 'int', raw), strncmp: f(3, 'int', raw), strcasecmp: f(2, 'int', raw), strncasecmp: f(3, 'int', raw),
  strcpy: f(2, 'cptr', { raw: true, buf: [0] }), strncpy: f(3, 'cptr', { raw: true, buf: [0] }), strlcpy: f(3, 'size', { raw: true, buf: [0] }),
  strcat: f(2, 'cptr', { raw: true, buf: [0] }), strncat: f(3, 'cptr', { raw: true, buf: [0] }), strlcat: f(3, 'size', { raw: true, buf: [0] }),
  strstr: f(2, 'cptr', raw), strchr: f(2, 'cptr', raw), strrchr: f(2, 'cptr', raw), memcmp: f(3, 'int', { raw: true, ref: [0, 1] }),
  atoi: f(1, 'int', raw), atol: f(1, 'i32', raw), atof: f(1, 'float', raw), strtol: f([2, 3], 'i32', raw), strtoul: f([2, 3], 'u32', raw), strtod: f(2, 'float', raw),
  itoa: f(3, 'cptr', { raw: true, buf: [1] }), ltoa: f(3, 'cptr', { raw: true, buf: [1] }), utoa: f(3, 'cptr', { raw: true, buf: [1] }), ultoa: f(3, 'cptr', { raw: true, buf: [1] }),
  dtostrf: f(4, 'cptr', { raw: true, buf: [3] }),
  snprintf: f([3, 40], 'int', { raw: true, buf: [0], fmt: 2 }), sprintf: f([2, 40], 'int', { raw: true, buf: [0], fmt: 1 }),
  // Variantes _P (avr/pgmspace.h) : le second texte est en mémoire flash (PSTR, PROGMEM). Les mêmes dans le simulateur.
  PSTR: f(1, 'str', raw), strlen_P: f(1, 'size', raw), strcmp_P: f(2, 'int', raw), strncmp_P: f(3, 'int', raw), strcasecmp_P: f(2, 'int', raw),
  strncasecmp_P: f(3, 'int', raw), strstr_P: f(2, 'cptr', raw), memcmp_P: f(3, 'int', { raw: true, ref: [0, 1] }),
  strcpy_P: f(2, 'cptr', { raw: true, buf: [0] }), strncpy_P: f(3, 'cptr', { raw: true, buf: [0] }), strlcpy_P: f(3, 'size', { raw: true, buf: [0] }),
  strcat_P: f(2, 'cptr', { raw: true, buf: [0] }), strncat_P: f(3, 'cptr', { raw: true, buf: [0] }), strlcat_P: f(3, 'size', { raw: true, buf: [0] }),
  snprintf_P: f([3, 40], 'int', { raw: true, buf: [0], fmt: 2 }), sprintf_P: f([2, 40], 'int', { raw: true, buf: [0], fmt: 1 }),
  memcpy_P: f(3, 'void', { raw: true, ref: [0, 1] }),
  // pgm_read_* (&TABLE[i]) : la case lue, au type de la fonction (traité à part par le compilateur).
  pgm_read_byte: f(1, 'u8', { raw: true, pgm: true }), pgm_read_word: f(1, 'u16', { raw: true, pgm: true }), pgm_read_dword: f(1, 'u32', { raw: true, pgm: true }),
  pgm_read_float: f(1, 'float', { raw: true, pgm: true }), pgm_read_ptr: f(1, 'any', { raw: true, pgm: true }),
  pgm_read_byte_near: f(1, 'u8', { raw: true, pgm: true }), pgm_read_word_near: f(1, 'u16', { raw: true, pgm: true }),
  // avr/sleep.h (AVR seulement) : mise en veille jusqu'à la prochaine interruption.
  set_sleep_mode: f(1, 'void', { avr: true, inc: 'avr/sleep.h' }), sleep_enable: f(0, 'void', { avr: true, inc: 'avr/sleep.h' }),
  sleep_disable: f(0, 'void', { avr: true, inc: 'avr/sleep.h' }), sleep_cpu: f(0, 'void', { avr: true, inc: 'avr/sleep.h', wait: true }),
  sleep_mode: f(0, 'void', { avr: true, inc: 'avr/sleep.h', wait: true }),
  random: f([1, 2], 'i32'), randomSeed: f(1, 'void'),
  // Registres à décalage : un bit par front d'horloge, comme le cœur Arduino (74HC595, 74HC165, sim/chips.js).
  shiftOut: f(4, 'void'), shiftIn: f(3, 'u8'),
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
  esp_now_recv_cb_t: f(1, 'any', { raw: true }), esp_now_send_cb_t: f(1, 'any', { raw: true }),
  // MAX30102 (bibliothèque SparkFun) : heartRate.h (détection d'un battement) et spo2_algorithm.h (exemple de Maxim).
  checkForBeat: f(1, 'bool'),
  maxim_heart_rate_and_oxygen_saturation: f(7, 'void', { raw: true, ref: [3, 4, 5, 6] })
};

/** Constantes communes à toutes les cartes. */
export const CONSTS = {
  HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3,
  CHANGE: 1, FALLING: 2, RISING: 3, NOT_AN_INTERRUPT: -1,
  DEC: 10, HEX: 16, OCT: 8, BIN: 2, LSBFIRST: 0, MSBFIRST: 1,
  PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EULER: Math.E,
  NULL: 0, nullptr: 0,
  // stdint.h (inclus par Arduino.h) et math.h.
  INT8_MAX: 127, INT8_MIN: -128, UINT8_MAX: 255, INT16_MAX: 32767, INT16_MIN: -32768, UINT16_MAX: 65535,
  INT32_MAX: 2147483647, INT32_MIN: -2147483648, UINT32_MAX: 4294967295, NAN: NaN, INFINITY: Infinity, M_PI: Math.PI,
  // avr/sleep.h (ATmega328P et ATmega2560 : valeurs du registre SMCR).
  SLEEP_MODE_IDLE: 0, SLEEP_MODE_ADC: 2, SLEEP_MODE_PWR_DOWN: 4, SLEEP_MODE_PWR_SAVE: 6, SLEEP_MODE_STANDBY: 12, SLEEP_MODE_EXT_STANDBY: 14,
  // Capteurs I2C (prog/sensorlibs.js) : VL53L0X, TCS34725, CCS811, BME680, MAX30102.
  VL53L0X_I2C_ADDR: 0x29, VL53L0X_SENSE_DEFAULT: 0, VL53L0X_SENSE_LONG_RANGE: 1, VL53L0X_SENSE_HIGH_SPEED: 2, VL53L0X_SENSE_HIGH_ACCURACY: 3,
  TCS34725_INTEGRATIONTIME_2_4MS: 0xff, TCS34725_INTEGRATIONTIME_24MS: 0xf6, TCS34725_INTEGRATIONTIME_50MS: 0xeb, TCS34725_INTEGRATIONTIME_60MS: 0xe7, TCS34725_INTEGRATIONTIME_101MS: 0xd6, TCS34725_INTEGRATIONTIME_120MS: 0xce, TCS34725_INTEGRATIONTIME_154MS: 0xc0, TCS34725_INTEGRATIONTIME_180MS: 0xb5, TCS34725_INTEGRATIONTIME_199MS: 0xad, TCS34725_INTEGRATIONTIME_240MS: 0x9c, TCS34725_INTEGRATIONTIME_300MS: 0x83, TCS34725_INTEGRATIONTIME_360MS: 0x6a, TCS34725_INTEGRATIONTIME_401MS: 0x59, TCS34725_INTEGRATIONTIME_420MS: 0x51, TCS34725_INTEGRATIONTIME_480MS: 0x38, TCS34725_INTEGRATIONTIME_499MS: 0x30, TCS34725_INTEGRATIONTIME_540MS: 0x1f, TCS34725_INTEGRATIONTIME_600MS: 0x06, TCS34725_INTEGRATIONTIME_614MS: 0x00,
  TCS34725_GAIN_1X: 0, TCS34725_GAIN_4X: 1, TCS34725_GAIN_16X: 2, TCS34725_GAIN_60X: 3, TCS34725_ADDRESS: 0x29,
  CCS811_ADDRESS: 0x5a, CCS811_DRIVE_MODE_IDLE: 0, CCS811_DRIVE_MODE_1SEC: 1, CCS811_DRIVE_MODE_10SEC: 2, CCS811_DRIVE_MODE_60SEC: 3, CCS811_DRIVE_MODE_250MS: 4,
  BME680_OS_NONE: 0, BME680_OS_1X: 1, BME680_OS_2X: 2, BME680_OS_4X: 3, BME680_OS_8X: 4, BME680_OS_16X: 5, BME68X_OS_NONE: 0, BME68X_OS_1X: 1, BME68X_OS_2X: 2, BME68X_OS_4X: 3, BME68X_OS_8X: 4, BME68X_OS_16X: 5,
  BME680_FILTER_SIZE_0: 0, BME680_FILTER_SIZE_1: 1, BME680_FILTER_SIZE_3: 2, BME680_FILTER_SIZE_7: 3, BME680_FILTER_SIZE_15: 4, BME680_FILTER_SIZE_31: 5, BME680_FILTER_SIZE_63: 6, BME680_FILTER_SIZE_127: 7,
  BME68X_FILTER_OFF: 0, BME68X_FILTER_SIZE_3: 2, BME68X_ODR_NONE: 8, BME68X_DEFAULT_ADDRESS: 0x77,
  MAX30105_ADDRESS: 0x57, I2C_SPEED_STANDARD: 100000, I2C_SPEED_FAST: 400000,
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
  // PCF8574 (bibliothèque de Renzo Mischianti) : broches P0 à P7 de l'extenseur.
  P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P6: 6, P7: 7,
  // Keypad : aucune touche, états d'une touche.
  NO_KEY: 0, IDLE: 0, PRESSED: 1, HOLD: 2, RELEASED: 3,
  // RF24 : puissance d'émission, débit, contrôle d'erreur.
  // LoRa (Sandeep Mistry) : sortie d'antenne de setTxPower(niveau, sortie).
  PA_OUTPUT_RFO_PIN: 0, PA_OUTPUT_PA_BOOST_PIN: 1,
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
  ESP_SPP_ROLE_MASTER: 0, ESP_SPP_ROLE_SLAVE: 1,
  // TM1637Display : segments (bit 0 = A … bit 6 = G, bit 7 = point ou deux-points).
  SEG_A: 1, SEG_B: 2, SEG_C: 4, SEG_D: 8, SEG_E: 16, SEG_F: 32, SEG_G: 64, SEG_DP: 128,
  // RTClib : format de timestamp(), sortie SQW et alarmes du DS3231, sortie SQW du DS1307.
  TIMESTAMP_FULL: 0, TIMESTAMP_TIME: 1, TIMESTAMP_DATE: 2, SECONDS_FROM_1970_TO_2000: 946684800,
  DS3231_OFF: 0x1c, DS3231_SquareWave1Hz: 0, DS3231_SquareWave1kHz: 0x08, DS3231_SquareWave4kHz: 0x10, DS3231_SquareWave8kHz: 0x18,
  DS3231_A1_PerSecond: 0x0f, DS3231_A1_Second: 0x0e, DS3231_A1_Minute: 0x0c, DS3231_A1_Hour: 0x08, DS3231_A1_Date: 0, DS3231_A1_Day: 0x10,
  DS3231_A2_PerMinute: 7, DS3231_A2_Minute: 6, DS3231_A2_Hour: 4, DS3231_A2_Date: 0, DS3231_A2_Day: 8,
  DS1307_OFF: 0, DS1307_ON: 0x80, DS1307_SquareWave1HZ: 0x10, DS1307_SquareWave4kHz: 0x11, DS1307_SquareWave8kHz: 0x12, DS1307_SquareWave32kHz: 0x13,
  // I2C_eeprom (Rob Tillaart) : taille des mémoires.
  I2C_DEVICESIZE_24LC512: 65536, I2C_DEVICESIZE_24LC256: 32768, I2C_DEVICESIZE_24LC128: 16384, I2C_DEVICESIZE_24LC64: 8192, I2C_DEVICESIZE_24LC32: 4096,
  I2C_DEVICESIZE_24LC16: 2048, I2C_DEVICESIZE_24LC08: 1024, I2C_DEVICESIZE_24LC04: 512, I2C_DEVICESIZE_24LC02: 256, I2C_DEVICESIZE_24LC01: 128,
  // Carte SD (bibliothèque SD d'Arduino) : modes d'ouverture d'un fichier.
  FILE_READ: 0x01, FILE_WRITE: 0x17, O_READ: 0x01, O_RDONLY: 0x01, O_WRITE: 0x02, O_WRONLY: 0x02, O_RDWR: 0x03, O_APPEND: 0x04, O_SYNC: 0x08, O_CREAT: 0x10, O_EXCL: 0x20, O_TRUNC: 0x40,
  // Écrans TFT (Adafruit_ST7735.h, Adafruit_ILI9341.h) : onglets de l'ST7735, couleurs RGB565.
  INITR_GREENTAB: 0x00, INITR_REDTAB: 0x01, INITR_BLACKTAB: 0x02, INITR_18GREENTAB: 0x00, INITR_18REDTAB: 0x01, INITR_18BLACKTAB: 0x02, INITR_144GREENTAB: 0x01, INITR_MINI160x80: 0x04, INITR_HALLOWING: 0x05,
  ST77XX_BLACK: 0x0000, ST77XX_WHITE: 0xffff, ST77XX_RED: 0xf800, ST77XX_GREEN: 0x07e0, ST77XX_BLUE: 0x001f, ST77XX_CYAN: 0x07ff, ST77XX_MAGENTA: 0xf81f, ST77XX_YELLOW: 0xffe0, ST77XX_ORANGE: 0xfc00,
  ST7735_BLACK: 0x0000, ST7735_WHITE: 0xffff, ST7735_RED: 0xf800, ST7735_GREEN: 0x07e0, ST7735_BLUE: 0x001f, ST7735_CYAN: 0x07ff, ST7735_MAGENTA: 0xf81f, ST7735_YELLOW: 0xffe0, ST7735_ORANGE: 0xfc00,
  ILI9341_BLACK: 0x0000, ILI9341_NAVY: 0x000f, ILI9341_DARKGREEN: 0x03e0, ILI9341_DARKCYAN: 0x03ef, ILI9341_MAROON: 0x7800, ILI9341_PURPLE: 0x780f, ILI9341_OLIVE: 0x7be0,
  ILI9341_LIGHTGREY: 0xc618, ILI9341_DARKGREY: 0x7bef, ILI9341_BLUE: 0x001f, ILI9341_GREEN: 0x07e0, ILI9341_CYAN: 0x07ff, ILI9341_RED: 0xf800, ILI9341_MAGENTA: 0xf81f,
  ILI9341_YELLOW: 0xffe0, ILI9341_WHITE: 0xffff, ILI9341_ORANGE: 0xfd20, ILI9341_GREENYELLOW: 0xafe5, ILI9341_PINK: 0xfc18,
  ILI9341_TFTWIDTH: 240, ILI9341_TFTHEIGHT: 320, ST7735_TFTWIDTH_128: 128, ST7735_TFTHEIGHT_160: 160, ST7735_TFTHEIGHT_128: 128,
  // Réseau informatique (prog/netlib.js) : Ethernet (puce, lien, renouvellement DHCP), PubSubClient (état, tailles, QoS).
  EthernetNoHardware: 0, EthernetW5100: 1, EthernetW5200: 2, EthernetW5500: 3, EthernetENC28J60: 10, Unknown: 0, LinkON: 1, LinkOFF: 2,
  DHCP_CHECK_NONE: 0, DHCP_CHECK_RENEW_FAIL: 1, DHCP_CHECK_RENEW_OK: 2, DHCP_CHECK_REBIND_FAIL: 3, DHCP_CHECK_REBIND_OK: 4,
  MQTT_CONNECTION_TIMEOUT: -4, MQTT_CONNECTION_LOST: -3, MQTT_CONNECT_FAILED: -2, MQTT_DISCONNECTED: -1, MQTT_CONNECTED: 0,
  MQTT_CONNECT_BAD_PROTOCOL: 1, MQTT_CONNECT_BAD_CLIENT_ID: 2, MQTT_CONNECT_UNAVAILABLE: 3, MQTT_CONNECT_BAD_CREDENTIALS: 4, MQTT_CONNECT_UNAUTHORIZED: 5,
  MQTT_MAX_PACKET_SIZE: 256, MQTT_KEEPALIVE: 15, MQTT_SOCKET_TIMEOUT: 15, MQTTQOS0: 0, MQTTQOS1: 1, MQTTQOS2: 2
};
/** Types des constantes non entières (les autres sont des int). */
export const CONST_TYPES = {
  PI: 'float', HALF_PI: 'float', TWO_PI: 'float', DEG_TO_RAD: 'float', RAD_TO_DEG: 'float', EULER: 'float', DEVICE_DISCONNECTED_F: 'float',
  NAN: 'float', INFINITY: 'float', M_PI: 'float', INT32_MAX: 'i32', INT32_MIN: 'i32', UINT32_MAX: 'u32', UINT16_MAX: 'uint'
};

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
// print, println, write rendent un size_t : le nombre de caractères envoyés (lcd.print(t, 1) → 4 pour « 21.5 »).
const PRINT = { print: m('size', { print: true }), println: m('size', { print: true }), write: m('size') };
const SERIAL = {
  begin: m('void'), end: m('void'), ...PRINT, printf: m('u32'), available: m('int'), read: m('int'), peek: m('int'),
  readString: m('str'), readStringUntil: m('str'), parseInt: m('i32'), parseFloat: m('float'), flush: m('void'), setTimeout: m('void'),
  availableForWrite: m('int')
};
// Réseau informatique (prog/netlib.js) : client TCP (EthernetClient, WiFiClient), serveur, UDP.
const NET_CLIENT = {
  connect: m('int', { block: true }), connected: m('u8'), available: m('int'), read: m('int', { ref: [0] }), peek: m('int'),
  readString: m('str'), readStringUntil: m('str'), parseInt: m('i32'), parseFloat: m('float'), find: m('bool'), ...PRINT, flush: m('void'), stop: m('void'),
  remoteIP: m('obj:IPAddress'), remotePort: m('u16'), localPort: m('u16'), setTimeout: m('void'), setConnectionTimeout: m('void'), setNoDelay: m('void'), status: m('u8')
};
const netServer = client => ({
  begin: m('void'), available: m('obj:' + client), accept: m('obj:' + client), hasClient: m('bool'), ...PRINT, end: m('void'), close: m('void'), stop: m('void'),
  setNoDelay: m('void'), getNoDelay: m('bool')
});
const NET_UDP = {
  begin: m('u8'), beginPacket: m('int'), endPacket: m('int'), parsePacket: m('int'), available: m('int'), read: m('int', { ref: [0] }), peek: m('int'),
  ...PRINT, remoteIP: m('obj:IPAddress'), remotePort: m('u16'), flush: m('void'), stop: m('void')
};
const GFX = {
  begin: m('bool'), clearDisplay: m('void'), display: m('void'), setTextSize: m('void'), setTextColor: m('void'), setCursor: m('void'),
  ...PRINT, drawPixel: m('void'), drawLine: m('void'), drawFastHLine: m('void'), drawFastVLine: m('void'), drawRect: m('void'), fillRect: m('void'),
  drawRoundRect: m('void'), fillRoundRect: m('void'), drawCircle: m('void'), fillCircle: m('void'), drawTriangle: m('void'), fillTriangle: m('void'),
  invertDisplay: m('void'), width: m('i16'), height: m('i16'), setRotation: m('void'), cp437: m('void'), dim: m('void'), setTextWrap: m('void'),
  fillScreen: m('void'), getCursorX: m('i16'), getCursorY: m('i16'),
  drawBitmap: m('void'), drawXBitmap: m('void'), drawChar: m('void'), getTextBounds: m('void', { ref: [3, 4, 5, 6] })
};
const TFT_GFX = {
  initR: m('void'), initB: m('void'), begin: m('void'), setRotation: m('void'), getRotation: m('u8'), width: m('i16'), height: m('i16'),
  fillScreen: m('void'), drawPixel: m('void'), drawLine: m('void'), drawFastHLine: m('void'), drawFastVLine: m('void'), drawRect: m('void'), fillRect: m('void'),
  drawRoundRect: m('void'), fillRoundRect: m('void'), drawCircle: m('void'), fillCircle: m('void'), drawTriangle: m('void'), fillTriangle: m('void'),
  setCursor: m('void'), getCursorX: m('i16'), getCursorY: m('i16'), setTextColor: m('void'), setTextSize: m('void'), setTextWrap: m('void'), cp437: m('void'),
  ...PRINT, drawChar: m('void'), drawBitmap: m('void'), drawRGBBitmap: m('void'), color565: m('u16'), invertDisplay: m('void'), enableDisplay: m('void'),
  enableSleep: m('void'), setSPISpeed: m('void'), startWrite: m('void'), endWrite: m('void'), readcommand8: m('u8')
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
  // Écrans TFT couleur en SPI (sim/tft.js) : couleurs RGB565 de 16 bits, police classique 5 × 7 d'Adafruit_GFX.
  Adafruit_ST7735: TFT_GFX, Adafruit_ILI9341: TFT_GFX,
  // Extenseurs et pilote PWM I2C (sim/chips.js) : chaque appel passe par Wire, registre par registre, comme la vraie bibliothèque.
  Adafruit_MCP23X17: {
    begin_I2C: m('bool'), pinMode: m('void'), digitalWrite: m('void'), digitalRead: m('u8'), readGPIO: m('u8'), writeGPIO: m('void'),
    readGPIOA: m('u8'), writeGPIOA: m('void'), readGPIOB: m('u8'), writeGPIOB: m('void'), readGPIOAB: m('u16'), writeGPIOAB: m('void'),
    setupInterrupts: m('void'), setupInterruptPin: m('void'), disableInterruptPin: m('void'), clearInterrupts: m('void'),
    getLastInterruptPin: m('u8'), getCapturedInterrupt: m('u16'), enableAddrPins: m('void')
  },
  // PCF8574 : bibliothèque de Rob Tillaart (write, read, write8, read8…), et les noms de celle de Renzo Mischianti (pinMode, digitalWrite…).
  PCF8574: {
    begin: m('bool'), isConnected: m('bool'), setAddress: m('bool'), getAddress: m('u8'), read8: m('u8'), read: m('u8'), value: m('u8'),
    write8: m('void'), write: m('void'), valueOut: m('u8'), readButton8: m('u8'), readButton: m('u8'), setButtonMask: m('void'), getButtonMask: m('u8'),
    toggle: m('void'), toggleMask: m('void'), shiftRight: m('void'), shiftLeft: m('void'), rotateRight: m('void'), rotateLeft: m('void'), reverse: m('void'),
    select: m('void'), selectN: m('void'), selectNone: m('void'), selectAll: m('void'), lastError: m('int'),
    pinMode: m('void'), digitalWrite: m('bool'), digitalRead: m('u8')
  },
  // Afficheurs à pilote (sim/displays.js) : MAX7219 par LedControl ou MD_MAX72XX, TM1637 par TM1637Display.
  LedControl: {
    getDeviceCount: m('int'), shutdown: m('void'), setScanLimit: m('void'), setIntensity: m('void'), clearDisplay: m('void'),
    setLed: m('void'), setRow: m('void'), setColumn: m('void'), setDigit: m('void'), setChar: m('void')
  },
  MD_MAX72XX: {
    begin: m('bool'), clear: m('void'), setPoint: m('bool'), getPoint: m('bool'), setRow: m('bool'), setColumn: m('bool'), control: m('bool'),
    update: m('void'), getColumnCount: m('u16'), getDeviceCount: m('u8')
  },
  TM1637Display: {
    setBrightness: m('void'), setSegments: m('void'), clear: m('void'), showNumberDec: m('void'), showNumberDecEx: m('void'), showNumberHexEx: m('void'), encodeDigit: m('u8')
  },
  // Horloges (sim/storage.js) : RTClib d'Adafruit, registres lus et écrits par Wire.
  DateTime: {
    year: m('u16'), month: m('u8'), day: m('u8'), hour: m('u8'), minute: m('u8'), second: m('u8'), twelveHour: m('u8'), isPM: m('u8'),
    dayOfTheWeek: m('u8'), unixtime: m('u32'), secondstime: m('u32'), isValid: m('bool'), timestamp: m('str'), toString: m('str')
  },
  TimeSpan: { days: m('i16'), hours: m('i8'), minutes: m('i8'), seconds: m('i8'), totalseconds: m('i32') },
  RTC_DS3231: {
    begin: m('bool'), adjust: m('void'), now: m('obj:DateTime'), lostPower: m('bool'), getTemperature: m('float'), readSqwPinMode: m('u8'), writeSqwPinMode: m('void'),
    isEnabled32K: m('bool'), enable32K: m('void'), disable32K: m('void'), setAlarm1: m('bool'), setAlarm2: m('bool'), alarmFired: m('bool'), clearAlarm: m('void'), disableAlarm: m('void')
  },
  RTC_DS1307: {
    begin: m('bool'), adjust: m('void'), now: m('obj:DateTime'), isrunning: m('u8'), readSqwPinMode: m('u8'), writeSqwPinMode: m('void'),
    readnvram: m('u8', { ref: [0] }), writenvram: m('void', { ref: [0] })
  },
  // Mémoire I2C AT24C256 (sim/storage.js) : bibliothèque I2C_eeprom de Rob Tillaart ; une écriture attend la fin du cycle (5 ms).
  I2C_eeprom: {
    begin: m('bool', { block: true }), isConnected: m('bool', { block: true }), getDeviceSize: m('u32'), getPageSize: m('u8'),
    writeByte: m('int', { block: true }), writeBlock: m('int', { block: true, ref: [1] }), setBlock: m('int', { block: true }), updateByte: m('int', { block: true }),
    readByte: m('u8', { block: true }), readBlock: m('u16', { block: true, ref: [1] }), writeByteVerify: m('bool', { block: true })
  },
  // Capteurs I2C (prog/sensorlibs.js, puces de sim/i2csensors.js).
  VL53L0X_RangingMeasurementData_t: {
    TimeStamp: fd('u32'), MeasurementTimeUsec: fd('u32'), RangeMilliMeter: fd('u16'), RangeDMaxMilliMeter: fd('u16'), SignalRateRtnMegaCps: fd('u32'),
    AmbientRateRtnMegaCps: fd('u32'), EffectiveSpadRtnCount: fd('u16'), ZoneId: fd('u8'), RangeFractionalPart: fd('u8'), RangeStatus: fd('u8')
  },
  Adafruit_VL53L0X: {
    begin: m('bool', { block: true }), setAddress: m('bool'), rangingTest: m('i8', { block: true }), getSingleRangingMeasurement: m('i8', { block: true }), readRange: m('u16', { block: true }),
    readRangeStatus: m('u8'), startRange: m('bool'), isRangeComplete: m('bool', { block: true }), waitRangeComplete: m('i8', { block: true }), readRangeResult: m('u16'),
    startRangeContinuous: m('bool'), stopRangeContinuous: m('void'), setMeasurementTimingBudgetMicroSeconds: m('bool'), getMeasurementTimingBudgetMicroSeconds: m('u32'),
    configSensor: m('bool'), setLimitCheckEnable: m('bool'), setLimitCheckValue: m('bool'), getLimitCheckEnable: m('u8'), setInterruptThresholds: m('bool'), setGpioConfig: m('bool'), clearInterruptMask: m('bool')
  },
  VL53L0X: {
    init: m('bool', { block: true }), setAddress: m('void'), getAddress: m('u8'), setTimeout: m('void'), getTimeout: m('u16'), timeoutOccurred: m('bool'),
    setSignalRateLimit: m('bool'), getSignalRateLimit: m('float'), setMeasurementTimingBudget: m('bool'), getMeasurementTimingBudget: m('u32'), setVcselPulsePeriod: m('bool'), getVcselPulsePeriod: m('u8'),
    startContinuous: m('void'), stopContinuous: m('void'), readRangeContinuousMillimeters: m('u16', { block: true }), readRangeSingleMillimeters: m('u16', { block: true }),
    readRangeContinuous: m('u16', { block: true }), readRangeSingle: m('u16', { block: true }), last_status: m('u8')
  },
  MAX30105: {
    begin: m('bool'), setup: m('void', { block: true }), softReset: m('void', { block: true }), shutDown: m('void'), wakeUp: m('void'), setLEDMode: m('void'), setADCRange: m('void'),
    setSampleRate: m('void'), setPulseWidth: m('void'), setPulseAmplitudeRed: m('void'), setPulseAmplitudeIR: m('void'), setPulseAmplitudeGreen: m('void'), setPulseAmplitudeProximity: m('void'),
    setProximityThreshold: m('void'), enableSlot: m('void'), disableSlots: m('void'), setFIFOAverage: m('void'), enableFIFORollover: m('void'), disableFIFORollover: m('void'), setFIFOAlmostFull: m('void'),
    getWritePointer: m('u8'), getReadPointer: m('u8'), clearFIFO: m('void'), getINT1: m('u8'), getINT2: m('u8'), enableDATARDY: m('void'), disableDATARDY: m('void'), enableAFULL: m('void'), disableAFULL: m('void'),
    enableDIETEMPRDY: m('void'), disableDIETEMPRDY: m('void'), check: m('u16', { block: true }), safeCheck: m('bool', { block: true }), available: m('u8'), nextSample: m('void'),
    getRed: m('u32', { block: true }), getIR: m('u32', { block: true }), getGreen: m('u32', { block: true }), getFIFORed: m('u32'), getFIFOIR: m('u32'), getFIFOGreen: m('u32'),
    readTemperature: m('float', { block: true }), readTemperatureF: m('float', { block: true }), readPartID: m('u8'), readRevisionID: m('void'), getRevisionID: m('u8')
  },
  Adafruit_TCS34725: {
    begin: m('bool', { block: true }), enable: m('void', { block: true }), disable: m('void'), setIntegrationTime: m('void'), setGain: m('void'),
    getRawData: m('void', { block: true, ref: [0, 1, 2, 3] }), getRawDataOneShot: m('void', { block: true, ref: [0, 1, 2, 3] }), getRGB: m('void', { block: true, ref: [0, 1, 2] }),
    calculateColorTemperature: m('u16'), calculateColorTemperature_dn40: m('u16'), calculateLux: m('u16'), setInterrupt: m('void'), clearInterrupt: m('void'), setIntLimits: m('void'),
    write8: m('void'), read8: m('u8'), read16: m('u16')
  },
  Adafruit_CCS811: {
    begin: m('bool', { block: true }), available: m('bool', { block: true }), readData: m('u8', { block: true }), geteCO2: m('u16'), getTVOC: m('u16'), getCurrentSelected: m('u8'), getRawADCreading: m('u16'),
    setDriveMode: m('void'), enableInterrupt: m('void'), disableInterrupt: m('void'), setEnvironmentalData: m('void'), setThresholds: m('void'), checkError: m('bool'),
    SWReset: m('void'), getBaseline: m('u16'), setBaseline: m('void'), calculateTemperature: m('float')
  },
  Adafruit_BME680: {
    begin: m('bool', { block: true }), setTemperatureOversampling: m('bool'), setHumidityOversampling: m('bool'), setPressureOversampling: m('bool'), setIIRFilterSize: m('bool'), setODR: m('bool'),
    setGasHeater: m('bool'), performReading: m('bool', { block: true }), beginReading: m('u32'), endReading: m('bool', { block: true }), remainingReadingMillis: m('i32'),
    readTemperature: m('float', { block: true }), readHumidity: m('float', { block: true }), readPressure: m('u32', { block: true }), readGas: m('u32', { block: true }), readAltitude: m('float', { block: true }),
    temperature: fd('float'), humidity: fd('float'), pressure: fd('float'), gas_resistance: fd('u32')
  },
  Adafruit_PWMServoDriver: {
    begin: m('bool'), reset: m('void'), sleep: m('void'), wakeup: m('void'), setExtClk: m('void'), setPWMFreq: m('void'), setOutputMode: m('void'),
    getPWM: m('u16'), setPWM: m('u8'), setPin: m('void'), readPrescale: m('u8'), writeMicroseconds: m('void'),
    setOscillatorFrequency: m('void'), getOscillatorFrequency: m('u32')
  },
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
  // AccelStepper : pilote STEP/DIR (A4988, DRV8825) ou moteur 4 fils ; runToPosition() attend la fin du mouvement.
  AccelStepper: {
    moveTo: m('void'), move: m('void'), run: m('bool'), runSpeed: m('bool'), runSpeedToPosition: m('bool'), runToPosition: m('void', { block: true }),
    runToNewPosition: m('void', { block: true }), setMaxSpeed: m('void'), maxSpeed: m('float'), setAcceleration: m('void'), acceleration: m('float'),
    setSpeed: m('void'), speed: m('float'), distanceToGo: m('i32'), targetPosition: m('i32'), currentPosition: m('i32'), setCurrentPosition: m('void'),
    stop: m('void'), isRunning: m('bool'), stepForward: m('i32'), stepBackward: m('i32'), setMinPulseWidth: m('void'), setEnablePin: m('void'),
    setPinsInverted: m('void'), enableOutputs: m('void'), disableOutputs: m('void')
  },
  sensors_event_t: {},
  // IRremote : IrReceiver (API v4) et IRrecv irrecv(broche) + decode(&results) (ancienne API).
  IRrecv: {
    begin: m('void'), enableIRIn: m('void'), decode: m('bool'), resume: m('void'), start: m('void'), stop: m('void'), isIdle: m('bool'),
    printIRResultShort: m('void'), printIRResultMinimal: m('void'), printIRSendUsage: m('void'), printIRResultRawFormatted: m('void'), decodedIRData: fd('IRData')
  },
  IRData: { command: fd('u16'), address: fd('u16'), protocol: fd('int'), flags: fd('u8'), decodedRawData: fd('u32'), numberOfBits: fd('u16') },
  decode_results: { value: fd('u32'), decode_type: fd('int'), bits: fd('int') },
  // TinyGPSPlus (TinyGPS++ de Mikal Hart) : champs location, date, time, speed… avec leurs méthodes (prog/gpslib.js).
  TinyGPSPlus: {
    encode: m('bool'), location: fd('TinyGPSLocation'), date: fd('TinyGPSDate'), time: fd('TinyGPSTime'), speed: fd('TinyGPSSpeed'), course: fd('TinyGPSCourse'),
    altitude: fd('TinyGPSAltitude'), satellites: fd('TinyGPSInteger'), hdop: fd('TinyGPSHDOP'),
    charsProcessed: m('u32'), sentencesWithFix: m('u32'), failedChecksum: m('u32'), passedChecksum: m('u32'),
    distanceBetween: m('float', { static: true }), courseTo: m('float', { static: true }), cardinal: m('str', { static: true }), libraryVersion: m('str', { static: true }), parseDecimal: m('i32', { static: true })
  },
  TinyGPSLocation: { isValid: m('bool'), isUpdated: m('bool'), age: m('u32'), lat: m('float'), lng: m('float') },
  TinyGPSDate: { isValid: m('bool'), isUpdated: m('bool'), age: m('u32'), value: m('u32'), year: m('u16'), month: m('u8'), day: m('u8') },
  TinyGPSTime: { isValid: m('bool'), isUpdated: m('bool'), age: m('u32'), value: m('u32'), hour: m('u8'), minute: m('u8'), second: m('u8'), centisecond: m('u8') },
  TinyGPSSpeed: { isValid: m('bool'), isUpdated: m('bool'), age: m('u32'), value: m('i32'), knots: m('float'), mph: m('float'), mps: m('float'), kmph: m('float') },
  TinyGPSCourse: { isValid: m('bool'), isUpdated: m('bool'), age: m('u32'), value: m('i32'), deg: m('float') },
  TinyGPSAltitude: { isValid: m('bool'), isUpdated: m('bool'), age: m('u32'), value: m('i32'), meters: m('float'), miles: m('float'), kilometers: m('float'), feet: m('float') },
  TinyGPSInteger: { isValid: m('bool'), isUpdated: m('bool'), age: m('u32'), value: m('u32') },
  TinyGPSHDOP: { isValid: m('bool'), isUpdated: m('bool'), age: m('u32'), value: m('i32'), hdop: m('float') },
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
  // Encoder (Paul Stoffregen) : position en fronts de quadrature, 4 par cran d'un KY-040.
  Encoder: { read: m('i32'), write: m('void'), readAndReset: m('i32') },
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
  // Radio LoRa SX1278 (prog/loralib.js) : l'objet global LoRa ; begin() et endPacket() attendent la puce.
  LoRaClass: {
    begin: m('int', { block: true }), end: m('void'), setPins: m('void'), setSPI: m('void'), setSPIFrequency: m('void'),
    beginPacket: m('int'), endPacket: m('int', { block: true }), ...PRINT, parsePacket: m('int'), available: m('int'), read: m('int'), peek: m('int'),
    readString: m('str'), readStringUntil: m('str'), parseInt: m('i32'), parseFloat: m('float'), flush: m('void'), setTimeout: m('void'),
    packetRssi: m('int'), packetSnr: m('float'), packetFrequencyError: m('i32'), rssi: m('int'), onReceive: m('void'), onTxDone: m('void'), receive: m('void'),
    idle: m('void'), sleep: m('void'), setTxPower: m('void'), setFrequency: m('void'), getSpreadingFactor: m('int'), setSpreadingFactor: m('void'),
    getSignalBandwidth: m('i32'), setSignalBandwidth: m('void'), setCodingRate4: m('void'), setPreambleLength: m('void'), setSyncWord: m('void'),
    enableCrc: m('void'), disableCrc: m('void'), enableInvertIQ: m('void'), disableInvertIQ: m('void'), setOCP: m('void'), setGain: m('void'),
    random: m('u8'), dumpRegisters: m('void')
  },
  // Carte microSD (sim/sdcard.js) : SD.open() rend un File, faux dans un if quand il n'a pas pu s'ouvrir.
  SDClass: { begin: m('bool'), end: m('void'), exists: m('bool'), mkdir: m('bool'), rmdir: m('bool'), remove: m('bool'), open: m('obj:File') },
  File: {
    ...PRINT, available: m('int'), read: m('int'), peek: m('int'), seek: m('bool'), position: m('u32'), size: m('u32'), flush: m('void'), close: m('void'),
    name: m('str'), isDirectory: m('bool'), openNextFile: m('obj:File'), rewindDirectory: m('void'), readStringUntil: m('str'), readString: m('str'), parseInt: m('i32')
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
  // Réseau informatique (prog/netlib.js) sur le plan réseau du projet : clients et serveurs TCP, UDP, MQTT, Modbus TCP, ping.
  WiFiClient: NET_CLIENT, NetworkClient: NET_CLIENT, EthernetClient: NET_CLIENT,
  WiFiServer: netServer('WiFiClient'), NetworkServer: netServer('NetworkClient'), EthernetServer: netServer('EthernetClient'),
  WiFiUDP: NET_UDP, NetworkUDP: NET_UDP, EthernetUDP: NET_UDP,
  EthernetClass: {
    begin: m('int', { block: true }), init: m('void'), hardwareStatus: m('int'), linkStatus: m('int'), maintain: m('int'),
    localIP: m('obj:IPAddress'), subnetMask: m('obj:IPAddress'), gatewayIP: m('obj:IPAddress'), dnsServerIP: m('obj:IPAddress'),
    setLocalIP: m('void'), setSubnetMask: m('void'), setGatewayIP: m('void'), setDnsServerIP: m('void'), setMACAddress: m('void'), MACAddress: m('void'),
    setRetransmissionTimeout: m('void'), setRetransmissionCount: m('void'), setHostname: m('void')
  },
  PubSubClient: {
    setServer: m('obj:PubSubClient'), setCallback: m('obj:PubSubClient'), setClient: m('obj:PubSubClient'), setKeepAlive: m('obj:PubSubClient'),
    setSocketTimeout: m('obj:PubSubClient'), setBufferSize: m('bool'), getBufferSize: m('u16'),
    connect: m('bool', { block: true }), connected: m('bool'), state: m('int'), disconnect: m('void'), loop: m('bool', { block: true }),
    publish: m('bool'), publish_P: m('bool'), subscribe: m('bool'), unsubscribe: m('bool')
  },
  ModbusTCPClient: {
    begin: m('int', { block: true }), connected: m('int'), stop: m('void'), end: m('void'), setTimeout: m('void'), lastError: m('str'),
    coilRead: m('int', { block: true }), discreteInputRead: m('int', { block: true }), holdingRegisterRead: m('i32', { block: true }),
    inputRegisterRead: m('i32', { block: true }), coilWrite: m('int', { block: true }), holdingRegisterWrite: m('int', { block: true })
  },
  PingClass: { ping: m('bool', { block: true }), averageTime: m('float') },
  // ESP-NOW : description d'un pair (adresse MAC, canal, chiffrement) et de l'émetteur d'un message reçu.
  esp_now_peer_info_t: { peer_addr: fd('u8[]'), channel: fd('u8'), encrypt: fd('bool'), ifidx: fd('int') },
  esp_now_recv_info_t: { src_addr: fd('u8[]'), des_addr: fd('u8[]') },
  wifi_tx_info_t: { des_addr: fd('u8[]'), src_addr: fd('u8[]') }
};
CLASSES.ESP8266WebServer = CLASSES.WebServer;
/** Objets globaux prédéfinis. */
export const OBJECTS = {
  Serial: 'HardwareSerial', Serial1: 'HardwareSerial', Serial2: 'HardwareSerial', Serial3: 'HardwareSerial', Wire: 'TwoWire', SPI: 'SPIClass', IrReceiver: 'IRrecv',
  EEPROM: 'EEPROMClass', WiFi: 'WiFiClass', MDNS: 'MDNSResponder', SD: 'SDClass', LoRa: 'LoRaClass', Ethernet: 'EthernetClass', Ping: 'PingClass'
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
    'WiFiClient.h': WIFI_BOARDS, 'WiFiServer.h': WIFI_BOARDS, 'WiFiUdp.h': WIFI_BOARDS, 'avr/sleep.h': ['uno', 'nano', 'mega'],
    'ESP32Ping.h': ESP, 'ESP8266Ping.h': ['nodemcu']
  },
  object: { WiFi: WIFI_BOARDS, MDNS: WIFI_BOARDS, Ping: WIFI_BOARDS },
  class: {
    BluetoothSerial: ['esp32'], WebServer: ESP, ESP8266WebServer: ['nodemcu'], HTTPClient: WIFI_BOARDS, WiFiClient: WIFI_BOARDS, Preferences: ESP,
    WiFiServer: WIFI_BOARDS, WiFiUDP: WIFI_BOARDS, NetworkClient: ESP, NetworkServer: ESP, NetworkUDP: ESP
  },
  fn: /^esp_now_/
};
/** Même bibliothèque sous un autre nom sur l'autre carte Wi-Fi. */
export const INCLUDE_TWIN = {
  'WiFi.h': 'ESP8266WiFi.h', 'ESP8266WiFi.h': 'WiFi.h', 'WebServer.h': 'ESP8266WebServer.h', 'ESP8266WebServer.h': 'WebServer.h',
  'HTTPClient.h': 'ESP8266HTTPClient.h', 'ESP8266HTTPClient.h': 'HTTPClient.h', 'esp_now.h': 'espnow.h', 'espnow.h': 'esp_now.h', 'ESPmDNS.h': 'ESP8266mDNS.h', 'ESP8266mDNS.h': 'ESPmDNS.h',
  'ESP32Ping.h': 'ESP8266Ping.h', 'ESP8266Ping.h': 'ESP32Ping.h'
};
/** Constantes d'une classe, écrites Classe::NOM (Adafruit_BMP280::MODE_NORMAL, MFRC522::PICC_TYPE_MIFARE_1K). */
export const CLASS_CONSTS = {
  MD_MAX72XX: {
    GENERIC_HW: 0, FC16_HW: 1, PAROLA_HW: 2, ICSTATION_HW: 3, DR0CR0RR0_HW: 4, DR0CR0RR1_HW: 5, DR0CR1RR0_HW: 6, DR0CR1RR1_HW: 7,
    DR1CR0RR0_HW: 8, DR1CR0RR1_HW: 9, DR1CR1RR0_HW: 10, DR1CR1RR1_HW: 11,
    SHUTDOWN: 0, SCANLIMIT: 1, INTENSITY: 2, TEST: 3, DECODE: 4, UPDATE: 10, WRAPAROUND: 11, OFF: 0, ON: 1
  },
  AccelStepper: { FUNCTION: 0, DRIVER: 1, FULL2WIRE: 2, FULL3WIRE: 3, FULL4WIRE: 4, HALF3WIRE: 6, HALF4WIRE: 8 },
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
  esp_err_t: { t: 'int' },
  // Texte en mémoire flash : PGM_P (const char * de pgmspace.h), const __FlashStringHelper * (F("…")).
  PGM_P: { t: 'cptr' }, __FlashStringHelper: { t: 'str' }, esp_now_send_status_t: { t: 'int' }, wl_status_t: { t: 'int' }, HTTPMethod: { t: 'int' }, wifi_mode_t: { t: 'int' },
  VL53L0X_Error: { t: 'i8' }, VL53L0X_Sense_config_t: { t: 'u8' },
  EthernetLinkStatus: { t: 'int' }, EthernetHardwareStatus: { t: 'int' }
};

/** Bibliothèques connues : #include accepté sans avertissement. */
export const KNOWN_INCLUDES = new Set([
  'Arduino.h', 'Wire.h', 'SPI.h', 'DHT.h', 'DHT_U.h', 'Adafruit_Sensor.h', 'OneWire.h', 'DallasTemperature.h', 'Adafruit_BMP280.h', 'Adafruit_BME280.h', 'BH1750.h', 'HX711.h',
  'Adafruit_MPU6050.h', 'LiquidCrystal_I2C.h', 'Adafruit_GFX.h', 'Adafruit_SSD1306.h', 'Servo.h', 'ESP32Servo.h', 'Adafruit_NeoPixel.h',
  'Stepper.h', 'AccelStepper.h', 'SoftwareSerial.h', 'math.h', 'stdlib.h', 'string.h', 'stdint.h', 'avr/pgmspace.h', 'pgmspace.h',
  'stdio.h', 'ctype.h', 'limits.h', 'inttypes.h', 'stdbool.h', 'avr/sleep.h', 'avr/io.h', 'avr/interrupt.h',
  'IRremote.h', 'IRremote.hpp', 'MFRC522.h', 'RF24.h', 'nRF24L01.h', 'Keypad.h', 'Encoder.h', 'printf.h', 'MPU6050.h', 'I2Cdev.h',
  'LedControl.h', 'MD_MAX72xx.h', 'TM1637Display.h', 'RTClib.h', 'I2C_eeprom.h',
  'Adafruit_MCP23X17.h', 'PCF8574.h', 'Adafruit_PWMServoDriver.h', 'Adafruit_ST7735.h', 'Adafruit_ILI9341.h', 'Adafruit_SPITFT.h', 'Adafruit_BusIO_Register.h', 'Adafruit_I2CDevice.h',
  'TinyGPSPlus.h', 'TinyGPS++.h',
  'Adafruit_VL53L0X.h', 'VL53L0X.h', 'MAX30105.h', 'heartRate.h', 'spo2_algorithm.h', 'Adafruit_TCS34725.h', 'Adafruit_CCS811.h', 'Adafruit_BME680.h', 'bme68x.h', 'bme68x_defs.h',
  'EEPROM.h', 'Preferences.h', 'BluetoothSerial.h', 'WiFi.h', 'ESP8266WiFi.h', 'WiFiClient.h', 'WebServer.h', 'ESP8266WebServer.h',
  'HTTPClient.h', 'ESP8266HTTPClient.h', 'esp_now.h', 'espnow.h', 'ESPmDNS.h', 'ESP8266mDNS.h', 'esp_wifi.h', 'SD.h', 'LoRa.h',
  // Réseau informatique (prog/netlib.js) : Ethernet (W5500 ; ENC28J60 par UIPEthernet ou EthernetENC), MQTT, Modbus TCP, ping.
  'Ethernet.h', 'EthernetClient.h', 'EthernetServer.h', 'EthernetUdp.h', 'UIPEthernet.h', 'EthernetENC.h', 'PubSubClient.h',
  'ArduinoModbus.h', 'ArduinoRS485.h', 'ESP32Ping.h', 'ESP8266Ping.h', 'WiFiServer.h', 'WiFiUdp.h'
]);
/** Bibliothèques reconnues mais non simulées : un message clair plutôt qu'une erreur obscure. */
export const UNSUPPORTED_INCLUDES = {
  'WiFiClientSecure.h': 'HTTPS', 'ESPAsyncWebServer.h': tl('le serveur web asynchrone'),
  'ArduinoJson.h': 'ArduinoJson', 'NTPClient.h': 'NTP'
};
