// expect: pi=3.14159 sqrt=1.41421 sin=0.50000
void setup() {
  Serial.begin(9600);
  Serial.print("pi="); Serial.print(PI, 5);
  Serial.print(" sqrt="); Serial.print(sqrt(2.0), 5);
  Serial.print(" sin="); Serial.println(sin(PI / 6), 5);
}
void loop() {}
