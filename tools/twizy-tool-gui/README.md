# Twizy Tool GUI

Een lokale Windows-GUI voor de headless M5StickC Plus2 tuner. De browser communiceert rechtstreeks via USB-Serial; er worden geen gegevens naar een server gestuurd.

## Starten

1. Flash eerst de `tuner/`-firmware.
2. Download of clone deze repository.
3. Dubbelklik op `start-gui.bat`.
4. Chrome of Edge opent op `http://localhost:8765`.
5. Klik **USB verbinden** en selecteer de COM-poort van de M5StickC Plus2.

Python is alleen nodig om de lokale pagina via localhost te openen. Web Serial werkt niet betrouwbaar via een dubbelgeklikt `file://`-adres.

## Beschikbare knoppen

- status, controlleridentiteit, foutlog en volledige diagnose
- help
- SDO-register lezen met vaste snelkeuzes
- queue-item toevoegen, wachtrij tonen, inspecteren en wissen
- vrije handmatige opdracht
- log wissen en als tekstbestand opslaan
- beveiligde `arm V12` en `apply`

## Write-beveiliging

De GUI verandert niets aan de firmwarebeveiliging. Voor writes blijven alle voorwaarden gelden:

1. verse CAN-data toont exact 0,00 km/u en Neutral;
2. Button A fysiek drie seconden ingedrukt;
3. veiligheidsvak aangevinkt;
4. bevestigingscode `V12`;
5. eerst `ARM V12`;
6. `APPLY` krijgt een aparte laatste bevestiging;
7. de firmware maakt snapshot/readback en rollbackt bij de eerste fout.

Gebruik tuning niet bij `0x5044`, STOP/no-GO of zonder opgeslagen OEM-waarden.

## Browserondersteuning

Gebruik een actuele Google Chrome of Microsoft Edge op Windows. Firefox en Safari ondersteunen Web Serial momenteel niet.
