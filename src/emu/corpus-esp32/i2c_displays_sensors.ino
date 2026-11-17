// expect: found=6
// expect: bmp=1 T=24.50 P=1007.35
// expect: mpu=1 ax=4.90 ay=-2.45 az=7.85 t=28.40
// expect: oled=1 st=0
// expect: lux=ok H=4
// expect: tcs=1 R=1148 G=576 B=0 C=1724
// expect: fin
// lcd: Bonjour Dakar!|T=21.5 C°
// module: {"type":"lcd1602","addr":[39]}
// module: {"type":"bmp280","addr":[118],"data":{"temp":24.5,"press":1007.35}}
// module: {"type":"mpu6050","addr":[104],"data":{"ax":0.5,"ay":-0.25,"az":0.8,"gx":0.1,"gy":-0.2,"gz":1.5,"temp":28.4}}
// module: {"type":"oled","addr":[60]}
// module: {"type":"bh1750","addr":[35],"data":{"lux":420}}
// module: {"type":"tcs34725","addr":[41],"data":{"rgb":16744448,"lux":300}}
// run-ms: 8000
// Bus I2C de l'ESP32 (Wire, SDA 21, SCL 22) dans QEMU : six modules, chacun avec sa vraie bibliothèque — écran LCD
// 16×2, BMP280, MPU-6050, OLED SSD1306, BH1750, TCS34725 — et un balayage des adresses.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <BH1750.h>
#include "Adafruit_TCS34725.h"
LiquidCrystal_I2C lcd(0x27, 16, 2);
Adafruit_BMP280 bmp;
Adafruit_MPU6050 mpu;
Adafruit_SSD1306 display(128, 64, &Wire, -1);
BH1750 lux;
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_614MS, TCS34725_GAIN_1X);
byte status() { Wire.requestFrom((uint8_t)0x3C, (uint8_t)1); return Wire.read(); }
void setup() {
  Serial.begin(115200);
  Wire.begin();
  int n = 0;
  for (byte a = 1; a < 127; a++) { Wire.beginTransmission(a); if (Wire.endTransmission() == 0) n++; }
  Serial.print("found="); Serial.println(n);
  lcd.init(); lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("Bonjour Dakar!");
  lcd.setCursor(0, 1); lcd.print("T="); lcd.print(21.5, 1); lcd.print(" C"); lcd.write(0xDF);
  Serial.print("bmp="); Serial.print(bmp.begin(0x76));
  Serial.print(" T="); Serial.print(bmp.readTemperature()); Serial.print(" P="); Serial.println(bmp.readPressure() / 100);
  Serial.print("mpu="); Serial.print(mpu.begin());
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  Serial.print(" ax="); Serial.print(a.acceleration.x); Serial.print(" ay="); Serial.print(a.acceleration.y);
  Serial.print(" az="); Serial.print(a.acceleration.z); Serial.print(" t="); Serial.println(t.temperature);
  Serial.print("oled="); Serial.print(display.begin(SSD1306_SWITCHCAPVCC, 0x3C));
  display.clearDisplay(); display.setTextColor(SSD1306_WHITE); display.setCursor(0, 0); display.println("Jollof"); display.display();
  Serial.print(" st="); Serial.println(status());
  Serial.print("lux="); Serial.print(lux.begin() ? "ok" : "absent");
  delay(200);
  Serial.print(" H="); Serial.println(lux.readLightLevel(), 0);
  Serial.print("tcs="); Serial.print(tcs.begin());
  uint16_t r, gg, b, c;
  tcs.getRawData(&r, &gg, &b, &c);
  Serial.print(" R="); Serial.print(r); Serial.print(" G="); Serial.print(gg); Serial.print(" B="); Serial.print(b); Serial.print(" C="); Serial.println(c);
  Serial.println("fin");
}
void loop() {}
