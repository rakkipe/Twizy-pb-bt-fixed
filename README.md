# Twizy PowerBox BT — fixed

Working continuation of [rakkipe/Twizy-pb-bt](https://github.com/rakkipe/Twizy-pb-bt) for a Renault Twizy 80 (2012).

## Target hardware

- M5StickC Plus2 with broken/removed TFT
- M5 Unit CAN on the Grove port (ESP32 native TWAI, GPIO 32/33)
- Twizy CAN bus at 500 kbit/s
- Android BLE dashboard using Nordic UART Service

## Current milestone

This branch provides a safe telemetry baseline:

- CAN controller runs in `TWAI_MODE_LISTEN_ONLY`
- no CAN transmit, NMT, SDO write, relay control, or tuning command is compiled in
- verified Twizy frame layouts from the Drive CAN object directory replace the earlier guessed decoders
- BLE remains compatible with the existing Android app
- serial CSV logging works without the TFT

The Drive SEVCON session records a persistent fault `0x5044` and a STOP/no-GO condition after earlier PMAP/FMAP changes. For that reason, write/tuning work stays quarantined until a healthy reference dump or DVT diagnosis identifies the conflicting object.

## Repository layout

- `firmware/` — M5StickC Plus2 + M5 Unit CAN listen-only firmware
- `app/` — migrated Android BLE dashboard
- `docs/can-reference.md` — curated CAN layouts and decoder provenance
- `docs/sevcon-session.md` — current SEVCON facts, open questions, and hard safety gate
- `docs/source-audit.md` — comparison with the original repository and Drive material

## First bench test

1. Build and flash the firmware with PlatformIO.
2. Power the M5StickC Plus2 from USB before connecting CAN.
3. Connect CAN-H, CAN-L and ground only; do not add a 120 Ω terminator to an already terminated vehicle bus.
4. Open Serial at 115200 baud and confirm `CAN listen-only ready`.
5. With ignition on, verify frame counters and plausible SOC/speed/voltage values.
6. Connect the Android app to `TwizyPB` and compare values with Serial.
7. Do not enable transmit while fault `0x5044` / STOP remains unresolved.
