// module: {"type":"bme680","addr":[119],"data":{"temp":27.4,"hum":61,"press":1009.5,"gas":85000}}
// expect: T=27.40 H=61.00 P=1009.49 G=85.00
// run-ms: 2000
// BME680 avec la bibliothèque d'Adafruit (API bme68x de Bosch, calculs en virgule flottante) : remise à zéro,
// coefficients d'étalonnage, mesure forcée avec chauffe du capteur de gaz (320 °C, 150 ms).
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include "Adafruit_BME680.h"
Adafruit_BME680 bme;
void setup() {
  Serial.begin(9600);
  if (!bme.begin()) { Serial.println("BME680 absent"); while (1); }
  bme.setTemperatureOversampling(BME680_OS_8X);
  bme.setHumidityOversampling(BME680_OS_2X);
  bme.setPressureOversampling(BME680_OS_4X);
  bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
  bme.setGasHeater(320, 150);
}
void loop() {
  if (!bme.performReading()) { Serial.println("echec"); return; }
  Serial.print("T="); Serial.print(bme.temperature); Serial.print(" H="); Serial.print(bme.humidity);
  Serial.print(" P="); Serial.print(bme.pressure / 100.0); Serial.print(" G="); Serial.println(bme.gas_resistance / 1000.0);
  delay(500);
}
