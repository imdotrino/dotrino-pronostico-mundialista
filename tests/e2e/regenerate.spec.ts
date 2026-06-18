import { test, expect, type Page } from '@playwright/test'

// El codec es lógica del cliente, así que el round-trip se ejecuta DENTRO del
// navegador (page.evaluate) importando los módulos del dev server de Vite.
// Construimos varios pronósticos representativos en el browser, los codificamos
// y decodificamos, y verificamos que se regeneran de forma exacta.

interface RoundTripResult {
  ok: boolean
  codeLen: number
  checks: Record<string, boolean>
}

type Kind = 'manual' | 'winlose' | 'score' | 'default'

async function roundTrip (page: Page, kind: Kind): Promise<RoundTripResult> {
  return page.evaluate(async (k: Kind) => {
    const codec = await import('/src/lib/codec.ts')
    const prediction = await import('/src/lib/prediction.ts')
    const standings = await import('/src/lib/standings.ts')
    const bracket = await import('/src/lib/bracket.ts')

    const { encodePrediction, decodePrediction } = codec
    const { defaultPrediction, resolveMatches, champion } = prediction
    const { computeStandings, groupMatchIndex } = standings
    const { FINAL } = bracket

    type P = ReturnType<typeof defaultPrediction>

    // Elige picks coherentes recorriendo la llaves en orden de dependencia: tras
    // cada elección re-resuelve, de modo que los partidos posteriores tengan
    // cupos válidos para elegir.
    function pickAll (p: P, side: 'home' | 'away'): void {
      const order = [
        73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88,
        89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104,
      ]
      for (const num of order) {
        const m = resolveMatches(p).get(num)
        if (!m) continue
        const chosen = side === 'home' ? m.home : m.away
        if (chosen != null) p.picks[num] = chosen
      }
    }

    let p: P
    if (k === 'default') {
      p = defaultPrediction()
    } else if (k === 'manual') {
      p = defaultPrediction()
      // Reordena algunos grupos invirtiendo su orden.
      p.groupOrder[0] = [...p.groupOrder[0]!].reverse()
      p.groupOrder[3] = [...p.groupOrder[3]!].reverse()
      p.groupOrder[7] = [...p.groupOrder[7]!].reverse()
      // Reordena el ranking de terceros.
      p.thirdsRank = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
      p.draftGroupOrder = p.groupOrder.map((g) => [...g])
      p.draftThirdsRank = [...p.thirdsRank]
      pickAll(p, 'home')
    } else if (k === 'winlose') {
      p = defaultPrediction()
      p.mode = 'winlose'
      // Llena todos los resultados de grupo (gana siempre el local del par)
      // para que las posiciones sean ciertas y los picks resolubles.
      for (let g = 0; g < 12; g++) {
        for (let pair = 0; pair < 6; pair++) {
          p.results[groupMatchIndex(g, pair)] = { o: 0 }
        }
      }
      // Algún empate para variar.
      p.results[groupMatchIndex(2, 5)] = { o: 1 }
      const st = computeStandings(p.results, 'winlose')
      p.groupOrder = st.groupOrder.map((g) => [...g])
      p.thirdsRank = [...st.thirdsRank]
      p.draftGroupOrder = p.groupOrder.map((g) => [...g])
      p.draftThirdsRank = [...p.thirdsRank]
      pickAll(p, 'away')
    } else {
      // score
      p = defaultPrediction()
      p.mode = 'score'
      for (let g = 0; g < 12; g++) {
        for (let pair = 0; pair < 6; pair++) {
          p.results[groupMatchIndex(g, pair)] = { o: 0, gh: 2, ga: 1 }
        }
      }
      // Resultado de eliminatoria empatado con penales.
      p.results[73] = { o: 1, gh: 1, ga: 1, ph: 5, pa: 4 }
      const st = computeStandings(p.results, 'score')
      p.groupOrder = st.groupOrder.map((g) => [...g])
      p.thirdsRank = [...st.thirdsRank]
      p.draftGroupOrder = p.groupOrder.map((g) => [...g])
      p.draftThirdsRank = [...p.thirdsRank]
      pickAll(p, 'home')
    }

    const code = encodePrediction(p)
    const back = decodePrediction(code)

    const winnersMatch = (): boolean => {
      const ra = resolveMatches(p)
      const rb = resolveMatches(back)
      const nums = new Set<number>([...ra.keys(), ...rb.keys()])
      for (const num of nums) {
        if ((ra.get(num)?.winner ?? null) !== (rb.get(num)?.winner ?? null)) return false
      }
      return true
    }

    const checks: Record<string, boolean> = {
      mode: back.mode === p.mode,
      groupOrder: JSON.stringify(back.groupOrder) === JSON.stringify(p.groupOrder),
      thirdsRank: JSON.stringify(back.thirdsRank) === JSON.stringify(p.thirdsRank),
      results: JSON.stringify(back.results) === JSON.stringify(p.results),
      picks: JSON.stringify(back.picks) === JSON.stringify(p.picks),
      winners: winnersMatch(),
      champion: champion(p) === champion(back),
      finalDefined: FINAL.num === 104,
    }

    return {
      ok: Object.values(checks).every(Boolean),
      codeLen: code.length,
      checks,
    }
  }, kind)
}

const kinds: Kind[] = ['default', 'manual', 'winlose', 'score']

for (const kind of kinds) {
  test(`round-trip exacto del pronóstico: ${kind}`, async ({ page }) => {
    await page.goto('/')
    const res = await roundTrip(page, kind)
    expect(res.checks, `checks fallidos: ${JSON.stringify(res.checks)}`).toEqual({
      mode: true,
      groupOrder: true,
      thirdsRank: true,
      results: true,
      picks: true,
      winners: true,
      champion: true,
      finalDefined: true,
    })
    expect(res.ok).toBe(true)
    // El código debe ser una cadena no vacía y razonablemente corta.
    expect(res.codeLen).toBeGreaterThan(0)
    expect(res.codeLen).toBeLessThan(400)
  })
}
