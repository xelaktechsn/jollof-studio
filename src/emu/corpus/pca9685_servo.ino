// expect: pre=121
// expect: off=307
// module: {"type":"pca9685","addr":[64]}
// chip-out: {"type":"pca9685","PWM0":{"servo":[85,96]},"PWM3":{"duty":[0.49,0.51]},"PWM5":{"duty":[0,0]}}
// run-ms: 400
// Pilote PWM PCA9685 avec la vraie bibliothèque Adafruit_PWMServoDriver : 50 Hz, impulsion de 1,5 ms sur la voie 0.
#include <Adafruit_PWMServoDriver.h>
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
void setup() {
  Serial.begin(9600);
  pwm.begin();
  pwm.setPWMFreq(50);
  pwm.setPWM(0, 0, 307);
  pwm.setPin(3, 2048);
  Serial.print("pre="); Serial.println(pwm.readPrescale());
  Serial.print("off="); Serial.println(pwm.getPWM(0, true));
}
void loop() {}
