// expect: init ok
// expect: w=160 h=128
// expect: sd=1
// expect: lu=Salut du projet
// expect: 1:ligne 1
// expect: 2:t=42
// expect: Firmware Version: 0x92 = v2.0
// expect: UID: DE AD BE EF SAK=08 MIFARE 1KB
// expect: fin
// module: {"type":"st7735","pins":{"CS":"D5","DC":"D2","RESET":"D4","SDA":"D23","SCK":"D18"}}
// module: {"type":"sdcard","pins":{"CS":"D15"},"mem":{"sd":{"/README.TXT":"U2FsdXQgZHUgcHJvamV0Cg=="}}}
// module: {"type":"rc522","pins":{"SDA":"D13","RST":"D14"}}
// tft: {"type":"st7735","on":true,"px":[[0,0,"#ff0000"],[9,9,"#ff0000"],[10,10,"#000000"],[127,0,"#0000ff"],[127,159,"#00ff00"],[60,80,"#ffff00"]]}
// sd: {"/LOG.TXT":"ligne 1\r\nt=42\r\n","/README.TXT":"Salut du projet\n"}
// event: 2000 presentBadge rc522 [0]
// run-ms: 15000
// Bus SPI de l'ESP32 (VSPI : SCK 18, MISO 19, MOSI 23) dans QEMU, trois modules sur leurs broches CS : écran TFT
// ST7735 (Adafruit, envois de pixels groupés), carte microSD (bibliothèque SD du cœur ESP32, FAT), lecteur RFID
// MFRC522.
#include <SPI.h>
#include <SD.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <MFRC522.h>
Adafruit_ST7735 tft = Adafruit_ST7735(5, 2, 4);
MFRC522 rfid(13, 14);
bool lu = false;
void setup() {
  Serial.begin(115200);
  tft.initR(INITR_BLACKTAB);
  Serial.println("init ok");
  tft.fillScreen(ST77XX_BLACK);
  tft.fillRect(0, 0, 10, 10, ST77XX_RED);
  tft.fillCircle(60, 80, 6, ST77XX_YELLOW);
  tft.setRotation(1);
  Serial.print("w="); Serial.print(tft.width()); Serial.print(" h="); Serial.println(tft.height());
  tft.drawPixel(0, 0, ST77XX_BLUE);
  tft.setRotation(2); tft.drawPixel(0, 0, ST77XX_GREEN);
  tft.setRotation(0);
  Serial.print("sd="); Serial.println(SD.begin(15));
  File r = SD.open("/README.TXT");
  if (r) { Serial.print("lu="); while (r.available()) Serial.write(r.read()); r.close(); }
  File f = SD.open("/LOG.TXT", FILE_WRITE);
  f.println("ligne 1"); f.print("t="); f.println(42); f.close();
  f = SD.open("/LOG.TXT");
  int n = 0;
  while (f.available()) { String l = f.readStringUntil('\n'); l.trim(); Serial.print(++n); Serial.print(':'); Serial.println(l); }
  f.close();
  SD.end();
  rfid.PCD_Init();
  rfid.PCD_DumpVersionToSerial();
}
void loop() {
  if (lu || !rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  lu = true;
  Serial.print("UID:");
  for (byte i = 0; i < rfid.uid.size; i++) { Serial.print(rfid.uid.uidByte[i] < 0x10 ? " 0" : " "); Serial.print(rfid.uid.uidByte[i], HEX); }
  Serial.print(" SAK="); if (rfid.uid.sak < 0x10) Serial.print("0"); Serial.print(rfid.uid.sak, HEX);
  Serial.print(" "); Serial.println(rfid.PICC_GetTypeName(rfid.PICC_GetType(rfid.uid.sak)));
  rfid.PICC_HaltA();
  Serial.println("fin");
}
