// expect: sensor=512 out=127 volts=2.50
// input: {"A0":{"v":2.5}}
// Lecture d'un potentiomètre (A0), mise à l'échelle avec map() et sortie PWM, comme l'exemple AnalogInOutSerial.
void setup() { Serial.begin(9600); pinMode(9, OUTPUT); }
void loop() {
  int sensor = analogRead(A0);
  int out = map(sensor, 0, 1023, 0, 255);
  analogWrite(9, out);
  Serial.print("sensor="); Serial.print(sensor);
  Serial.print(" out="); Serial.print(out);
  Serial.print(" volts="); Serial.println(sensor * 5.0 / 1023.0, 2);
  delay(100);
}
