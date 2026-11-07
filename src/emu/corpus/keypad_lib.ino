// expect: key=6
// expect: key=*
// expect: key=D
// not-expect: key=5
// module: {"type":"keypad","pins":{"R1":"D9","R2":"D8","R3":"D7","R4":"D6","C1":"D5","C2":"D4","C3":"D3","C4":"D2"}}
// event: 300 keypadDown keypad [1,2]
// event: 450 keypadUp keypad
// event: 600 keypadDown keypad [3,0]
// event: 750 keypadUp keypad
// event: 900 keypadDown keypad [3,3]
// run-ms: 1100
// Clavier 4×4 lu par la vraie bibliothèque Keypad : colonnes mises à LOW tour à tour, lignes en INPUT_PULLUP.
#include <Keypad.h>
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {{'1','2','3','A'}, {'4','5','6','B'}, {'7','8','9','C'}, {'*','0','#','D'}};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad pad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
void setup() { Serial.begin(115200); Serial.println("pret"); }
void loop() {
  char k = pad.getKey();
  if (k) { Serial.print("key="); Serial.println(k); }
}
