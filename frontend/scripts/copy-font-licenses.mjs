// Copie la licence SIL OFL 1.1 de chaque famille de polices embarquée dans les PDF à côté des fichiers
// sous-ensemblés (src/pdf/fonts/licenses/). L'OFL exige que sa licence accompagne les polices redistribuées.
//
//   node scripts/copy-font-licenses.mjs      (appelé aussi par scripts/build-pdf-fonts.mjs)
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'src/pdf/fonts/licenses')

export const FONT_PACKAGES = ['inter', 'newsreader', 'bricolage-grotesque', 'jetbrains-mono', 'ibm-plex-sans', 'source-sans-3', 'source-serif-4']

export function copyFontLicenses() {
  mkdirSync(out, { recursive: true })
  for (const pkg of FONT_PACKAGES) {
    copyFileSync(require.resolve(`@expo-google-fonts/${pkg}/LICENSE_FONT`), resolve(out, `${pkg}-OFL.txt`))
  }
  return FONT_PACKAGES.length
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`${copyFontLicenses()} licences de polices copiées dans src/pdf/fonts/licenses/.`)
}
