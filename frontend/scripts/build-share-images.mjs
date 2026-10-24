#!/usr/bin/env node
// Génère les images de partage à partir du logo, avec le Chromium de Playwright (déjà installé pour les tests e2e) :
//   public/og-image.png          1200×630  aperçu d'un lien partagé (réseaux sociaux, messageries)
//   public/apple-touch-icon.png   180×180  icône ajoutée à l'écran d'accueil d'un téléphone
//   ../docs/social-preview.png   1280×640  aperçu du dépôt GitHub (à téléverser dans Settings → Social preview)
// Relancer après un changement de logo ou de slogan : node scripts/build-share-images.mjs
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const font = readFileSync(join(frontend, 'node_modules/@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2')).toString('base64')

const NAVY = '#13213d'
const ACCENT = '#1f4fa3'
const SOFT = '#8fb2f4'

const mark = (size, bg, fg, lines) => `
  <svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="${bg}"/>
    <path d="M37.6 19.4A15.5 15.5 0 1 0 37.6 44.6" fill="none" stroke="${fg}" stroke-width="7" stroke-linecap="round"/>
    <path d="M41 26h10M41 32h7M41 38h10" fill="none" stroke="${lines}" stroke-width="4" stroke-linecap="round"/>
  </svg>`

const base = `
  @font-face { font-family: 'Source Sans 3'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 200 900; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; }
  body { font-family: 'Source Sans 3', sans-serif; background: ${NAVY}; color: #fff; display: grid; place-items: center; overflow: hidden; }`

/** Carte d'aperçu : promesse à gauche, CV stylisé avec ses constats d'analyse à droite. */
const card = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${base}
  .card { width: 1200px; height: 630px; padding: 64px 72px; display: grid; grid-template-columns: 1fr 380px; gap: 56px; align-items: center;
          background: radial-gradient(900px 500px at 85% 20%, #1c3160 0%, ${NAVY} 60%); }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 44px; font-weight: 650; letter-spacing: -0.5px; }
  h1 { margin-top: 44px; font-size: 58px; line-height: 1.08; font-weight: 700; letter-spacing: -1.2px; }
  p.sub { margin-top: 22px; font-size: 27px; line-height: 1.35; color: #c9d6f2; }
  ul { margin-top: 34px; display: flex; gap: 12px; padding: 0; list-style: none; }
  li { font-size: 21px; font-weight: 600; padding: 8px 16px; border-radius: 999px; background: rgba(143,178,244,0.16); color: #dbe6ff; }
  .cv { height: 470px; background: #fff; border-radius: 14px; padding: 30px 30px; box-shadow: 0 30px 60px rgba(0,0,0,0.35); color: ${NAVY}; transform: rotate(2deg); }
  .cv .name { height: 18px; width: 58%; background: ${NAVY}; border-radius: 4px; }
  .cv .role { height: 11px; width: 40%; background: ${ACCENT}; border-radius: 4px; margin-top: 12px; }
  .cv .h { height: 10px; width: 34%; background: ${ACCENT}; border-radius: 3px; margin-top: 30px; }
  .cv .l { height: 8px; background: #d9dfeb; border-radius: 3px; margin-top: 11px; }
  .check { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 19px; font-weight: 600; }
  .ok { color: #1d7a46; } .warn { color: #a3620a; }
  .dot { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 15px; font-weight: 800; }
  .ok .dot { background: #1d7a46; } .warn .dot { background: #c27a12; }
</style></head><body><div class="card">
  <div>
    <div class="brand">${mark(64, '#fff', NAVY, ACCENT)}<span>Cuvylo</span></div>
    <h1>Votre CV est-il bien lu par les logiciels de recrutement&nbsp;?</h1>
    <p class="sub">Analysez un CV PDF sans compte, comparez-le à une offre, puis créez vos CV et suivez vos candidatures.</p>
    <ul><li>Gratuit</li><li>Sans IA</li><li>Sans publicité</li><li>Auto-hébergé</li></ul>
  </div>
  <div class="cv" aria-hidden="true">
    <div class="name"></div><div class="role"></div>
    <div class="h"></div><div class="l" style="width:92%"></div><div class="l" style="width:84%"></div><div class="l" style="width:70%"></div>
    <div class="h"></div><div class="l" style="width:88%"></div><div class="l" style="width:76%"></div>
    <div class="check ok"><span class="dot">✓</span>Coordonnées trouvées</div>
    <div class="check ok"><span class="dot">✓</span>Rubriques reconnues</div>
    <div class="check warn"><span class="dot">!</span>« Python » demandé, absent</div>
  </div>
</div></body></html>`

const icon = `<!doctype html><html><head><meta charset="utf-8"><style>${base} body { background: ${NAVY}; }</style></head>
  <body>${mark(132, NAVY, '#fff', SOFT)}</body></html>`

const browser = await chromium.launch()
try {
  const shots = [
    { html: card, width: 1200, height: 630, out: join(frontend, 'public/og-image.png') },
    { html: card, width: 1280, height: 640, out: join(frontend, '../docs/social-preview.png') },
    { html: icon, width: 180, height: 180, out: join(frontend, 'public/apple-touch-icon.png') },
  ]
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 })
    await page.setContent(s.html)
    await page.evaluate('document.fonts.ready') // évalué dans la page : attend la police avant la capture
    await page.screenshot({ path: s.out })
    await page.close()
    console.log(`✓ ${s.out.replace(`${frontend}/`, '')} (${s.width}×${s.height})`)
  }
} finally {
  await browser.close()
}
