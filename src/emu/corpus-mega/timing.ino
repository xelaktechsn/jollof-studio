// expect: delay250=ok micros1000=ok millis=ok us=ok
// run-ms: 700
// Exactitude du temps : delay() mesuré par micros(), delayMicroseconds(), millis() par rapport à micros(), et
// résolution de micros() (4 µs à 16 MHz).
const char *ok(long err, long tol) { return labs(err) <= tol ? "ok" : "KO"; }
void setup() {
  Serial.begin(9600);
  unsigned long t0 = micros(); delay(250); long d = micros() - t0;
  t0 = micros(); delayMicroseconds(1000); long u = micros() - t0;
  unsigned long m0 = millis(), u0 = micros(); delay(300); long dm = millis() - m0, du = (micros() - u0) / 1000;
  unsigned long a = micros(), b; do { b = micros(); } while (b == a);
  Serial.print("delay250="); Serial.print(ok(d - 250000L, 1500));
  Serial.print(" micros1000="); Serial.print(ok(u - 1000, 20));
  Serial.print(" millis="); Serial.print(ok(dm - du, 2));
  Serial.print(" us="); Serial.println((b - a) % 4 == 0 && b - a <= 8 ? "ok" : "KO");
}
void loop() {}
