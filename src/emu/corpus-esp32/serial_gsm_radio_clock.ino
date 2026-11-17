// expect: [AT+CSQ|+CSQ: 20,0|OK]
// expect: [AT+CREG?|+CREG: 0,1|OK]
// expect: hc12 [OK][OK+C005]
// expect: running=1 nv=42,43
// expect: pas=200
// module: {"type":"sim800","pins":{"TXD":"D26","RXD":"D27"}}
// module: {"type":"hc12","pins":{"TXD":"RX2","RXD":"TX2","SET":"D4"}}
// module: {"type":"ds1307","addr":[104]}
// module: {"type":"max7219s","pins":{"DIN":"D23","CLK":"D18","CS":"D5"}}
// module: {"type":"drv8825","pins":{"STEP":"D32","DIR":"D33"},"levels":{"RESET":1,"SLEEP":1}}
// screen: {"type":"max7219s","on":true,"text":"-H2.7"}
// step: {"type":"drv8825","steps":200,"lost":0}
// run-ms: 12000
// Sur l'ESP32 dans QEMU : GSM SIM800L sur Serial1 (RX 26, TX 27), radio HC-12 en mode AT sur Serial2 (SET à LOW),
// horloge DS1307 (RTClib, RAM sauvegardée), afficheur MAX7219 à 8 chiffres (shiftOut, segments comme LedControl,
// qui ne compile pas pour l'ESP32), pilote DRV8825 (200 pas).
#include <Wire.h>
#include <RTClib.h>
RTC_DS1307 rtc;
void mx(byte reg, byte val) { digitalWrite(5, LOW); shiftOut(23, 18, MSBFIRST, reg); shiftOut(23, 18, MSBFIRST, val); digitalWrite(5, HIGH); }
String lire(HardwareSerial &s, unsigned long ms) {
  unsigned long t = millis();
  String r = "", ligne = "";
  while (millis() - t < ms) {
    while (s.available()) {
      char ch = s.read();
      if (ch != '\r' && ch != '\n') { ligne += ch; continue; }
      if (ligne.length()) { if (r.length()) r += "|"; r += ligne; ligne = ""; }
    }
  }
  if (ligne.length()) { if (r.length()) r += "|"; r += ligne; }
  return r;
}
void gsm(const char *c) { Serial1.println(c); Serial.print("["); Serial.print(lire(Serial1, 400)); Serial.println("]"); }
void setup() {
  Serial.begin(115200);
  Serial1.begin(9600, SERIAL_8N1, 26, 27);
  gsm("AT+CSQ");
  gsm("AT+CREG?");
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
  pinMode(4, OUTPUT); digitalWrite(4, LOW); delay(50);
  Serial.print("hc12 ");
  Serial2.print("AT"); Serial.print("["); Serial.print(lire(Serial2, 200)); Serial.print("]");
  Serial2.print("AT+C005"); Serial.print("["); Serial.print(lire(Serial2, 200)); Serial.println("]");
  digitalWrite(4, HIGH);
  Wire.begin();
  rtc.begin();
  Serial.print("running="); Serial.print(rtc.isrunning());
  rtc.writenvram(3, 42); rtc.writenvram(55, 43);
  Serial.print(" nv="); Serial.print(rtc.readnvram(3)); Serial.print(','); Serial.println(rtc.readnvram(55));
  pinMode(23, OUTPUT); pinMode(18, OUTPUT); pinMode(5, OUTPUT); digitalWrite(5, HIGH);
  mx(0x0F, 0); mx(0x0B, 7); mx(0x09, 0); mx(0x0C, 1); mx(0x0A, 4);   // test, balayage, sans décodage, en marche
  for (byte r = 1; r <= 8; r++) mx(r, 0);
  mx(1, 0x70); mx(2, 0x6D | 0x80); mx(3, 0x37); mx(4, 0x01);          // 7, 2., H, - (table de LedControl)
  pinMode(32, OUTPUT); pinMode(33, OUTPUT);
  digitalWrite(33, HIGH);
  int n = 0;
  for (; n < 200; n++) { digitalWrite(32, HIGH); delayMicroseconds(20); digitalWrite(32, LOW); delayMicroseconds(800); }
  Serial.print("pas="); Serial.println(n);
}
void loop() {}
