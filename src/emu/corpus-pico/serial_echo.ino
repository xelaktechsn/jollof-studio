// send: abc\n
// expect: pret
// expect: >ABC
// expect: n=4
// run-ms: 200
// Serial du Pico : l'USB (CDC) de la carte, énuméré par un hôte simulé ; while (!Serial) attend son ouverture.
// Les octets envoyés par le moniteur série arrivent par le même chemin.
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  Serial.println("pret");
}
int n = 0;
void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    n++;
    if (c == '\n') { Serial.print(" n="); Serial.println(n); }
    else { if (n == 1) Serial.print(">"); Serial.print((char)toupper(c)); }
  }
  delay(2);
}
