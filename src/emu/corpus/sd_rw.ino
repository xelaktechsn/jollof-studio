// expect: init=1
// expect: lu=Salut du projet
// expect: taille=15
// expect: 1:ligne 1
// expect: 2:t=42
// expect: existe=1 vieux=0
// expect: lignes=100 octets=1090
// expect: README.TXT 16
// expect: LOG.TXT 15
// expect: DATA/ 512
// expect: seek=t
// not-expect: VIEUX.TXT
// module: {"type":"sdcard","pins":{"CS":"D4"},"mem":{"sd":{"/README.TXT":"U2FsdXQgZHUgcHJvamV0Cg==","/VIEUX.TXT":"YSBqZXRlcg=="}}}
// sd: {"/LOG.TXT":"ligne 1\r\nt=42\r\n","/DATA/A.CSV":"1,2\r\n","/VIEUX.TXT":null,"/README.TXT":"Salut du projet\n"}
// run-ms: 3000
// Carte microSD (CS sur D4) avec la vraie bibliothèque SD d'Arduino : un fichier du projet est relu, un autre effacé,
// un journal écrit puis relu ligne par ligne, un dossier créé, un gros fichier de plusieurs blocs, la racine listée.
#include <SPI.h>
#include <SD.h>
void setup() {
  Serial.begin(115200);
  Serial.print(F("init=")); Serial.println(SD.begin(4));
  File r = SD.open("readme.txt");
  if (r) { Serial.print(F("lu=")); while (r.available()) Serial.write(r.read()); r.close(); }
  SD.remove("vieux.txt");
  File f = SD.open("log.txt", FILE_WRITE);
  f.println(F("ligne 1")); f.print(F("t=")); f.println(42); f.close();
  f = SD.open("log.txt");
  Serial.print(F("taille=")); Serial.println(f.size());
  int n = 0;
  while (f.available()) { String l = f.readStringUntil('\n'); l.trim(); Serial.print(++n); Serial.print(':'); Serial.println(l); }
  f.seek(9); Serial.print(F("seek=")); Serial.write(f.read()); Serial.println();
  f.close();
  SD.mkdir("data");
  File g = SD.open("data/a.csv", FILE_WRITE); g.println("1,2"); g.close();
  Serial.print(F("existe=")); Serial.print(SD.exists("data/a.csv")); Serial.print(F(" vieux=")); Serial.println(SD.exists("vieux.txt"));
  File big = SD.open("gros.txt", FILE_WRITE);
  for (int i = 0; i < 100; i++) { big.print(F("mesure ")); big.println(i); }
  big.close();
  big = SD.open("gros.txt");
  long octets = big.size(); int lignes = 0;
  while (big.available()) if (big.read() == '\n') lignes++;
  big.close();
  Serial.print(F("lignes=")); Serial.print(lignes); Serial.print(F(" octets=")); Serial.println(octets);
  File root = SD.open("/");
  while (true) {
    File e = root.openNextFile();
    if (!e) break;
    Serial.print(e.name()); Serial.print(e.isDirectory() ? "/ " : " "); Serial.println(e.size());
    e.close();
  }
  root.close();
}
void loop() {}
