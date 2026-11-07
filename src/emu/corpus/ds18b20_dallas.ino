// expect: n=1 parasite=0 addr=28BC3F0B785437A0
// expect: res=12 T=23.0625 wait12=ok
// expect: res=9 T=23.00 wait9=ok
// expect: F=73.40
// module: {"type":"ds18b20","pins":{"DQ":"D2"},"data":{"temp":23.0625}}
// input: {"D2":{"d":1}}
// run-ms: 1600
// Une DS18B20 avec les vraies bibliothèques OneWire et DallasTemperature : recherche de l'adresse, conversion en
// 12 bits (attente par lecture du bit d'état), puis passage en 9 bits (bloc-notes écrit et copié en EEPROM).
#include <OneWire.h>
#include <DallasTemperature.h>
OneWire bus(2);
DallasTemperature sondes(&bus);
DeviceAddress a;
void mesure(int lo, int hi, const char *tag) {
  unsigned long t0 = millis();
  sondes.requestTemperatures();
  unsigned long dt = millis() - t0;
  Serial.print("res="); Serial.print(sondes.getResolution(a));
  Serial.print(" T="); Serial.print(sondes.getTempCByIndex(0), sondes.getResolution(a) == 12 ? 4 : 2);
  Serial.print(tag); Serial.println(dt > lo && dt < hi ? "ok" : "bad");
}
void setup() {
  Serial.begin(115200);
  sondes.begin();
  Serial.print("n="); Serial.print(sondes.getDeviceCount());
  Serial.print(" parasite="); Serial.print(sondes.isParasitePowerMode());
  Serial.print(" addr=");
  sondes.getAddress(a, 0);
  for (int i = 0; i < 8; i++) { if (a[i] < 16) Serial.print('0'); Serial.print(a[i], HEX); }
  Serial.println();
  mesure(400, 760, " wait12=");
  sondes.setResolution(9);
  mesure(40, 100, " wait9=");
  Serial.print("F="); Serial.println(sondes.getTempF(a));
}
void loop() {}
