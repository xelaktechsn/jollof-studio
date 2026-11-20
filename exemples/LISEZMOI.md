# Exemples

Ces montages s’ouvrent depuis le bouton « Exemples » de Jollof Studio, ou avec « Ouvrir » (Ctrl+O). Une fois l’exemple chargé, la simulation démarre : réglez la température, la distance, etc. pour voir les capteurs réagir. L’onglet Code montre le programme de la carte : ses règles, son code Arduino et le moniteur série.

| Fichier | Montage | Carte | Programme |
|---|---|---|---|
| `01-station-meteo.jollof` | DHT22, BMP280 et écran OLED. Les deux modules I2C partagent SDA et SCL. | ESP32 | Généré : mesures sur l’écran et le moniteur série |
| `02-led-bouton-breadboard.jollof` | LED avec sa résistance, bouton poussoir, masses sur les rails de la breadboard | Arduino Uno | Règle : quand BTN1 est appuyé, LED1 s’allume |
| `03-radar-de-recul.jollof` | HC-SR04, buzzer et écran LCD 16×2 | Arduino Uno | Écrit à la main : bips de plus en plus rapides, distance et barre sur le LCD |
| `04-thermometre-ds18b20.jollof` | Sonde DS18B20 avec sa résistance de tirage de 4,7 kΩ, et écran OLED | Raspberry Pi Pico | Généré : température sur l’écran |
| `05-arrosage-automatique.jollof` | Humidité du sol, DHT11 et relais de pompe | ESP32 | Règles imbriquées : sol trop sec → pompe, sauf au-dessus de 35 °C ; pompe arrêtée par défaut |
| `06-moteur-vitesse.jollof` | Moteur avec pilote L298N et pile 9 V, et potentiomètre de vitesse | Arduino Uno | Règle : le potentiomètre fait varier la vitesse |
| `07-a-corriger.jollof` | **Montage à corriger** : erreurs volontaires à trouver | ESP32 | — |
| `09-ventilateur-pnp.jollof` | Ventilateur commandé côté + par un transistor PNP (PN2907A) : LOW le met en marche ; courant de démarrage visible | Arduino Uno | Règle : quand BTN1 est appuyé, le ventilateur tourne |
| `10-regulateur-zener.jollof` | Régulateur à diode Zener 5,1 V et sa résistance série, sans carte (projet analogique) ; changez la valeur de R1 | — | — |
| `11-analyseur-bus-i2c.jollof` | BMP280 et écran OLED sur le même bus I2C, à suivre dans l’analyseur de bus (NACK en rouge) | Raspberry Pi Pico | Écrit à la main : scanner I2C puis lecture du BMP280 |
| `12-feu-pietons-sequence.jollof` | Feu tricolore, bouton d’appel et buzzer (derrière un transistor) | Arduino Uno | Séquence vert → orange → rouge, temporisée sans delay() ; « dès que » le bouton est appuyé, une variable retient l’appel ; « puis attendre » arrête le bip |
| `13-compteur-visiteurs.jollof` | Capteur d’obstacle infrarouge, bouton, écran LCD 16×2 et LED | Arduino Uno | Variable gardée dans l’EEPROM, affichée sur le LCD ; remise à zéro par appui de 2 s ou par « zero » envoyé au moniteur série |
| `14-reseau-salle-info.jollof` | **Réseau informatique** d’une salle de classe : box (DHCP), switch PoE, panneau de brassage, cinq prises murales (liens permanents de 42 à 63 m), deux PC, imprimante à adresse fixe, point d’accès Wi-Fi et caméra alimentés par PoE, portable en Wi-Fi | — (projet Réseau) | — : essayez le ping, le testeur de câble, le budget PoE du switch |
| `15-objet-connecte-w5500.jollof` | Module Ethernet W5500 en SPI, alimenté en 3,3 V par un régulateur AMS1117, potentiomètre ; plan réseau avec box, switch, PC et Serveur MQTT | Arduino Uno | Écrit à la main : adresse par DHCP, page web avec la position du potentiomètre (navigateur de PC1 : `http://ETH1/`), publication MQTT sur `atelier/pot` |
| `16-esp32-mqtt-wifi.jollof` | Potentiomètre et LED ; plan réseau avec box, switch PoE, point d’accès « Atelier » alimenté par PoE, Serveur MQTT et PC | ESP32 | Écrit à la main : Wi-Fi par le point d’accès, publication sur `atelier/pot`, LED commandée par `atelier/led` |
| `pro/17-college-reseau-deux-etages.jollof` | **Réseau d’un collège** (projet de professionnel) : bâtiment de deux étages à l’échelle, 26 pièces, un local technique par étage (baie 42U, panneaux, switchs PoE+, onduleur, PDU), rocade fibre OM4, cœur de niveau 3 avec VLAN données, voix, Wi-Fi et gestion, DHCP et DNS par relais, routeur Internet avec traduction d’adresses, 17 points d’accès Wi-Fi 6, 95 prises aux longueurs réelles, liens certifiés. Chargé à l’ouverture seulement (fichier volumineux), sa fiche est dans `pro/17-….meta.json` | — (projet Réseau) | — : vues Plans, Baies et Conception ; le vérificateur ne trouve aucune faute |

## Le montage à corriger

`07-a-corriger.jollof` contient cinq erreurs et un avertissement :

1. Un BMP280, qui ne supporte que 3,3 V, est alimenté par VIN (5 V).
2. Les données du DHT22 arrivent sur D34, qui est une entrée seulement.
3. La LED est montée à l’envers.
4. Le HC-SR04 est alimenté en 3,3 V au lieu de 5 V.
5. Un fil oublié relie le rail + au rail − de la breadboard, ce qui fait un court-circuit.
6. La DS18B20 n’a pas sa résistance de tirage de 4,7 kΩ (avertissement).

Lancez la simulation. Chaque erreur est montrée dans la scène et expliquée, avec un bouton pour la corriger.

Chaque fichier porte aussi sa version anglaise dans le champ `en` : `name`, `description` et, pour un programme écrit à la main, `code` (une liste de lignes par carte). L’interface en anglais l’utilise ; les rôles des fils sont traduits par le dictionnaire de l’application.
