// expect: short-reset=no-presence
// expect: presence=1 family=28 rom-crc=ok
// expect: power=external
// expect: conv=ok
// expect: pad=78 01 1E F6 3F
// expect: pad-crc=ok T=23.50
// expect: alarm=none
// expect: alarm=yes
// module: {"type":"ds18b20","pins":{"DQ":"D6"},"data":{"temp":23.4}}
// input: {"D6":{"d":1}}
// run-ms: 900
// Protocole 1-Wire écrit à la main, sans bibliothèque (la carte relâche la ligne au lieu de la forcer à HIGH) :
// lecture de l'adresse, alimentation, écriture du bloc-notes (TH = 30, TL = -10, 10 bits), conversion suivie bit
// à bit, lecture du bloc-notes et de son CRC, puis recherche des sondes en alarme avant et après TH = 20.
const byte P = 6;
bool reset(unsigned lowUs) {
  pinMode(P, OUTPUT); delayMicroseconds(lowUs);
  pinMode(P, INPUT); delayMicroseconds(65);
  bool here = !digitalRead(P);
  delayMicroseconds(420);
  return here;
}
void writeBit(bool b) {
  noInterrupts();
  pinMode(P, OUTPUT);
  if (b) { delayMicroseconds(5); pinMode(P, INPUT); interrupts(); delayMicroseconds(60); }
  else { delayMicroseconds(65); pinMode(P, INPUT); interrupts(); delayMicroseconds(5); }
}
bool readBit() {
  noInterrupts();
  pinMode(P, OUTPUT); delayMicroseconds(2);
  pinMode(P, INPUT); delayMicroseconds(5);
  bool b = digitalRead(P);
  interrupts();
  delayMicroseconds(55);
  return b;
}
void writeByte(byte v) { for (int i = 0; i < 8; i++) writeBit((v >> i) & 1); }
byte readByte() { byte v = 0; for (int i = 0; i < 8; i++) if (readBit()) v |= 1 << i; return v; }
byte crc8(const byte *a, int n) {
  byte crc = 0;
  for (int i = 0; i < n; i++) { byte b = a[i]; for (int j = 0; j < 8; j++) { byte mix = (crc ^ b) & 1; crc >>= 1; if (mix) crc ^= 0x8C; b >>= 1; } }
  return crc;
}
void hex2(byte b) { if (b < 16) Serial.print('0'); Serial.print(b, HEX); }
void writePad(byte th, byte tl, byte cfg) { reset(500); writeByte(0xCC); writeByte(0x4E); writeByte(th); writeByte(tl); writeByte(cfg); }
unsigned long convert() {
  reset(500); writeByte(0xCC); writeByte(0x44);
  unsigned long t0 = millis();
  while (!readBit()) if (millis() - t0 > 1000) break;
  return millis() - t0;
}
const char *alarmSearch() {
  if (!reset(500)) return "no-presence";
  writeByte(0xEC);
  bool b = readBit(), nb = readBit();
  return b && nb ? "none" : "yes";
}
void setup() {
  Serial.begin(115200);
  digitalWrite(P, LOW); // la sortie, quand elle est activée, tire à LOW ; sinon la ligne est relâchée
  pinMode(P, INPUT);
  Serial.print("short-reset="); Serial.println(reset(100) ? "presence" : "no-presence");
  bool here = reset(500);
  writeByte(0x33);
  byte rom[8];
  for (int i = 0; i < 8; i++) rom[i] = readByte();
  Serial.print("presence="); Serial.print(here); Serial.print(" family="); Serial.print(rom[0], HEX);
  Serial.print(" rom-crc="); Serial.println(crc8(rom, 7) == rom[7] ? "ok" : "bad");
  reset(500); writeByte(0xCC); writeByte(0xB4);
  Serial.print("power="); Serial.println(readBit() ? "external" : "parasite");
  writePad(30, (byte)-10, 0x3F);
  unsigned long ms = convert();
  Serial.print("conv="); Serial.println(ms > 120 && ms < 190 ? "ok" : "bad");
  reset(500); writeByte(0xCC); writeByte(0xBE);
  byte pad[9];
  for (int i = 0; i < 9; i++) pad[i] = readByte();
  Serial.print("pad="); for (int i = 0; i < 5; i++) { hex2(pad[i]); if (i < 4) Serial.print(' '); } Serial.println();
  int16_t raw = (pad[1] << 8) | pad[0];
  Serial.print("pad-crc="); Serial.print(crc8(pad, 8) == pad[8] ? "ok" : "bad");
  Serial.print(" T="); Serial.println(raw / 16.0);
  Serial.print("alarm="); Serial.println(alarmSearch());
  writePad(20, (byte)-10, 0x3F);
  convert();
  Serial.print("alarm="); Serial.println(alarmSearch());
}
void loop() {}
