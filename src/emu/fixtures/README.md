# Firmware fixtures

`blink.uno.hex` is `blink/blink.ino` compiled for the Arduino Uno with the Arduino AVR core 1.8.8
and the Servo library (arduino-cli 1.5.1). It links the Arduino core (LGPL-2.1) and Servo
(LGPL-2.1); their sources are at https://github.com/arduino/ArduinoCore-avr and
https://github.com/arduino-libraries/Servo.

Rebuild:

```bash
arduino-cli lib install Servo
arduino-cli compile --fqbn arduino:avr:uno --output-dir /tmp/fx src/emu/fixtures/blink
cp /tmp/fx/blink.ino.hex src/emu/fixtures/blink.uno.hex
```
