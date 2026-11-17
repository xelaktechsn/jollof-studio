// expect: rtc=1 lost=0
// expect: 2030/02/28 23:59:59
// expect: 2030/03/01 00:00:01
// expect: ee=1 bad=0 struct=1234,-5.50
// expect: mcp-ok b0=0 b1=1
// expect: pcf-ok p7=0 p6=1
// expect: pre=121 off=307
// expect: bme T=23.5 H=61 P=1002 ID=60
// expect: fin
// module: {"type":"ds3231","addr":[104,87],"data":{"temp":21.3}}
// module: {"type":"at24c256","addr":[80]}
// module: {"type":"mcp23017","addr":[32],"levels":{"GPB0":0}}
// module: {"type":"pcf8574","addr":[33],"levels":{"P7":0}}
// module: {"type":"pca9685","addr":[64]}
// module: {"type":"bme280","addr":[118],"data":{"temp":23.5,"hum":61,"press":1002}}
// chip-out: {"type":"mcp23017","GPA0":1,"GPA1":0,"GPA7":1}
// chip-out: {"type":"pcf8574","P0":0,"P1":1}
// chip-out: {"type":"pca9685","PWM0":{"servo":[85,96]},"PWM3":{"duty":[0.49,0.51]}}
// run-ms: 9000
// Bus I2C de l'ESP32 dans QEMU : horloge DS3231 (RTClib, passage à minuit au rythme du temps des modules), mémoire
// AT24C256 (I2C_eeprom, cycles d'écriture attendus par acquittement), extenseurs MCP23017 et PCF8574, PCA9685, BME280.
#include <Wire.h>
#include <RTClib.h>
#include <I2C_eeprom.h>
#include <Adafruit_MCP23X17.h>
#include <PCF8574.h>
#include <Adafruit_PWMServoDriver.h>
#include <Adafruit_BME280.h>
RTC_DS3231 rtc;
I2C_eeprom ee(0x50, I2C_DEVICESIZE_24LC256);
Adafruit_MCP23X17 mcp;
PCF8574 pcf(0x21);
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
Adafruit_BME280 bme;
struct Mesure { int id; float v; };
void show(const DateTime &t) {
  char b[24];
  sprintf(b, "%04d/%02d/%02d %02d:%02d:%02d", t.year(), t.month(), t.day(), t.hour(), t.minute(), t.second());
  Serial.println(b);
}
void setup() {
  Serial.begin(115200);
  Wire.begin();
  Serial.print("rtc="); Serial.print(rtc.begin()); Serial.print(" lost="); Serial.println(rtc.lostPower());
  rtc.adjust(DateTime(2030, 2, 28, 23, 59, 59));
  show(rtc.now());
  ee.begin();
  Serial.print("ee="); Serial.print(ee.isConnected());
  uint8_t buf[200];
  for (int i = 0; i < 200; i++) buf[i] = i ^ 0x5A;
  ee.writeBlock(1000, buf, 200);
  memset(buf, 0, sizeof buf);
  ee.readBlock(1000, buf, 200);
  int bad = 0; for (int i = 0; i < 200; i++) if (buf[i] != (i ^ 0x5A)) bad++;
  Serial.print(" bad="); Serial.print(bad);
  Mesure m = { 1234, -5.5 }, r;
  ee.writeBlock(20, (uint8_t *)&m, sizeof m);
  ee.readBlock(20, (uint8_t *)&r, sizeof r);
  Serial.print(" struct="); Serial.print(r.id); Serial.print(','); Serial.println(r.v);
  if (mcp.begin_I2C()) {
    mcp.pinMode(0, OUTPUT); mcp.pinMode(1, OUTPUT); mcp.pinMode(7, OUTPUT);
    mcp.digitalWrite(0, HIGH); mcp.digitalWrite(1, LOW); mcp.digitalWrite(7, HIGH);
    mcp.pinMode(8, INPUT_PULLUP); mcp.pinMode(9, INPUT_PULLUP);
    Serial.print("mcp-ok b0="); Serial.print(mcp.digitalRead(8)); Serial.print(" b1="); Serial.println(mcp.digitalRead(9));
  }
  if (pcf.begin()) { pcf.write(0, LOW); Serial.print("pcf-ok p7="); Serial.print(pcf.read(7)); Serial.print(" p6="); Serial.println(pcf.read(6)); }
  pwm.begin(); pwm.setPWMFreq(50); pwm.setPWM(0, 0, 307); pwm.setPin(3, 2048);
  Serial.print("pre="); Serial.print(pwm.readPrescale()); Serial.print(" off="); Serial.println(pwm.getPWM(0, true));
  if (bme.begin(0x76)) {
    delay(200);
    Serial.print("bme T="); Serial.print(bme.readTemperature(), 1); Serial.print(" H="); Serial.print(bme.readHumidity(), 0);
    Serial.print(" P="); Serial.print(bme.readPressure() / 100.0, 0); Serial.print(" ID="); Serial.println(bme.sensorID(), HEX);
  }
  while (rtc.now().second() != 1) delay(50);
  show(rtc.now());
  Serial.println("fin");
}
void loop() {}
