# Dank en bronvermelding

Deze PowerBox-continuation kon alleen zorgvuldig worden opgebouwd dankzij het werk en de documentatie van anderen.

## Bijzondere dank

- **Michael Balzer (dexterbg)** voor [Twizy-Cfg](https://github.com/dexterbg/Twizy-Cfg), de gedocumenteerde Renault Twizy CANopen/SEVCON-toegang, login, state handling en tuninglogica. Gevalideerd tegen commit `684150ac9d375cd41a23ff08bf4e87024776e67f`.
- **Het Open Vehicle Monitoring System-team en alle Renault Twizy-bijdragers** voor de [OVMS Renault Twizy SEVCON-implementatie](https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3). Gevalideerd tegen commit `1aa1daff19c5ad8532ba9fc887187c7f301539ac`.
- **De Arduino-, Espressif-, PlatformIO-, NimBLE-Arduino- en ArduinoJson-projecten** voor de gereedschappen en libraries waarop de M5StickC Plus2-firmware steunt.
- **Twizy-eigenaars en testers** die CAN-captures, controllergegevens en praktijktests delen. Hun terugkoppeling helpt voorkomen dat aannames als veilige tuningwaarden worden verspreid.

## Projectbronnen

- Het oorspronkelijke project [rakkipe/Twizy-pb-bt](https://github.com/rakkipe/Twizy-pb-bt) leverde de Android-app en eerdere firmwarebasis.
- Het eigen Google Drive-archief leverde de Twizy CANBUS-objectlijst, SEVCON-sessie-exporten, controlleridentiteit en de historische v12/v14-resultaten.
- De vaste CAN-decoders en veiligheidsbeslissingen in deze repository zijn uit die bronnen gecureerd en waar mogelijk gekruist gecontroleerd met Twizy-Cfg en OVMS.

Er is geen extern bronbestand letterlijk gekopieerd. Protocolgedrag, formules en registerbetekenissen blijven wel aan de oorspronkelijke projecten toegeschreven. Zie ook [THIRD_PARTY.md](../THIRD_PARTY.md) voor licentieprovenance.
