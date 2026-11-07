// expect: T=24.50 H=61.00
// expect: T2=-7.30
// module: {"type":"dht22","pins":{"DATA":"GP2"},"data":{"temp":24.5,"hum":61}}
// module: {"type":"dht22","pins":{"DATA":"GP3"},"data":{"temp":-7.3,"hum":35.5}}
// input: {"GP2":{"d":1},"GP3":{"d":1}}
// run-ms: 400
// Deux DHT22 avec la vraie bibliothèque d'Adafruit sur le Pico : trame de 40 bits mesurée au cycle près
// (modèle src/emu/devices/dht.js, horloge de 125 MHz du RP2040).
#include <DHT.h>
DHT a(2, DHT22), b(3, DHT22);
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  a.begin(); b.begin();
  Serial.print("T="); Serial.print(a.readTemperature()); Serial.print(" H="); Serial.println(a.readHumidity());
  Serial.print("T2="); Serial.println(b.readTemperature());
}
void loop() {}
