// expect: short=no-answer
// expect: bytes=03 69 80 7C 68 sum=ok
// expect: T=-12.4 H=87.3
// module: {"type":"dht22","pins":{"DATA":"D7"},"data":{"temp":-12.4,"hum":87.3}}
// input: {"D7":{"d":1}}
// run-ms: 400
// Lecture d'un DHT22 écrite à la main, sans bibliothèque : impulsion de départ, puis durée de chaque niveau haut
// mesurée avec micros() (26 µs : 0, 70 µs : 1). Une impulsion de 200 µs est trop courte : le capteur se tait.
const int PIN = 7;
byte d[5];
// Attend que la ligne quitte le niveau lv ; rend la durée en µs, ou -1 au-delà de max µs.
long waitWhile(int lv, unsigned max) {
  unsigned long t = micros();
  while (digitalRead(PIN) == lv) if (micros() - t > max) return -1;
  return micros() - t;
}
int readRaw(unsigned startUs) {
  for (int i = 0; i < 5; i++) d[i] = 0;
  pinMode(PIN, OUTPUT); digitalWrite(PIN, LOW);
  if (startUs >= 1000) delay(startUs / 1000); else delayMicroseconds(startUs);
  pinMode(PIN, INPUT); // relâchée : la résistance de tirage du module la ramène à HIGH
  if (waitWhile(HIGH, 100) < 0) return -1;
  if (waitWhile(LOW, 120) < 0) return -2;
  if (waitWhile(HIGH, 120) < 0) return -3;
  for (int i = 0; i < 40; i++) {
    if (waitWhile(LOW, 90) < 0) return -4;
    long h = waitWhile(HIGH, 110);
    if (h < 0) return -5;
    d[i / 8] = (d[i / 8] << 1) | (h > 45 ? 1 : 0);
  }
  return 0;
}
void hex2(byte b) { if (b < 16) Serial.print('0'); Serial.print(b, HEX); }
void setup() {
  Serial.begin(115200);
  Serial.print("short="); Serial.println(readRaw(200) == -1 ? "no-answer" : "answer");
  delay(5);
  int r = readRaw(2000);
  if (r) { Serial.print("err="); Serial.println(r); return; }
  Serial.print("bytes=");
  for (int i = 0; i < 5; i++) { hex2(d[i]); if (i < 4) Serial.print(' '); }
  Serial.print(" sum="); Serial.println(((d[0] + d[1] + d[2] + d[3]) & 0xFF) == d[4] ? "ok" : "bad");
  float t = (((d[2] & 0x7F) << 8) | d[3]) * 0.1, h = ((d[0] << 8) | d[1]) * 0.1;
  if (d[2] & 0x80) t = -t;
  Serial.print("T="); Serial.print(t, 1); Serial.print(" H="); Serial.println(h, 1);
}
void loop() {}
