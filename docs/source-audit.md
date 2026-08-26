# Source comparison and continuation decision

## Repository comparison

| Area | `Twizy-pb-bt` | Fixed continuation |
|---|---|---|
| Android | Kotlin BLE dashboard present | migrated as the current UI baseline |
| Firmware | M5Unified display, BLE, TWAI listen-only; several guessed CAN decoders; relay commands | headless serial + BLE, Drive-backed CAN decoders, no relays/commands |
| Hardware assumption | M5StickC Plus2 with live TFT | M5StickC Plus2 with broken/removed TFT |
| CAN safety | TWAI listen-only, but comments suggested switching to normal | listen-only is an explicit milestone constraint |
| Documentation | 35-byte README | hardware, bench test, provenance, SEVCON fault gate |
| CI | Android and PlatformIO workflows | migrated and simplified |

## Drive material disposition

- **Twizy CANBUS Objektverzeichnis:** authoritative working reference for confirmed broadcast frames.
- **Twizy SEVCON Versions:** controller-era/lock reference; not a tuning recipe.
- **Two SEVCON session exports:** duplicates; curated into `sevcon-session.md`.
- **ESP32 Twizy Tuning Powerbox Firmware / renault_twizy_esp32_project.md:** useful design background, but example code contains unverified IDs, scaling, electrical claims, and automatic write sequences. Kept out of production firmware.
- **Twizy SEVCON Versions PDF:** duplicate presentation of the sheet, not imported.

## Continuation rule

Evidence is promoted in this order: live capture + independent measurement, confirmed Drive table, healthy-controller dump, community documentation, then speculative report text. Unknowns stay documented rather than silently becoming executable values.
