# Headless tuner v12

This is a separate firmware target for the M5StickC Plus2 with a broken/removed TFT and the M5 Unit CAN on GPIO 32/33.

## Basis retained from the working v12 path

- SEVCON node 1, SDO request/response IDs `0x601/`0x581`
- targeted NMT Start only when heartbeat `0x701` reports STOPPED
- controller identity check: Twizy 80 PID `0x0712302D`
- access-level-4 login through `0x5000:03=0`, `0x5000:02=0x4BDF`
- v12 pre-op/op transition through `0x2800:00`, verified at `0x5110:00`
- no blind delays between writes: every SDO waits for a matching response
- no v14-generated PMAP/FMMap values

## Improvements

1. All target registers are read before any write.
2. Every write is read back and compared.
3. First failure triggers reverse-order rollback.
4. The tuner always attempts operational-state restore and logout.
5. Writes require recent CAN evidence of zero speed and Neutral.
6. Arming requires a 3-second physical Button A hold plus the serial command `arm V12`.
7. Arming is single-use and expires after 60 seconds.
8. The firmware uses Serial only; it never initializes the TFT.

## Use

Open Serial at 115200 baud.

```text
status
read 1018 02
queue 2920 05 7250
show
```

Hold Button A for three seconds, then:

```text
arm V12
apply
```

Values are parsed as decimal unless prefixed according to C number syntax. Index and subindex are hexadecimal.

## Important profile rule

The Drive report containing simplistic Normal/Sport/Race values is not used. It conflicts with the proven Twizy-Cfg/OVMS register model and contains broken CAN-array construction. Queue only the exact parameter values from the previously working v12 profile or a verified healthy-controller dump.

## Provenance

The CANopen transaction, login and state-verification behavior is derived from Michael Balzer's LGPL Twizy-Cfg implementation and cross-checked against OVMS Renault Twizy SEVCON code. See `THIRD_PARTY.md`.
