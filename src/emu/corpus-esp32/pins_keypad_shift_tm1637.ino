// expect: hc595-ok
// expect: in=10110010
// expect: pret
// expect: key=6
// expect: key=*
// expect: key=D
// not-expect: key=5
// module: {"type":"hc595","pins":{"DS":"D23","SHCP":"D18","STCP":"D5"}}
// module: {"type":"hc165","pins":{"PL":"D19","CP":"D21","Q7":"D22","CE":"D15"},"levels":{"D0":0,"D1":1,"D2":0,"D3":0,"D4":1,"D5":1,"D6":0,"D7":1}}
// module: {"type":"tm1637","pins":{"CLK":"D4","DIO":"D2"}}
// module: {"type":"keypad","pins":{"R1":"D13","R2":"D12","R3":"D14","R4":"D27","C1":"D26","C2":"D25","C3":"D33","C4":"D32"}}
// chip-out: {"type":"hc595","Q0":1,"Q1":0,"Q2":1,"Q3":0,"Q4":0,"Q5":1,"Q6":0,"Q7":1,"Q7S":1}
// screen: {"type":"tm1637","on":true,"text":"12:05"}
// event: 3000 keypadDown keypad [1,2]
// event: 3400 keypadUp keypad
// event: 3800 keypadDown keypad [3,0]
// event: 4200 keypadUp keypad
// event: 4600 keypadDown keypad [3,3]
// run-ms: 9000
// Broches de l'ESP32 dans QEMU reliées à des modules qui répondent au front près : 74HC595 (shiftOut), 74HC165
// (shiftIn), afficheur TM1637 (TM1637Display : deux fils, acquittement de la puce), clavier 4×4 (Keypad : colonnes
// mises à LOW tour à tour, lignes lues en INPUT_PULLUP).
#include <Keypad.h>
#include <TM1637Display.h>
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {{'1','2','3','A'}, {'4','5','6','B'}, {'7','8','9','C'}, {'*','0','#','D'}};
byte rowPins[ROWS] = {13, 12, 14, 27};
byte colPins[COLS] = {26, 25, 33, 32};
Keypad pad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
TM1637Display display(4, 2);
void setup() {
  Serial.begin(115200);
  pinMode(23, OUTPUT); pinMode(18, OUTPUT); pinMode(5, OUTPUT);
  digitalWrite(5, LOW);
  shiftOut(23, 18, MSBFIRST, 0x5A);
  shiftOut(23, 18, MSBFIRST, 0b10100101);
  digitalWrite(5, HIGH);
  Serial.println("hc595-ok");
  pinMode(19, OUTPUT); pinMode(15, OUTPUT); pinMode(21, OUTPUT); pinMode(22, INPUT);
  digitalWrite(15, HIGH);
  digitalWrite(19, LOW); delayMicroseconds(5); digitalWrite(19, HIGH); delayMicroseconds(5);
  digitalWrite(15, LOW); // shiftIn() du cœur ESP32 lit avant chaque front d'horloge (celui de l'AVR, après) : D7 d'abord
  digitalWrite(21, LOW);
  byte v = shiftIn(22, 21, MSBFIRST);
  digitalWrite(15, HIGH);
  Serial.print("in="); Serial.println(v, BIN);
  display.setBrightness(7);
  display.showNumberDec(42);
  delay(50);
  display.showNumberDecEx(1205, 0b01000000, true);
  Serial.println("pret");
}
void loop() {
  char k = pad.getKey();
  if (k) { Serial.print("key="); Serial.println(k); }
}
