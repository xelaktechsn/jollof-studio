// expect: n=2
// expect: 0 28BC3F0B785437A0 T=21.50
// expect: 1 284F30FB2A86C37D T=-3.50
// expect: busy=1 done=1
// expect: 12bit T0=21.3125 T1=-3.6875
// module: {"type":"ds18b20","pins":{"DQ":"D2"},"data":{"temp":21.3}}
// module: {"type":"ds18b20","pins":{"DQ":"D2"},"data":{"temp":-3.7}}
// input: {"D2":{"d":1}}
// run-ms: 1800
// Deux DS18B20 sur le même fil : la recherche ROM les énumère (bits en conflit), chacune répond à son adresse.
// Résolution 9 bits (pas de 0,5 °C), conversion sans attente (isConversionComplete), puis retour à 12 bits.
#include <OneWire.h>
#include <DallasTemperature.h>
OneWire bus(2);
DallasTemperature sondes(&bus);
void setup() {
  Serial.begin(115200);
  sondes.begin();
  Serial.print("n="); Serial.println(sondes.getDeviceCount());
  sondes.setResolution(9);
  sondes.requestTemperatures();
  for (int i = 0; i < 2; i++) {
    DeviceAddress a;
    if (!sondes.getAddress(a, i)) { Serial.println("no-addr"); continue; }
    Serial.print(i); Serial.print(' ');
    for (int k = 0; k < 8; k++) { if (a[k] < 16) Serial.print('0'); Serial.print(a[k], HEX); }
    Serial.print(" T="); Serial.println(sondes.getTempC(a));
  }
  sondes.setWaitForConversion(false);
  sondes.requestTemperatures();
  bool busy = !sondes.isConversionComplete();
  delay(120);
  Serial.print("busy="); Serial.print(busy); Serial.print(" done="); Serial.println(sondes.isConversionComplete());
  sondes.setWaitForConversion(true);
  sondes.setResolution(12);
  sondes.requestTemperatures();
  Serial.print("12bit T0="); Serial.print(sondes.getTempCByIndex(0), 4);
  Serial.print(" T1="); Serial.println(sondes.getTempCByIndex(1), 4);
}
void loop() {}
