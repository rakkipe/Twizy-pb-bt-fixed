# Delen en installeren

Deze PowerBox-release is bedoeld voor Renault Twizy 80-gebruikers met een M5StickC Plus2 zonder werkend TFT en een M5 Unit CAN op GPIO 32/33.

## Welk bestand moet een gebruiker kiezen?

| Bestand | Voor wie | Risico |
|---|---|---|
| `TwizyPB-v1.0.0-telemetry-safe.bin` | iedereen die wil uitlezen, loggen en de Android-app gebruiken | CAN is hardwarematig in listen-only modus |
| `TwizyPB-v1.0.0-tuner-v12.bin` | ervaren gebruiker die SEVCON-diagnose of tuning uitvoert | kan CANopen/SDO schrijven na dubbele arming |
| `TwizyPB-v1.0.0-android.apk` | Android BLE-dashboard | installeer alleen vanaf deze GitHub-release |
| `SHA256SUMS.txt` | controle van downloads | vergelijk de SHA-256 voor flashen/installeren |

De firmware is niet universeel voor een Twizy 45 of een afwijkende controller. De tuner accepteert uitsluitend Twizy 80 PID `0712302D`.

## Aanbevolen eerste installatie

1. Download de telemetry-safe firmware en controleer de SHA-256.
2. Flash via USB met PlatformIO/esptool.
3. Voed de M5StickC eerst via USB.
4. Sluit CAN-H, CAN-L en massa aan; plaats geen extra 120-ohm afsluitweerstand op een reeds afgesloten voertuigbus.
5. Zet het contact aan en controleer via Serial 115200 dat plausibele frames verschijnen.
6. Installeer de APK en verbind met BLE-apparaat `TwizyPB`.
7. Vergelijk snelheid, SOC en spanning met de auto voordat je de metingen gebruikt.

## Tuner alleen voor gecontroleerd gebruik

Gebruik de tuner pas nadat de auto betrouwbaar GO is en een volledige OEM-snapshot is opgeslagen. Voer eerst `status`, `read` en `inspect` uit. Schrijven vereist verse CAN-bevestiging van 0,00 km/u en Neutral, drie seconden Button A, `arm V12` en daarna `apply`.

De historische fout `0x5044` is een blokkade voor maximum-trekkrachttuning. Deel geen “max”-profiel alsof dit veilig universeel toepasbaar is. Controller-, accustaat, banden, temperatuur en mechanische toestand verschillen per voertuig.

## Een release publiceren

Na groen licht op pull request #2:

1. squash-merge naar `main`;
2. maak tag `v1.0.0` op de mergecommit;
3. push de tag.

GitHub Actions bouwt en publiceert daarna de twee firmwarebestanden, APK en checksums in één GitHub Release.
