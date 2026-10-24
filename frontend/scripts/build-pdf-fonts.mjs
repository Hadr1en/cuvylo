// Génère les polices embarquées dans les PDF (src/pdf/fonts/*.ttf) et la table des caractères
// qu'elles savent dessiner (src/pdf/glyphs.generated.ts).
//
//   npm run fonts:build
//
// Pourquoi : les sous-ensembles « latin » de fontsource n'ont ni Ł, ř, ș, ő… — un nom polonais ou
// tchèque s'imprimait avec des cases vides. On part des fichiers complets (Google Fonts, licence
// SIL OFL) et on garde latin + latin étendu A/B + ponctuation usuelle, avec HarfBuzz (subset-font),
// qui conserve cmap, crénage et ligatures. Les fichiers générés sont versionnés : le build de
// production n'a pas besoin de ce script.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import subsetFont from 'subset-font'
import { copyFontLicenses } from './copy-font-licenses.mjs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'src/pdf/fonts')

/** [famille, fichier de sortie, paquet, nom du fichier source]. */
const FONTS = [
  ['Inter', 'inter-400', 'inter', '400Regular/Inter_400Regular.ttf'],
  ['Inter', 'inter-500', 'inter', '500Medium/Inter_500Medium.ttf'],
  ['Inter', 'inter-600', 'inter', '600SemiBold/Inter_600SemiBold.ttf'],
  ['Inter', 'inter-700', 'inter', '700Bold/Inter_700Bold.ttf'],
  ['Newsreader', 'newsreader-400', 'newsreader', '400Regular/Newsreader_400Regular.ttf'],
  ['Newsreader', 'newsreader-400i', 'newsreader', '400Regular_Italic/Newsreader_400Regular_Italic.ttf'],
  ['Newsreader', 'newsreader-600', 'newsreader', '600SemiBold/Newsreader_600SemiBold.ttf'],
  ['Bricolage Grotesque', 'bricolage-700', 'bricolage-grotesque', '700Bold/BricolageGrotesque_700Bold.ttf'],
  ['Bricolage Grotesque', 'bricolage-800', 'bricolage-grotesque', '800ExtraBold/BricolageGrotesque_800ExtraBold.ttf'],
  ['JetBrains Mono', 'mono-400', 'jetbrains-mono', '400Regular/JetBrainsMono_400Regular.ttf'],
  ['JetBrains Mono', 'mono-700', 'jetbrains-mono', '700Bold/JetBrainsMono_700Bold.ttf'],
  ['IBM Plex Sans', 'plex-400', 'ibm-plex-sans', '400Regular/IBMPlexSans_400Regular.ttf'],
  ['IBM Plex Sans', 'plex-500', 'ibm-plex-sans', '500Medium/IBMPlexSans_500Medium.ttf'],
  ['IBM Plex Sans', 'plex-600', 'ibm-plex-sans', '600SemiBold/IBMPlexSans_600SemiBold.ttf'],
  ['IBM Plex Sans', 'plex-700', 'ibm-plex-sans', '700Bold/IBMPlexSans_700Bold.ttf'],
  ['Source Sans 3', 'source-400', 'source-sans-3', '400Regular/SourceSans3_400Regular.ttf'],
  ['Source Sans 3', 'source-600', 'source-sans-3', '600SemiBold/SourceSans3_600SemiBold.ttf'],
  ['Source Sans 3', 'source-700', 'source-sans-3', '700Bold/SourceSans3_700Bold.ttf'],
  ['Source Serif 4', 'serif-400', 'source-serif-4', '400Regular/SourceSerif4_400Regular.ttf'],
  ['Source Serif 4', 'serif-400i', 'source-serif-4', '400Regular_Italic/SourceSerif4_400Regular_Italic.ttf'],
  ['Source Serif 4', 'serif-600', 'source-serif-4', '600SemiBold/SourceSerif4_600SemiBold.ttf'],
]

/** Plages conservées : latin, latin étendu A et B, ponctuation et symboles usuels d'un CV. */
const RANGES = [
  [0x0020, 0x007e],
  [0x00a0, 0x024f],
  [0x02c6, 0x02dd],
  [0x2010, 0x2027],
  [0x2030, 0x2044],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2190, 0x2193],
  [0x2212, 0x2212],
]
const text = RANGES.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i))).join('')

mkdirSync(outDir, { recursive: true })
const coverage = []
let total = 0

for (const [family, out, pkg, file] of FONTS) {
  const source = readFileSync(require.resolve(`@expo-google-fonts/${pkg}/${file}`))
  const subset = await subsetFont(source, text, { targetFormat: 'sfnt' })
  writeFileSync(resolve(outDir, `${out}.ttf`), subset)
  total += subset.length
  const font = fontkit.create(subset)
  coverage.push({ family, out, cps: new Set(font.characterSet) })
  console.log(`${out.padEnd(16)} ${(source.length / 1024).toFixed(0).padStart(5)} Ko → ${(subset.length / 1024).toFixed(0).padStart(4)} Ko`)
}

// Caractères dessinables par TOUTES les polices : un modèle ou une paire typographique quelconque
// peut être choisi, la garantie doit valoir pour chacun.
const all = [...coverage[0].cps].filter((cp) => coverage.every((c) => c.cps.has(cp))).sort((a, b) => a - b)
const ranges = []
for (const cp of all) {
  const last = ranges[ranges.length - 1]
  if (last && last[1] === cp - 1) last[1] = cp
  else ranges.push([cp, cp])
}

writeFileSync(
  resolve(root, 'src/pdf/glyphs.generated.ts'),
  `// Fichier généré par scripts/build-pdf-fonts.mjs — ne pas modifier à la main.
// Caractères que TOUTES les polices embarquées dans les PDF savent dessiner.
export const PDF_GLYPH_RANGES: ReadonlyArray<readonly [number, number]> = ${JSON.stringify(ranges)}
`,
)
console.log(`\n${coverage.length} fichiers, ${(total / 1024).toFixed(0)} Ko au total ; ${all.length} caractères communs en ${ranges.length} plages.`)
console.log(`${copyFontLicenses()} licences SIL OFL copiées dans src/pdf/fonts/licenses/.`)
