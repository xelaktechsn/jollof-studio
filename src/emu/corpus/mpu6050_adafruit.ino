// expect: begin=1
// expect: ar=0 gr=1
// expect: ax=4.90 ay=-2.45 az=7.85
// expect: gx=0.10 gy=-0.20 gz=1.50
// expect: t=28.40
// module: {"type":"mpu6050","addr":[104],"data":{"ax":0.5,"ay":-0.25,"az":0.8,"gx":0.1,"gy":-0.2,"gz":1.5,"temp":28.4}}
// run-ms: 900
// Centrale MPU-6050 (0x68) avec la vraie bibliothèque Adafruit_MPU6050 : begin() vérifie WHO_AM_I, remet la puce
// à zéro, règle ±2 g et ±500 °/s, la réveille ; getEvent() lit les 14 octets de mesure (m/s², rad/s, °C).
#include <Adafruit_MPU6050.h>
Adafruit_MPU6050 mpu;
void setup() {
  Serial.begin(9600);
  Serial.print(F("begin=")); Serial.println(mpu.begin());
  Serial.print(F("ar=")); Serial.print(mpu.getAccelerometerRange()); Serial.print(F(" gr=")); Serial.println(mpu.getGyroRange());
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  Serial.print(F("ax=")); Serial.print(a.acceleration.x); Serial.print(F(" ay=")); Serial.print(a.acceleration.y);
  Serial.print(F(" az=")); Serial.println(a.acceleration.z);
  Serial.print(F("gx=")); Serial.print(g.gyro.x); Serial.print(F(" gy=")); Serial.print(g.gyro.y);
  Serial.print(F(" gz=")); Serial.println(g.gyro.z);
  Serial.print(F("t=")); Serial.println(t.temperature);
}
void loop() {}
