// Calendario oficial del Mundial 2026 (Canadá / México / EE. UU.).
//
// Mapa de horarios de inicio en UTC, indexado por el IDENTIFICADOR INTERNO del
// partido:
//   - Fase de grupos: clave = groupMatchIndex(g, pair) = g*6 + pair  (0..71),
//     donde g=0..11 son los grupos A..L y `pair` es el índice en GROUP_PAIRS
//     ([[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]] por posición de sorteo 0..3).
//   - Eliminatorias: clave = número OFICIAL FIFA del partido (73..104), que ya
//     coincide con `R32/R16/QF/SF/THIRD_PLACE/FINAL` en bracket.ts.
//
// Las horas se almacenan en ISO 8601 UTC ('...Z'). La conversión a hora LOCAL
// del usuario la hace el navegador con `toLocaleString` (no se hardcodea zona).
//
// Fuentes del fixture (fechas y horas de inicio por sede):
//   - Wikipedia, "2026 FIFA World Cup knockout stage" (offsets UTC explícitos).
//   - ESPN, "2026 FIFA World Cup: Format, groups, full match schedule" (grupos,
//     horarios en ET).
//   - FIFA.com (match schedule) y Sky Sports (verificación de fechas).
//
// Husos horarios: en junio/julio de 2026 todas las sedes usan horario de verano.
//   ET=UTC-4 (Toronto, Nueva York/East Rutherford, Foxborough, Filadelfia,
//   Atlanta, Miami), CT=UTC-5 (Arlington/Dallas, Houston, Kansas City), MT=UTC-6
//   en México (CDMX, Guadalajara/Zapopan, Monterrey/Guadalupe), PT=UTC-7
//   (Inglewood/L. Á., Santa Clara, Seattle, Vancouver).
//
// Cobertura: 104/104 partidos con FECHA y HORA exacta de inicio.

import { groupMatchIndex } from './standings'

// Atajo para construir las claves de fase de grupos (g*6 + pair).
const G = groupMatchIndex

// Las horas ET de la fuente se convierten a UTC sumando 4 h (EDT = UTC-4); las
// CT suman 5 h, MT 6 h y PT 7 h. Cada valor de abajo ya está en UTC.
export const MATCH_UTC: Record<number, string> = {
  // ===================== FASE DE GRUPOS (clave g*6+pair) =====================
  // --- Grupo A (g=0): MEX(0) RSA(1) KOR(2) CZE(3) ---
  [G(0, 0)]: '2026-06-11T19:00:00Z', // MEX-RSA  11 jun 15:00 ET (CDMX, MT 13:00)
  [G(0, 5)]: '2026-06-12T02:00:00Z', // KOR-CZE  11 jun 22:00 ET (Zapopan)
  [G(0, 1)]: '2026-06-19T03:00:00Z', // MEX-KOR  18 jun 23:00 ET (Zapopan)
  [G(0, 4)]: '2026-06-18T16:00:00Z', // CZE-RSA  18 jun 12:00 ET (Atlanta)
  [G(0, 2)]: '2026-06-25T01:00:00Z', // CZE-MEX  24 jun 21:00 ET (CDMX)
  [G(0, 3)]: '2026-06-25T01:00:00Z', // RSA-KOR  24 jun 21:00 ET (Zapopan)

  // --- Grupo B (g=1): CAN(0) BIH(1) QAT(2) SUI(3) ---
  [G(1, 0)]: '2026-06-12T19:00:00Z', // CAN-BIH  12 jun 15:00 ET (Toronto)
  [G(1, 5)]: '2026-06-13T19:00:00Z', // QAT-SUI  13 jun 15:00 ET (Santa Clara)
  [G(1, 1)]: '2026-06-18T22:00:00Z', // CAN-QAT  18 jun 18:00 ET (Vancouver)
  [G(1, 4)]: '2026-06-18T19:00:00Z', // SUI-BIH  18 jun 15:00 ET (Inglewood)
  [G(1, 2)]: '2026-06-24T19:00:00Z', // SUI-CAN  24 jun 15:00 ET (Vancouver)
  [G(1, 3)]: '2026-06-24T19:00:00Z', // BIH-QAT  24 jun 15:00 ET (Seattle)

  // --- Grupo C (g=2): BRA(0) MAR(1) HAI(2) SCO(3) ---
  [G(2, 0)]: '2026-06-13T22:00:00Z', // BRA-MAR  13 jun 18:00 ET (East Rutherford)
  [G(2, 5)]: '2026-06-14T01:00:00Z', // HAI-SCO  13 jun 21:00 ET (Foxborough)
  [G(2, 1)]: '2026-06-20T01:00:00Z', // BRA-HAI  19 jun 21:00 ET (Filadelfia)
  [G(2, 4)]: '2026-06-19T22:00:00Z', // SCO-MAR  19 jun 18:00 ET (Foxborough)
  [G(2, 2)]: '2026-06-24T22:00:00Z', // SCO-BRA  24 jun 18:00 ET (Miami Gardens)
  [G(2, 3)]: '2026-06-24T22:00:00Z', // MAR-HAI  24 jun 18:00 ET (Atlanta)

  // --- Grupo D (g=3): USA(0) PAR(1) AUS(2) TUR(3) ---
  [G(3, 0)]: '2026-06-13T01:00:00Z', // USA-PAR  12 jun 21:00 ET (Inglewood)
  [G(3, 5)]: '2026-06-14T04:00:00Z', // AUS-TUR  14 jun 00:00 ET (Vancouver)
  [G(3, 1)]: '2026-06-19T19:00:00Z', // USA-AUS  19 jun 15:00 ET (Seattle)
  [G(3, 4)]: '2026-06-20T04:00:00Z', // TUR-PAR  20 jun 00:00 ET (Santa Clara)
  [G(3, 2)]: '2026-06-26T02:00:00Z', // TUR-USA  25 jun 22:00 ET (Inglewood)
  [G(3, 3)]: '2026-06-26T02:00:00Z', // PAR-AUS  25 jun 22:00 ET (Santa Clara)

  // --- Grupo E (g=4): GER(0) CUW(1) CIV(2) ECU(3) ---
  [G(4, 0)]: '2026-06-14T17:00:00Z', // GER-CUW  14 jun 13:00 ET (Houston)
  [G(4, 5)]: '2026-06-14T23:00:00Z', // CIV-ECU  14 jun 19:00 ET (Filadelfia)
  [G(4, 1)]: '2026-06-20T20:00:00Z', // GER-CIV  20 jun 16:00 ET (Toronto)
  [G(4, 4)]: '2026-06-21T00:00:00Z', // ECU-CUW  20 jun 20:00 ET (Kansas City)
  [G(4, 2)]: '2026-06-25T20:00:00Z', // ECU-GER  25 jun 16:00 ET (East Rutherford)
  [G(4, 3)]: '2026-06-25T20:00:00Z', // CUW-CIV  25 jun 16:00 ET (Filadelfia)

  // --- Grupo F (g=5): NED(0) JPN(1) SWE(2) TUN(3) ---
  [G(5, 0)]: '2026-06-14T20:00:00Z', // NED-JPN  14 jun 16:00 ET (Arlington)
  [G(5, 5)]: '2026-06-15T02:00:00Z', // SWE-TUN  14 jun 22:00 ET (Guadalupe)
  [G(5, 1)]: '2026-06-20T17:00:00Z', // NED-SWE  20 jun 13:00 ET (Houston)
  [G(5, 4)]: '2026-06-21T04:00:00Z', // TUN-JPN  21 jun 00:00 ET (Guadalupe)
  [G(5, 2)]: '2026-06-25T23:00:00Z', // TUN-NED  25 jun 19:00 ET (Kansas City)
  [G(5, 3)]: '2026-06-25T23:00:00Z', // JPN-SWE  25 jun 19:00 ET (Arlington)

  // --- Grupo G (g=6): BEL(0) EGY(1) IRN(2) NZL(3) ---
  [G(6, 0)]: '2026-06-15T22:00:00Z', // BEL-EGY  15 jun 18:00 ET (Seattle)
  [G(6, 5)]: '2026-06-16T04:00:00Z', // IRN-NZL  16 jun 00:00 ET (Inglewood)
  [G(6, 1)]: '2026-06-21T19:00:00Z', // BEL-IRN  21 jun 15:00 ET (Inglewood)
  [G(6, 4)]: '2026-06-22T01:00:00Z', // NZL-EGY  21 jun 21:00 ET (Vancouver)
  [G(6, 2)]: '2026-06-27T03:00:00Z', // NZL-BEL  26 jun 23:00 ET (Vancouver)
  [G(6, 3)]: '2026-06-27T03:00:00Z', // EGY-IRN  26 jun 23:00 ET (Seattle)

  // --- Grupo H (g=7): ESP(0) CPV(1) KSA(2) URU(3) ---
  [G(7, 0)]: '2026-06-15T17:00:00Z', // ESP-CPV  15 jun 13:00 ET (Atlanta)
  [G(7, 5)]: '2026-06-15T22:00:00Z', // KSA-URU  15 jun 18:00 ET (Miami Gardens)
  [G(7, 1)]: '2026-06-21T16:00:00Z', // ESP-KSA  21 jun 12:00 ET (Atlanta)
  [G(7, 4)]: '2026-06-21T22:00:00Z', // URU-CPV  21 jun 18:00 ET (Miami Gardens)
  [G(7, 2)]: '2026-06-27T00:00:00Z', // URU-ESP  26 jun 20:00 ET (Zapopan)
  [G(7, 3)]: '2026-06-27T00:00:00Z', // CPV-KSA  26 jun 20:00 ET (Houston)

  // --- Grupo I (g=8): FRA(0) SEN(1) IRQ(2) NOR(3) ---
  [G(8, 0)]: '2026-06-16T19:00:00Z', // FRA-SEN  16 jun 15:00 ET (East Rutherford)
  [G(8, 5)]: '2026-06-16T22:00:00Z', // IRQ-NOR  16 jun 18:00 ET (Foxborough)
  [G(8, 1)]: '2026-06-22T21:00:00Z', // FRA-IRQ  22 jun 17:00 ET (Filadelfia)
  [G(8, 4)]: '2026-06-23T00:00:00Z', // NOR-SEN  22 jun 20:00 ET (East Rutherford)
  [G(8, 2)]: '2026-06-26T19:00:00Z', // NOR-FRA  26 jun 15:00 ET (Foxborough)
  [G(8, 3)]: '2026-06-26T19:00:00Z', // SEN-IRQ  26 jun 15:00 ET (Toronto)

  // --- Grupo J (g=9): ARG(0) ALG(1) AUT(2) JOR(3) ---
  [G(9, 0)]: '2026-06-17T01:00:00Z', // ARG-ALG  16 jun 21:00 ET (Kansas City)
  [G(9, 5)]: '2026-06-17T04:00:00Z', // AUT-JOR  17 jun 00:00 ET (Santa Clara)
  [G(9, 1)]: '2026-06-22T17:00:00Z', // ARG-AUT  22 jun 13:00 ET (Arlington)
  [G(9, 4)]: '2026-06-23T03:00:00Z', // JOR-ALG  22 jun 23:00 ET (Santa Clara)
  [G(9, 2)]: '2026-06-28T02:00:00Z', // JOR-ARG  27 jun 22:00 ET (Arlington)
  [G(9, 3)]: '2026-06-28T02:00:00Z', // ALG-AUT  27 jun 22:00 ET (Kansas City)

  // --- Grupo K (g=10): POR(0) COD(1) UZB(2) COL(3) ---
  [G(10, 0)]: '2026-06-17T17:00:00Z', // POR-COD  17 jun 13:00 ET (Houston)
  [G(10, 5)]: '2026-06-18T02:00:00Z', // UZB-COL  17 jun 22:00 ET (Zapopan)
  [G(10, 1)]: '2026-06-23T17:00:00Z', // POR-UZB  23 jun 13:00 ET (Houston)
  [G(10, 4)]: '2026-06-24T02:00:00Z', // COL-COD  23 jun 22:00 ET (Zapopan)
  [G(10, 2)]: '2026-06-27T23:30:00Z', // COL-POR  27 jun 19:30 ET (Miami Gardens)
  [G(10, 3)]: '2026-06-27T23:30:00Z', // COD-UZB  27 jun 19:30 ET (Atlanta)

  // --- Grupo L (g=11): ENG(0) CRO(1) GHA(2) PAN(3) ---
  [G(11, 0)]: '2026-06-17T20:00:00Z', // ENG-CRO  17 jun 16:00 ET (Arlington)
  [G(11, 5)]: '2026-06-17T23:00:00Z', // GHA-PAN  17 jun 19:00 ET (Toronto)
  [G(11, 1)]: '2026-06-23T20:00:00Z', // ENG-GHA  23 jun 16:00 ET (Foxborough)
  [G(11, 4)]: '2026-06-23T23:00:00Z', // PAN-CRO  23 jun 19:00 ET (Toronto)
  [G(11, 2)]: '2026-06-27T21:00:00Z', // PAN-ENG  27 jun 17:00 ET (East Rutherford)
  [G(11, 3)]: '2026-06-27T21:00:00Z', // CRO-GHA  27 jun 17:00 ET (Filadelfia)

  // ===================== ELIMINATORIAS (clave = num FIFA) =====================
  // --- Dieciseisavos (Round of 32), 73-88 ---
  73: '2026-06-28T19:00:00Z', // 28 jun 12:00 PT (Inglewood)
  74: '2026-06-29T20:30:00Z', // 29 jun 16:30 ET (Foxborough)
  75: '2026-06-30T01:00:00Z', // 29 jun 19:00 MT (Guadalupe)
  76: '2026-06-29T17:00:00Z', // 29 jun 12:00 CT (Houston)
  77: '2026-06-30T21:00:00Z', // 30 jun 17:00 ET (East Rutherford)
  78: '2026-06-30T17:00:00Z', // 30 jun 12:00 CT (Arlington)
  79: '2026-07-01T01:00:00Z', // 30 jun 19:00 MT (CDMX)
  80: '2026-07-01T16:00:00Z', // 1 jul 12:00 ET (Atlanta)
  81: '2026-07-02T00:00:00Z', // 1 jul 17:00 PT (Santa Clara)
  82: '2026-07-01T20:00:00Z', // 1 jul 13:00 PT (Seattle)
  83: '2026-07-02T23:00:00Z', // 2 jul 19:00 ET (Toronto)
  84: '2026-07-02T19:00:00Z', // 2 jul 12:00 PT (Inglewood)
  85: '2026-07-03T03:00:00Z', // 2 jul 20:00 PT (Vancouver)
  86: '2026-07-03T22:00:00Z', // 3 jul 18:00 ET (Miami Gardens)
  87: '2026-07-04T01:30:00Z', // 3 jul 20:30 CT (Kansas City)
  88: '2026-07-03T18:00:00Z', // 3 jul 13:00 CT (Arlington)

  // --- Octavos (Round of 16), 89-96 ---
  89: '2026-07-04T21:00:00Z', // 4 jul 17:00 ET (Filadelfia)
  90: '2026-07-04T17:00:00Z', // 4 jul 12:00 CT (Houston)
  91: '2026-07-05T20:00:00Z', // 5 jul 16:00 ET (East Rutherford)
  92: '2026-07-06T00:00:00Z', // 5 jul 18:00 MT (CDMX)
  93: '2026-07-06T19:00:00Z', // 6 jul 14:00 CT (Arlington)
  94: '2026-07-07T00:00:00Z', // 6 jul 17:00 PT (Seattle)
  95: '2026-07-07T16:00:00Z', // 7 jul 12:00 ET (Atlanta)
  96: '2026-07-07T20:00:00Z', // 7 jul 13:00 PT (Vancouver)

  // --- Cuartos de final, 97-100 ---
  97: '2026-07-09T20:00:00Z', // 9 jul 16:00 ET (Foxborough)
  98: '2026-07-10T19:00:00Z', // 10 jul 12:00 PT (Inglewood)
  99: '2026-07-11T21:00:00Z', // 11 jul 17:00 ET (Miami Gardens)
  100: '2026-07-12T01:00:00Z', // 11 jul 20:00 CT (Kansas City)

  // --- Semifinales, 101-102 ---
  101: '2026-07-14T19:00:00Z', // 14 jul 14:00 CT (Arlington)
  102: '2026-07-15T19:00:00Z', // 15 jul 15:00 ET (Atlanta)

  // --- Tercer puesto y final ---
  103: '2026-07-18T21:00:00Z', // 18 jul 17:00 ET (Miami Gardens)
  104: '2026-07-19T19:00:00Z', // 19 jul 15:00 ET (East Rutherford)
}

/**
 * Hora de inicio en UTC (ISO 8601) del partido identificado por `key`
 * (groupMatchIndex 0..71 para grupos; número FIFA 73..104 para eliminatorias),
 * o null si no hay dato.
 */
export function kickoffUTC (key: number): string | null {
  return MATCH_UTC[key] ?? null
}

/**
 * Fecha y hora LOCAL del partido `key`, formateadas según `locale` (la zona la
 * resuelve el navegador a partir de la hora UTC). Devuelve null si no hay dato.
 */
export function formatLocal (key: number, locale: string): string | null {
  const iso = MATCH_UTC[key]
  if (!iso) return null
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}
