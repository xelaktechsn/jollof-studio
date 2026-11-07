// expect: begin=1
// expect: ax=19.61 gx=8.73
// expect: ar=1 gr=3
// expect: ax=29.42 gx=10.00
// module: {"type":"mpu6050","addr":[104],"data":{"ax":3,"ay":0,"az":1,"gx":10,"gy":0,"gz":-0.5,"temp":20}}
// run-ms: 900
// Plages de mesure : à ±2 g, une accélération de 3 g sature (32767 pas = 2 g) ; à ±4 g elle passe. Même chose
// pour 10 rad/s (573 °/s) à ±500 °/s, puis à ±2000 °/s.
#include <Adafruit_MPU6050.h>
Adafruit_MPU6050 mpu;
void show() {
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  Serial.print(F("ax=")); Serial.print(a.acceleration.x); Serial.print(F(" gx=")); Serial.println(g.gyro.x);
}
void setup() {
  Serial.begin(9600);
  Serial.print(F("begin=")); Serial.println(mpu.begin());
  show();
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setGyroRange(MPU6050_RANGE_2000_DEG);
  Serial.print(F("ar=")); Serial.print(mpu.getAccelerometerRange()); Serial.print(F(" gr=")); Serial.println(mpu.getGyroRange());
  show();
}
void loop() {}
