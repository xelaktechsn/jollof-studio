// expect: delay=ok cm=50
// expect: pings=3 busy-ignored=ok
// module: {"type":"hcsr04","pins":{"TRIG":"D4","ECHO":"D5"},"data":{"dist":50,"us":2900}}
// run-ms: 400
// HC-SR04 mesuré comme le fait NewPing : boucle sur micros() et lecture directe du registre d'entrée (PIND).
// Un second déclenchement pendant l'écho est ignoré par le module.
const byte TRIG = 4, ECHO = 5;
bool echoHigh() { return PIND & _BV(ECHO); }
void trigger() { digitalWrite(TRIG, HIGH); delayMicroseconds(10); digitalWrite(TRIG, LOW); }
// Rend la durée de l'écho (µs), 0 sans écho ; *wait : délai entre la fin de TRIG et le début de l'écho.
unsigned long ping(unsigned long *wait, bool retrig) {
  trigger();
  unsigned long t0 = micros();
  while (!echoHigh()) if (micros() - t0 > 5000) return 0;
  unsigned long t1 = micros();
  if (retrig) { delayMicroseconds(300); trigger(); }
  while (echoHigh()) if (micros() - t1 > 40000) break;
  *wait = t1 - t0;
  return micros() - t1;
}
void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  unsigned long w, us = ping(&w, false);
  Serial.print("delay="); Serial.print(w > 200 && w < 320 ? "ok" : "bad");
  Serial.print(" cm="); Serial.println((us + 29) / 58);
  int n = 0; bool ok = true;
  for (int i = 0; i < 3; i++) {
    delay(60);
    unsigned long d = ping(&w, i == 1);
    if (d) n++;
    if ((d + 29) / 58 != 50) ok = false;
  }
  Serial.print("pings="); Serial.print(n); Serial.print(" busy-ignored="); Serial.println(ok ? "ok" : "bad");
}
void loop() {}
