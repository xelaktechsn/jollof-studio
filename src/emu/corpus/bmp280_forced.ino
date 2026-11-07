// expect: b76=0
// expect: b77=1
// expect: forced=1
// expect: wait=3
// expect: T=-5.25
// expect: P=980.00
// expect: ctrl=0x54
// expect: st=0
// module: {"type":"bmp280","addr":[119],"data":{"temp":-5.25,"press":980}}
// run-ms: 800
// BMP280 à l'adresse 0x77 (SDO en l'air ou au +), en mode forcé : une mesure à la demande, puis la puce se
// rendort (les deux bits de mode de 0xF4 reviennent à 00). La mesure dure environ 37 ms (×2 et ×16).
#include <Wire.h>
#include <Adafruit_BMP280.h>
Adafruit_BMP280 bmp;
byte reg(byte r) { Wire.beginTransmission(0x77); Wire.write(r); Wire.endTransmission(); Wire.requestFrom((uint8_t)0x77, (uint8_t)1); return Wire.read(); }
void setup() {
  Serial.begin(9600);
  Serial.print(F("b76=")); Serial.println(bmp.begin(0x76));
  Serial.print(F("b77=")); Serial.println(bmp.begin());
  bmp.setSampling(Adafruit_BMP280::MODE_FORCED, Adafruit_BMP280::SAMPLING_X2, Adafruit_BMP280::SAMPLING_X16,
                  Adafruit_BMP280::FILTER_OFF, Adafruit_BMP280::STANDBY_MS_500);
  unsigned long t = millis();
  Serial.print(F("forced=")); Serial.println(bmp.takeForcedMeasurement());
  Serial.print(F("wait=")); Serial.println(millis() - t);
  Serial.print(F("T=")); Serial.println(bmp.readTemperature());
  Serial.print(F("P=")); Serial.println(bmp.readPressure() / 100);
  Serial.print(F("ctrl=0x")); Serial.println(reg(0xF4), HEX);
  Serial.print(F("st=")); Serial.println(bmp.getStatus());
}
void loop() {}
