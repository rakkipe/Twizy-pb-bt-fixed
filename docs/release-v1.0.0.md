# PowerBox v1.0.0 release

Release candidate for the headless M5StickC Plus2 PowerBox.

## Included

| Capability | Delivered by | Status |
|---|---|---|
| Speed, SOC, voltage, current and power | telemetry firmware | available |
| Motor, controller and battery temperature | telemetry firmware | available |
| BLE live dashboard | telemetry firmware + Android app | available |
| USB Serial CSV logging | telemetry firmware | available |
| Controller identity and arbitrary SDO read | tuner firmware | available |
| Queue and inspect register changes | tuner firmware | available |
| v12-style transactional tuning | tuner firmware | available with exact known-good values |
| Automatic snapshot/readback/rollback | tuner firmware | available |
| OEM restore | queue a saved snapshot and apply | available when a snapshot was captured |
| Normal/Sport/Race presets | profile framework | intentionally unpopulated pending validated values |
| TFT display | neither target | intentionally excluded |
| Wi-Fi/web UI and OTA | future release | not included |
| Track timing / 0–80 measurement | future release | not included |

“All possibilities” in v1.0.0 means all capabilities supported by the evidence and current hardware without inventing SEVCON values. Unsupported profile numbers are not silently substituted.

## Tuner workflow

1. Flash `tuner/.pio/build/tuner-v12-headless/firmware.bin`.
2. Connect Serial at 115200 baud.
3. Verify `status` reports fresh 0.00 km/h and Neutral.
4. Use `read` for diagnosis.
5. Add only verified v12 values with `queue <index_hex> <sub_hex> <value>`.
6. Run `inspect` and save the displayed current values.
7. Hold Button A for three seconds, enter `arm V12`, then `apply`.
8. Confirm every write is verified and operational restore reports OK.

The apply transaction performs: identity check → level-4 login → complete snapshot → pre-operational state → write/readback per object → rollback on first failure → operational restore → logout.

## Known safety gate

Controller identity must equal PID `0712302D`. Active tuning is blocked unless the vehicle is stationary and Neutral from fresh CAN frames. Historical fault `0x5044` remains a diagnostic concern; do not attempt performance tuning until the vehicle is reliably GO and the OEM configuration has been backed up.

## Release verification

The pull request must pass:

- Android `assembleDebug`
- PlatformIO build of `firmware/`
- PlatformIO build of `tuner/`

The workflow uploads both `.bin` files as artifacts.
