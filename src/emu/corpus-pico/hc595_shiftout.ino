// expect: hc595-ok
// module: {"type":"hc595","pins":{"DS":"GP2","SHCP":"GP3","STCP":"GP6"}}
// chip-out: {"type":"hc595","Q0":0,"Q1":1,"Q2":1,"Q3":0,"Q4":1,"Q5":0,"Q6":0,"Q7":1}
// run-ms: 400
// 74HC595 piloté par le Pico : shiftOut() du cœur arduino-pico (LSBFIRST), puis front montant du verrou.
const int dataPin = 2, clockPin = 3, latchPin = 6;
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  pinMode(dataPin, OUTPUT); pinMode(clockPin, OUTPUT); pinMode(latchPin, OUTPUT);
  digitalWrite(latchPin, LOW);
  shiftOut(dataPin, clockPin, LSBFIRST, 0b01101001);
  digitalWrite(latchPin, HIGH);
  Serial.println("hc595-ok");
}
void loop() {}
