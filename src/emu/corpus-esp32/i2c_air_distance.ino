// expect: lox=1 mm=257 st=0
// expect: ccs=1 CO2=1250 TVOC=128
// expect: bme680 T=27.40 H=61.00 P=1009.49 G=85.00
// expect: max id=0x15 temp=31.2 doigt=1
// expect: fin
// module: {"type":"vl53l0x","addr":[41],"data":{"mm":257}}
// module: {"type":"ccs811","addr":[90],"levels":{"WAKE":0},"data":{"eco2":1250,"tvoc":128}}
// module: {"type":"bme680","addr":[119],"data":{"temp":27.4,"hum":61,"press":1009.5,"gas":85000}}
// module: {"type":"max30102","addr":[87],"data":{"bpm":75,"spo2":97,"finger":1,"temp":31.2}}
// module: {"type":"lcd2004","addr":[39]}
// screen: {"type":"lcd2004","lines":["Jollof Studio","","  ligne 3","Quatrieme ligne 20c"]}
// run-ms: 12000
// Bus I2C de l'ESP32 dans QEMU : distance VL53L0X (API complète d'ST), qualité de l'air CCS811, BME680 (gaz),
// oxymètre MAX30102 (SparkFun), écran LCD 20×4.
#include <Wire.h>
#include <Adafruit_VL53L0X.h>
#include "Adafruit_CCS811.h"
#include "Adafruit_BME680.h"
#include "MAX30105.h"
#include <LiquidCrystal_I2C.h>
Adafruit_VL53L0X lox = Adafruit_VL53L0X();
Adafruit_CCS811 ccs;
Adafruit_BME680 bme;
MAX30105 capteur;
LiquidCrystal_I2C lcd(0x27, 20, 4);
void setup() {
  Serial.begin(115200);
  Wire.begin();
  lcd.init(); lcd.backlight();
  lcd.print("Jollof Studio");
  lcd.setCursor(2, 2); lcd.print("ligne 3");
  lcd.setCursor(0, 3); lcd.print("Quatrieme ligne 20c");
  Serial.print("lox="); Serial.print(lox.begin());
  VL53L0X_RangingMeasurementData_t mesure;
  lox.rangingTest(&mesure, false);
  Serial.print(" mm="); Serial.print(mesure.RangeMilliMeter); Serial.print(" st="); Serial.println(mesure.RangeStatus);
  Serial.print("ccs="); Serial.print(ccs.begin());
  while (!ccs.available()) delay(10);
  while (true) {
    if (ccs.available() && !ccs.readData()) { Serial.print(" CO2="); Serial.print(ccs.geteCO2()); Serial.print(" TVOC="); Serial.println(ccs.getTVOC()); break; }
    delay(100);
  }
  if (bme.begin()) {
    bme.setTemperatureOversampling(BME680_OS_8X); bme.setHumidityOversampling(BME680_OS_2X);
    bme.setPressureOversampling(BME680_OS_4X); bme.setIIRFilterSize(BME680_FILTER_SIZE_3); bme.setGasHeater(320, 150);
    if (bme.performReading()) {
      Serial.print("bme680 T="); Serial.print(bme.temperature); Serial.print(" H="); Serial.print(bme.humidity);
      Serial.print(" P="); Serial.print(bme.pressure / 100.0); Serial.print(" G="); Serial.println(bme.gas_resistance / 1000.0);
    }
  }
  if (capteur.begin(Wire, I2C_SPEED_FAST)) {
    Serial.print("max id=0x"); Serial.print(capteur.readPartID(), HEX);
    capteur.setup(); capteur.setPulseAmplitudeRed(0x0A);
    Serial.print(" temp="); Serial.print(capteur.readTemperature(), 1);
    Serial.print(" doigt="); Serial.println(capteur.getIR() > 50000 ? 1 : 0);
  }
  Serial.println("fin");
}
void loop() {}
