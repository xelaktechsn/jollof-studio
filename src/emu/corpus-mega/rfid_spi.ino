// expect: Firmware Version: 0x92 = v2.0
// expect: UID: DE AD BE EF SAK=08 MIFARE 1KB
// expect: lectures=1
// module: {"type":"rc522","pins":{"SDA":"D53","RST":"D5"}}
// event: 300 presentBadge rc522 [0]
// run-ms: 1100
// Lecteur RFID MFRC522 sur le bus SPI du Mega (SCK D52, MOSI D51, MISO D50, SS D53) avec la vraie bibliothèque.
#include <SPI.h>
#include <MFRC522.h>
MFRC522 rfid(53, 5);
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
