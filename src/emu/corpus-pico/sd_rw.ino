// expect: init=1
// expect: lu=Salut du projet
// expect: taille=15
// expect: relu=ligne 1
// expect: existe=1 vieux=0
// expect: lignes=50
// module: {"type":"sdcard","pins":{"CS":"GP17","MISO":"GP16","SCK":"GP18","MOSI":"GP19"},"mem":{"sd":{"/README.TXT":"U2FsdXQgZHUgcHJvamV0Cg==","/VIEUX.TXT":"YSBqZXRlcg=="}}}
// sd: {"/LOG.TXT":"ligne 1\r\nt=42\r\n","/DATA/A.CSV":"1,2\r\n","/VIEUX.TXT":null}
// run-ms: 700
// Carte microSD sur le SPI0 du Pico (GP16 MISO, GP17 CS, GP18 SCK, GP19 MOSI) avec la bibliothèque SD du cœur
// arduino-pico (SdFat 2 dessous) : lecture d'un fichier du projet, effacement, écriture, dossier, liste de la racine.
#include <SPI.h>
#include <SD.h>
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.print("init="); Serial.println(SD.begin(17));
  File r = SD.open("readme.txt");
  if (r) { Serial.print("lu="); while (r.available()) Serial.write(r.read()); r.close(); }
  SD.remove("vieux.txt");
  File f = SD.open("log.txt", FILE_WRITE);
  f.println("ligne 1"); f.print("t="); f.println(42); f.close();
  f = SD.open("log.txt");
  Serial.print("taille="); Serial.println(f.size());
  Serial.print("relu="); Serial.println(f.readStringUntil('\r'));
  f.close();
  SD.mkdir("data");
  File g = SD.open("data/a.csv", FILE_WRITE); g.println("1,2"); g.close();
  Serial.print("existe="); Serial.print(SD.exists("data/a.csv")); Serial.print(" vieux="); Serial.println(SD.exists("vieux.txt"));
  File big = SD.open("gros.txt", FILE_WRITE);
  for (int i = 0; i < 50; i++) { big.print("mesure "); big.println(i); }
  big.close();
  big = SD.open("gros.txt");
  int lignes = 0;
  while (big.available()) if (big.read() == '\n') lignes++;
  big.close();
  Serial.print("lignes="); Serial.println(lignes);
  File root = SD.open("/");
  while (File e = root.openNextFile()) { Serial.print("- "); Serial.println(e.name()); e.close(); }
}
void loop() {}
