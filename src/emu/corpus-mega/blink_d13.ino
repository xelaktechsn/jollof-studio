// expect: LED_BUILTIN=13 PB7=1
// expect: blinks=6
// pin: {"D13":{"mode":1,"d":1}}
// run-ms: 800
// Clignotement de la LED « L » du Mega : D13 est PB7 sur l'ATmega2560 (PB5 sur l'Uno).
int blinks = 0;
void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.print("LED_BUILTIN="); Serial.print(LED_BUILTIN); Serial.print(" PB7="); Serial.println((PORTB >> 7) & 1);
}
void loop() {
  if (blinks < 6) {
    delay(50); digitalWrite(13, LOW); delay(50); digitalWrite(13, HIGH);
    if (++blinks == 6) { Serial.print("blinks="); Serial.println(blinks); }
  }
}
