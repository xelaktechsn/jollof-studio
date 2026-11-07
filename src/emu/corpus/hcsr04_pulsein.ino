// expect: cm=20 us=ok
// expect: far=0
// expect: none=38
// expect: short=0
// module: {"type":"hcsr04","pins":{"TRIG":"D9","ECHO":"D10"},"data":{"dist":20,"us":1160}}
// module: {"type":"hcsr04","pins":{"TRIG":"D11","ECHO":"D12"},"data":{"dist":0,"us":0}}
// run-ms: 400
// HC-SR04 mesuré avec pulseIn() : écho de 1160 µs (20 cm) ; obstacle hors de portée (ECHO haut 38 ms, que
// pulseIn ne voit pas finir avant 30 ms) ; impulsion TRIG trop courte (le module ne réagit pas).
long ping(int trig, int echo, unsigned w, unsigned long timeout) {
  digitalWrite(trig, LOW); delayMicroseconds(2);
  digitalWrite(trig, HIGH); delayMicroseconds(w); digitalWrite(trig, LOW);
  return pulseIn(echo, HIGH, timeout);
}
void setup() {
  Serial.begin(115200);
  pinMode(9, OUTPUT); pinMode(10, INPUT); pinMode(11, OUTPUT); pinMode(12, INPUT);
  long us = ping(9, 10, 10, 30000);
  Serial.print("cm="); Serial.print((us + 29) / 58); Serial.print(" us="); Serial.println(abs(us - 1160) <= 8 ? "ok" : "bad");
  Serial.print("far="); Serial.println(ping(11, 12, 10, 30000));
  delay(50);
  Serial.print("none="); Serial.println((ping(11, 12, 10, 100000) + 500) / 1000); // pulseIn perd un peu de temps dans les interruptions
  delay(60);
  Serial.print("short="); Serial.println(ping(9, 10, 2, 5000));
}
void loop() {}
