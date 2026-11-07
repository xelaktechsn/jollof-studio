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
