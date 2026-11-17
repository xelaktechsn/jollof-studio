// expect: init=1
// expect: mesures=5
// expect: total=6
// module: {"type":"sdcard","pins":{"CS":"D53"},"mem":{"sd":{"/LOG.CSV":"dCxBMAo="}}}
// sd: {"/LOG.CSV":"t,A0\n0,512\r\n1,512\r\n2,512\r\n3,512\r\n4,512\r\n"}
// run-ms: 1200
// Enregistreur sur le Mega 2560 : carte microSD sur le SPI matériel (SCK D52, MOSI D51, MISO D50, CS D53). Le fichier
// du projet (son en-tête) est complété ligne par ligne, chaque ligne ajoutée par une nouvelle ouverture FILE_WRITE.
#include <SPI.h>
#include <SD.h>
int n = 0;
void setup() {
  Serial.begin(115200);
  Serial.print(F("init=")); Serial.println(SD.begin(53));
}
void loop() {
  if (n < 5) {
    File f = SD.open("log.csv", FILE_WRITE);
    if (f) { f.print(n); f.print(','); f.println(512); f.close(); n++; }
    delay(100);
  } else if (n == 5) {
    Serial.print(F("mesures=")); Serial.println(n);
    File f = SD.open("log.csv");
    int lignes = 0;
    while (f.available()) if (f.read() == '\n') lignes++;
    f.close();
    Serial.print(F("total=")); Serial.println(lignes);
    n++;
  }
}
