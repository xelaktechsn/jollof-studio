// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Fiches techniques d'où viennent les chiffres du vérificateur : limites de limits.js (clé src, ou LIMIT_SRC),
// transistors NPNS (clé src), alimentations v et consommations ma des modules de parts.js (clé ds, car src y
// désigne déjà la batterie d'une broche 'ext').
// Une entrée par document : titre tel que publié, éditeur, adresse, et l'endroit précis où se lit le chiffre (section).
// mirror : copie identique consultée quand le site du fabricant refuse les accès automatiques (fichier du fabricant
// inchangé). Les citations entre guillemets sont recopiées du document, dans sa langue.

export const SOURCES = {
  /* ---------- Microcontrôleurs et cartes ---------- */
  atmega328p: {
    title: 'ATmega48A/PA/88A/PA/168A/PA/328/P Data Sheet Complete (DS40002061B)',
    publisher: 'Microchip Technology',
    url: 'https://ww1.microchip.com/downloads/aemDocuments/documents/MCU08/ProductDocuments/DataSheets/ATmega48A-PA-88A-PA-168A-PA-328-P-DS-DS40002061B.pdf',
    section: '§ 29.1 Absolute Maximum Ratings, p. 308 : « DC Current per I/O Pin 40.0mA », « DC Current VCC and GND Pins 200.0mA », « Voltage on any Pin except RESET -0.5V to VCC+0.5V » ; Table 30-1 Common DC characteristics, notes 3 et 4, p. 323 : courant d’essai « 20mA at VCC = 5V »'
  },
  arduinoUno: {
    title: 'Arduino UNO Rev3',
    publisher: 'Arduino',
    url: 'https://store.arduino.cc/products/arduino-uno-rev3',
    section: 'Input and Output : « Each pin can provide or receive 20 mA as recommended operating condition » ; Power : broche 3.3V « Maximum current draw is 50 mA » ; Warnings : « If more than 500 mA is applied to the USB port, the fuse will automatically break the connection »'
  },
  arduinoNano: {
    title: 'Arduino Nano',
    publisher: 'Arduino',
    url: 'https://store.arduino.cc/products/arduino-nano',
    section: 'Tech Specs : DC Current per I/O Pin « 20 mA (I/O Pins) » ; FAQ, Input and Output : « Each pin can provide or receive a maximum of 40 mA »'
  },
  ft232r: {
    title: 'FT232R USB UART IC Datasheet',
    publisher: 'Future Technology Devices International (FTDI)',
    url: 'https://ftdichip.com/wp-content/uploads/2020/08/DS_FT232R.pdf',
    mirror: 'https://www.sparkfun.com/datasheets/IC/FT232R_v104.pdf',
    section: '§ 3.3V LDO Regulator, p. 5 (version 1.04) : « requiring a 3.3V nominal supply at a current of around than 50mA could also draw its power from the 3V3OUT pin » (broche 3V3 du Nano)'
  },
  usb2: {
    title: 'Universal Serial Bus Specification, Revision 2.0',
    publisher: 'USB Implementers Forum (USB-IF)',
    url: 'https://www.usb.org/document-library/usb-20-specification',
    section: '§ 7.2.1 Classes of Devices : « A unit load is defined to be 100 mA », un périphérique « may draw up to five unit loads » (500 mA)'
  },
  esp32: {
    title: 'ESP32 Series Datasheet v5.3',
    publisher: 'Espressif Systems',
    url: 'https://documentation.espressif.com/esp32_datasheet_en.pdf',
    section: 'Table 5-1 Absolute Maximum Ratings : « Cumulative IO output current 1200 mA », VDD 3.6 V au plus ; Table 5-2 : alimentation de 0.5 A au moins ; Table 5-3 DC Characteristics : IOH 40 mA (typ.), IOL 28 mA (typ.), VIH jusqu’à VDD + 0.3 V'
  },
  esp8266: {
    title: 'ESP8266EX Datasheet Version 7.1',
    publisher: 'Espressif Systems',
    url: 'https://documentation.espressif.com/0a-esp8266ex_datasheet_en.pdf',
    section: '§ 5.1, Table 5-1 Electrical Characteristics : « IMAX … 12 mA », VIH jusqu’à 3.6 V, tension de travail 2.5 à 3.6 V'
  },
  rp2040: {
    title: 'RP2040 Datasheet',
    publisher: 'Raspberry Pi Ltd',
    url: 'https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf',
    section: '§ 5.5.3.1 Table 622 : VPIN « -0.5 … IOVDD + 0.5 V » ; § 5.5.3.4 Table 625 : IOH/IOL « 2, 4, 8 or 12mA depending on setting », VIH jusqu’à IOVDD + 0.3 V, « Maximum Total IOVDD current … 50 mA »'
  },
  pico: {
    title: 'Raspberry Pi Pico Datasheet',
    publisher: 'Raspberry Pi Ltd',
    url: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf',
    section: '§ 2.1 Raspberry Pi Pico pinout : broche 3V3, « it is recommended to keep the load on this pin less than 300mA »'
  },
  ams1117: {
    title: 'AMS1117 1A Low Dropout Voltage Regulator',
    publisher: 'Advanced Monolithic Systems',
    // Le site du fabricant ne sert pas HTTPS (échec de la poignée de main TLS) : adresse HTTP d'origine.
    url: 'http://www.advanced-monolithic.com/pdf/ds1117.pdf',
    section: 'Features, p. 1 : « Output Current of 1A » (régulateur 3,3 V des cartes ESP32 DevKit et NodeMCU, et du MB102)'
  },

  /* ---------- Composants discrets ---------- */
  kingbrightWp7113id: {
    title: 'WP7113ID T-1 3/4 (5mm) Solid State Lamp (Spec No DSAF0012, Rev V.14A)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf',
    section: 'Absolute Maximum Ratings at TA=25°C : « DC Forward Current IF 30 mA » (LED rouge 5 mm)'
  },
  kingbrightWp7113qbcd: {
    title: 'WP7113QBC/D T-1 3/4 (5mm) Solid State Lamp (Spec No DSAG3481, Rev V.18B)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113QBC-D.pdf',
    section: 'Absolute Maximum Ratings at TA=25°C : « DC Forward Current IF 30 mA » (LED bleue 5 mm)'
  },
  yageoCfr: {
    title: 'Product specification – Carbon Film Resistors, CFR, Through Hole Resistors (V.3, 2024)',
    publisher: 'YAGEO',
    url: 'https://yageogroup.com/content/datasheet/asset/file/YAGEO-CFR_DATASHEET',
    section: 'Table 1, p. 3 : Power Rating at 70 °C, CFR-25 « 1/4W »'
  },
  bournsPdb12: {
    title: 'PDB12 Series - 12 mm Rotary Potentiometer',
    publisher: 'Bourns',
    url: 'https://www.bourns.com/docs/Product-Datasheets/pdb12.pdf',
    section: 'Electrical Characteristics : Power Rating « Linear … 0.08 watt »'
  },
  sameSkyCms40558n: {
    title: 'CMS-40558N-L152 Speaker',
    publisher: 'Same Sky (ex-CUI Devices)',
    url: 'https://www.sameskydevices.com/product/resource/cms-40558n-l152.pdf',
    section: 'Specifications, p. 1 : input power 0.5 W (typ.), 1.0 W (max.) ; impedance 8 Ω'
  },
  onsemiBc547: {
    title: 'BC546 / BC547 / BC548 / BC549 / BC550 - NPN Epitaxial Silicon Transistor',
    publisher: 'onsemi',
    url: 'https://www.onsemi.com/pdf/datasheet/bc550-d.pdf',
    section: 'Absolute Maximum Ratings, p. 1 : VCEO 45 V (BC547), « Collector Current (DC) IC 100 mA », « Collector Power Dissipation PC 500 mW » ; Electrical Characteristics, p. 2 : hFE 110 à 800'
  },
  onsemiPn2222a: {
    title: 'PN2222A — NPN General-Purpose Amplifier',
    publisher: 'onsemi (Fairchild Semiconductor)',
    url: 'https://www.onsemi.com/pdf/datasheet/pn2222a-d.pdf',
    section: 'Features : « collector currents up to 500mA » ; Absolute Maximum Ratings : VCEO 40 V, IC 1.0 A ; Thermal Characteristics : PD 625 mW'
  },
  vishay1n4007: {
    title: '1N4001, 1N4002, 1N4003, 1N4004, 1N4005, 1N4006, 1N4007 — General Purpose Plastic Rectifier',
    publisher: 'Vishay General Semiconductor',
    url: 'https://www.vishay.com/docs/88503/1n4001.pdf',
    section: 'Maximum Ratings, p. 1 : « Maximum average forward rectified current … IF(AV) 1.0 A »'
  },
  vishayKSeries: {
    title: 'K Series — Radial Leaded Multilayer Ceramic Capacitors for General Purpose, Class 1 and Class 2, 50 VDC, 100 VDC, 200 VDC, 500 VDC',
    publisher: 'Vishay BCcomponents',
    url: 'https://www.vishay.com/docs/45171/kseries.pdf',
    section: 'Dielectric X7R, p. 4 : 100 000 pF en K104…X7RF5 ; Ordering Code : « F = 50 VDC »'
  },
  vishay036Rsp: {
    title: '036 RSP — Aluminum Electrolytic Capacitors Radial Semi-Professional',
    publisher: 'Vishay BCcomponents',
    url: 'https://www.vishay.com/docs/28312/036rsp.pdf',
    section: 'Ordering example, p. 2 : « 100 μF / 16 V » (MAL203635101E3)'
  },
  songleSrd: {
    title: 'SRD relay (SRD-05VDC-SL-C)',
    publisher: 'Ningbo Songle Relay',
    url: 'https://www.circuitbasics.com/wp-content/uploads/2015/11/SRD-05VDC-SL-C-Datasheet.pdf',
    section: '§ 6 Coil data : 5 V, 71.4 mA, « Pull-In 75% Max. », « Max-Allowable 120% » ; § 7 Contact rating, FORM C : « 10A 125VAC », « 7A 240VAC », « 7A 28VDC »'
  },

  /* ---------- Circuits de puissance ---------- */
  stL298: {
    title: 'L298 Dual Full-Bridge Driver',
    publisher: 'STMicroelectronics',
    url: 'https://www.st.com/resource/en/datasheet/l298.pdf',
    mirror: 'https://www.sparkfun.com/datasheets/Robotics/L298_H_Bridge.pdf',
    section: 'Absolute Maximum Ratings, p. 2 : IO « DC Operation 2 A » par voie ; Electrical Characteristics, p. 3 : VS de VIH + 2.5 à 46 V'
  },
  stL78: {
    title: 'L78 Positive voltage regulator ICs (DocID2143)',
    publisher: 'STMicroelectronics',
    url: 'https://www.st.com/resource/en/datasheet/l78.pdf',
    mirror: 'https://protostack.com.au/download/l7805.pdf',
    section: 'Features, p. 1 : « Output current up to 1.5 A » (Rev 34)'
  },
  onsemiMc7800: {
    title: 'MC7800, MC7800A, MC7800AE, NCV7800 — Voltage Regulators – Positive 1.0 A',
    publisher: 'onsemi',
    url: 'https://www.onsemi.com/pdf/datasheet/mc7800-d.pdf',
    section: 'Maximum Ratings, p. 1 : « Thermal Resistance, Junction−to−Ambient RθJA … 65 °C/W » (TO-220, case 221A), « Output Current in Excess of 1.0 A » ; Ordering Information : MC7805C, « TJ = 0°C to +125°C »'
  },
  tiUa78m: {
    title: 'UA78M 500mA, Positive-Voltage Linear Regulator (SLVS059V)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/ua78m.pdf',
    section: '§ 5.1 Absolute Maximum Ratings : Input voltage, UA78M05C (legacy chip) 35 V (régulateur 5 V du module L298N)'
  },
  sameSkyCmi1295: {
    title: 'CMI-1295-0585T Magnetic Buzzer Indicator',
    publisher: 'Same Sky (ex-CUI Devices)',
    url: 'https://www.sameskydevices.com/product/resource/cmi-1295-0585t.pdf',
    section: 'Specifications, p. 1 : rated voltage 5 Vdc, operating voltage 4 à 7 Vdc, 30 mA (max.), 2 300 Hz (typ.)'
  },

  /* ---------- Sources d'énergie ---------- */
  energizer522: {
    title: 'Energizer 522 Product Datasheet',
    publisher: 'Energizer',
    url: 'https://data.energizer.com/pdfs/522.pdf',
    section: 'Industry Standard Tests et « Milliamp-Hours Capacity » : courbes de 10 à 50 mA seulement ; aucun courant maximal publié'
  },
  samsungIcr18650: {
    title: 'Specification of Product — Lithium-ion Rechargeable Cell ICR18650-26J',
    publisher: 'Samsung SDI',
    url: 'https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/196/ICR18650_2D00_26J_2D00_Samsung.pdf',
    section: '§ 3.6 : « Max. continuous discharge 5.2A (@ RT) »'
  },
  mb102: {
    title: 'MB102 Breadboard Power Supply 3.3V/5V',
    publisher: 'ShillehTek',
    url: 'https://shillehtek.com/blogs/shillehtek-product-manuals/mb102-breadboard-power-supply-3-3v-5v',
    section: 'Specifications : « Maximum Output Current: 700 mA per rail », régulateurs AMS1117-5.0 et AMS1117-3.3'
  },

  /* ---------- Capteurs ---------- */
  aosongDht11: {
    title: 'DHT11 说明书 (2022年12月)',
    publisher: 'Aosong Electronics',
    url: 'https://www.aosong.com/userfiles/files/media/DHT11%E6%B8%A9%E6%B9%BF%E5%BA%A6%E4%BC%A0%E6%84%9F%E5%99%A8%E8%AF%B4%E6%98%8E%E4%B9%A6%EF%BC%88%E4%B8%AD%EF%BC%89%20A0-1208.pdf',
    section: '§ 1.2 表2 电气特性表 : VCC 3.3 à 5.5 V (typ. 5 V), courant moyen en mesure 1000 µA (typ.)'
  },
  aosongDht22: {
    title: 'Digital-output relative humidity & temperature sensor/module DHT22 (DHT22 also named as AM2302)',
    publisher: 'Aosong Electronics',
    url: 'https://cdn.sparkfun.com/assets/f/7/d/9/c/DHT22.pdf',
    section: '§ 7 Electrical Characteristics, p. 9 : Power supply 3.3 à 6 V ; Current supply, measuring 1 à 1.5 mA'
  },
  elecfreaksHcsr04: {
    title: 'Ultrasonic Ranging Module HC-SR04',
    publisher: 'ElecFreaks',
    url: 'https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf',
    section: 'Electric Parameter : « Working Voltage DC 5 V », « Working Current 15mA »'
  },
  rapidHcsr501: {
    title: 'HC-SR501 PIR Motion Detector (order code 74-1108)',
    publisher: 'Rapid Electronics',
    url: 'https://static.rapidonline.com/pdf/74-1108_v2.pdf',
    section: 'Specification, p. 1 : « Voltage: 5V – 20V »'
  },
  dfrobotSen0193: {
    title: 'Gravity: Analog Capacitive Corrosion Resistant Soil Moisture Sensor for Arduino / Raspberry Pi (SKU SEN0193)',
    publisher: 'DFRobot',
    url: 'https://wiki.dfrobot.com/Capacitive_Soil_Moisture_Sensor_SKU_SEN0193',
    section: 'Specification : « Operating Voltage: 3.3 ~ 5.5 VDC », « Operating Current: 5mA »'
  },
  mq2: {
    title: 'MQ-2 Semiconductor Sensor for Combustible Gas',
    publisher: 'fabricant non indiqué (fiche diffusée par Pololu)',
    url: 'https://www.pololu.com/file/0J309/MQ2.pdf',
    section: 'Standard work condition : « Heater Voltage VH 5.0V±0.2V », « RH 31Ω±3Ω », « PH ≤900mW »'
  },
  maximDs18b20: {
    title: 'DS18B20 Programmable Resolution 1-Wire Digital Thermometer',
    publisher: 'Analog Devices (Maxim Integrated)',
    url: 'https://www.analog.com/media/en/technical-documentation/data-sheets/DS18B20.pdf',
    mirror: 'https://cdn.sparkfun.com/datasheets/Sensors/Temp/DS18B20.pdf',
    section: 'DC Electrical Characteristics : Supply Voltage VDD 3.0 à 5.5 V, Active Current IDD 1 à 1.5 mA'
  },
  boschBmp280: {
    title: 'BMP280 – Data sheet (BST-BMP280-DS001-26, revision 1.26)',
    publisher: 'Bosch Sensortec',
    url: 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp280-ds001.pdf',
    section: 'Table 2 Parameter specification, p. 7 : VDD 1.71 à 3.6 V ; Peak current Ipeak 720 µA (typ.), 1120 µA (max.)'
  },
  invensenseMpu6050: {
    title: 'MPU-6000 and MPU-6050 Product Specification (PS-MPU-6000A-00)',
    publisher: 'InvenSense',
    url: 'https://cdn.sparkfun.com/datasheets/Components/General%20IC/PS-MPU-6000A.pdf',
    section: '§ 6.3 Electrical Characteristics : Operating Voltages 2.375 à 3.46 V (la puce ; le module GY-521 a son régulateur), « Normal Operating Current Gyroscope + Accelerometer + DMP 3.9 mA »'
  },
  tiLm393: {
    title: 'LM393B, LM2903B, LM193, LM293, LM393 and LM2903 Dual Comparators (SLCS005AH)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/lm393.pdf',
    section: '§ 5.8 Electrical Characteristics : ICC « VCC = 5V » 0.45 mA (typ.), 1 mA (max.) ; le reste des ≈ 5 mA d’un module va à ses LED et à son pont diviseur'
  },
  vs1838b: {
    title: 'Infrared Receiver Module VS1838B',
    publisher: 'fabricant non indiqué (fiche diffusée par Elecrow)',
    url: 'https://www.elecrow.com/download/Infrared%20receiver%20vs1838b.pdf',
    section: '§ 5 光电参数 : Vcc 2.7 à 5.5 V ; Icc 0.4 mA (typ.), 1.5 mA (max.)'
  },
  adafruitOled: {
    title: 'Monochrome 0.96" 128x64 OLED Graphic Display - STEMMA QT (product 326)',
    publisher: 'Adafruit',
    url: 'https://www.adafruit.com/product/326',
    section: 'Description : « They tend to draw ~20mA or so in practice », « completely 5V-ready, with an onboard regulator and built-in boost converter »'
  },
  newhavenLcd1602: {
    title: 'NHD-0216K1Z-NSW-BBW-L Product Specification',
    publisher: 'Newhaven Display',
    url: 'https://newhavendisplay.com/content/specs/NHD-0216K1Z-NSW-BBW-L.pdf',
    section: 'Electrical Characteristics, p. 5 : Supply Voltage VDD 4.5 à 5.5 V ; IDD 1.0 mA (typ.) ; rétroéclairage ILED 32 mA (typ.)'
  },
  worldsemiWs2812b: {
    title: 'WS2812B Intelligent control LED integrated light source',
    publisher: 'Worldsemi',
    url: 'https://cdn-shop.adafruit.com/datasheets/WS2812B.pdf',
    section: 'Absolute Maximum Ratings : « Power supply voltage VDD +3.5~+5.3 V »'
  },
  adafruitNeopixel: {
    title: 'Adafruit NeoPixel Überguide — Powering NeoPixels',
    publisher: 'Adafruit',
    url: 'https://learn.adafruit.com/adafruit-neopixel-uberguide/powering-neopixels',
    section: 'Estimating Power Requirements : « Each individual NeoPixel draws up to 60 milliamps at maximum brightness white », « 20 mA per pixel » en moyenne'
  },

  /* ---------- Actionneurs ---------- */
  towerproSg90: {
    title: 'SG90 Digital',
    publisher: 'Tower Pro',
    url: 'https://towerpro.com.tw/product/sg90-7/',
    section: 'Description : « Operating voltage: 4.8v », « Voltages from 4.8V – 6V are fine. »'
  },
  kiatronics28byj48: {
    title: '28BYJ-48 – 5V Stepper Motor',
    publisher: 'Kiatronics',
    url: 'https://microcontroller-course.web.cern.ch/Project_Material/resources/stepd-01-data-sheet-1143075.pdf',
    section: 'p. 1 : « Rated voltage: 5VDC », bobine de 50 Ω'
  },

  /* ---------- Communication ---------- */
  hc05Manual: {
    title: 'HC Serial Bluetooth Products User Instructional Manual',
    publisher: 'Guangzhou HC Information Technology',
    url: 'https://epfl.ch/campus/associations/robopoly/wp-content/uploads/2018/09/hc-05-user_instructional_manual.pdf',
    section: 'p. 5 : « During the pairing, the current is fluctuant in the range of 30-40mA », 8 mA une fois appairé'
  },
  hc05Zs040: {
    title: 'HC-05 ZS-040 Bluetooth Module',
    publisher: 'ProtoSupplies',
    url: 'https://protosupplies.com/product/hc-05-zs-040-bluetooth-module/',
    section: 'Specifications : Vcc « 3.6 – 6V » (module sur sa carte d’accueil, régulateur 3,3 V)'
  },
  nxpMfrc522: {
    title: 'MFRC522 Standard performance MIFARE and NTAG frontend, Product data sheet Rev. 3.9',
    publisher: 'NXP Semiconductors',
    url: 'https://www.nxp.com/docs/en/data-sheet/MFRC522.pdf',
    section: '§ 4 Table 1 Quick reference data : VDDA, VDDD, VDD(TVDD) 2.5 à 3.6 V (« below 3 V reduce the performance ») ; IDDD 6.5 mA, IDD(TVDD) 60 mA (typ.), 100 mA (max.)'
  },
  nordicNrf24: {
    title: 'nRF24L01+ Single Chip 2.4GHz Transceiver Product Specification v1.0',
    publisher: 'Nordic Semiconductor',
    url: 'https://www.sparkfun.com/datasheets/Components/SMD/nRF24L01Pluss_Preliminary_Product_Specification_v1_0.pdf',
    section: '§ 4 Table 3 Operating conditions : VDD 1.9 à 3.6 V ; Key Features : « 11.3mA TX at 0dBm », « 13.5mA RX at 2Mbps »'
  },
  simcomSim800l: {
    title: 'SIM800L Hardware Design V1.00',
    publisher: 'SIMCom Wireless Solutions',
    url: 'https://www.makerhero.com/wp-content/uploads/2025/12/Datasheet_SIM800L.pdf',
    section: 'Table 42 Recommended operating conditions : VBAT 3.4 à 4.4 V ; Table 48 Current consumption : GPRS (1Rx, 4Tx) jusqu’à 453.57 mA ; § 4.1 : pointes de 2 A en émission'
  },
  adafruitLevelShifter: {
    title: '4-channel I2C-safe Bi-directional Logic Level Converter - BSS138 (product 757)',
    publisher: 'Adafruit',
    url: 'https://www.adafruit.com/product/757',
    section: 'Description : « It works down to 1.8V on the low side, and up to 10V on the high side. »'
  },

  /* ---------- Analogique ---------- */
  tiNe555: {
    title: 'xx555 Precision Timers (SLFS022K, révision de mars 2026)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/ne555.pdf',
    section: '§ 5.1 Absolute Maximum Ratings, p. 4 : VCC 18 V, « IO Output current ±225 mA » ; § 5.3 Recommended Operating Conditions, p. 4 : VCC 4.5 à 16 V (NE555), IO ±200 mA ; § 5.5 Electrical Characteristics, p. 5-6 : supply current, output low, no load, VCC = 5 V, 3 mA (typ.) ; VOH 3.3 V (typ.) à IOH = −100 mA sous 5 V ; VOL 0.1 V (typ.) à 5 mA ; DISCH switch on-state voltage 0.15 V (typ.) à 8 mA ; RESET voltage level 0.7 V (typ.) ; § 6.3.1-6.3.2 : tw = 1.1 × RA × C, f ≅ 1.44 / ((RA + 2RB) × C)'
  },
  tiLm358: {
    title: 'LMx58, LMx58x, LM2904x Industry-Standard Dual Operational Amplifiers (SLOS068AB, révision d’octobre 2024)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/lm358.pdf',
    section: '§ 5.1 Absolute Maximum Ratings, p. 4 : VS 32 V, VI −0.3 à 32 V ; § 5.3 Recommended Operating Conditions, p. 5 : VS 3 à 30 V ; § 5.7 Electrical Characteristics: LM358, p. 10 (VS = 5 V) : VCM de (V–) à (V+) – 1.5 V, voltage output swing from positive rail 1.5 V (max., RL ≥ 2 kΩ), from negative rail 5 mV (typ.), IQ 350 µA par ampli (typ.), AOL 100 V/mV (typ.), GBW 0.7 MHz, SR 0.3 V/µs, ISC ±40 mA (typ.)'
  },
  infineonIrlz44n: {
    title: 'IRLZ44NPbF HEXFET Power MOSFET (PD-94831)',
    publisher: 'Infineon Technologies (International Rectifier)',
    url: 'https://www.infineon.com/assets/row/public/documents/24/49/infineon-irlz44n-datasheet-en.pdf',
    section: 'p. 1, Absolute Maximum Ratings : VDSS 55 V, ID @ TC = 25 °C 47 A, ID @ TC = 100 °C 33 A, VGS ±16 V, TJ jusqu’à 175 °C ; Thermal Resistance : RθJA 62 °C/W ; p. 2, Electrical Characteristics : RDS(on) 0.022 Ω (VGS = 10 V), 0.025 Ω (5 V), 0.035 Ω (4 V), VGS(th) 1.0 à 2.0 V'
  },
  bourns5800: {
    title: '5800 Series High Current Chokes (REV. 09/17)',
    publisher: 'Bourns',
    url: 'https://www.bourns.com/docs/Product-Datasheets/5800_series.pdf',
    section: 'Electrical Specifications, ligne 5800-103-RC : 10,000 µH ±10 %, DCR 24.0 Ω max., I sat. 0.11 A (« current to cause 10 % max. inductance drop »), I rated 0.076 A (« current to cause 35 °C max. temperature rise »)'
  }
};
