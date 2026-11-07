// expect: auth=Success.
// expect: ecrit=Success.
// expect: lu=Success. 18 octets : Jollof Studio!!
// expect: bloc0=DE AD BE EF 22 08 04 00
// expect: trailer=00 00 00 00 00 00 FF 07 80 69 FF FF FF FF FF FF
// expect: secteur2=A MIFARE PICC responded with NAK.
// expect: mauvaise cle=Timeout in communication.
// not-expect: auth=Timeout
// module: {"type":"rc522","pins":{"SDA":"D10","RST":"D9"}}
// event: 300 presentBadge rc522 [0]
// run-ms: 900
// Mémoire d'un badge MIFARE Classic 1K avec la vraie bibliothèque MFRC522 : authentification par la clé A d'usine,
// écriture puis relecture du bloc 4, lecture du bloc du fabricant et d'un bloc de fin de secteur (clé A illisible),
// accès refusé hors du secteur authentifié (NAK : le badge retourne au repos), et mauvaise clé.
#include <SPI.h>
#include <MFRC522.h>
MFRC522 rfid(10, 9);
MFRC522::MIFARE_Key key;
bool fait = false;
void dump(const char *nom, byte *b, byte n) {
  Serial.print(nom); Serial.print("=");
  for (byte i = 0; i < n; i++) { if (i) Serial.print(" "); if (b[i] < 0x10) Serial.print("0"); Serial.print(b[i], HEX); }
  Serial.println();
}
void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();
  for (byte i = 0; i < 6; i++) key.keyByte[i] = 0xFF;
}
void loop() {
  if (fait || !rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  fait = true;
  MFRC522::StatusCode s = rfid.PCD_Authenticate(MFRC522::PICC_CMD_MF_AUTH_KEY_A, 7, &key, &rfid.uid);
  Serial.print("auth="); Serial.println(rfid.GetStatusCodeName(s));
  byte data[16] = "Jollof Studio!!";
  s = rfid.MIFARE_Write(4, data, 16);
  Serial.print("ecrit="); Serial.println(rfid.GetStatusCodeName(s));
  byte buffer[18], size = sizeof(buffer);
  s = rfid.MIFARE_Read(4, buffer, &size);
  Serial.print("lu="); Serial.print(rfid.GetStatusCodeName(s)); Serial.print(" "); Serial.print(size); Serial.print(" octets : ");
  Serial.println((char *)buffer);
  size = sizeof(buffer);
  s = rfid.MIFARE_Read(7, buffer, &size);
  dump("trailer", buffer, 16);
  rfid.PCD_Authenticate(MFRC522::PICC_CMD_MF_AUTH_KEY_A, 0, &key, &rfid.uid);
  size = sizeof(buffer);
  rfid.MIFARE_Read(0, buffer, &size);
  dump("bloc0", buffer, 8);
  size = sizeof(buffer);
  s = rfid.MIFARE_Read(8, buffer, &size);
  Serial.print("secteur2="); Serial.println(rfid.GetStatusCodeName(s));
  rfid.PCD_StopCrypto1();
  // Badge revenu au repos après le NAK : WUPA le réveille ; une mauvaise clé B ne l'authentifie pas.
  byte atqa[2], n = 2;
  rfid.PICC_WakeupA(atqa, &n);
  rfid.PICC_Select(&rfid.uid);
  key.keyByte[0] = 0x12;
  s = rfid.PCD_Authenticate(MFRC522::PICC_CMD_MF_AUTH_KEY_B, 4, &key, &rfid.uid);
  Serial.print("mauvaise cle="); Serial.println(rfid.GetStatusCodeName(s));
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
