# SEVCON Gen4 session status

Curated from the two duplicate Drive exports dated 2026-05-25 and the project master context.

## Identified controller

- Renault Twizy 80, model year 2012
- SEVCON Gen4, CANopen node 1
- software `0712.0001`
- hardware `0x00000003`
- VID `0000001E`, PID `0712302D`, revision `00010019`
- serial `4797625`

The Drive SEVCON version table lists 2012/06 T80 controllers with software `0712.0001` as not locked.

## Current hard gate

The recorded vehicle state is STOP/no-GO with persistent fault `0x5044`. PMAP at `0x4611:01..0x12` had been corrupted by an earlier v14 sketch and was restored from a v12 OEM baseline, but `0x5044` remained. Writes to `0x3813:23` at 6000 and 18000 did not clear or uniquely trigger the condition. Fault lists `0x4100`, `0x4110`, and `0x5300` rejected clearing at operator level with abort `0x06010002`.

Therefore this continuation compiles no CAN transmit or SDO-write path. The next evidence needed is one of:

1. DVT identification of the object pair behind `0x5044`.
2. A healthy matching-controller dump of `0x3813:01..0x3F` and `0x4611:01..0x12`.
3. A documented, independently verified OVMS clear-log mechanism.

## Quarantined historical sequence

The Drive export records an earlier sequence involving operator login, `0x2800:00` pre-op/op transitions, brake-safe writes, speed/power/PMAP/FMAP/recuperation/ramp writes, and `0x1003:00` history clearing. It is retained as investigation evidence only and is deliberately not implemented here.
