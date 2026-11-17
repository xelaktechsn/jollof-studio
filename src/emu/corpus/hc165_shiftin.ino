// expect: in=10110010
// module: {"type":"hc165","pins":{"PL":"D8","CP":"D12","Q7":"D11","CE":"D9"},"levels":{"D0":0,"D1":1,"D2":0,"D3":0,"D4":1,"D5":1,"D6":0,"D7":1}}
// Registre à décalage 74HC165 : chargement par PL, horloge haute avant shiftIn() pour lire D7 en premier.
const int loadPin = 8, enablePin = 9, dataPin = 11, clockPin = 12;
void setup() {
  Serial.begin(9600);
  pinMode(loadPin, OUTPUT); pinMode(enablePin, OUTPUT); pinMode(clockPin, OUTPUT); pinMode(dataPin, INPUT);
  digitalWrite(enablePin, HIGH);
  digitalWrite(loadPin, LOW); delayMicroseconds(5); digitalWrite(loadPin, HIGH); delayMicroseconds(5);
  digitalWrite(clockPin, HIGH);
  digitalWrite(enablePin, LOW);
  byte v = shiftIn(dataPin, clockPin, MSBFIRST);
  digitalWrite(enablePin, HIGH);
  Serial.print("in="); Serial.println(v, BIN);
}
void loop() {}
