// Encodeur KY-040 sans bibliothèque : interruption sur chaque front de CLK (D2), sens donné par DT (D3), comme les
// tutoriels courants : deux fronts de CLK par cran. Deux crans horaires (+4), puis trois antihoraires (−6).
// module: {"type":"ky040","pins":{"CLK":"D2","DT":"D3"}}
// event: 150 encTurn ky040 [1, 2]
// event: 450 encTurn ky040 [-1, 3]
// run-ms: 800
// expect: compteur=4
// expect: compteur=-2
volatile int compteur = 0;
int montre = 0;
void tourne() {
  if (digitalRead(3) != digitalRead(2)) compteur++; else compteur--;
}
void setup() {
  Serial.begin(115200);
  pinMode(2, INPUT); pinMode(3, INPUT);
  attachInterrupt(digitalPinToInterrupt(2), tourne, CHANGE);
}
void loop() {
  noInterrupts(); int c = compteur; interrupts();
  if (c != montre) { montre = c; Serial.print("compteur="); Serial.println(c); }
}
