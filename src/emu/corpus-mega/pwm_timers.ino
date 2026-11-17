// expect: pwm ok
// pin: {"D2":{"pwm":[0.24,0.27]},"D3":{"pwm":[0.85,0.88]},"D5":{"pwm":[0.38,0.41]}}
// pin: {"D6":{"pwm":[0.61,0.64]},"D7":{"pwm":[0.11,0.14]},"D8":{"pwm":[0.57,0.60]}}
// pin: {"D44":{"pwm":[0.73,0.76]},"D45":{"pwm":[0.30,0.33]},"D46":{"pwm":[0.08,0.11]}}
// pin: {"D4":{"pwm":[0.12,0.14]},"D9":{"pwm":[0.38,0.41]},"D10":{"pwm":[0.18,0.21]},"D11":{"pwm":[0.68,0.71]},"D12":{"pwm":[0.93,0.96]},"D13":{"pwm":[0.78,0.80]}}
// run-ms: 300
// analogWrite() sur les 15 sorties PWM du Mega : minuteries 0 (D4, D13), 1 (D11, D12), 2 (D9, D10), 3 (D2, D3, D5),
// 4 (D6, D7, D8) et 5 (D44, D45, D46), avec les trois comparaisons A, B, C des minuteries de 16 bits.
const byte PINS[] = { 2, 3, 5, 6, 7, 8, 44, 45, 46, 4, 9, 10, 11, 12, 13 };
const byte VALS[] = { 65, 222, 100, 160, 32, 150, 191, 80, 24, 32, 100, 50, 178, 241, 202 };
void setup() {
  Serial.begin(9600);
  for (byte i = 0; i < sizeof(PINS); i++) analogWrite(PINS[i], VALS[i]);
  Serial.println("pwm ok");
}
void loop() {}
