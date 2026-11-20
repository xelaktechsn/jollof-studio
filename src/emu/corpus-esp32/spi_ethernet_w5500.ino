// expect: puce=3
// expect: lien=OFF
// expect: ip=192.168.1.177
// expect: masque=255.255.255.0
// module: {"type":"w5500","pins":{"CS":"D5","SCK":"D18","MOSI":"D23","MISO":"D19"}}
// run-ms: 10000
// Module Ethernet W5500 sur le bus SPI de l'ESP32 dans QEMU (bibliothèque Ethernet d'Arduino) : la bibliothèque
// reconnaît la puce (remise à zéro, MR, VERSIONR), écrit l'adresse fixe et la relit ; sans plan réseau, pas de lien.
#include <SPI.h>
#include <Ethernet.h>
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
void setup() {
  Serial.begin(115200);
  Ethernet.init(5);
  Ethernet.begin(mac, IPAddress(192, 168, 1, 177));
  Serial.print("puce="); Serial.println((int)Ethernet.hardwareStatus());
  Serial.print("lien="); Serial.println(Ethernet.linkStatus() == LinkON ? "ON" : "OFF");
  Serial.print("ip="); Serial.println(Ethernet.localIP());
  Serial.print("masque="); Serial.println(Ethernet.subnetMask());
}
void loop() {}
