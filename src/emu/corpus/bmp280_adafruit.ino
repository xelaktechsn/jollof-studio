// expect: begin=1
// expect: id=0x58
// expect: T=24.50
// expect: P=1007.35
// expect: Alt=49
// module: {"type":"bmp280","addr":[118],"data":{"temp":24.5,"press":1007.35}}
// run-ms: 600
// Capteur BMP280 (SDO à la masse : adresse 0x76) avec la vraie bibliothèque Adafruit_BMP280 : la bibliothèque lit
// l'identifiant, les coefficients d'étalonnage, puis les mesures brutes, et refait les calculs de la fiche technique.
#include <Wire.h>
#include <Adafruit_BMP280.h>
Adafruit_BMP280 bmp;
void setup() {
  Serial.begin(9600);
  Serial.print(F("begin=")); Serial.println(bmp.begin(0x76));
  Serial.print(F("id=0x")); Serial.println(bmp.sensorID(), HEX);
  Serial.print(F("T=")); Serial.println(bmp.readTemperature());
  Serial.print(F("P=")); Serial.println(bmp.readPressure() / 100);
  Serial.print(F("Alt=")); Serial.println(bmp.readAltitude(1013.25), 0);
}
void loop() {}
