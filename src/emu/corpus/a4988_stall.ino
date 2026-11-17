// expect: envoye=400
// module: {"type":"a4988","pins":{"STEP":"D3","DIR":"D4"},"levels":{"RESET":1,"SLEEP":1}}
// step: {"type":"a4988","steps":-400,"lost":[300,400],"rotor":[-100,0]}
// run-ms: 400
// Impulsions trop rapides sans rampe : 2500 pas par seconde d'un coup (digitalWrite et delayMicroseconds), DIR à LOW.
// Le pilote compte les 400 pas, mais le rotor décroche presque tout de suite : les pas sont perdus.
const int STEP_PIN = 3, DIR_PIN = 4;
void setup() {
  Serial.begin(9600);
  pinMode(STEP_PIN, OUTPUT); pinMode(DIR_PIN, OUTPUT);
  digitalWrite(DIR_PIN, LOW);
  for (int i = 0; i < 400; i++) {
    digitalWrite(STEP_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(STEP_PIN, LOW); delayMicroseconds(390);
  }
  Serial.println("envoye=400");
}
void loop() {}
