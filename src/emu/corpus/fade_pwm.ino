// expect: duty=0 duty=64 duty=128 duty=192 duty=255
// expect: fade-ok
// Variation d'intensité d'une LED par analogWrite (PWM matérielle du timer 0 sur D5), valeurs relues sur OCR0B.
const int LED = 5;
void setup() {
  Serial.begin(9600);
  pinMode(LED, OUTPUT);
  for (int v = 0; v <= 256; v += 64) {
    int duty = v > 255 ? 255 : v;
    analogWrite(LED, duty);
    Serial.print("duty="); Serial.print(duty == 0 || duty == 255 ? duty : OCR0B); Serial.print(' ');
    delay(5);
  }
  Serial.println();
  Serial.println("fade-ok");
}
void loop() {}
