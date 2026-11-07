// expect: Firmware Version: 0x92 = v2.0
// expect: UID: DE AD BE EF SAK=08 MIFARE 1KB
// expect: UID: A1 B2 C3 D4
// expect: lectures=2
// module: {"type":"rc522","pins":{"SDA":"D10","RST":"D9"}}
// event: 300 presentBadge rc522 [0]
// event: 700 presentBadge rc522 [0]
// event: 800 presentBadge rc522 [2]
// run-ms: 1100
// Lecteur RFID MFRC522 avec la vraie bibliothèque (miguelbalboa) : version de la puce, puis l'UID de chaque badge
// posé, une seule fois par présentation (PICC_HaltA endort le badge jusqu'à ce qu'on le repose).
#include <SPI.h>
#include <MFRC522.h>
MFRC522 rfid(10, 9);
int lectures = 0;
void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();
  rfid.PCD_DumpVersionToSerial();
}
void loop() {
  if (millis() > 1000 && lectures >= 0) { Serial.print("lectures="); Serial.println(lectures); lectures = -1; }
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  lectures++;
  Serial.print("UID:");
  for (byte i = 0; i < rfid.uid.size; i++) {
    Serial.print(rfid.uid.uidByte[i] < 0x10 ? " 0" : " ");
    Serial.print(rfid.uid.uidByte[i], HEX);
  }
  Serial.print(" SAK="); if (rfid.uid.sak < 0x10) Serial.print("0"); Serial.print(rfid.uid.sak, HEX);
  Serial.print(" "); Serial.println(rfid.PICC_GetTypeName(rfid.PICC_GetType(rfid.uid.sak)));
  rfid.PICC_HaltA();
}
