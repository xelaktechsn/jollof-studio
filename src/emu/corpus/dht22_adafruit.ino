// expect: A T=24.50 H=61.00
// expect: B T=-7.30 H=35.50
// expect: A2 T=24.50
// module: {"type":"dht22","pins":{"DATA":"D2"},"data":{"temp":24.5,"hum":61}}
// module: {"type":"dht22","pins":{"DATA":"D3"},"data":{"temp":-7.3,"hum":35.5}}
// input: {"D2":{"d":1},"D3":{"d":1}}
// run-ms: 2600
// Deux DHT22 avec la vraie bibliothèque d'Adafruit : trame de 40 bits, température négative (bit de signe),
// puis une nouvelle mesure 2 s plus tard (période d'échantillonnage du capteur).
#include <DHT.h>
DHT a(2, DHT22), b(3, DHT22);
void show(const char *n, DHT &d) {
  Serial.print(n); Serial.print(" T="); Serial.print(d.readTemperature());
  Serial.print(" H="); Serial.println(d.readHumidity());
}
void setup() {
  Serial.begin(9600);
  a.begin(); b.begin();
  show("A", a); show("B", b);
  delay(2100);
  Serial.print("A2 T="); Serial.println(a.readTemperature());
}
void loop() {}
