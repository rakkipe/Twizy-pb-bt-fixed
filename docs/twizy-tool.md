# Twizy Tool-integratie

De bruikbare Twizy Tool-functies zijn gemigreerd naar de modulaire PowerBox. Er is nog maar één gevalideerde CANopen/SDO-engine, zodat dashboard, diagnose en tuning geen tegenstrijdige registerlogica gebruiken.

| Twizy Tool-functie | PowerBox-opdracht/onderdeel |
|---|---|
| voertuigstatus | `status` |
| controlleridentiteit | `identify` |
| foutgeschiedenis | `faults` |
| volledige snelle controle | `diagnose` |
| willekeurig SDO-object lezen | `read <index> <sub>` |
| profielwaarden voorbereiden | `queue <index> <sub> <value>` |
| profiel tonen/wissen | `show` / `clear` |
| huidige en gevraagde waarden vergelijken | `inspect` |
| gecontroleerd toepassen | Button A → `arm V12` → `apply` |
| live voertuigmonitoring | veilige telemetry-firmware + Android-app |
| herstel | automatisch rollback bij fout; opgeslagen waarden kunnen opnieuw worden gequeued |

## Snelheid

- CANopen gebruikt de bewezen 50 ms SDO-time-out met maximaal drie pogingen.
- Transmit-wachttijd is begrensd op 20 ms.
- Mislukte pogingen krijgen slechts 2 ms tussenruimte.
- Een profiel gebruikt één login, één complete snapshot en daarna directe write/readback-paren.
- Telemetry wordt met 5 Hz naar BLE en Serial gestuurd.

SDO-verzoeken blijven bewust sequentieel. De SEVCON Gen4 ondersteunt één SDO-clienttransactie tegelijk; parallelle writes zijn niet sneller en kunnen antwoorden verkeerd koppelen.

## Niet overgenomen uit de oude Drive-tool

De oude voorbeeldcode gebruikt onder andere een foutieve `SEVC`-login, generieke registers en onbevestigde Normal/Sport/Race-waarden. Deze zijn vervangen door de gevalideerde level-4-login, Twizy 80 PID-controle en de bewezen v12 state-sequentie.
