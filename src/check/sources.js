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
    section: '§ 29.1 Absolute Maximum Ratings, p. 308 : « DC Current per I/O Pin 40.0mA », « DC Current VCC and GND Pins 200.0mA », « Voltage on any Pin except RESET -0.5V to VCC+0.5V » ; Table 30-1 Common DC characteristics, notes 3 et 4, p. 323 : courant d’essai « 20mA at VCC = 5V » ; Table 30-1, p. 322 : VIL « -0.5 0.3VCC », VIH « 0.6VCC … VCC + 0.5 » (3,0 V sous 5 V), « RPU I/O Pin Pull-up Resistor 20 50 k » ; note 3, p. 323 : « The sum of all IOH, for ports C0 - C5, D0- D4, ADC7, RESET should not exceed 150mA », « … B0 - B5, D5 - D7, ADC6, XTAL1, XTAL2 should not exceed 150mA » ; note 4 : somme des IOL au plus 100 mA pour « C0 - C5, ADC7, ADC6 », pour « B0 - B5, D5 - D7, XTAL1, XTAL2 », pour « D0 - D4, RESET » ; Table 29-8, p. 312 : « Active 8MHz, VCC = 5V 5.2 9 » mA'
  },
  arduinoUno: {
    title: 'Arduino UNO Rev3',
    publisher: 'Arduino',
    url: 'https://store.arduino.cc/products/arduino-uno-rev3',
    section: 'Input and Output : « Each pin can provide or receive 20 mA as recommended operating condition » ; Power : broche 3.3V « Maximum current draw is 50 mA » ; Warnings : « If more than 500 mA is applied to the USB port, the fuse will automatically break the connection » ; schéma (fichier EAGLE UNO-TH_Rev3e.sch, docs.arduino.cc A000066-cad-files.zip) : régulateur 3,3 V U2 « LP2985-33DBVR », fusible USB F1 « MF-MSMF050-2 500mA » ; brochage A000066-full-pinout.pdf : « MAXIMUM current per +3.3V pin is 50mA », « MAXIMUM current per I/O pin is 20mA »'
  },
  arduinoNano: {
    title: 'Arduino Nano',
    publisher: 'Arduino',
    url: 'https://store.arduino.cc/products/arduino-nano',
    section: 'Tech Specs : DC Current per I/O Pin « 20 mA (I/O Pins) » ; FAQ, Input and Output : « Each pin can provide or receive a maximum of 40 mA » ; brochage A000005-full-pinout.pdf : « MAXIMUM current per +3.3V pin is 50mA » ; schéma NanoV3.3.sch : broche 3V3 = sortie 3V3OUT du FT232RL'
  },
  atmega2560: {
    title: 'ATmega640/V-1280/V-1281/V-2560/V-2561/V Datasheet (2549Q–AVR–02/2014)',
    publisher: 'Microchip Technology (Atmel)',
    url: 'https://ww1.microchip.com/downloads/en/devicedoc/atmel-2549-8-bit-avr-microcontroller-atmega640-1280-1281-2560-2561_datasheet.pdf',
    section: '§ 31 Electrical Characteristics, Absolute Maximum Ratings, p. 355 : « DC Current per I/O Pin 40.0mA », « DC Current VCC and GND Pins 200.0mA », « Voltage on any Pin except RESET with respect to Ground -0.5V to VCC+0.5V » ; § 31.1 DC Characteristics, p. 355 : VIL 0.3 VCC au plus, VIH 0.6 VCC au moins, RPU 20 à 50 kΩ ; p. 356, notes 3 et 4 (ATmega640/1280/2560) : somme des IOL, et des IOH, au plus 200 mA pour « J0-J7, A0-A7, G2 », pour « C0-C7, G0-G1, D0-D7, L0-L7 », pour « G3-G4, B0-B7, H0-H7 », au plus 100 mA pour « E0-E7, G5 » et pour « F0-F7, K0-K7 »'
  },
  arduinoMega: {
    title: 'Arduino Mega 2560 Rev3',
    publisher: 'Arduino',
    url: 'https://store.arduino.cc/products/arduino-mega-2560-rev3',
    section: 'Tech Specs : « DC Current per I/O Pin 20 mA », « DC Current for 3.3V Pin 50 mA » ; Power : fusible réarmable de l’USB à 500 mA ; schéma MEGA2560_Rev3e.sch : régulateur 3,3 V IC6 « LP2985-33DBVR », fusible « MF-MSMF050-2 500mA » ; brochage A000067-full-pinout.pdf : « MAXIMUM current per +3.3V pin is 50mA »'
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
    section: '§ 7.2.1 Classes of Devices, p. 171 : « A unit load is defined to be 100 mA. », « A device may be either low-power at one unit load or high-power, consuming up to five unit loads. » (500 mA)'
  },
  esp32: {
    title: 'ESP32 Series Datasheet v5.3',
    publisher: 'Espressif Systems',
    url: 'https://documentation.espressif.com/esp32_datasheet_en.pdf',
    section: 'Table 5-1 Absolute Maximum Ratings : « Cumulative IO output current 1200 mA », VDD 3.6 V au plus ; Table 5-2 : alimentation de 0.5 A au moins ; Table 5-3 DC Characteristics : IOH 40 mA (typ.), IOL 28 mA (typ.), VIH jusqu’à VDD + 0.3 V ; Table 5-3, p. 52 : VIL −0.3 à 0.25 VDD, VIH 0.75 VDD à VDD + 0.3 V, IOH 40 mA « VDD = 3.3 V, VOH >= 2.64 V, output drive strength set to the maximum », RPU = RPD 45 kΩ ; Table 5-4, p. 52 : émission 802.11b 1 Mbps à 19.5 dBm 240 mA (typ.) ; Table 4-4, p. 44 : plages calibrées de l’ADC, atten 3 « 150 ~ 2450 » mV ; Table 4-6, p. 46 : ADC2 sur GPIO4, 0, 2, 15, 13, 12, 14, 27, 25, 26 ; Table 6-1 note 2, p. 61 : « GPIO pins 34-39 are input-only » ; Table 2-1, p. 15 et § 2.6 : GPIO6 à GPIO11 reliées à la flash, « not recommended for other usage » ; Table 3-1, p. 22 et § 3.2, p. 24 : broches de démarrage GPIO0, 2, 5, 12 (MTDI), 15 (MTDO) ; « MTDI = 1, VDD_SDIO pin is powered from internal 1.8 V LDO »'
  },
  esp32s3: {
    title: 'ESP32-S3 Series Datasheet Version 2.2',
    publisher: 'Espressif Systems',
    url: 'https://documentation.espressif.com/esp32-s3_datasheet_en.pdf',
    section: 'Table 5-1 Absolute Maximum Ratings : « Cumulative IO output current — 1500 mA », « Allowed input voltage −0.3 3.6 V » ; Table 5-4 DC Characteristics : IOH 40 mA (typ.), IOL 28 mA (typ.), VIH jusqu’à VDD + 0.3 V ; § 2 : « GPIO0, GPIO3, GPIO45, GPIO46: Strapping pins » ; Table 5-4, p. 65 : VIL −0.3 à 0.25 VDD, RPU/RPD 45 kΩ ; Table 5-7, p. 66 : émission 802.11b 1 Mbps à 21 dBm 340 mA (crête) ; Table 3-1 à 3-4, p. 32-34 : GPIO0 tirée haut (démarrage SPI : 1), GPIO45 tirée bas (« 1 » : flash à 1,8 V), GPIO46 tirée bas (« GPIO0 = 0 et GPIO46 = 0 » pour le téléversement) ; Table 5-6, p. 66 : ADC, ATTEN3 0 à 2900 mV'
  },
  esp32c3: {
    title: 'ESP32-C3 Series Datasheet Version 2.5',
    publisher: 'Espressif Systems',
    url: 'https://documentation.espressif.com/esp32-c3_datasheet_en.pdf',
    section: 'Table 5-1 Absolute Maximum Ratings : « Cumulative IO output current — 1000 mA », « Allowed input voltage −0.3 3.6 V » ; Table 5-4 DC Characteristics : IOH 40 mA (typ.), IOL 28 mA (typ.), VIH jusqu’à VDD + 0.3 V ; § 2 : « GPIO2, GPIO8, GPIO9: Strapping pins » ; Table 5-4, p. 56 : VIL −0.3 à 0.25 VDD, RPU/RPD 45 kΩ ; Table 5-7, p. 57 : émission 802.11b 1 Mbps à 21 dBm 335 mA (crête) ; Table 3-3, p. 31 : démarrage SPI GPIO2 = 1, GPIO9 = 1 ; téléversement GPIO2 = 1, GPIO8 = 1, GPIO9 = 0 (« it is recommended to pull this pin up », GPIO2) ; Table 5-6, p. 57 : ADC, ATTEN3 0 à 2500 mV'
  },
  esp8266: {
    title: 'ESP8266EX Datasheet Version 7.1',
    publisher: 'Espressif Systems',
    url: 'https://documentation.espressif.com/0a-esp8266ex_datasheet_en.pdf',
    section: '§ 5.1, Table 5-1 Electrical Characteristics : « IMAX … 12 mA », VIH jusqu’à 3.6 V, tension de travail 2.5 à 3.6 V ; Table 5-1 : VIL −0.3 à 0.25 VIO ; Table 5-3, p. 20 : émission 802.11b 11 Mbps à 17 dBm 170 mA (typ.) ; § 4 ADC : « The input voltage range is 0 to 1.0 V when TOUT is connected to external circuit »'
  },
  rp2040: {
    title: 'RP2040 Datasheet',
    publisher: 'Raspberry Pi Ltd',
    url: 'https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf',
    section: '§ 5.5.3.1 Table 622 : VPIN « -0.5 … IOVDD + 0.5 V » ; § 5.5.3.4 Table 625 : IOH/IOL « 2, 4, 8 or 12mA depending on setting », VIH jusqu’à IOVDD + 0.3 V, « Maximum Total IOVDD current … 50 mA » ; Table 622, p. 614 : IOVDD −0.5 à 3.63 V ; Table 625, p. 615-616 : VIH 2.0 V au moins et VIL 0.8 V au plus sous 3,3 V, RPU et RPD 50 à 80 kΩ, « IIOVSS_MAX 50 mA Sum of all current being sunk into GPIO and QSPI pins » ; § 2.19 Table 341, p. 301 : intensité de sortie 2, 4 (par défaut), 8 ou 12 mA'
  },
  pico: {
    title: 'Raspberry Pi Pico Datasheet',
    publisher: 'Raspberry Pi Ltd',
    url: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf',
    section: '§ 2.1 Raspberry Pi Pico pinout : broche 3V3, « it is recommended to keep the load on this pin less than 300mA » ; § 2.3 : VSYS 1.8 à 5.5 V, VBUS 5 V ± 10 % ; § 4.4 : « VSYS … feeds the RT6150 buck-boost SMPS, which generates a fixed 3.3 V output »'
  },
  ams1117: {
    title: 'AMS1117 1A Low Dropout Voltage Regulator',
    publisher: 'Advanced Monolithic Systems',
    // Le site du fabricant ne sert pas HTTPS (échec de la poignée de main TLS) : adresse HTTP d'origine.
    url: 'http://www.advanced-monolithic.com/pdf/ds1117.pdf',
    section: 'Features, p. 1 : « Output Current of 1A » (régulateur 3,3 V des cartes ESP32 DevKit et NodeMCU, et du MB102) ; Absolute Maximum Ratings, p. 2 : « Input Voltage 15V », « SOT-223 package θJA = 90 °C/W » ; Electrical Characteristics, p. 3 : AMS1117-3.3, output voltage 3.300 V (typ.) à VIN = 4.8 V ; « Dropout Voltage (VIN - VOUT) … IOUT = 0.8A » 1.1 V (typ.), 1.3 V (max.) ; Current Limit 900 mA (min.), 1100 mA (typ.) ; p. 2, note : « φJA can vary from 46°C/W to >90°C/W depending on mounting » ; température de jonction −40 à 125 °C ; Stability, p. 4 : condensateur de sortie de 22 µF au tantale'
  },

  /* ---------- Composants discrets ---------- */
  kingbrightWp7113id: {
    title: 'WP7113ID T-1 3/4 (5mm) Solid State Lamp (Spec No DSAF0012, Rev V.14A)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf',
    section: 'Absolute Maximum Ratings at TA=25°C : « DC Forward Current IF 30 mA » (LED rouge 5 mm) ; « Peak Forward Current IFP 160 mA » (1/10, 0,1 ms), « Power dissipation PD 75 mW », « Reverse Voltage VR 5 V », VF 1.9 V (typ.), 2.3 V (max.) à 10 mA'
  },
  kingbrightWp7113qbcd: {
    title: 'WP7113QBC/D T-1 3/4 (5mm) Solid State Lamp (Spec No DSAG3481, Rev V.18B)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113QBC-D.pdf',
    section: 'Absolute Maximum Ratings at TA=25°C : « DC Forward Current IF 30 mA » (LED bleue 5 mm) ; IFP 150 mA, PD 120 mW, VR 5 V, VF 3.3 V (typ.), 4.0 V (max.) à 20 mA'
  },
  yageoCfr: {
    title: 'Product specification – Carbon Film Resistors, CFR, Through Hole Resistors (V.3, 2024)',
    publisher: 'YAGEO',
    url: 'https://yageogroup.com/content/datasheet/asset/file/YAGEO-CFR_DATASHEET',
    section: 'Table 1, p. 3 : Power Rating at 70 °C, CFR-25 « 1/4W » ; Table 1, p. 3 : CFR-25 « Maximum Working Voltage 250V », « Maximum Overload Voltage 500V » ; courbe de déclassement : 100 % jusqu’à 70 °C, 0 % à 155 °C ; p. 5 : « V=√(P X R) or max. working voltage whichever is less »'
  },
  bournsPdb12: {
    title: 'PDB12 Series - 12 mm Rotary Potentiometer (REV. 07/25)',
    publisher: 'Bourns',
    url: 'https://www.bourns.com/docs/Product-Datasheets/pdb12.pdf',
    section: 'Electrical Characteristics : Power Rating « Linear … 0.08 watt » ; p. 1 : « Maximum Operating Voltage Linear… 150 V »'
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
    section: 'Absolute Maximum Ratings, p. 1 : VCEO 45 V (BC547), « Collector Current (DC) IC 100 mA », « Collector Power Dissipation PC 500 mW » ; Electrical Characteristics, p. 2 : hFE 110 à 800 ; BC550/D (février 2026, Rev. 6), p. 1 : VCBO 50 V, VEBO 6 V ; p. 2 : VCE(sat) 600 mV au plus à IC = 100 mA, IB = 5 mA (β forcé 20), 250 mV à 10 mA / 0.5 mA ; hFE A 110–220, B 200–450, C 420–800'
  },
  onsemiPn2222a: {
    title: 'PN2222A — NPN General-Purpose Amplifier',
    publisher: 'onsemi (Fairchild Semiconductor)',
    url: 'https://www.onsemi.com/pdf/datasheet/pn2222a-d.pdf',
    section: 'Features : « collector currents up to 500mA » ; Absolute Maximum Ratings : VCEO 40 V, IC 1.0 A ; Thermal Characteristics : PD 625 mW ; VEBO 6.0 V ; Electrical Characteristics : hFE 100 (min.) à 150 mA / 10 V, 40 (min.) à 500 mA ; VCE(sat) 0.3 V au plus à IC = 150 mA, IB = 15 mA, 1.0 V à 500 mA / 50 mA (β forcé 10)'
  },
  onsemiBc557: {
    title: 'BC556B, BC557A, B, C, BC558B — Amplifier Transistors, PNP Silicon (BC556B/D)',
    publisher: 'onsemi',
    url: 'https://www.onsemi.com/pdf/datasheet/bc556b-d.pdf',
    section: 'Maximum Ratings, p. 1 : VCEO −45 V (BC557), « Collector Current − Continuous IC 100 mAdc », « Total Device Dissipation @ TA = 25 °C PD 625 mW » ; brochage TO-92 : 1 collecteur, 2 base, 3 émetteur ; Electrical Characteristics, p. 2 : hFE 120 à 800 (IC = 2,0 mA), VCE(sat) 0.3 V au plus à 10 mA ; p. 1 : VEBO −5.0 V, RθJA 200 °C/W ; p. 2 : VCE(sat) −0.65 V au plus à IC = −100 mA, IB = −5 mA (β forcé 20)'
  },
  onsemiPn2907a: {
    title: 'PN2907A — PNP General-Purpose Transistor, 60 V (PN2907A-FSC/D)',
    publisher: 'onsemi (Fairchild Semiconductor)',
    url: 'https://www.onsemi.com/pdf/datasheet/pn2907a-fsc-d.pdf',
    section: 'Description : « applications that require up to 500 mA » ; Absolute Maximum Ratings, p. 1 : VCEO −60 V, IC −800 mA (continu) ; Thermal Characteristics : PD 625 mW ; Electrical Characteristics, p. 2 : hFE 100 à 300 (IC = −150 mA), VCE(sat) 0.4 V au plus à −150 mA ; VEBO −5.0 V ; hFE 50 (min.) à −500 mA ; VCE(sat) −1.6 V au plus à IC = −500 mA, IB = −50 mA (β forcé 10)'
  },
  vishay1n4007: {
    title: '1N4001, 1N4002, 1N4003, 1N4004, 1N4005, 1N4006, 1N4007 — General Purpose Plastic Rectifier (document 88503, 29-Apr-2020)',
    publisher: 'Vishay General Semiconductor',
    url: 'https://www.vishay.com/docs/88503/1n4001.pdf',
    section: 'Maximum Ratings, p. 1 : « Maximum average forward rectified current … IF(AV) 1.0 A » ; « 8.3 ms single half sine-wave … IFSM 30 A », VRRM 1000 V (1N4007) ; p. 2 : VF 1.1 V au plus à 1.0 A'
  },
  vishayBzx55: {
    title: 'BZX55-Series — Small Signal Zener Diodes (document 85604)',
    publisher: 'Vishay Semiconductors',
    url: 'https://www.vishay.com/docs/85604/bzx55.pdf',
    section: 'Absolute Maximum Ratings, p. 1 : « Power dissipation l = 4 mm, TL = 25 °C Ptot 500 mW », « Zener current IZ Ptot/VZ » ; Electrical Characteristics, p. 2 : BZX55C3V3 3.1 / 3.3 / 3.5 V, BZX55C5V1 4.8 / 5.1 / 5.4 V, BZX55C12 11.4 / 12 / 12.7 V (min. / nom. / max. à IZT = 5 mA) ; ZZ à IZT au plus 85 Ω (C3V3), 35 Ω (C5V1), 20 Ω (C12) ; Rev. 2.0 (07-Nov-2024) : pas de colonne IZM, IZ = Ptot ÷ VZ ; RthJA 300 K/W, Tj 175 °C'
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
    section: '§ 6 Coil data : 5 V, 71.4 mA, « Pull-In 75% Max. », « Max-Allowable 120% » ; § 7 Contact rating, FORM C : « 10A 125VAC », « 7A 240VAC », « 7A 28VDC » ; § 6 : bobine 70 Ω, ≈ 0.36 W, retombée à 10 % au moins ; § 7, charge inductive : « 3A 120VAC », « 3A 28VDC » ; tension de contact au plus 250 VAC / 110 VDC'
  },

  /* ---------- Circuits de puissance ---------- */
  stL298: {
    title: 'L298 Dual Full-Bridge Driver',
    publisher: 'STMicroelectronics',
    url: 'https://www.st.com/resource/en/datasheet/l298.pdf',
    mirror: 'https://cdn.sparkfun.com/assets/7/1/d/6/c/Full-Bridge_Motor_Driver_Dual_-_L298N.pdf',
    section: 'Absolute Maximum Ratings, p. 2 : IO « DC Operation 2 A » par voie ; Electrical Characteristics, p. 3 : VS de VIH + 2.5 à 46 V ; Absolute Maximum Ratings, p. 2 : VS 50 V, VSS 7 V, VI et Ven −0.3 à 7 V ; Electrical Characteristics, p. 3 : ViH 2.3 V à VSS, ViL −0.3 à 1.5 V (entrées et validations)'
  },
  tiL293d: {
    title: 'L293x Quadruple Half-H Drivers (SLRS008D)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/l293d.pdf',
    section: 'Features, p. 1 : « Output Current 1 A Per Channel (600 mA for L293D) », « Peak Output Current 2 A Per Channel (1.2 A for L293D) », « Output Clamp Diodes for Inductive Transient Suppression (L293D) », « Wide Supply-Voltage Range: 4.5 V to 36 V » ; § 6.1 : VCC1 36 V, VI 7 V ; § 6.3 Recommended Operating Conditions : VCC1 4.5 à 7 V, VCC2 VCC1 à 36 V, VIH 2.3 V à VCC1, VIL −0.3 à 1.5 V ; § 8.1 : « All inputs are TTL compatible and tolerant up to 7 V. » ; § 6.5 Electrical Characteristics : VOH = VCC2 − 1.4 V et VOL = 1.2 V (typ., IO = ±0.6 A)'
  },
  toshibaTb6612: {
    title: 'TB6612FNG Driver IC for Dual DC motor (datasheet, 2026-05-13)',
    publisher: 'Toshiba Electronic Devices & Storage',
    url: 'https://toshiba.semicon-storage.com/info/TB6612FNG_datasheet_en_20141001.pdf?did=10660&prodName=TB6612FNG',
    section: 'Features, p. 1 : « Low ON resistance: 0.5 Ω (upper+lower Typ. @ VM ≥ 5 V) », « Output current: IOUT = 1.2 A(ave) / 3.2 A (peak) » ; Absolute Maximum Ratings : VM 15 V, VCC 6 V ; Operating Range : VCC 2.7 à 5.5 V, VM 2.5 à 13.5 V ; H-SW Control Function : IN1 = IN2 = H frein court, PWM = L frein court, IN1 = IN2 = L arrêt, STBY = L veille ; p. 3 : VIN −0.2 à 6 V ; Electrical Characteristics, p. 5 : VIH VCC × 0.7 à VCC + 0.2 V, VIL −0.2 V à VCC × 0.3 (STBY aussi) ; Pin Functions, p. 2 : tirage de 200 kΩ vers la masse sur PWM, IN et STBY'
  },
  pololuTb6612: {
    title: 'TB6612FNG Dual Motor Driver Carrier (#713)',
    publisher: 'Pololu',
    url: 'https://www.pololu.com/product/713',
    section: 'Features et description : « recommended motor voltage (VMOT) 4.5 V to 13.5 V », « logic voltage (VCC) 2.7 V to 5.5 V », « 1 A continuous per channel (3 A peak) » ; STBY tirée vers la masse en interne'
  },
  allegroA4988: {
    title: 'A4988 DMOS Microstepping Driver with Translator and Overcurrent Protection (A4988-DS, Rev. 8, 5 avril 2022)',
    publisher: 'Allegro MicroSystems',
    url: 'https://www.allegromicro.com/-/media/files/datasheets/a4988-datasheet.pdf',
    section: 'Absolute Maximum Ratings : VBB 35 V, IOUT ±2 A, VDD 3.0 à 5.5 V ; Table 1 Microstepping Resolution Truth Table (MS1, MS2, MS3) ; Figure 1 : STEP minimum high et low pulse width 1 µs ; ITripMAX = VREF ÷ (8 × RS) ; p. 2 : VDD et VIN −0.3 à 5.5 V ; Electrical Characteristics, p. 4 : VDD 3.0 à 5.5 V (fonctionnement), VIN(1) = VDD × 0.7, VIN(0) = VDD × 0.3, tirages vers la masse de MS1 (100 kΩ), MS2 (50 kΩ), MS3 (100 kΩ) ; p. 7 : RESET bas coupe les sorties et ignore STEP'
  },
  pololuA4988: {
    title: 'A4988 Stepper Motor Driver Carrier (#1182)',
    publisher: 'Pololu',
    url: 'https://www.pololu.com/product/1182',
    section: 'Features : « Minimum operating voltage 8 V », « Maximum operating voltage 35 V », « Continuous current per phase 1 A » (sans radiateur), « Maximum current per phase 2 A » ; Current limiting : « Current Limit = VREF × 2.5 » soit I_MAX = VREF ÷ (8 × RCS), RCS = 0.068 Ω ; MS1, MS2, MS3 tirées vers la masse ; « the RST pin is floating » (à relier à SLP) ; condensateur électrolytique d’au moins 47 µF sur VMOT'
  },
  tiDrv8825: {
    title: 'DRV8825 Stepper Motor Controller IC (SLVSA73F)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/drv8825.pdf',
    section: '§ 7.1, p. 4 : broches logiques −0.5 à 7 V ; § 7.3 Recommended Operating Conditions : VM 8.2 à 45 V ; § 7.5, p. 6 : VIL 0 à 0.7 V, VIH 2.2 à 5.25 V, RPD 100 kΩ ; § 7.6 Timing : tWH(STEP), tWL(STEP) 1.9 µs, tWAKE 1.7 ms ; § 8.3.5 Table 1, p. 13 : microstepping (MODE0 à MODE2, jusqu’à 1/32) ; § 8.3.2, p. 12 : ICHOP = VREF ÷ (5 × RISENSE) ; § 8.3.6, p. 17 : « nRESET and nENABL have internal pulldown resistors of approximately 100 kΩ. The nSLEEP pin has an internal pulldown resistor of 1 MΩ. », « nSLEEP and nRESET signals need to be driven to logic high for device operation. »'
  },
  pololuDrv8825: {
    title: 'DRV8825 Stepper Motor Driver Carrier, High Current (#2133)',
    publisher: 'Pololu',
    url: 'https://www.pololu.com/product/2133',
    section: 'Features : « 8.2 V to 45 V », « 1.5 A per phase without a heat sink », « 2.2 A per coil with sufficient additional cooling » ; Current limiting : « Current Limit = VREF × 2 » ; RESET (100 kΩ) et SLEEP (1 MΩ) tirées vers la masse, ENBL tirée vers la masse (pilote actif) ; impulsions STEP de 1.9 µs'
  },
  nema17hs4401: {
    title: '17HS4401 Stepper Motor (NEMA 17, 1.8°) — fiche du fabricant',
    publisher: 'Changzhou Songyang Machinery & Electronics',
    url: 'https://www.omc-stepperonline.com/download/17HS4401S.pdf',
    section: 'Electrical Specification : Step Angle 1.8°, Rated Current 1.7 A, Phase Resistance 1.5 Ω, Inductance 2.8 mH, Holding Torque 40 N·cm (≈ 0.4 N·m) ; document du fabricant refusé aux accès automatiques (403) en novembre 2026 : chiffres non relus'
  },
  stL78: {
    title: 'L78 Positive voltage regulator ICs (DocID2143)',
    publisher: 'STMicroelectronics',
    url: 'https://www.st.com/resource/en/datasheet/l78.pdf',
    mirror: 'https://protostack.com.au/download/l7805.pdf',
    section: 'Features, p. 1 : « Output current up to 1.5 A » (Rev 34) ; Table 2 Thermal data, p. 5 : TO-220 RthJA 50 °C/W, RthJC 5 °C/W ; Table 1 : TOP 0 à 125 °C (L78xxC) ; Figure 4, p. 5 : application avec CI = 0.33 µF et CO = 0.1 µF ; VI 35 V au plus'
  },
  onsemiMc7800: {
    title: 'MC7800, MC7800A, MC7800AE, NCV7800 — Voltage Regulators – Positive 1.0 A',
    publisher: 'onsemi',
    url: 'https://www.onsemi.com/pdf/datasheet/mc7800-d.pdf',
    section: 'Maximum Ratings, p. 1 : « Thermal Resistance, Junction−to−Ambient RθJA … 65 °C/W » (TO-220, case 221A), « Output Current in Excess of 1.0 A » ; Ordering Information : MC7805C, « TJ = 0°C to +125°C » ; MC7800/D Rev. 29 : RθJC 5.0 °C/W, TJ +150 °C ; Standard Application, p. 1 : Cin 0.33 µF, « Cin is required if regulator is located an appreciable distance from power supply filter », « CO is not needed for stability; however, it does improve transient response »'
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
    section: 'Specifications, p. 1 : rated voltage 5 Vdc, operating voltage 4 à 7 Vdc, 30 mA (max.), 2 300 Hz (typ.) ; SPL 85 dB au moins'
  },

  /* ---------- Sources d'énergie ---------- */
  energizer522: {
    title: 'Energizer 522 Product Datasheet',
    publisher: 'Energizer',
    url: 'https://data.energizer.com/pdfs/522.pdf',
    section: 'Form No. 522GL1019, « Milliamp-Hours Capacity » (« Continuous discharge to 4.8 volts at 21°C ») : histogramme sans valeurs imprimées, lu ≈ 600 mAh à 10 mA, ≈ 560 mAh à 25 mA, ≈ 450 mAh à 50 mA ; aucun courant maximal publié'
  },
  samsungIcr18650: {
    title: 'Specification of Product — Lithium-ion Rechargeable Cell ICR18650-26J',
    publisher: 'Samsung SDI',
    url: 'https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/196/ICR18650_2D00_26J_2D00_Samsung.pdf',
    section: '§ 3.6 : « Max. continuous discharge 5.2A (@ RT) » ; version 2.0 : § 3.1 capacité 2 550 mAh au moins (0,2 C, fin à 2,75 V), « 1C = 2,600mA » ; § 3.2 3.63 V ; § 3.3 charge standard CCCV 1.3 A, 4.20 V ; § 3.4 charge rapide 2.6 A au plus ; § 3.7 fin de décharge 2.75 V ; charge de 0 à 45 °C'
  },
  mb102: {
    title: 'MB102 Breadboard Power Supply 3.3V/5V',
    publisher: 'ShillehTek',
    url: 'https://shillehtek.com/blogs/shillehtek-product-manuals/mb102-breadboard-power-supply-3-3v-5v',
    section: 'Specifications : « Maximum Output Current: 700 mA per rail », régulateurs AMS1117-5.0 et AMS1117-3.3'
  },
  onsemiLm2596: {
    title: 'LM2596 — 3.0 A, Step-Down Switching Regulator (LM2596/D, Rev. 2)',
    publisher: 'onsemi',
    url: 'https://www.onsemi.com/pdf/datasheet/lm2596-d.pdf',
    section: 'Features, p. 1 : « Adjustable Output Voltage Range 1.23 V − 37 V », « Guaranteed 3.0 A Output Load Current », « Wide Input Voltage Range up to 40 V » ; Maximum Ratings, p. 2 : Maximum Supply Voltage 45 V, TO-220 RθJA 65 °C/W ; Operating Ratings, p. 3 : Supply Voltage 4.5 to 40 V ; Electrical Characteristics, p. 4 : Efficiency 73 % (Vin = 12 V, ILoad = 3.0 A, Vout = 5.0 V), Saturation Voltage 1.5 V (typ., Iout = 3.0 A), Current Limit 4.2 A à 6.9 A'
  },
  aerosemiMt3608: {
    title: 'MT3608 High Efficiency 1.2MHz 2A Step Up Converter (MT3608/V1.0)',
    publisher: 'Aerosemi Technology',
    url: 'https://www.olimex.com/Products/Breadboarding/BB-PWR-3608/resources/MT3608.pdf',
    section: 'Features, p. 1 : « 2V to 24V Input Voltage », « Internal 4A Switch Current Limit », « Up to 28V Output Voltage » ; Electrical Characteristics, p. 3 : Operating Input Voltage 2 à 24 V, Under Voltage Lockout 1.98 V, Maximum Duty Cycle 90 %, FB Voltage 0.6 V, SW Current Limit 4 A'
  },
  topPowerTp4056: {
    title: 'TP4056 1A Standalone Linear Li-lon Battery Charger with Thermal Regulation in SOP-8',
    publisher: 'NanJing Top Power ASIC Corp.',
    url: 'https://hobbielektronika.hu/forum/getfile.php?id=290337',
    section: 'Description et Features, p. 1 : « Programmable Charge Current Up to 1000mA », « Preset 4.2V Charge Voltage with 1.5% Accuracy », « C/10 Charge Termination », « 2.9V Trickle Charge Threshold » ; Absolute Maximum Ratings, p. 1 : Input Supply Voltage (VCC) −0.3 V à 8 V, jonction 145 °C ; Electrical Characteristics, p. 2 : VCC 4.0 à 8.0 V, IBAT 950 / 1000 / 1050 mA à RPROG = 1.2 kΩ, TLIM 145 °C ; tableau RPROG, p. 3 : 1.2 kΩ → 1000 mA'
  },
  adafruitSolar3809: {
    title: 'Small 6V 1W Solar Panel (product 3809)',
    publisher: 'Adafruit',
    url: 'https://www.adafruit.com/product/3809',
    section: 'Technical Details : « Open Circuit Voltage: 7.7V », « Peak Voltage: 6.5V », « Peak Current: 180mA », « Peak Power: 1.2W », « Power Tolerance: +/-10% » ; description : « they output 6V at 180 mA »'
  },

  /* ---------- Capteurs ---------- */
  aosongDht11: {
    title: 'DHT11 说明书 (2022年12月)',
    publisher: 'Aosong Electronics',
    url: 'https://www.aosong.com/userfiles/files/media/DHT11%E6%B8%A9%E6%B9%BF%E5%BA%A6%E4%BC%A0%E6%84%9F%E5%99%A8%E8%AF%B4%E6%98%8E%E4%B9%A6%EF%BC%88%E4%B8%AD%EF%BC%89%20A0-1208.pdf',
    section: '§ 1.2 表2 电气特性表 : VCC 3.3 à 5.5 V (typ. 5 V), courant moyen en mesure 1000 µA (typ.) ; 表2 note 7 : « 推荐R5=10Ω、Rp=4.7kΩ » (tirage de 4,7 kΩ conseillé sous 5 V) ; 表5, p. 6 : VCC −0.3 à 5.5 V, DATA −0.3 à VCC + 0.3 V, ±10 mA'
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
    section: 'Specification, p. 1 : « Voltage: 5V – 20V » ; p. 1 : « TTL output: 3.3V , 0V » ; p. 2, Features 8) : « DC4.5V-20V »'
  },
  dfrobotSen0193: {
    title: 'Gravity: Analog Capacitive Corrosion Resistant Soil Moisture Sensor for Arduino / Raspberry Pi (SKU SEN0193)',
    publisher: 'DFRobot',
    url: 'https://wiki.dfrobot.com/Capacitive_Soil_Moisture_Sensor_SKU_SEN0193',
    section: 'Specification : « Operating Voltage: 3.3 ~ 5.5 VDC », « Operating Current: 5mA »'
  },
  tiLm35: {
    title: 'LM35 Precision Centigrade Temperature Sensors (SNIS159)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/lm35.pdf',
    section: '§ 1 Features : « Operates From 4 V to 30 V », « Less Than 60-µA Current Drain », « Linear + 10-mV/°C Scale Factor »'
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
    section: 'DC Electrical Characteristics : Supply Voltage VDD 3.0 à 5.5 V, Active Current IDD 1 à 1.5 mA ; REV 042208, p. 19 : « Voltage Range on Any Pin Relative to Ground … -0.5V to +6.0V » ; VIH 2.2 V au moins (alimentation locale), VIL 0.8 V au plus ; IL 4.0 mA à 0.4 V ; p. 9 : tirage « approximately 5kΩ », DQ à drain ouvert'
  },
  boschBme280: {
    title: 'BME280 – Data sheet (BST-BME280-DS001-24, revision 1.24)',
    publisher: 'Bosch Sensortec',
    url: 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf',
    section: 'Table 1 Electrical parameter specification, p. 8 : VDD « 1.71 1.8 3.6 V » ; « Current during pressure measurement IDDP Max value at -40 °C 714 µA » ; Table 5, p. 13 : 4.25 V au plus, broches d’interface VDDIO + 0.3 V au plus ; Table 32, p. 35 : VIH 80 % VDDIO, VIL 20 % VDDIO'
  },
  winsenMq135: {
    title: 'Air Quality Gas Sensor (Model: MQ135) Manual, Version 1.4',
    publisher: 'Zhengzhou Winsen Electronics Technology',
    url: 'https://www.winsen-sensor.com/d/files/PDF/Semiconductor%20Gas%20Sensor/MQ135%20(Ver1.4)%20-%20Manual.pdf',
    section: 'Standard Circuit Conditions : « Heater Voltage VH 5.0V±0.1V AC or DC », « Heater Resistance RH 29Ω±3Ω (room tem.) », « Heater consumption PH ≤950mW » (5 V / 29 Ω ≈ 172 mA)'
  },
  rcwl0516: {
    title: 'RCWL-0516 Doppler radar motion sensor module – reverse engineering notes',
    publisher: 'Joe Desbonnet (documentation communautaire, le fabricant ne publie pas de fiche)',
    url: 'https://github.com/jdesbonnet/RCWL-0516',
    section: 'Tableau des broches : « VIN | 4 - 28V supply voltage », « 3V3 | 3.3V regulated output » ; « Working voltage: 4 - 28V »'
  },
  boschBmp280: {
    title: 'BMP280 – Data sheet (BST-BMP280-DS001-26, revision 1.26)',
    publisher: 'Bosch Sensortec',
    url: 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp280-ds001.pdf',
    section: 'Table 2 Parameter specification, p. 7 : VDD 1.71 à 3.6 V ; Peak current Ipeak 720 µA (typ.), 1120 µA (max.) ; Table 2 : VDDIO 1.2 à 3.6 V ; Table 3, p. 9 : VDD et VDDIO 4.25 V au plus, broches d’interface VDDIO + 0.3 V au plus ; Table 26, p. 31 : VIH 0.8 VDDIO, VIL 0.2 VDDIO ; I2C jusqu’à 3.4 MHz'
  },
  invensenseMpu6050: {
    title: 'MPU-6000 and MPU-6050 Product Specification (PS-MPU-6000A-00, Revision 3.1)',
    publisher: 'InvenSense',
    url: 'https://cdn.sparkfun.com/datasheets/Components/General%20IC/PS-MPU-6000A.pdf',
    section: '§ 6.3 Electrical Characteristics : Operating Voltages 2.375 à 3.46 V (la puce ; le module GY-521 a son régulateur), « Normal Operating Current Gyroscope + Accelerometer + DMP 3.9 mA » ; § 6.3 : VLOGIC 1.71 V à VDD ; § 6.4, p. 15 : VIH 0.7 VLOGIC, VIL 0.3 VLOGIC, I2C 400 kHz ; § 6.9, p. 20 : VDD −0.5 à +6 V, SCL et SDA au plus VDD + 0.5 V'
  },
  tiLm393: {
    title: 'LM393B, LM2903B, LM193, LM293, LM393 and LM2903 Dual Comparators (SLCS005AH)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/lm393.pdf',
    section: '§ 5.8 Electrical Characteristics : ICC « VCC = 5V » 0.45 mA (typ.), 1 mA (max.) ; le reste des ≈ 5 mA d’un module va à ses LED et à son pont diviseur ; § 5.1, p. 4 : VCC 36 V (versions non B), VI −0.3 à 36 V, IO 20 mA ; § 5.2 : VS 2 à 30 V ; § 5.8, p. 8 : IOL 6 mA au moins à VOL = 1.5 V, sortie à collecteur ouvert (IOH 50 nA au plus)'
  },
  vs1838b: {
    title: 'Infrared Receiver Module VS1838B',
    publisher: 'fabricant non indiqué (fiche diffusée par Elecrow)',
    url: 'https://www.elecrow.com/download/Infrared%20receiver%20vs1838b.pdf',
    section: '光电参数 table, p. 2 : Vcc 2.7 à 5.5 V ; Icc 0.4 mA (typ.), 1.5 mA (max.) ; § 6 极限参数 : Vcc 6.0 V au plus'
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
    section: 'Absolute Maximum Ratings : « Power supply voltage VDD +3.5~+5.3 V » ; « Input voltage VI -0.5～VDD+0.5 V » ; Electrical Characteristics (VDD = 4.5～5.5 V), p. 3 : « VIH DIN，SET 0.7VDD », VIL 0.3 VDD (3,5 V et 1,5 V sous 5 V)'
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
    section: 'Description : « Operating voltage: 4.8v », « Voltages from 4.8V – 6V are fine. » ; réponse du fabricant à une question (7 novembre 2021) : « The operation current for our SG90 is about 0.5A – 2A. » ; aucun courant de blocage dans la fiche'
  },
  kiatronics28byj48: {
    title: '28BYJ-48 – 5V Stepper Motor',
    publisher: 'Kiatronics',
    url: 'https://microcontroller-course.web.cern.ch/Project_Material/resources/stepd-01-data-sheet-1143075.pdf',
    section: 'p. 1 : « Rated voltage: 5VDC », bobine de 50 Ω ; ≈ 100 mA par phase (5 V ÷ 50 Ω, calculé)'
  },

  /* ---------- Communication ---------- */
  hc05Manual: {
    title: 'HC Serial Bluetooth Products User Instructional Manual',
    publisher: 'Guangzhou HC Information Technology',
    url: 'https://epfl.ch/campus/associations/robopoly/wp-content/uploads/2018/09/hc-05-user_instructional_manual.pdf',
    section: 'p. 4-5 : « During the pairing, the current is fluctuant in the range of 30-40mA », 8 mA une fois appairé ; p. 7 : UART « TTL/COMS level » ; p. 11 : module nu, VCC 3.0 à 4.2 V'
  },
  hc05Zs040: {
    title: 'HC-05 ZS-040 Bluetooth Module',
    publisher: 'ProtoSupplies',
    url: 'https://protosupplies.com/product/hc-05-zs-040-bluetooth-module/',
    section: 'Specifications : Vcc « 3.6 – 6V » (module sur sa carte d’accueil, régulateur 3,3 V) ; logique « 3.3V levels », « RXD … Use a level shifter if using a 5V MCU »'
  },
  nxpMfrc522: {
    title: 'MFRC522 Standard performance MIFARE and NTAG frontend, Product data sheet Rev. 3.9',
    publisher: 'NXP Semiconductors',
    url: 'https://www.nxp.com/docs/en/data-sheet/MFRC522.pdf',
    section: '§ 4 Table 1 Quick reference data : VDDA, VDDD, VDD(TVDD) 2.5 à 3.6 V (« below 3 V reduce the performance ») ; IDDD 6.5 mA, IDD(TVDD) 60 mA (typ.), 100 mA (max.) ; § 11 Table 150, p. 74 : alimentations −0.5 à +4.0 V, « VI input voltage all input pins except pins MFIN and RX VSS(PVSS) - 0.5 VDD(PVDD) + 0.5 V » (entrées non tolérantes au 5 V) ; Table 153, p. 75 : VIH 0.7 VDD(PVDD), VIL 0.3 VDD(PVDD)'
  },
  nordicNrf24: {
    title: 'nRF24L01+ Single Chip 2.4GHz Transceiver Product Specification v1.0',
    publisher: 'Nordic Semiconductor',
    url: 'https://www.sparkfun.com/datasheets/Components/SMD/nRF24L01Pluss_Preliminary_Product_Specification_v1_0.pdf',
    section: '§ 4 Table 3 Operating conditions : VDD 1.9 à 3.6 V ; Key Features : « 11.3mA TX at 0dBm », « 13.5mA RX at 2Mbps » ; Key Features, p. 1 : « 5V tolerant inputs » ; § 3 Table 2, p. 12 : VDD −0.3 à 3.6 V, VI −0.3 à 5.25 V ; Table 3, p. 13 : « If the input signal >3.6V, the VDD of the nRF24L01+ must be between 2.7V and 3.3V »'
  },
  simcomSim800l: {
    title: 'SIM800L Hardware Design V1.00',
    publisher: 'SIMCom Wireless Solutions',
    url: 'https://www.makerhero.com/wp-content/uploads/2025/12/Datasheet_SIM800L.pdf',
    section: 'Table 42 Recommended operating conditions : VBAT 3.4 à 4.4 V ; Table 48 Current consumption : GPRS (1Rx, 4Tx) jusqu’à 453.57 mA ; § 4.1 : pointes de 2 A en émission ; § 6.1 Table 41, p. 58 : VBAT 4.5 V au plus, 2.0 A, broches numériques 8 mA ; § 6.6 Table 46 : niveau des E/S 2.8 V ; § 4.5 Table 9, p. 30 : UART VIH 2.5 à 2.8 V'
  },
  adafruitLevelShifter: {
    title: '4-channel I2C-safe Bi-directional Logic Level Converter - BSS138 (product 757)',
    publisher: 'Adafruit',
    url: 'https://www.adafruit.com/product/757',
    section: 'Description : « It works down to 1.8V on the low side, and up to 10V on the high side. »'
  },

  /* ---------- Circuits logiques ---------- */
  tiHc595: {
    title: 'SNx4HC595 8-Bit Shift Registers With 3-State Output Registers (SCLS041J, révision d’octobre 2021)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/sn74hc595.pdf',
    section: '§ 6.1 Absolute Maximum Ratings, p. 4 : « IO Continuous output current VO = 0 to VCC ±35 mA », « Continuous current through VCC or GND ±70 mA » ; § 6.3 Recommended Operating Conditions, p. 4 : VCC 2 à 6 V ; § 6.5 Electrical Characteristics, p. 5 (VCC = 4.5 V) : VOH 4.3 V typ. (3.84 V min.) à IOH = −6 mA, VOL 0.17 V typ. (0.33 V max.) à IOL = 6 mA ; § 8.1 : SRCLK et RCLK « positive-edge triggered » ; Table 8-1 : SRCLR bas vide le registre, OE haut met QA–QH en haute impédance ; § 6.1 : VCC 7 V, IIK ±20 mA ; § 6.3, p. 4 : VIH 1.5 / 3.15 / 4.2 V et VIL 0.5 / 1.35 / 1.8 V à VCC = 2 / 4.5 / 6 V ; § 6.6, p. 6 : fclock 25 MHz (−40 à 85 °C, 4.5 V)'
  },
  tiHc165: {
    title: 'SNx4HC165 8-Bit Parallel-Load Shift Registers (SCLS116H, révision de décembre 2015)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/sn74hc165.pdf',
    section: '§ 6.1 Absolute Maximum Ratings, p. 4 : « IO Continuous output current VO = 0 to VCC ±25 mA », « Continuous current through VCC or GND ±50 mA » ; § 6.3 : VCC 2 à 6 V ; § 6.5, p. 5 : VOH 4.3 V typ. à IOH = −4 mA, VOL 0.17 V typ. à IOL = 4 mA (VCC = 4.5 V) ; § 3 Description : « The functions of CLK and CLK INH are interchangeable », « While SH/LD is low, the parallel inputs to the register are enabled » ; § 6.3, p. 4 : VIH et VIL comme le 74HC595 (3.15 V et 1.35 V à 4.5 V)'
  },
  microchipMcp23017: {
    title: 'MCP23017/MCP23S17 16-Bit I/O Expander with Serial Interface (DS20001952D, révision D de juin 2022)',
    publisher: 'Microchip Technology',
    url: 'https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP23017-Data-Sheet-DS20001952.pdf',
    section: 'Absolute Maximum Ratings, p. 3 : « Maximum current out of VSS pin 150 mA », « Maximum current into VDD pin 125 mA », « Maximum output current sunk by any output pin 25 mA », « … sourced by any output pin 25 mA » ; table 1-1, p. 4 : VDD 1.8 à 5.5 V, VOL 0.6 V max. à 8 mA, VOH VDD − 0.7 V à −3 mA ; § 3.5.7 : tirage interne « 100 k » ; tables 3-1 et 3-3 : IODIRA 00h … OLATB 15h (IOCON.BANK = 0), IODIR « 1111 1111 » à la mise sous tension ; § 3.2.1 : pointeur d’adresse incrémenté, retour à 00h après le dernier registre ; p. 3 : VDD 5.5 V au plus, autres broches −0.6 à VDD + 0.6 V, IIK ±20 mA ; Table 1-1 D031/D041, p. 4 : VIH 0.8 VDD, VIL 0.2 VDD ; p. 1 : I2C 100 kHz, 400 kHz, 1.7 MHz'
  },
  tiPcf8574: {
    title: 'PCF8574 Remote 8-Bit I/O Expander for I2C Bus (SCPS068K, révision de septembre 2024)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/pcf8574.pdf',
    section: '§ 5.1 Absolute Maximum Ratings, p. 4 : « Continuous current through VCC or GND ±100 mA » ; § 5.3, p. 4 : VCC 2.5 à 6 V, IOL 25 mA ; § 5.5, p. 5 : IOH (P port, VO = GND) −30 à −300 µA, IOL 25 mA typ. à VO = 1 V ; § 7.3.2 : adresse « L H L L A2 A1 A0 » (0x20 à 0x27) ; § 5.1 : VCC 6.5 V, VI −0.5 à VCC + 0.5 V ; § 5.3 : VIH 0.7 VCC, VIL 0.3 VCC ; § 5.6 : fSCL 100 kHz'
  },
  nxpPcf8574: {
    title: 'PCF8574; PCF8574A Remote 8-bit I/O expander for I2C-bus with interrupt (Rev. 5, 27 mai 2013)',
    publisher: 'NXP Semiconductors',
    url: 'https://www.nxp.com/docs/en/data-sheet/PCF8574_PCF8574A.pdf',
    section: 'Table 7 Limiting values, p. 15 : « IO output current 25 mA », IDD et ISS 100 mA ; Features, p. 1 : « Total package sink capability of 80 mA » ; § 8.1 : « all the ports are HIGH with a weak 100 µA internal pull-up to VDD » ; tables 4 et 5 : PCF8574 20h à 27h, PCF8574A 38h à 3Fh ; Table 7, p. 15 : VDD 7 V, VI au plus VDD + 0.5 V ; p. 1 : « non-overvoltage tolerant I/O » ; Table 9, p. 16 : VIH 0.7 VDD, VIL 0.3 VDD'
  },
  nxpPca9685: {
    title: 'PCA9685 16-channel, 12-bit PWM Fm+ I2C-bus LED controller (Rev. 4, 16 avril 2015)',
    publisher: 'NXP Semiconductors',
    url: 'https://www.nxp.com/docs/en/data-sheet/PCA9685.pdf',
    section: '§ 1 : « totem pole with a 25 mA sink, 10 mA source capability at 5 V », « supply voltage range of 2.3 V to 5.5 V », « internal 25 MHz oscillator » ; table 13, p. 38 : IO(LEDn) 25 mA, ISS 400 mA ; table 4 : MODE1 00h, LED0_ON_L 06h, ALL_LED FAh à FDh, PRE_SCALE FEh ; § 7.3.5 : prescale = round(osc_clock ÷ (4096 × update_rate)) − 1, 0x1E par défaut (200 Hz), modifiable seulement quand SLEEP vaut 1 ; table 7 : bit 4 de LEDn_ON_H (toujours allumée) et de LEDn_OFF_H (toujours éteinte, prioritaire) ; p. 1 : « 5.5 V tolerant inputs » ; Table 13, p. 38 : VDD 6.0 V, VI/O −0.5 à 5.5 V ; Table 14 : VIH 0.7 VDD à 5.5 V, VIL 0.3 VDD'
  },

  /* ---------- Analogique ---------- */
  tiNe555: {
    title: 'xx555 Precision Timers (SLFS022K, révision de mars 2026)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/ne555.pdf',
    section: '§ 5.1 Absolute Maximum Ratings, p. 4 : VCC 18 V, « IO Output current ±225 mA » ; § 5.3 Recommended Operating Conditions, p. 4 : VCC 4.5 à 16 V (NE555), IO ±200 mA ; § 5.5 Electrical Characteristics, p. 5-6 : supply current, output low, no load, VCC = 5 V, 3 mA (typ.) ; VOH 3.3 V (typ.) à IOH = −100 mA sous 5 V ; VOL 0.1 V (typ.) à 5 mA ; DISCH switch on-state voltage 0.15 V (typ.) à 8 mA ; RESET voltage level 0.7 V (typ.) ; § 6.3.1-6.3.2 : tw = 1.1 × RA × C, f ≅ 1.44 / ((RA + 2RB) × C) ; § 5.1 : VI (CONT, RESET, THRES, TRIG) au plus VCC ; § 5.5, p. 5 (VCC = 5 V) : TRIG 1.1 / 1.67 / 2.2 V, THRES 2.4 / 3.3 / 4.2 V, RESET 0.3 / 0.7 / 1 V'
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
    section: 'p. 1, Absolute Maximum Ratings : VDSS 55 V, ID @ TC = 25 °C 47 A, ID @ TC = 100 °C 33 A, VGS ±16 V, TJ jusqu’à 175 °C ; Thermal Resistance : RθJA 62 °C/W ; p. 2, Electrical Characteristics : RDS(on) 0.022 Ω (VGS = 10 V), 0.025 Ω (5 V), 0.035 Ω (4 V), VGS(th) 1.0 à 2.0 V ; p. 1 : PD 110 W à TC = 25 °C, RθJC 1.4 °C/W'
  },
  infineonIrf9540n: {
    title: 'IRF9540NPbF HEXFET Power MOSFET, P-Channel',
    publisher: 'Infineon Technologies (International Rectifier)',
    url: 'https://www.infineon.com/assets/row/public/documents/24/49/infineon-irf9540npbf-datasheet-en.pdf',
    section: 'p. 1, Absolute Maximum Ratings : VDSS −100 V, ID @ TC = 25 °C −23 A, ID @ TC = 100 °C −16 A, VGS ±20 V, TJ jusqu’à 175 °C ; Thermal Resistance : RθJA 62 °C/W ; p. 2, Electrical Characteristics : RDS(on) 0.117 Ω au plus (VGS = −10 V, ID = −11 A), VGS(th) −2.0 à −4.0 V ; Rev. 2.1 : PD 140 W à TC = 25 °C, RθJC 1.1 °C/W, IDM −76 A'
  },
  bourns5800: {
    title: '5800 Series High Current Chokes (REV. 09/17)',
    publisher: 'Bourns',
    url: 'https://www.bourns.com/docs/Product-Datasheets/5800_series.pdf',
    section: 'Electrical Specifications, ligne 5800-103-RC : 10,000 µH ±10 %, DCR 24.0 Ω max., I sat. 0.11 A (« current to cause 10 % max. inductance drop »), I rated 0.076 A (« current to cause 35 °C max. temperature rise »)'
  },
  /* ---------- Afficheurs à pilote, écrans TFT, horloges et mémoires (relus dans les fiches en novembre 2026, sauf la carte SD) ---------- */
  maximMax7219: {
    title: 'MAX7219/MAX7221 Serially Interfaced, 8-Digit LED Display Drivers (19-4452, Rev 4, 7/03)',
    publisher: 'Analog Devices (Maxim Integrated)',
    url: 'https://www.analog.com/media/en/technical-documentation/data-sheets/MAX7219-MAX7221.pdf',
    mirror: 'https://cdn-shop.adafruit.com/datasheets/MAX7219.pdf',
    section: 'Absolute Maximum Ratings, p. 2 : V+ −0.3 à 6 V, « DIN, CLK, LOAD, CS … -0.3V to 6V », « All Other Pins … -0.3V to (V+ + 0.3V) », « DIG 0–DIG 7 Sink Current … 500mA », « SEG A–G, DP Source Current … 100mA » ; Electrical Characteristics, p. 2-3 : « Operating Supply Voltage V+ 4.0 5.5 », I+ 330 mA (typ., « All segments and decimal point on, ISEG_ = -40mA »), courant de segment −30 / −40 / −45 mA, VIH 3.5 V au moins, VIL 0.8 V au plus, tCP 100 ns (10 MHz) ; p. 7 Table 2 (registres), p. 9 Table 7 (intensité 1/32 à 31/32) ; p. 8 : « maximum recommended segment current is 40mA », RSET au moins 9.53 kΩ ; Table 11, p. 11 : RSET 9.69 à 12.2 kΩ pour 40 mA selon VLED'
  },
  titanTm1637: {
    title: 'TM1637 LED Drive Control Special Circuit (V2.4)',
    publisher: 'Titan Micro Electronics',
    url: 'https://akizukidenshi.com/goodsaffix/TM1637_V2.4_EN.PDF',
    section: 'Limit parameter, p. 9 : VDD −0.5 à +7.0 V, « Logic input voltage VI1 -0.5 ～ VDD + 0.5 », SEG 50 mA, GRID 200 mA ; Electrical character, p. 9-10 (VDD = 4.5 à 5.5 V) : VIH 0.7 VDD, VIL 0.3 VDD, IDDdyn 5 mA, « Maximum clock frequency Fmax … 500 KHz » ; p. 8 : « TM1637 power supply should be 5V », tirages de 10 kΩ sur CLK et DIO (schéma d’application) ; p. 3 : acquittement du 8e front descendant à la fin du 9e coup d’horloge, octets bit de poids faible d’abord ; p. 4-5 : commandes 0x40 (données), 0xC0 (adresse), 0x80 (affichage, luminosité 1/16 à 14/16)'
  },
  newhavenLcd2004: {
    title: 'NHD-0420H1Z-FL-GBW User’s Guide, LCM (Version 00, 2007)',
    publisher: 'Newhaven Display',
    url: 'https://newhavendisplay.com/content/specs/NHD-0420H1Z-FL-GBW.pdf',
    section: '§ 4, p. 5 : VDD − VSS 0 à 7.0 V, entrées de VSS à VDD ; § 9 Electrical characteristics, p. 6 : « Input voltage VDD 4.7 - 5.5 », IDD 2.5 mA (typ.), 3.0 mA (max.), rétroéclairage 15 mA (typ.) sous 5 V, VIH 2.2 V, VIL 0.6 V ; § 12, p. 12 : DDRAM des lignes à 00, 40, 14 et 54'
  },
  sitronixSt7735: {
    title: 'ST7735S 132RGB x 162dot 262K Color with Frame Memory Single-Chip TFT Controller/Driver (V1.1)',
    publisher: 'Sitronix Technology',
    url: 'https://cdn.sparkfun.com/assets/9/0/2/5/8/ST7735S_v1.1.pdf',
    section: 'Table 1 Absolute Operation Range, p. 28 : VDD −0.3 à 4.8 V, VDDI −0.3 à 4.6 V, « Logic Input Voltage Range VIN -0.3 ~ VDDI + 0.3 » ; Table 2 DC Characteristic, p. 29 : VDDI 1.65 à 3.7 V, VDD 2.5 à 4.8 V, VIH 0.7 VDDI, VIL 0.3 VDDI ; Table 3, p. 30 : IDD 0.9 mA (typ.), 2 mA (max.) ; Table 7, p. 36 : TSCYCW 66 ns ; § 10 Command : CASET 2Ah, RASET 2Bh, RAMWR 2Ch, MADCTL 36h (MY, MX, MV, RGB), COLMOD 3Ah'
  },
  ilitekIli9341: {
    title: 'ILI9341 a-Si TFT LCD Single Chip Driver 240RGBx320 Resolution and 262K color (V1.11)',
    publisher: 'ILI Technology',
    url: 'https://cdn-shop.adafruit.com/datasheets/ILI9341.pdf',
    section: '§ 18.1, p. 235 : VCI et VDDI −0.3 à +4.6 V, entrées logiques −0.3 V à VDDI + 0.3 V ; § 18.2.1, p. 236 : VDDI 1.65 à 3.3 V, VCI 2.5 à 3.3 V, VIH 0.7 VDDI, VIL 0.3 VDDI ; § 18.3.3, p. 242 : « Serial clock cycle (Write) 100 » ns ; § 8 Command : CASET 2Ah, PASET 2Bh, RAMWR 2Ch, MADCTL 36h, COLMOD 3Ah'
  },
  maximDs3231: {
    title: 'DS3231 Extremely Accurate I²C-Integrated RTC/TCXO/Crystal (19-5170, Rev 10)',
    publisher: 'Analog Devices (Maxim Integrated)',
    url: 'https://www.analog.com/media/en/technical-documentation/data-sheets/DS3231.pdf',
    mirror: 'https://cdn-shop.adafruit.com/product-files/3013/DS3231.pdf',
    section: 'Absolute Maximum Ratings, p. 2 : « Voltage Range on Any Pin Relative to Ground … -0.3V to +6.0V » ; Recommended Operating Conditions : VCC 2.3 à 5.5 V, SDA/SCL VIH 0.7 VCC, VIL 0.3 VCC ; Electrical Characteristics, p. 2 : ICCA 200 µA au plus (3.63 V), 300 µA (5.5 V), VOL 0.4 V à 3 mA ; p. 4 : fSCL 400 kHz ; p. 3 : ±2 ppm de 0 à 40 °C ; Figure 1, p. 11 (registres 00h à 12h, OSF, A2F, A1F en 0Fh) ; p. 15 : température par pas de 0.25 °C, conversion toutes les 64 s'
  },
  maximDs1307: {
    title: 'DS1307 64 x 8, Serial, I²C Real-Time Clock (REV 100208)',
    publisher: 'Analog Devices (Maxim Integrated)',
    url: 'https://www.analog.com/media/en/technical-documentation/data-sheets/DS1307.pdf',
    mirror: 'https://cdn-shop.adafruit.com/datasheets/DS1307.pdf',
    section: 'p. 2 : « Voltage Range on Any Pin Relative to Ground … -0.5V to +7.0V » ; Recommended DC Operating Conditions : VCC 4.5 à 5.5 V, VIH 2.2 V à VCC + 0.3 V, VIL 0.8 V au plus ; DC Electrical Characteristics : ICCA 1.5 mA au plus, VOL 0.4 V à 5 mA ; p. 3 : fSCL 100 kHz ; Table 2, p. 8 : bit CH, 56 octets de RAM sauvegardée de 08h à 3Fh'
  },
  microchipAt24c256: {
    title: '128/256-Kbit I²C Serial EEPROM, Automotive Grade, AT24C128C/AT24C256C (DS20006270D)',
    publisher: 'Microchip Technology',
    url: 'https://ww1.microchip.com/downloads/aemDocuments/documents/MPD/ProductDocuments/DataSheets/AT24C256C-I2C-Compatible-Two-Wire-Serial-EEPROM-256-Kbit-32768x8-DS20006270.pdf',
    mirror: 'https://onlinedocs.microchip.com/oxy/GUID-338FB7E8-CF68-4894-B7AB-B95E716C71D4-en-US-3/index.html',
    section: '§ 4.1 : VCC 6.25 V au plus, toute broche −1.0 à +7.0 V, 5.0 mA en sortie ; § 4.3 DC Characteristics : VCC 1.7 à 5.5 V (Grade 3), ICC2 (écriture) 3.0 mA au plus, VIH 0.7 VCC, VIL 0.3 VCC ; § 4.4 : fSCL 400 kHz, tWR 5 ms au plus ; § 7.2 : page de 64 octets, « the address counter will roll over to the beginning of the same page » ; § 7.3 : « The device will not respond with an ACK while the write cycle is ongoing. »'
  },
  sdaPhysical: {
    title: 'SD Specifications Part 1 Physical Layer Simplified Specification (Version 9.10)',
    publisher: 'SD Association',
    url: 'https://www.sdcard.org/downloads/pls/',
    section: 'Non relu : le document n’est servi qu’après acceptation d’une licence. Chiffres relevés de mémoire, sans citation : alimentation de la carte 2.7 à 3.6 V ; § 7 SPI Mode : CMD0, CMD8, ACMD41, CMD58, CMD17/18, CMD24/25, jetons de données ; § 6.6 : courant d’une carte en vitesse par défaut jusqu’à 100 mA'
  },
  /* ---------- Radio LoRa SX1278 (src/sim/lora.js) : chiffres relus dans la fiche (Rev. 4) ---------- */
  semtechSx1278: {
    title: 'SX1276/77/78/79 - 137 MHz to 1020 MHz Low Power Long Range Transceiver (Datasheet Rev. 4, March 2015)',
    publisher: 'Semtech',
    url: 'https://cdn-shop.adafruit.com/product-files/3179/sx1276_77_78_79.pdf',
    section: 'Table 3 Absolute Maximum Ratings, p. 13 : « VDDmr Supply Voltage -0.5 3.9 V » ; Table 4 Operating Range : « VDDop Supply voltage 1.8 3.7 V » ; Table 6 Power Consumption, p. 14 : IDDT « RFOP = +20 dBm, on PA_BOOST » 120 mA, IDDR 10.8 à 12.0 mA ; Table 10, p. 19 : IDDR_L 11.5 mA (bandes 2 et 3, BW 125 kHz), décalage de fréquence toléré ± 25 % de la bande ; Table 11, p. 22 : VIH 0.8 VDD, VIL 0.2 VDD, FSCK 10 MHz ; Table 1 : SX1278 « 137 - 525 MHz », SF 6 à 12, 7.8 à 500 kHz ; § 4.1.1.7 Time on air (préambule n + 4.25 symboles) ; Table 41 : RegVersion 0x12, RegSyncWord 0x12, RegFrf 0x6C8000, RegPaConfig 0x4F, RegOcp 0x2B, RegLna 0x20 ; § 6.4, p. 110-114 (valeurs de remise à zéro des champs) : RegFifoTxBaseAddr 0x80, RegModemConfig1 0x72, RegModemConfig2 0x70, RegInvertIQ 0x27'
  },
  /* ---------- Capteur de courant ACS712, GPS NEO-6M, radio HC-12, RS-485 MAX485 ---------- */
  // Chiffres relus dans les fiches (novembre 2026). Les plages d'alimentation des modules (régulateur ajouté par le module)
  // ne figurent pas dans la fiche de la puce : elles restent marquées « non vérifié ».
  allegroAcs712: {
    title: 'ACS712 Fully Integrated, Hall-Effect-Based Linear Current Sensor IC with 2.1 kVRMS Isolation and a Low-Resistance Current Conductor (ACS712-DS, Rev. 22)',
    publisher: 'Allegro MicroSystems',
    url: 'https://www.allegromicro.com/-/media/files/datasheets/acs712-datasheet.pdf',
    section: 'Absolute Maximum Ratings : « Overcurrent Transient Tolerance … 1 pulse, 100 ms … 100 A » ; Common Operating Characteristics : « Supply Voltage VCC 4.5 5.0 5.5 V », « Supply Current … 10 13 mA », « Primary Conductor Resistance … 1.2 mΩ », « Frequency Bandwidth … 80 kHz », Zero Current Output Voltage VCC × 0.5 ; x05B, x20A, x30A Performance Characteristics : Optimized Accuracy Range ±5, ±20, ±30 A, Sensitivity 185, 100, 66 mV/A, « Noise VNOISE(PP) » 21, 11, 7 mV'
  },
  neo6mUblox: {
    title: 'NEO-6 u-blox 6 GPS Modules Data Sheet (GPS.G6-HW-09005-E)',
    publisher: 'u-blox',
    url: 'https://content.u-blox.com/sites/default/files/products/documents/NEO-6_DataSheet_%28GPS.G6-HW-09005%29.pdf',
    section: 'Table 9, p. 14 : VCC −0.5 à 3.6 V, « Input pin voltage Vin All -0.5 3.6 V » (non tolérant au 5 V), 10 mA par broche ; Table 10, p. 15 : VCC 2.7 à 3.6 V (NEO-6M), VIL 0.2 VCC, VIH 0.7 VCC ; Table 11, p. 15 : poursuite 39 mA, acquisition 47 mA, crête 67 mA ; Table 2, p. 6 : démarrage à froid 27 s ; Table 15, p. 22 : « 9600 Baud, 8 bits, no parity bit, 1 stop bit », trames GGA, GLL, GSA, GSV, RMC, VTG, TXT, 1 Hz ; Table 4, p. 9 : NMEA 0183 version 2.3. Module GY-NEO6MV2 (régulateur 3,3 V, VCC 3 à 5 V) : pas de document du fabricant, non vérifié'
  },
  hc12Manual: {
    title: 'HC-12 Wireless RF UART Communication Module V2.4 User Manual (2016-12-02)',
    publisher: 'HC Information Technology (Guangzhou HC)',
    url: 'https://statics3.seeedstudio.com/assets/file/bazaar/product/HC-12_english_datasheets.pdf',
    section: 'p. 1 : « Power supply voltage（DC 3.2V ~5.5V） », « the maximum operating current is 100mA (full power transmit state) » ; p. 2 : alimentation de 200 mA au moins, RXD et TXD en logique 3,3 V (1 kΩ en série), SET tirée haut (10 kΩ), active au niveau bas ; p. 4-5 : ≈ 16 mA au repos (FU3) ; p. 5 : SET bas à la mise sous tension, commandes AT à 9600 bauds ; p. 6-8 : AT, AT+Bxxxx, AT+Cxxx (001 à 127), AT+FUx, AT+Px, AT+RX, AT+V, AT+SLEEP, AT+DEFAULT ; canal 1 à 433,4 MHz, 400 kHz par canal ; p. 4 : FU3, 5 000 à 236 000 bit/s. Pas de valeurs maximales absolues'
  },
  maximMax485: {
    title: 'MAX481/MAX483/MAX485/MAX487–MAX491/MAX1487 Low-Power, Slew-Rate-Limited RS-485/RS-422 Transceivers (19-0122, Rev 5)',
    publisher: 'Analog Devices (Maxim Integrated)',
    url: 'https://www.analog.com/media/en/technical-documentation/data-sheets/MAX1487-MAX491.pdf',
    mirror: 'https://static.rapidonline.com/pdf/82-0302e.pdf',
    section: 'Absolute Maximum Ratings, p. 2 : VCC 12 V, entrées (/RE, DE, DI) et RO −0.5 V à VCC + 0.5 V, A et B −8 à +12.5 V ; DC Electrical Characteristics (« VCC = 5V ±5% », soit 4.75 à 5.25 V) : VIH 2.0 V, VIL 0.8 V, ICC 300 µA (typ.) à 900 µA (max., DE = VCC) ; p. 3 : 2.5 Mbit/s ; p. 7 : « driver outputs … enabled by bringing DE high », « RO is enabled when /RE is low » ; p. 1 et 8 : 12 kΩ = une charge unitaire, 32 émetteurs-récepteurs. Le module (LED, ≈ 1 mA) : non vérifié'
  },
  /* ---------- Capteurs I2C : VL53L0X, MAX30102, TCS34725, CCS811, BME680 (puces relues dans leurs fiches ; modules non vérifiés) ---------- */
  // Plages d'alimentation des modules (avec leur régulateur) : non publiées par le fabricant de la puce. Registres : vérifiés dans le code des bibliothèques (Adafruit_VL53L0X et son
  // API d'ST, VL53L0X de Pololu, SparkFun MAX3010x, Adafruit_TCS34725, Adafruit_CCS811, bme68x de Bosch).
  stVl53l0x: {
    title: 'VL53L0X World’s smallest Time-of-Flight ranging and gesture detection sensor (DocID029104 Rev 2)',
    publisher: 'STMicroelectronics',
    url: 'https://www.st.com/resource/en/datasheet/vl53l0x.pdf',
    mirror: 'https://www.pololu.com/file/0J1187/VL53L0X.pdf',
    section: 'Table 6, p. 22 : AVDD −0.5 à 3.6 V, SCL, SDA, XSHUT, GPIO1 −0.5 à 3.6 V ; Table 7 : AVDD 2.6 à 3.5 V, « The I/Os are internally failsafe with no diode connecting them to AVDD » ; Table 9, p. 23 : 19 mA en mesure, crêtes de 40 mA ; Table 10, p. 24 : VIH 1.12 V, VIL 0.6 V ; p. 20 : I2C 400 kHz ; p. 1 : jusqu’à 2 m, VCSEL 940 nm ; Figure 14, p. 18 : adresse 0x52 (8 bits), soit 0x29 ; Table 4 : 0xEE en 0xC0. Module GY-VL53L0XV2 (régulateur 2,8 V, VIN jusqu’à 5,5 V) : non vérifié'
  },
  maximMax30102: {
    title: 'MAX30102 High-Sensitivity Pulse Oximeter and Heart-Rate Sensor for Wearable Health (19-7740, Rev 0)',
    publisher: 'Analog Devices (Maxim Integrated)',
    url: 'https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf',
    mirror: 'https://datasheet.chipsmall.com/MAX30102EFD/174927.pdf',
    section: 'p. 2 : VDD −0.3 à 2.2 V, VLED+ et autres broches −0.3 à 6.0 V, ±20 mA ; Electrical Characteristics : VDD 1.7 à 2.0 V, VLED+ 3.1 à 5.25 V, IDD 600 µA (typ.), 1200 µA (max.), ADC 18 bits ; p. 4 : VIH 0.7 VDD, VIL 0.3 VDD, fSCL 400 kHz, adresse AE/AF (0x57) ; p. 9 : LED de 0 à 50 mA ; p. 14 : FIFO de 32 ; p. 11 : 0x15 en 0xFF. Module (régulateurs 1,8 V et 3,3 V, VIN 3 à 5,5 V) : non vérifié'
  },
  amsTcs34725: {
    title: 'TCS3472 Color Light-to-Digital Converter with IR Filter (TAOS135, août 2012)',
    publisher: 'ams-OSRAM',
    url: 'https://cdn-shop.adafruit.com/datasheets/TCS34725.pdf',
    section: 'p. 3 : VDD 3.8 V au plus, entrées et sorties −0.5 à 3.8 V ; VDD 2.7 à 3.6 V (TCS34725), adresse 0x29 ; p. 4 : IDD 235 µA (typ.), 330 µA (max.), VIH 0.7 VDD, VIL 0.3 VDD ; p. 5 : fSCL 400 kHz ; p. 8 : intégration 2.4 ms × (256 − ATIME) ; p. 16 : (256 − ATIME) × 1024 comptes, 65 535 au plus ; p. 18 : gains 1, 4, 16, 60, 0x44 en 0x12. Module (régulateur 3,3 V, VIN 3 à 5 V, LED ≈ 20 mA) : non vérifié'
  },
  sciosenseCcs811: {
    title: 'CCS811 Ultra-Low Power Digital Gas Sensor for Monitoring Indoor Air Quality (ams, v1-00, 2016-Dec-23)',
    publisher: 'ScioSense (ams)',
    url: 'https://cdn.sparkfun.com/assets/learn_tutorials/1/4/3/CCS811_Datasheet-DS000459.pdf',
    section: 'Figure 5, p. 5 : VDD 1.8 à 3.6 V (maxima absolus), 30 mA au plus en mode 1 ; Figure 6, p. 6 : VDD 1.8 à 3.3 V, 26 mA en mesure, VIH VDD − 0.6 V, VIL 0.6 V ; Figure 7, p. 7 : I2C 400 kHz au plus ; p. 9 : eCO₂ 400 à 8192 ppm, COVT 0 à 1187 ppb ; p. 8 et 17 : modes 1 s, 10 s, 60 s, 250 ms ; p. 15 : 0x81 en 0x20 ; p. 4 : adresse 0x5A (ADDR bas) ou 0x5B, nWAKE actif au niveau bas'
  },
  boschBme680: {
    title: 'BME680 Datasheet (BST-BME680-DS001-09, revision 1.9)',
    publisher: 'Bosch Sensortec',
    url: 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme680-ds001.pdf',
    section: 'Table 1, p. 7 : VDD 1.71 à 3.6 V, VDDIO 1.2 à 3.6 V ; Table 2, p. 8 : chauffe du capteur de gaz 12 mA (typ.), crête 17 mA ; Table 9, p. 13 : VDD et VDDIO −0.3 à 4.25 V, broches d’interface −0.3 V à VDDIO + 0.3 V ; p. 41 : VIL 20 % VDDIO, VIH 80 % VDDIO ; p. 3 : −40 à 85 °C, 300 à 1100 hPa, I2C 3.4 MHz ; p. 28 : 0x61 en 0xD0 ; p. 38 : adresse 0x76 (SDO à la masse) ou 0x77. Module GY-BME680 (régulateur 3,3 V, VCC 3 à 5 V) : non vérifié'
  },
  lp2985: {
    title: 'LP2985 150mA, Low-Noise, Low-Dropout Regulator With Shutdown (SLVS522S)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/lp2985.pdf',
    section: '§ 1 Features : « Output current: Up to 150mA » ; § 5.3 Recommended Operating Conditions : « IOUT Output current 0 150 mA » ; § 5.1 : VIN 16 V au plus (régulateur 3,3 V de l’Uno et du Mega)'
  },
  avr182: {
    title: 'AVR182: Zero Cross Detector (Atmel doc 2508)',
    publisher: 'Microchip Technology',
    url: 'https://onlinedocs.microchip.com/oxy/GUID-6AC9F79C-CD9D-4DEE-B7A9-57FB68C0D274-en-US-3/GUID-C94F9D0C-A2A7-461E-B1D6-48B2AD6585B2.html',
    section: '§ 1.1 Hardware : « It is not recommended that the clamping diodes are conducting more than maximum 1mA », « Any voltage higher than VCC + 0.5V will be forced down to VCC + 0.5V »'
  },
  esp32DevKitC: {
    title: 'ESP32-DevKitC V4 schematic (ESP32_DevKitc_V4, 25 février 2020)',
    publisher: 'Espressif Systems',
    url: 'https://dl.espressif.com/dl/schematics/esp32_devkitc_v4_sch.pdf',
    section: 'Régulateur 3,3 V U2 « AMS1117-3.3 », pont USB-série CP2102N'
  },
  arduinoEsp32Adc: {
    title: 'Arduino-ESP32 ADC API — analogSetAttenuation',
    publisher: 'Espressif Systems',
    url: 'https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html',
    section: 'ESP32 : « ADC_11db » 150 à 3100 mV (atténuation par défaut d’analogRead) ; ESP32-S3 : 0 à 3100 mV ; ESP32-C3 : 0 à 2500 mV'
  },
  espIdfAdc: {
    title: 'ESP-IDF Programming Guide — ADC Oneshot Mode Driver (ESP32, v6.1.1) et ADC (v4.4)',
    publisher: 'Espressif Systems',
    url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/adc/adc_oneshot.html',
    section: 'Hardware Limitations : « ADC2 is also used by Wi-Fi » ; ESP_ERR_TIMEOUT « Timeout, the ADC result is invalid. » ; v4.4, ADC Limitations : « Since the ADC2 module is also used by the Wi-Fi, only one of them could get the preemption when using together, which means the adc2_get_raw() may get blocked until Wi-Fi stops »'
  },
  nxpUm10204: {
    title: 'UM10204 I2C-bus specification and user manual (Rev. 7.0, 1 October 2021)',
    publisher: 'NXP Semiconductors',
    url: 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf',
    section: '§ 6.1 Table 10, p. 43 : VIL 0.3 VDD, VIH 0.7 VDD, « VOL1 … at 3 mA sink current; VDD > 2 V 0 0.4 », IOL 3 mA (Standard et Fast mode), « Ci capacitance for each I/O pin … 10 pF » ; Table 11, p. 44 : fSCL 100 / 400 kHz, « tr rise time of both SDA and SCL signals » 1000 ns (Sm), 300 ns (Fm), « Cb capacitive load for each bus line » 400 pF ; § 7.1 Pull-up resistor sizing, p. 50 : Rp(max) = tr ÷ (0.8473 × Cb) (équation 1, « T = t2 - t1 = 0.8473 × RC »), Rp(min) = (VDD − VOL(max)) ÷ IOL (équation 2, « minimum sink current of 3 mA »)'
  },
  nasaEee002: {
    title: 'EEE-INST-002 Instructions for EEE Parts Selection, Screening, Qualification, and Derating (NASA/TP-2003-212242, édition d’avril 2008, Addendum 1)',
    publisher: 'NASA Goddard Space Flight Center',
    url: 'https://nepp.nasa.gov/DocUploads/FFB52B88-36AE-4378-A05B2C084B5EE2CC/EEE-INST-002_add1.pdf',
    section: '§ 6.5 : déclassement selon la Table 4 de chaque section ; R2 Table 4 (résistances), p. 24 : puissance 0.6 (film, carbone) ; tension « 80% of the specified maximum voltage rating » ; C1 Table 4 (céramiques), p. 23 : tension 0.60 ; S1 Table 4 (diodes), p. 12 : « Forward Current 0.50 », « PIV 0.70 », Zener « Power 0.50 » ; S1 Table 4 (transistors), p. 13 : bipolaires « Power 0.60 », « Current 0.75 », « Voltage 0.75 » ; MOSFET puissance 0.60, courant 0.75, « Source to Drain Voltage 0.75 », « Gate to Source Voltage 0.60 » ; M3 Table 4 (circuits intégrés), p. 15 : « Maximum Output Current 0.8 » ; S2 Table 4 (interrupteurs), p. 18 : 75 % du courant résistif'
  },
  kingbrightWp7113gd: {
    title: 'WP7113GD T-1 3/4 (5mm) Solid State Lamp (Spec No DSAE9335, Rev V.12B)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113GD.pdf',
    section: 'Absolute Maximum Ratings at TA=25°C, p. 2 : IF 25 mA, IFM 140 mA, PD 62.5 mW, VR 5 V ; VF 2.0 V (typ.), 2.4 V (max.) à 10 mA (LED verte 5 mm)'
  },
  kingbrightWp7113yd: {
    title: 'WP7113YD T-1 3/4 (5mm) Solid State Lamp (Spec No DSAF2448, Rev V.11B)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113YD.pdf',
    section: 'Absolute Maximum Ratings at TA=25°C, p. 2 : IF 30 mA, IFP 140 mA, PD 75 mW, VR 5 V ; VF 1.95 V (typ.), 2.4 V (max.) à 10 mA (LED jaune 5 mm)'
  },
  kingbrightWp7113qwcd: {
    title: 'WP7113QWC/D T-1 3/4 (5mm) Solid State Lamp (Spec No DSAI6407, Rev V.6B)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113QWC-D.pdf',
    section: 'Absolute Maximum Ratings at TA=25°C, p. 2 : IF 30 mA, IFP 150 mA, PD 120 mW, VR 5 V ; VF 3.3 V (typ.), 4.0 V (max.) à 20 mA (LED blanche 5 mm)'
  },
  kingbrightWp154: {
    title: 'WP154A4SUREQBFZGW T-1 3/4 (5mm) Full Color LED Lamp (DSAJ8688, Rev V.12A)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP154A4SUREQBFZGW.pdf',
    section: 'p. 1 : cathode commune (broche 2) ; Absolute Maximum Ratings, p. 2 : rouge IF 30 mA, PD 75 mW ; bleu IF 30 mA, PD 120 mW ; vert IF 25 mA, PD 102.5 mW ; VR 5 V pour chaque couleur'
  },
  kingbrightSc56: {
    title: 'SC56-11EWA 14.2mm (0.56INCH) Single Digit Numeric Display (DSAP6671, Rev V.1A)',
    publisher: 'Kingbright',
    url: 'https://www.kingbrightusa.com/images/catalog/SPEC/SC56-11EWA.pdf',
    section: 'Absolute Maximum Ratings, p. 2 : IF 30 mA, IFM 160 mA, PD 75 mW, VR 5 V ; VF 1.9 V (typ.), 2.3 V (max.) à 10 mA (par segment)'
  },
  omronB3f: {
    title: 'Tactile Switch B3F (Cat. No. A070-E1-08)',
    publisher: 'Omron',
    url: 'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf',
    section: 'Ratings/Characteristics, p. 3 : « 1 to 50 mA, 3 to 24 VDC » (charge résistive)'
  },
  busboardBb830: {
    title: 'BB830 Product Datasheet (BPS-DOC-(BB830)-Rev 7)',
    publisher: 'BusBoard Prototype Systems',
    url: 'https://busboardcom.busboard.us/documents/datasheets/BPS-DAT-(BB830)-Datasheet.pdf',
    section: 'p. 1 : « Rated at 36 Volts, 2 Amps. », contacts en bronze phosphoreux, fils de 21 à 26 AWG'
  },
  tiUln2003a: {
    title: 'ULN2002A, ULN2003A, ULN2003AI … High-Voltage, High-Current Darlington Transistor Arrays (SLRS027T)',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/uln2003a.pdf',
    section: '§ 5.1, p. 4 : VCE 50 V, VI 30 V, « Peak collector current » 500 mA par sortie, courant total d’émetteur −2.5 A ; § 5.6, p. 5 : VI(on) 2.4 V au plus à IC = 200 mA, VCE(sat) 1.1 V à 100 mA (carte du moteur 28BYJ-48)'
  },
  adafruitVibro1201: {
    title: 'Vibrating Mini Motor Disc (product 1201)',
    publisher: 'Adafruit',
    url: 'https://www.adafruit.com/product/1201',
    section: 'Technical Details : « rated voltage is 2.5 to 3.8V », « 2V current draw: 40mA », « 5V current draw: 100mA » (pas de fiche du fabricant du moteur)'
  },
  protosuppliesKy008: {
    title: 'Laser Emitter Module (KY-008)',
    publisher: 'ProtoSupplies',
    url: 'https://protosupplies.com/product/laser-emitter-module/',
    section: 'Vcc 5 V, « will operate down to 3.3V at reduced intensity », « draws about 30mA », 650 nm (pas de fiche du fabricant)'
  },
  allegroA3144: {
    title: 'A3141, A3142, A3143, and A3144 Sensitive Hall-Effect Switches (27621.6A)',
    publisher: 'Allegro MicroSystems',
    url: 'https://cdn.shopify.com/s/files/1/1560/1473/files/a3144eul.pdf',
    section: 'p. 1 : VCC 28 V au plus, −35 V en inverse, IOUT 25 mA, « an open-collector output to sink up to 25 mA » ; p. 2 : VCC 4.5 à 24 V, VOUT(SAT) 400 mV au plus à 20 mA, ICC 9 mA au plus'
  },
  tontekTtp223: {
    title: 'TTP223E-BA6 1 Key Touch Pad Detector IC (V1.0)',
    publisher: 'Tontek Design Technology',
    url: 'https://hestore.hu/prod_getfile.php?id=10464',
    section: 'p. 3 : VDD 2.0 à 5.5 V, VDD au plus VSS + 5.5 V, entrées au plus VDD + 0.3 V ; IOL 8 mA à VOL = 0.6 V, IOH −4 mA (VDD = 3 V) ; p. 1 : « Q pin is CMOS output »'
  },
  aviaHx711: {
    title: 'HX711 24-Bit Analog-to-Digital Converter (ADC) for Weigh Scales (V2.0)',
    publisher: 'Avia Semiconductor',
    url: 'https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/73/HX711.pdf',
    section: 'Table 1, p. 2 : DVDD et AVDD 2.6 à 5.5 V ; p. 4 : « Digital power supply (DVDD) should be the same power supply as the MCU power supply » ; p. 5 : PD_SCK haut 0.2 à 50 µs, au-delà de 60 µs la puce s’éteint. Pas de VIH ni de maxima absolus dans ce document'
  },
  bournsPec11r: {
    title: 'PEC11R - 12 mm Incremental Encoder (REV. 04/26)',
    publisher: 'Bourns',
    url: 'https://www.bourns.com/docs/Product-Datasheets/pec11r.pdf',
    section: 'Electrical Characteristics, p. 1 : « Contact Rating … 10 mA @ 5 VDC », bouton 10 mA à 5 VDC, rebonds 2 ms au plus (codeur du module KY-040)'
  },
  parallaxJoystick: {
    title: '2-Axis Joystick (#27800, v1.2)',
    publisher: 'Parallax',
    url: 'https://static.chipdip.ru/lib/053/DOC043053567.pdf',
    section: 'Key Specifications, p. 1 : « Dual 10 kΩ potentiometers with common ground », « Power capability: 0.01W; 10 VDC maximum working voltage »'
  },
  parallaxKeypad: {
    title: '4x4 Matrix Membrane Keypad (#27899, v1.2)',
    publisher: 'Parallax',
    url: 'https://www.ece.nus.edu.sg/ee3032/html/Common/4x4MembraneKeypad.pdf',
    section: 'Key Specifications, p. 1 : « Maximum Rating: 24 VDC, 30 mA »'
  },
  bailinSw520d: {
    title: 'SW-520D Tilt Switch',
    publisher: 'Bailin',
    url: 'https://www.rcscomponents.kiev.ua/datasheets/datasheet_SW-520D.pdf',
    section: 'p. 1 : « Contact Rating:12V », résistance de contact < 10 Ω ; variante XKB SW-520DS-AB12G : « < 12V », « < 20mA »'
  },
  onsemiBss138: {
    title: 'BSS138 N-Channel Logic Level Enhancement Mode Field Effect Transistor (BSS138/D, Rev. 7)',
    publisher: 'onsemi',
    url: 'https://www.onsemi.com/download/data-sheet/pdf/bss138-d.pdf',
    section: 'p. 2 : VDSS 50 V, VGSS ±20 V, ID 0.22 A, PD 0.36 W, VGS(th) 0.8 / 1.3 / 1.5 V, RDS(on) 3.5 Ω au plus à 10 V (adaptateur de niveau)'
  },
  rohmBh1750: {
    title: 'BH1750FVI Technical Note (Rev.D, No.11046EDT01)',
    publisher: 'ROHM Semiconductor',
    url: 'https://wemos-docs.readthedocs.io/en/latest/_static/files/bh1750fvi-tr.pdf',
    section: 'Absolute Maximum Ratings, p. 1 : alimentation 4.5 V au plus, SDA 7 mA ; Operating Conditions : VCC 2.4 à 3.6 V, DVI 1.65 V à VCC ; p. 2 : ICC 120 µA (typ.), 190 µA (max.), VIH 0.7 DVI, VIL 0.3 DVI, fSCL 400 kHz. Module GY-302 : régulateur 3,3 V, non vérifié'
  },
  solomonSsd1306: {
    title: 'SSD1306 128 x 64 Dot Matrix OLED/PLED Segment/Common Driver with Controller (Advance Information Rev 1.1)',
    publisher: 'Solomon Systech',
    url: 'https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf',
    section: 'Table 11-1, p. 47 : VDD −0.3 à 4 V, entrées au plus VDD + 0.3 V ; Table 12-1, p. 48 : VDD 1.65 à 3.3 V, VIH 0.8 VDD, VIL 0.2 VDD ; Table 13-6, p. 54 : cycle I2C 2.5 µs (400 kHz)'
  },
  /* ---------- Réseau informatique (src/net : NET de limits.js, NET_SRC de issues.js), relu en novembre 2026 ---------- */
  // Les normes de câblage (ANSI/TIA-568, ISO/IEC 11801) et IEEE 802.3 sont payantes : leurs chiffres sont lus dans les
  // guides des fabricants qui les citent (Belden, Fluke Networks, Cisco) et dans les documents publics du groupe 802.3.
  beldenCopperDesignGuide: {
    title: 'Copper Structured Cabling Design Guide, Issue 10',
    publisher: 'Belden',
    url: 'https://www.belden.com/-/media/project/belden/catalog-assets/assets/2025/10/31/11/57/174662.pdf?rev=1fd9a57224d64e03940d7c96afec4e4b',
    section: 'Chiffres de la norme TIA-568-C lus dans le guide du fabricant (norme payante, non lue directement) : Figure 10, p. 13 : lien permanent de 90 m, canal de 100 m, 10 m de cordons au plus ; Table 1, p. 11 : Cat 5e 1000 Mb/s sur 100 m, Cat 6 en 10 Gb/s sur 37 à 55 m, Cat 6A en 10 Gb/s sur 100 m ; Table 2, p. 22 : brochages T568A et T568B ; bandes passantes : Cat 6A 500 MHz (p. 64), Cat 6 250 MHz (p. 65), Cat 5e 100 MHz (p. 67)'
  },
  flukeT568AvsB: {
    title: 'Differences between wiring codes T568A vs T568B',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/application-or-standards-articles-copper/differences-between-wiring-codes-t568a-vs',
    section: 'Les deux codes ne diffèrent que par l’échange des paires orange et verte ; « Both are allowed under the ANSI/TIA-568.2-D wiring standards. » Un câble droit a le même code aux deux bouts.'
  },
  foaUtpColorCodes: {
    title: 'Premises Cabling: UTP Termination and Color Codes',
    publisher: 'The Fiber Optic Association',
    url: 'https://www.thefoa.org/tech/ref/premises/term.html',
    section: 'Numérotation des paires : 1 bleue, 2 orange, 3 verte, 4 marron ; un câble serti T568A d’un côté et T568B de l’autre croise les paires 2 et 3'
  },
  flukeFrequencySteps: {
    title: 'Frequency steps on the DTX CableAnalyzer',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/dtx-cableanalyzer/frequency-steps-dtx-cableanalyzer',
    section: 'Fréquence de mesure la plus haute de chaque catégorie (classe ISO) : Cat 5e 100 MHz (classe D), Cat 6 250 MHz (classe E), Cat 6A 500 MHz (classe EA)'
  },
  flukeBeyond100m: {
    title: 'Extending and Testing Cable Runs Beyond 100 Meters',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/blog/cabling-chronicles/extending-and-testing-cable-runs-beyond-100-meters',
    section: 'Le canal de 100 m des normes : « 4-connector channel that includes a 90m permanent link and 5m of patch cable at both ends »'
  },
  fluke10gbaseT: {
    title: '10GBASE-T Field Testing Requirements',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/applicationstandards-articles-copper/10gbase-t-field-testing-requirements',
    section: 'TSB-155 (lu par Fluke) : 10GBASE-T sur Cat 6 assuré jusqu’à 37 m, de 37 à 55 m selon la diaphonie exogène (à mesurer), au-delà de 55 m il faut l’atténuer ; Cat 6A pour 100 m'
  },
  flukeWireMapBlog: {
    title: 'Wire Map Testing: It’s Not All About Color',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/blog/cabling-chronicles/wire-map-testing-it-s-not-all-about-color',
    section: 'Définitions des défauts de la carte de câblage : conducteur ouvert, court-circuit, paire inversée, paires croisées, paire séparée ; une paire séparée passe le test de continuité broche à broche mais échoue à la mesure de diaphonie (NEXT)'
  },
  flukeMicroScannerFaults: {
    title: 'Diagnosing wiremap faults with the MicroScanner2',
    publisher: 'Fluke Networks',
    url: 'https://www.flukenetworks.com/knowledge-base/microscanner2/diagnosing-wiremap-faults-microscanner2',
    section: 'Paires croisées : mélange des codes 568A et 568B, les paires 1-2 et 3-6 sont croisées'
  },
  ieee8023_2022: {
    title: 'IEEE Std 802.3-2022, IEEE Standard for Ethernet',
    publisher: 'IEEE',
    url: 'https://standards.ieee.org/ieee/802.3/10422/',
    section: 'Norme payante, texte non lu directement : référence de la couche physique Ethernet (10BASE-T, 100BASE-TX, 1000BASE-T, 10GBASE-T) ; les chiffres utilisés viennent des documents publics du groupe 802.3 et des guides cités ici'
  },
  ieee80211_2024: {
    title: 'IEEE Std 802.11-2024, Wireless LAN Medium Access Control (MAC) and Physical Layer (PHY) Specifications',
    publisher: 'IEEE',
    url: 'https://standards.ieee.org/ieee/802.11/10548/',
    section: 'Norme payante, texte non lu directement : référence du Wi-Fi (MAC et couche physique), qui remplace 802.11-2020 ; l’association à un point d’accès et la sécurité RSNA y sont définies'
  },
  ieeeMaint1115: {
    title: 'IEEE 802.3 Maintenance Request 1115',
    publisher: 'IEEE 802.3 Working Group',
    url: 'https://www.ieee802.org/3/maint/requests/maint_1115.pdf',
    section: 'Clause 40.4.4 : Auto MDI/MDI-X facultatif en 1000BASE-T ; Table 40-12 : fonction de croisement des quatre paires ; 14.5.2 : croisement en 10BASE-T'
  },
  ieeeMaint1183: {
    title: 'IEEE 802.3 Maintenance Request 1183',
    publisher: 'IEEE 802.3 Working Group',
    url: 'https://www.ieee802.org/3/maint/requests/maint_1183.pdf',
    section: 'Clause 55.4.4 : l’Auto-MDIX est obligatoire en 10GBASE-T'
  },
  unhIolFeTestPlans: {
    title: 'Fast Ethernet Test Plans',
    publisher: 'University of New Hampshire InterOperability Laboratory',
    url: 'https://www.iol.unh.edu/testing/ethernet/fe/test-plans',
    section: 'Plans d’essai par clause d’IEEE 802.3 : clause 14 (10BASE-T), clause 25 (100BASE-TX)'
  },
  cisco10100Cables: {
    title: 'Ethernet 10BaseT, 100BaseTX and Fast Ethernet Cabling',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/routers/10000-series-routers/46792-ethbase.html',
    section: '100 m au plus en 10BaseT et 100BaseTX ; émission sur les broches 1 et 2, réception sur 3 et 6, broches 4, 5, 7 et 8 inutilisées ; Cat 3, 4 ou 5 en 10BaseT, Cat 5 en 100BaseTX'
  },
  ciscoCat2960Cabling: {
    title: 'Catalyst 2960 Switch Hardware Installation Guide, Cable and Connectors',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst2960/hardware/installation/guide/2960_hg/higcable.pdf',
    section: '1000BASE-T : quatre paires en Cat 5 ; Auto-MDIX activé par défaut sur les ports du switch'
  },
  ciscoStp: {
    title: 'Spanning Tree Protocol',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/tech/lan-switching/spanning-tree-protocol/index.html',
    section: 'Le protocole Spanning Tree (IEEE 802.1D) bloque les chemins redondants entre switchs pour éviter les boucles de niveau 2'
  },
  ciscoL2Loops: {
    title: 'Troubleshoot Layer 2 Loops (Catalyst 9200)',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/support/docs/switches/catalyst-9200-series-switches/221191-troubleshoot-layer-2-loops.html',
    section: 'Une boucle de niveau 2 sans Spanning Tree fait tourner les trames de diffusion sans fin (tempête de diffusion) : liens saturés, tables MAC instables'
  },
  eaOverview8023bt: {
    title: 'Overview of 802.3bt — Power over Ethernet standard (white paper v2.1)',
    publisher: 'Ethernet Alliance',
    url: 'https://ethernetalliance.org/wp-content/uploads/2019/12/WP_EA_Overview8023bt_V2p1_FINAL.pdf',
    section: 'Puissance réservée par le PSE pour les classes 1 à 8 : 4, 7, 15,4, 30, 45, 60, 75 et 90 W ; puissance garantie au PD : 3,84, 6,49, 13 (12,95), 25,5, 40, 51, 62 et 71,3 W ; la classe 0 vaut la classe 3 ; type 1 jusqu’à la classe 3, type 2 la classe 4, type 3 jusqu’à la classe 6, type 4 les classes 7 et 8 ; un PSE de la clause 145 réserve 14,0 W en classe 3'
  },
  tiTps23755Class: {
    title: 'TPS23755 High Efficiency PoE PD Interface with No-Opto Flyback DC-DC Controller',
    publisher: 'Texas Instruments',
    url: 'https://www.ti.com/lit/ds/symlink/tps23755.pdf',
    section: 'Table 7-1 (relu par un outil de résumé, citation non mot à mot) : classes 0 à 3, puissance au PD 12,95, 3,84, 6,49 et 12,95 W'
  },
  axisM2035le: {
    title: 'AXIS M2035-LE Bullet Camera Datasheet',
    publisher: 'Axis Communications',
    url: 'https://www.axis.com/dam/public/cc/31/2a/datasheet-axis-m2035-le-bullet-camera-en-US-555402.pdf',
    section: 'Alimentation : PoE IEEE 802.3af type 1 classe 3, 5 W typique, 12,95 W au plus'
  },
  cisco7800DataSheet: {
    title: 'Cisco IP Phone 7800 Series Data Sheet',
    publisher: 'Cisco',
    url: 'https://www.cisco.com/c/en/us/products/collateral/collaboration-endpoints/unified-ip-phone-7800-series/data-sheet-c78-729488.html',
    section: 'Alimentation : PoE IEEE 802.3af classe 1, 3,84 W au plus'
  },
  tplinkEap225: {
    title: 'EAP225 V4.20 Datasheet',
    publisher: 'TP-Link',
    url: 'https://static.tp-link.com/upload/product-overview/2026/202603/20260305/Datasheet_EAP225%204.20.pdf',
    section: 'Alimentation : PoE 802.3af ou passif 24 V ; consommation maximale 12,6 W (version US), 9,7 W (version EU)'
  },
  tplinkSg1008p: {
    title: 'TL-SG1008P V6 Datasheet',
    publisher: 'TP-Link',
    url: 'https://static.tp-link.com/upload/product-overview/2021/202108/20210827/TL-SG1008P%206.0%20Datasheet.pdf',
    section: '4 ports PoE+ 802.3af/at sur 8, 30 W par port, budget PoE total de 64 W'
  },
  rfc2131: {
    title: 'RFC 2131 Dynamic Host Configuration Protocol',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc2131',
    section: '§ 4.1 : messages du client vers le port du serveur (67), du serveur vers le port du client (68) ; § 3.1 : DHCPDISCOVER, DHCPOFFER, DHCPREQUEST, DHCPACK ; un seul serveur doit répondre pour un même réseau, sinon le client prend la première offre'
  },
  rfc3927: {
    title: 'RFC 3927 Dynamic Configuration of IPv4 Link-Local Addresses',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc3927',
    section: '§ 1 : préfixe 169.254/16 réservé aux adresses locales au lien, que l’hôte se donne lui-même quand aucun serveur DHCP ne répond ; ces adresses ne passent pas les routeurs'
  },
  rfc1918: {
    title: 'RFC 1918 Address Allocation for Private Internets',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc1918',
    section: '§ 3 : plages privées 10.0.0.0/8, 172.16.0.0/12 et 192.168.0.0/16 ; une adresse doit être unique dans le réseau où elle sert'
  },
  rfc950: {
    title: 'RFC 950 Internet Standard Subnetting Procedure',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc950',
    section: 'Masque de sous-réseau : un hôte joint directement les adresses de son sous-réseau, les autres par une passerelle de ce sous-réseau ; adresses de réseau et de diffusion réservées'
  },
  rfc4632: {
    title: 'RFC 4632 Classless Inter-domain Routing (CIDR)',
    publisher: 'IETF',
    url: 'https://www.rfc-editor.org/rfc/rfc4632',
    section: '§ 3.1 : notation préfixe/longueur (192.168.1.0/24), masque contigu'
  },
  mqtt311: {
    title: 'MQTT Version 3.1.1 (OASIS Standard)',
    publisher: 'OASIS',
    url: 'https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html',
    section: '§ 4.2 : port TCP 1883 enregistré auprès de l’IANA pour MQTT sans TLS ; § 2 et 3 : paquets CONNECT, CONNACK, PUBLISH, SUBSCRIBE, SUBACK, PINGREQ, DISCONNECT ; § 4.7 : jokers + et # des filtres de sujets'
  },
  modbusTcpGuide: {
    title: 'MODBUS Messaging on TCP/IP Implementation Guide V1.0b',
    publisher: 'Modbus Organization',
    url: 'https://www.modbus.org/file/secure/messagingimplementationguide.pdf',
    section: 'Port TCP 502 réservé à Modbus ; en-tête MBAP de 7 octets (identifiant de transaction, protocole 0, longueur, unité) devant la trame de la fonction'
  },
  /* ---------- Modules Ethernet des cartes (W5500, ENC28J60) ---------- */
  wiznetW5500Datasheet: {
    title: 'W5500 Datasheet Version 1.1.0',
    publisher: 'WIZnet',
    url: 'https://docs.wiznet.io/assets/files/W5500_ds_v110e-226ffec190c588b69f88d629789585e1.pdf',
    section: 'Features, p. 2 : « Supports 8 independent sockets simultaneously », « Internal 32Kbytes Memory for TX/RX Buffers » ; § 4.1, p. 43 : « VERSIONR (W5500 Chip Version Register) [R] [0x0039] [0x04] » ; § 2.2, p. 15 : trame SPI = adresse sur 16 bits, octet de contrôle (BSB[4:0], RWB, OM[1:0]), données ; § 5.1, p. 58 : « VDD DC Supply voltage -0.5 to 4.6 V », « VIN DC input voltage -0.5 to 6 V » ; § 5.3, p. 59 : VDD 2.97 à 3.63 V, VIH 2.0 à 5.5 V (entrées tolérantes au 5 V), VOL 0.4 V à « IOL = 8mA » ; § 5.4, p. 60 : « 100M Link - 128 - mA », « 100M Transmitting - 132 - mA » (valeurs typiques, sans maximum) ; § 5.5.4, p. 61 : « Even though theoretical design speed is 80MHz […] The minimum guaranteed speed of the SCLK is 33.3 MHz »'
  },
  wiznetWiz850io: {
    title: 'WIZ850io',
    publisher: 'WIZnet',
    url: 'https://docs.wiznet.io/Product/ioModule/WIZ850io',
    section: 'Page du module (relu par un outil de résumé, citation non mot à mot) : module W5500 avec prise RJ45 à transformateurs intégrés, alimenté en 3,3 V seulement, IDD typique 141 mA, 135 mA avec un lien à 100 Mb/s'
  },
  microchipEnc28j60: {
    title: 'ENC28J60 Stand-Alone Ethernet Controller with SPI Interface (DS39662E)',
    publisher: 'Microchip Technology',
    url: 'https://ww1.microchip.com/downloads/en/DeviceDoc/39662e.pdf',
    section: 'p. 1 : « SPI Interface with Clock Speeds up to 20 MHz », « 5V Tolerant Inputs », 10BASE-T ; § 2.5, p. 8 : « The SPI CS, SCK and SI inputs, as well as the RESET pin, are all 5V tolerant » ; § 16.0, p. 79 : « Voltage on VDD […] -0.3V to 3.6V », « Voltage on RESET, CS, SCK and SI, with respect to VSS -0.3V to 6.0V », « Current sourced or sunk by INT and SO 4 mA » ; § 16.1, p. 80 : VDD 3.10 à 3.60 V, VIH (SCK, CS, SI, RESET) 2.25 à 5.5 V, IDD « Transmitting Ethernet Packets » 160 mA (typ.) 180 mA (max.), 120 mA actif sans émission ; Table 16-6, p. 82 : FSCK « DC 20 MHz »'
  }
};
