// expect: down R3C2
// expect: down R1C4
// expect: up
// module: {"type":"keypad","pins":{"R1":"D9","R2":"D8","R3":"D7","R4":"D6","C1":"D5","C2":"D4","C3":"D3","C4":"D2"}}
// event: 300 keypadDown keypad [2,1]
// event: 450 keypadUp keypad
// event: 600 keypadDown keypad [0,3]
// event: 750 keypadUp keypad
// run-ms: 900
// Balayage écrit à la main, dans l'autre sens que Keypad : les lignes sont des sorties mises à LOW tour à tour,
// les colonnes sont lues en INPUT_PULLUP (registres directs pour la lecture, digitalWrite pour l'écriture).
const byte rows[4] = {9, 8, 7, 6}, cols[4] = {5, 4, 3, 2};
int last = -1;
void setup() {
  Serial.begin(115200);
  for (byte r = 0; r < 4; r++) { pinMode(rows[r], OUTPUT); digitalWrite(rows[r], HIGH); }
  for (byte c = 0; c < 4; c++) pinMode(cols[c], INPUT_PULLUP);
}
int scan() {
  for (byte r = 0; r < 4; r++) {
    digitalWrite(rows[r], LOW);
    for (byte c = 0; c < 4; c++) if (!(PIND & _BV(cols[c]))) { digitalWrite(rows[r], HIGH); return r * 4 + c; }
    digitalWrite(rows[r], HIGH);
  }
  return -1;
}
void loop() {
  int k = scan();
  if (k != last) {
    if (k >= 0) { Serial.print("down R"); Serial.print(k / 4 + 1); Serial.print("C"); Serial.println(k % 4 + 1); }
    else if (last >= 0) Serial.println("up");
    last = k;
  }
  delay(5);
}
