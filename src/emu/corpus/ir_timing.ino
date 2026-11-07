// expect: nec addr=0 naddr=FF cmd=5A ncmd=A5
// expect: repeat
// expect: header=9 ms
// module: {"type":"ir","pins":{"OUT":"D3"}}
// event: 300 irPress ir [90]
// event: 400 irPress ir [90,true]
// run-ms: 700
// Décodeur NEC écrit à la main : interruption externe sur chaque front de OUT (INT1) et durées mesurées avec
// micros(). Vérifie la forme du signal (salve de 9 ms, silence de 4,5 ms ou 2,25 ms, bits par la durée du silence).
volatile unsigned long lastT = 0, header = 0;
volatile uint32_t data = 0;
volatile byte n = 0, state = 0;
volatile bool got = false, rep = false;
void edge() {
  unsigned long t = micros(), d = t - lastT;
  lastT = t;
  if (digitalRead(3)) {               // front montant : fin d'une salve (durée d)
    if (d > 8000 && d < 10000) { state = 1; header = d; }
    return;
  }
  if (state == 1) {                   // front descendant : fin d'un silence (durée d)
    if (d > 4000 && d < 5000) { state = 2; n = 0; data = 0; }
    else { if (d > 2000 && d < 2500) rep = true; state = 0; }
  } else if (state == 2) {
    if (d > 1200) data |= 1UL << n;
    if (++n == 32) { got = true; state = 0; }
  }
}
void setup() {
  Serial.begin(115200);
  pinMode(3, INPUT);
  attachInterrupt(digitalPinToInterrupt(3), edge, CHANGE);
}
void loop() {
  if (got) {
    got = false;
    Serial.print("nec addr="); Serial.print(data & 0xFF, HEX);
    Serial.print(" naddr="); Serial.print((data >> 8) & 0xFF, HEX);
    Serial.print(" cmd="); Serial.print((data >> 16) & 0xFF, HEX);
    Serial.print(" ncmd="); Serial.println((data >> 24) & 0xFF, HEX);
    Serial.print("header="); Serial.print((header + 500) / 1000); Serial.println(" ms");
  }
  if (rep) { rep = false; Serial.println("repeat"); }
}
