// expect: A T=24.50 H=61.00
// expect: B T=23.00 H=45.00
// expect: cm=20 us=ok
// expect: far=0
// expect: m cm=ok
// expect: n=2
// expect: 0 28BC3F0B785437A0 T=21.50
// expect: 1 284F30FB2A86C37D T=-3.50
// expect: busy=1 done=1
// expect: 12bit T0=21.3125 T1=-3.6875
// expect: fin
// module: {"type":"dht22","pins":{"DATA":"D4"},"data":{"temp":24.5,"hum":61}}
// module: {"type":"dht11","pins":{"DATA":"D27"},"data":{"temp":23,"hum":45}}
// module: {"type":"hcsr04","pins":{"TRIG":"D13","ECHO":"D14"},"data":{"dist":20,"us":1160}}
// module: {"type":"hcsr04","pins":{"TRIG":"D25","ECHO":"D26"},"data":{"dist":50,"us":2900}}
// module: {"type":"ds18b20","id":"ds18b20_0","pins":{"DQ":"D32"},"data":{"temp":21.3}}
// module: {"type":"ds18b20","id":"ds18b20_1","pins":{"DQ":"D32"},"data":{"temp":-3.7}}
// input: {"D4":{"d":1},"D27":{"d":1},"D32":{"d":1}}
// run-ms: 15000
// Signaux temporisés sur l'ESP32 dans QEMU, avec les vraies bibliothèques : DHT22 et DHT11 (trame de 40 bits lue en
// comptant les tours de boucle, interruptions coupées), HC-SR04 par pulseIn() et par une boucle sur micros(), deux
// DS18B20 sur le même fil 1-Wire (recherche ROM, résolutions 9 et 12 bits, conversion sans attente).
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
DHT a(4, DHT22), b(27, DHT11);
OneWire bus(32);
DallasTemperature sondes(&bus);
long ping(int trig, int echo, unsigned w, unsigned long timeout) {
  digitalWrite(trig, LOW); delayMicroseconds(2);
  digitalWrite(trig, HIGH); delayMicroseconds(w); digitalWrite(trig, LOW);
  return pulseIn(echo, HIGH, timeout);
}
unsigned long pingMicros(int trig, int echo) {
  digitalWrite(trig, HIGH); delayMicroseconds(10); digitalWrite(trig, LOW);
  unsigned long t0 = micros();
  while (!digitalRead(echo)) if (micros() - t0 > 5000) return 0;
  unsigned long t1 = micros();
  while (digitalRead(echo)) if (micros() - t1 > 40000) break;
  return micros() - t1;
}
void setup() {
  Serial.begin(115200);
  a.begin(); b.begin();
  Serial.print("A T="); Serial.print(a.readTemperature()); Serial.print(" H="); Serial.println(a.readHumidity());
  Serial.print("B T="); Serial.print(b.readTemperature()); Serial.print(" H="); Serial.println(b.readHumidity());
  pinMode(13, OUTPUT); pinMode(14, INPUT); pinMode(25, OUTPUT); pinMode(26, INPUT);
  long us = ping(13, 14, 10, 30000);
  Serial.print("cm="); Serial.print((us + 29) / 58); Serial.print(" us="); Serial.println(abs(us - 1160) <= 15 ? "ok" : "bad");
  Serial.print("far="); Serial.println(ping(13, 14, 2, 5000));
  delay(60);
  unsigned long m = pingMicros(25, 26);
  Serial.print("m cm="); Serial.println(abs((long)((m + 29) / 58) - 50) <= 2 ? "ok" : String((m + 29) / 58)); // ±2 cm : la boucle chronomètre au temps réel de QEMU
  sondes.begin();
  Serial.print("n="); Serial.println(sondes.getDeviceCount());
  sondes.setResolution(9);
  sondes.requestTemperatures();
  for (int i = 0; i < 2; i++) {
    DeviceAddress ad;
    if (!sondes.getAddress(ad, i)) { Serial.println("no-addr"); continue; }
    Serial.print(i); Serial.print(' ');
    for (int k = 0; k < 8; k++) { if (ad[k] < 16) Serial.print('0'); Serial.print(ad[k], HEX); }
    Serial.print(" T="); Serial.println(sondes.getTempC(ad));
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
  Serial.println("fin");
}
void loop() {}
