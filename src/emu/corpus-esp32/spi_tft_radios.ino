// expect: mode=9C
// expect: madctl=48
// expect: lora=ok
// expect: envoye
// expect: rf24 begin ok puce ok
// expect: rf24 echec
// module: {"type":"ili9341","pins":{"CS":"D5","DC":"D2","RESET":"D4","MOSI":"D23","SCK":"D18","MISO":"D19"}}
// module: {"type":"sx1278","pins":{"NSS":"D15","RST":"D14","DIO0":"D26","SCK":"D18","MOSI":"D23","MISO":"D19"}}
// module: {"type":"nrf24","pins":{"CE":"D27","CSN":"D13"}}
// tft: {"type":"ili9341","on":true,"px":[[0,0,"#00ff00"],[2,2,"#00ff00"],[3,3,"#000000"],[239,0,"#ff0000"],[120,130,"#ffffff"]]}
// run-ms: 15000
// Bus SPI de l'ESP32 dans QEMU : écran ILI9341 (lectures de diagnostic sur MISO), radio LoRa SX1278 (bibliothèque
// LoRa : émission, fin d'émission lue dans les registres), nRF24L01+ (RF24 : sans récepteur, write() échoue).
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <LoRa.h>
#include <RF24.h>
Adafruit_ILI9341 tft = Adafruit_ILI9341(5, 2, 4);
RF24 radio(27, 13);
const byte address[6] = "00001";
void setup() {
  Serial.begin(115200);
  tft.begin();
  Serial.print("mode="); Serial.println(tft.readcommand8(ILI9341_RDMODE), HEX);
  Serial.print("madctl="); Serial.println(tft.readcommand8(ILI9341_RDMADCTL), HEX);
  tft.fillScreen(ILI9341_BLACK);
  tft.fillRect(0, 0, 3, 3, ILI9341_GREEN);
  tft.drawCircle(120, 160, 30, ILI9341_WHITE);
  tft.setRotation(1);
  tft.drawPixel(0, 0, ILI9341_RED);
  LoRa.setPins(15, 14, 26);
  Serial.print("lora="); Serial.println(LoRa.begin(433E6) ? "ok" : "echec");
  LoRa.beginPacket(); LoRa.print("Bonjour"); LoRa.endPacket();
  Serial.println("envoye");
  Serial.print("rf24 begin "); Serial.print(radio.begin() ? "ok" : "echec");
  Serial.print(" puce "); Serial.println(radio.isChipConnected() ? "ok" : "absente");
  radio.openWritingPipe(address);
  radio.setPALevel(RF24_PA_MIN);
  radio.stopListening();
  const char text[] = "Hello";
  Serial.println(radio.write(&text, sizeof(text)) ? "rf24 envoye" : "rf24 echec");
}
void loop() {}
