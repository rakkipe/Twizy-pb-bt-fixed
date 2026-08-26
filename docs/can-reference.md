# Curated Twizy CAN reference

Source: Google Drive spreadsheet **Twizy CANBUS Objektverzeichnis**, inspected 2026-08-26.

| CAN ID | Source | Verified fields used by firmware |
|---|---|---|
| `0x155` | BMS | B2+B3 lower 12 bits: current, zero=2000, A=(2000-raw)/4; B4 phase `0x54` valid; B5+B6 SOC=raw/400 |
| `0x196` | controller | B6 motor temperature = raw−40 °C |
| `0x554` | BMS | B1…B7 module temperatures = raw−40 °C |
| `0x55F` | BMS | B6…B8 contain two packed 12-bit pack-voltage readings, raw/10 V |
| `0x599` | display | B7+B8 absolute speed, raw/100 km/h; `0xFFFF` invalid |
| `0x59E` | controller | B6 PEB/controller temperature = raw−40 °C |

## Corrections versus the original firmware

The original repository decoded SOC from `0x424`, speed from the first bytes of `0x155`, and voltage/current from `0x59E`. Those layouts conflict with the Drive object directory. The fixed firmware therefore uses the table above and keeps range/plausibility checks around the packed pack-voltage values.

## Still unverified

- Exact byte/nibble order of both `0x55F` voltage readings must be confirmed against a captured frame and a multimeter/DDT value.
- Frame definitions marked `?` in the spreadsheet are not used as authoritative inputs.
- No tuning/SDO object is inferred from broadcast CAN frames.
