// expect: id=0x58
// expect: T=21.50
// module: {"type":"bmp280","addr":[118],"data":{"temp":21.5,"press":1008}}
// run-ms: 400
// BMP280 sur le bus I2C matériel du Pico (Wire : GP4/GP5) avec la vraie bibliothèque d'Adafruit : lecture des
// coefficients d'étalonnage, mesure, compensation.
#include <Wire.h>
#include <Adafruit_BMP280.h>
Adafruit_BMP280 bmp;
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  if (!bmp.begin(0x76)) { Serial.println("absent"); return; }
  Serial.print("id=0x"); Serial.println(bmp.sensorID(), HEX);
  delay(50);
  Serial.print("T="); Serial.println(bmp.readTemperature());
}
void loop() {}
