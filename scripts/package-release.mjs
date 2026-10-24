#!/usr/bin/env node
// Prépare un paquet de déploiement pour un hébergement mutualisé (FTP + MySQL, sans SSH).
//
//   node scripts/package-release.mjs            # construit le frontend puis assemble release/
//   node scripts/package-release.mjs --no-build # réutilise frontend/dist/ existant
//
// Résultat (rien n'est envoyé nulle part) :
//   release/
//   ├─ www/             → contenu du dossier du site (racine web) : SPA + api/index.php + .htaccess
//   ├─ cuvylo/          → à côté du dossier du site (HORS racine web) : src/ migrations/ bin/
//   ├─ INSTALLATION.txt → mode d'emploi (scripts/INSTALLATION.txt)
//   └─ MANIFEST.txt     → version, date, empreintes SHA-256 de chaque fichier
//
// Aucune configuration : à la première visite, l'assistant d'installation l'écrit lui-même (cuvylo/.env).
// Ni fichiers précompressés (.br/.gz, recompressés par certains hébergeurs : page blanche) ni fichier de configuration d'hébergeur (il écraserait la
// version de PHP choisie dans le Manager) : l'assistant vérifie la version de PHP.
//
// Le workflow .github/workflows/release.yml en fait un zip publié sur la page Releases (tag vX.Y.Z).
//
// Jamais copiés : .env, vendor/, tests/, var/, sources du frontend.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'release')
const build = !process.argv.includes('--no-build')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

if (build) {
  console.log('Construction du frontend…')
  execFileSync('npm', ['run', 'build', '--prefix', join(root, 'frontend')], { stdio: 'inherit' })
}
const dist = join(root, 'frontend', 'dist')
if (!existsSync(join(dist, 'index.html'))) {
  console.error('frontend/dist/ est absent : lancez sans --no-build.')
  process.exit(1)
}

// Le dossier release/ est à nous : on le recrée à chaque paquet.
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// 1. Racine web : SPA + point d'entrée de l'API.
cpSync(dist, join(out, 'www'), { recursive: true })
cpSync(join(root, 'backend', 'public'), join(out, 'www', 'api'), { recursive: true })

// 2. Code PHP hors racine web.
for (const dir of ['src', 'migrations', 'bin']) {
  cpSync(join(root, 'backend', dir), join(out, 'cuvylo', dir), { recursive: true })
}
// Outils de développement inutiles (et risqués) en production.
for (const f of ['bin/dev-router.php', 'bin/e2e-prepare.php']) rmSync(join(out, 'cuvylo', f), { force: true })
cpSync(join(root, 'backend', 'env.example'), join(out, 'cuvylo', 'env.example'))

// 3. Licence (PolyForm Noncommercial), mention de copyright et licences des polices : elles accompagnent toute copie.
cpSync(join(root, 'LICENSE.md'), join(out, 'cuvylo', 'LICENSE.md'))
cpSync(join(root, 'NOTICE.md'), join(out, 'cuvylo', 'NOTICE.md'))
cpSync(join(root, 'frontend', 'src', 'pdf', 'fonts', 'licenses'), join(out, 'cuvylo', 'font-licenses'), { recursive: true })

// 4. Mode d'emploi pour qui télécharge le paquet (zip de la page Releases).
const version = JSON.parse(readFileSync(join(root, 'frontend', 'package.json'), 'utf8')).version
writeFileSync(join(out, 'INSTALLATION.txt'), readFileSync(join(root, 'scripts', 'INSTALLATION.txt'), 'utf8').replaceAll('{{VERSION}}', version))

// 5. Manifeste : ce qui a été empaqueté, pour vérifier un envoi FTP incomplet.
let commit = 'inconnu'
try {
  commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  /* hors dépôt git */
}
const files = walk(out).filter((f) => !f.endsWith('MANIFEST.txt'))
const lines = files.map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(out, f)}`).sort((a, b) => a.slice(66).localeCompare(b.slice(66)))
writeFileSync(join(out, 'MANIFEST.txt'), `Cuvylo ${version} (${commit}) — ${new Date().toISOString()}\n\n${lines.join('\n')}\n`)

console.log(`\nPaquet prêt dans release/ : ${files.length} fichiers.`)
console.log('Étapes suivantes : release/INSTALLATION.txt (ou docs/deploiement.md).')
