// expect: nack=2
// expect: ack=0
// expect: st0=64
// expect: st1=0
// expect: done
// module: {"type":"oled","addr":[60]}
// Écran OLED piloté sans bibliothèque : octet de contrôle 0x00 (commandes) ou 0x40 (image), adressage par page
// (0xB0 + page, puis quartets de la colonne), pompe de charge (0x8D 0x14) puis allumage (0xAF).
#include <Wire.h>
const byte OLED = 0x3C;
byte cmd(const byte *c, byte n) { Wire.beginTransmission(OLED); Wire.write(0x00); Wire.write(c, n); return Wire.endTransmission(); }
byte status() { Wire.requestFrom(OLED, (uint8_t)1); return Wire.read(); }
void setup() {
  Serial.begin(9600); Wire.begin();
  Wire.beginTransmission(0x3D); Serial.print(F("nack=")); Serial.println(Wire.endTransmission());
  const byte init[] = { 0xAE, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0xA1, 0xC8, 0xDA, 0x12, 0x81, 0x7F, 0xA4, 0xA6, 0xD5, 0x80, 0x8D, 0x14 };
  Serial.print(F("ack=")); Serial.println(cmd(init, sizeof init));
  Serial.print(F("st0=")); Serial.println(status());
  const byte on[] = { 0xAF };
  cmd(on, 1);
  Serial.print(F("st1=")); Serial.println(status());
  for (byte p = 0; p < 8; p++) {
    const byte at[] = { (byte)(0xB0 + p), 0x00, 0x10 };
    cmd(at, 3);
    // Page effacée par paquets de 16 octets (le tampon de Wire fait 32 octets ; la mémoire de l'écran, au
    // démarrage, contient n'importe quoi).
    for (byte k = 0; k < 8; k++) { Wire.beginTransmission(OLED); Wire.write(0x40); for (byte i = 0; i < 16; i++) Wire.write(0); Wire.endTransmission(); }
  }
  // Page 2, colonne 10 : une bande de 8 pixels de haut et 20 colonnes de large.
  const byte at[] = { 0xB2, 0x0A, 0x10 };
  cmd(at, 3);
  Wire.beginTransmission(OLED); Wire.write(0x40);
  for (byte i = 0; i < 20; i++) Wire.write(0xFF);
  Wire.endTransmission();
  Serial.println(F("done"));
}
void loop() {}
