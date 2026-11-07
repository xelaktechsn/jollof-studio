// expect: T=23.00 H=40.00 F=73.40
// expect: wrong-type=nan
// module: {"type":"dht11","pins":{"DATA":"D4"},"data":{"temp":23,"hum":40}}
// module: {"type":"dht11","pins":{"DATA":"D5"},"data":{"temp":30,"hum":70}}
// input: {"D4":{"d":1},"D5":{"d":1}}
// run-ms: 500
// DHT11 avec la vraie bibliothèque d'Adafruit (impulsion de départ de 20 ms). Le second capteur est déclaré DHT22
// dans le code : la bibliothèque ne le tient que 1,1 ms à LOW, trop peu pour réveiller un DHT11, qui ne répond pas.
#include <DHT.h>
DHT dht(4, DHT11), faux(5, DHT22);
void setup() {
  Serial.begin(9600);
  dht.begin(); faux.begin();
  Serial.print("T="); Serial.print(dht.readTemperature());
  Serial.print(" H="); Serial.print(dht.readHumidity());
  Serial.print(" F="); Serial.println(dht.readTemperature(true));
  Serial.print("wrong-type="); Serial.println(isnan(faux.readTemperature()) ? "nan" : "value");
}
void loop() {}
