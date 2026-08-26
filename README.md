# Twizy PowerBox BT — fixed

Working continuation of [rakkipe/Twizy-pb-bt](https://github.com/rakkipe/Twizy-pb-bt) for a Renault Twizy 80 (2012), SEVCON Gen4 software `0712.0001`.

## PowerBox v1.0.0

This release packages all currently safe, supportable capabilities for the M5StickC Plus2 without TFT and the M5 Unit CAN on GPIO 32/33:

- verified Twizy CAN telemetry and Serial CSV logging
- BLE Nordic UART telemetry for the Android dashboard
- headless Android companion app
- raw CAN frame intake and health counters
- CANopen SDO reads and controller identity verification
- transactional v12 register tuning with snapshot, readback and rollback
- physical plus software arming, stationary/Neutral gate and one-shot timeout
- separate read-only inspection before applying a queued profile
- reproducible Android and PlatformIO builds with downloadable CI artifacts

## Two deliberately separate firmware modes

| Target | CAN mode | Purpose |
|---|---|---|
| `firmware/` | listen-only | Daily telemetry, BLE dashboard and logging; CAN transmit is impossible |
| `tuner/` | normal | Bench diagnosis and controlled v12 tuning; Serial only, no TFT |

Keeping the targets separate prevents a dashboard session from becoming an accidental tuning session.

## Validated hardware and controller

- M5StickC Plus2, TFT unused
- M5 Unit CAN, ESP32 TWAI GPIO 32/33
- Twizy CAN bus, 500 kbit/s
- Twizy 80 model year 2012
- SEVCON Gen4 PID `0712302D`, software `0712.0001`

## Build

```text
pio run -d firmware
pio run -d tuner
gradle assembleDebug
```

GitHub Actions publishes both firmware binaries and validates the Android app.

## Safety boundary

The recorded vehicle has shown STOP/no-GO and persistent fault `0x5044` after historical PMAP/FMAP changes. The tuner therefore contains no guessed Normal/Sport/Race profile and no v14 PMAP generator. Active writes require the exact known-good v12 values or a validated matching-controller dump.

Before any write: prove zero speed and Neutral on fresh CAN data, run `inspect`, keep an OEM snapshot, and bench-test. See [PowerBox v1.0.0](docs/release-v1.0.0.md) and [SEVCON session](docs/sevcon-session.md).

## Dank

Bijzondere dank aan Michael Balzer voor Twizy-Cfg, het OVMS-team en alle Renault Twizy-bijdragers die de CANopen/SEVCON-kennis beschikbaar maakten. De volledige bronvermelding staat in [docs/acknowledgements.md](docs/acknowledgements.md) en [THIRD_PARTY.md](THIRD_PARTY.md).
