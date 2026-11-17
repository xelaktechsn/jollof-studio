// expect: hc595-ok
// module: {"type":"hc595","pins":{"DS":"D11","SHCP":"D12","STCP":"D8"}}
// chip-out: {"type":"hc595","Q0":1,"Q1":0,"Q2":1,"Q3":0,"Q4":0,"Q5":1,"Q6":0,"Q7":1,"Q7S":1}
// Registre à décalage 74HC595 : shiftOut() du cœur Arduino, puis front montant du verrou.
const int dataPin = 11, clockPin = 12, latchPin = 8;
void setup() {
  Serial.begin(9600);
  pinMode(dataPin, OUTPUT); pinMode(clockPin, OUTPUT); pinMode(latchPin, OUTPUT);
  digitalWrite(latchPin, LOW);
  shiftOut(dataPin, clockPin, MSBFIRST, 0x5A);  // d'abord un autre motif, jamais verrouillé tel quel
  shiftOut(dataPin, clockPin, MSBFIRST, 0b10100101);
  digitalWrite(latchPin, HIGH);
  Serial.println("hc595-ok");
}
void loop() {}
