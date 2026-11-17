// expect: pre=121
// module: {"type":"pca9685","addr":[64]}
// chip-out: {"type":"pca9685","PWM15":{"servo":[85,96]}}
// run-ms: 500
// PCA9685 sur le bus I2C matériel du Pico (GP4/GP5) avec la vraie bibliothèque Adafruit_PWMServoDriver.
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
Adafruit_PWMServoDriver pwm;
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  pwm.begin();
  pwm.setPWMFreq(50);
  pwm.writeMicroseconds(15, 1500);
  Serial.print("pre="); Serial.println(pwm.readPrescale());
}
void loop() {}
