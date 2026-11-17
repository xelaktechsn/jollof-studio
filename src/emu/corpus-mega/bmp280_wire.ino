// expect: begin=1
// expect: id=0x58
// expect: T=24.50
// expect: P=1007.35
// module: {"type":"bmp280","addr":[118],"data":{"temp":24.5,"press":1007.35}}
// run-ms: 600
// BMP280 sur le bus I2C du Mega (SDA D20, SCL D21) avec la vraie bibliothèque Adafruit_BMP280 (interruption TWI).
#include <Wire.h>
#include <Adafruit_BMP280.h>
Adafruit_BMP280 bmp;
void setup() {
  Serial.begin(9600);
  Serial.print(F("begin=")); Serial.println(bmp.begin(0x76));
  Serial.print(F("id=0x")); Serial.println(bmp.sensorID(), HEX);
  Serial.print(F("T=")); Serial.println(bmp.readTemperature());
  Serial.print(F("P=")); Serial.println(bmp.readPressure() / 100);
}
void loop() {}
