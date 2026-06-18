// Equipos del Mundial 2026 según el sorteo final (5 dic 2025, Washington D.C.).
// 48 selecciones, 12 grupos (A-L) de 4 en orden de bombo del sorteo.
//
// El índice global de cada equipo es estable: groupIndex * 4 + posición de
// sorteo (0..3). Ese índice es lo único que viaja en el código compartido,
// así que el orden de esta lista NO debe cambiarse una vez publicado.

export interface Team {
  /** Índice global estable 0..47 */
  id: number
  name: string
  /** Emoji de bandera */
  flag: string
  /** Código FIFA de 3 letras (p.ej. MEX) */
  code: string
  /** Letra de grupo A..L */
  group: string
}

export interface Group {
  letter: string
  /** Los 4 equipos en orden de sorteo */
  teams: Team[]
}

// [nombre, emoji, código FIFA] en orden de sorteo, grupo por grupo A..L.
const RAW: [string, string, string][][] = [
  // A
  [['México', '🇲🇽', 'MEX'], ['Sudáfrica', '🇿🇦', 'RSA'], ['Corea del Sur', '🇰🇷', 'KOR'], ['Chequia', '🇨🇿', 'CZE']],
  // B
  [['Canadá', '🇨🇦', 'CAN'], ['Bosnia y Herzegovina', '🇧🇦', 'BIH'], ['Catar', '🇶🇦', 'QAT'], ['Suiza', '🇨🇭', 'SUI']],
  // C
  [['Brasil', '🇧🇷', 'BRA'], ['Marruecos', '🇲🇦', 'MAR'], ['Haití', '🇭🇹', 'HAI'], ['Escocia', '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', 'SCO']],
  // D
  [['Estados Unidos', '🇺🇸', 'USA'], ['Paraguay', '🇵🇾', 'PAR'], ['Australia', '🇦🇺', 'AUS'], ['Turquía', '🇹🇷', 'TUR']],
  // E
  [['Alemania', '🇩🇪', 'GER'], ['Curazao', '🇨🇼', 'CUW'], ['Costa de Marfil', '🇨🇮', 'CIV'], ['Ecuador', '🇪🇨', 'ECU']],
  // F
  [['Países Bajos', '🇳🇱', 'NED'], ['Japón', '🇯🇵', 'JPN'], ['Suecia', '🇸🇪', 'SWE'], ['Túnez', '🇹🇳', 'TUN']],
  // G
  [['Bélgica', '🇧🇪', 'BEL'], ['Egipto', '🇪🇬', 'EGY'], ['Irán', '🇮🇷', 'IRN'], ['Nueva Zelanda', '🇳🇿', 'NZL']],
  // H
  [['España', '🇪🇸', 'ESP'], ['Cabo Verde', '🇨🇻', 'CPV'], ['Arabia Saudita', '🇸🇦', 'KSA'], ['Uruguay', '🇺🇾', 'URU']],
  // I
  [['Francia', '🇫🇷', 'FRA'], ['Senegal', '🇸🇳', 'SEN'], ['Irak', '🇮🇶', 'IRQ'], ['Noruega', '🇳🇴', 'NOR']],
  // J
  [['Argentina', '🇦🇷', 'ARG'], ['Argelia', '🇩🇿', 'ALG'], ['Austria', '🇦🇹', 'AUT'], ['Jordania', '🇯🇴', 'JOR']],
  // K
  [['Portugal', '🇵🇹', 'POR'], ['RD Congo', '🇨🇩', 'COD'], ['Uzbekistán', '🇺🇿', 'UZB'], ['Colombia', '🇨🇴', 'COL']],
  // L
  [['Inglaterra', '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', 'ENG'], ['Croacia', '🇭🇷', 'CRO'], ['Ghana', '🇬🇭', 'GHA'], ['Panamá', '🇵🇦', 'PAN']],
]

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']

export const TEAMS: Team[] = []
export const GROUPS: Group[] = RAW.map((raw, gi) => {
  const letter = GROUP_LETTERS[gi]!
  const teams = raw.map(([name, flag, code], pi) => {
    const team: Team = { id: gi * 4 + pi, name: name!, flag: flag!, code: code!, group: letter }
    TEAMS.push(team)
    return team
  })
  return { letter, teams }
})

export function teamById (id: number): Team {
  return TEAMS[id]!
}

/** Índice de grupo (0..11) a partir de la letra. */
export function groupIndex (letter: string): number {
  return GROUP_LETTERS.indexOf(letter)
}
