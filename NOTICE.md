Required Notice: Copyright (c) 2026 Hadr1en (https://github.com/Hadr1en)

# Licence de Cuvylo

Cuvylo est distribué sous la **[PolyForm Noncommercial License 1.0.0](LICENSE.md)** (texte officiel, en anglais, qui seul fait foi).

En résumé, sans valeur juridique :

| Vous pouvez | Vous ne pouvez pas |
|---|---|
| Installer Cuvylo pour vous, votre famille, vos amis, une association, une école, une collectivité | Vendre Cuvylo, le proposer comme service payant ou l'utiliser dans le cadre d'une activité commerciale |
| Lire, modifier et redistribuer le code, y compris vos versions modifiées | Retirer la licence ou la ligne `Required Notice` ci-dessus des copies que vous distribuez |
| L'utiliser pour apprendre, tester, expérimenter | Accorder à d'autres des droits que vous n'avez pas (pas de sous-licence) |

Une licence « non commerciale » n'est **pas** une licence open source au sens de l'Open Source Initiative : le code est ouvert à la lecture et aux contributions, mais son usage commercial est réservé. Pour un usage commercial, contactez l'auteur.

Celui qui installe une instance en est l'exploitant : il est responsable de sa configuration, de son hébergement et des données de ses utilisateurs (voir [SECURITY.md](SECURITY.md)).

## Composants tiers

Cuvylo s'appuie sur des composants distribués sous leurs propres licences, qui restent applicables :

| Composant | Licence |
|---|---|
| Polices embarquées dans les PDF (Inter, Newsreader, Bricolage Grotesque, JetBrains Mono, IBM Plex Sans, Source Sans 3, Source Serif 4), sous-ensembles dans `frontend/src/pdf/fonts/` | SIL Open Font License 1.1 — textes et copyrights dans `frontend/src/pdf/fonts/licenses/` |
| Police de l'interface (Source Sans 3, via `@fontsource-variable/source-sans-3`) | SIL Open Font License 1.1 |
| React, React Router, Vite, Tailwind CSS, zod, `@react-pdf/renderer`, `docx`, `fflate`, `uqr` | MIT |
| `pdfjs-dist` (pdf.js) | Apache 2.0 |
| Outils de développement et de test (TypeScript, ESLint, Vitest, Playwright, PHPUnit…) | Licences respectives (non distribués avec l'application) |

Les textes complets de ces licences accompagnent chaque paquet (`node_modules/<paquet>/LICENSE`, `vendor/`).
