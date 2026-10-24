# Tests de bout en bout (Playwright)

Ils pilotent un **vrai Chromium** sur le **build de production** (`vite preview`), contre l'**API PHP réelle** et une base **MySQL** : rien n'est simulé. Ils vérifient en particulier les fichiers PDF réellement téléchargés, relus avec pdf.js.

## Ce qui est couvert (21 scénarios + installation)

| Fichier | Scénarios |
|---|---|
| `global-setup.ts` | Sur une base neuve : **installation** par `/api/setup` (code `SETUP_CODE`), création du compte administrateur ; sinon, simple inscription de ce compte |
| `journey.spec.ts` | **Parcours principal** : inscription → profil (autosauvegarde, rechargement) → création du CV → aperçu → **export PDF** (fichier valide, une page, texte extractible, pas de lettres espacées) → renommage persistant ; atelier : dupliquer, supprimer |
| `pdf.spec.ts` | **Les 18 modèles** exportent un PDF valide au texte extractible ; le modèle choisi est celui du fichier ; **saut de page forcé** (page 2 commence par « Formation ») ; rubrique masquée absente du PDF ; ordre des rubriques = ordre de lecture |
| `auth.spec.ts` | Pages protégées → connexion ; mot de passe erroné (message neutre, identique pour un compte inconnu) ; **déconnexion qui invalide un cookie copié** ; e-mail déjà inscrit ; mot de passe trop court ; **isolation entre utilisateurs** (404 sur lecture, versions, suppression) |
| `offer-ats-versions.spec.ts` | Fiche de poste → présent/absent, pistes **sans invention**, création d'une version adaptée ; analyse ATS (constats, texte lu dans le PDF) ; version nommée puis restaurée |
| `legal-account.spec.ts` | Mentions légales, confidentialité et sécurité alimentées par la configuration ; `security.txt` ; export complet puis suppression du compte |
| `forgotten.spec.ts` | **Mot de passe oublié** : lien reçu par e-mail (transport `file`, relu depuis le fichier `.eml`), nouveau mot de passe, connexion, e-mail de confirmation |
| `admin.spec.ts` | **Administration restreinte** : métadonnées seulement, aucun contenu de CV, pas de sauvegarde, pas de lien de réinitialisation sans demande de l'utilisateur |

Non couvert ici : la limitation des tentatives de connexion (limite par IP partagée par tous les tests : elle est testée dans PHPUnit) et le rendu visuel au pixel près.

## Lancer en local

1. **MySQL** sur le port 3307 (exemple Homebrew) :

   ```bash
   mysqld --initialize-insecure --datadir=backend/var/mysql      # une seule fois
   mysqld --datadir=backend/var/mysql --bind-address=127.0.0.1 --port=3307 --mysqlx=OFF --socket=/tmp/cuvylo-mysql.sock
   ```

   `--initialize-insecure` crée `root` sans mot de passe : acceptable uniquement pour un serveur local lié à `127.0.0.1`.

2. **Navigateur** (une fois) puis tests :

   ```bash
   cd frontend
   npm run e2e:install
   npm run e2e
   ```

Playwright démarre lui-même l'API PHP (port 8081) et le build servi (port 5174). La base `cuvylo_e2e` est créée au besoin et migrée par `backend/bin/e2e-prepare.php` ; **elle n'est jamais vidée ni supprimée** : chaque test crée ses propres comptes (e-mails uniques), donc les relances successives sont sans effet de bord.

| Variable | Défaut |
|---|---|
| `E2E_DB_DSN` | `mysql:host=127.0.0.1;port=3307;dbname=cuvylo_e2e;charset=utf8mb4` |
| `E2E_DB_USER` / `E2E_DB_PASSWORD` | `root` / (vide) |
| `E2E_API_PORT` / `E2E_WEB_PORT` | `8081` / `5174` |

## Captures d'écran du README

```bash
cd frontend
npm run screenshots      # même environnement que les tests e2e ; MySQL local requis
```

Le script `e2e/screenshots/readme.spec.ts` crée un compte jetable avec le profil fictif « Camille Exemple », puis régénère `docs/screenshots/*.jpg` en haute résolution (clair, sombre, mobile, les 18 modèles, galerie). Aucune donnée réelle n'est utilisée ; ne jamais lancer ce script avec un vrai profil.

## Rapports de panne

En cas d'échec : capture d'écran et trace dans `frontend/test-results/` (`npx playwright show-trace <fichier>.zip`). Sur GitHub Actions, le job `e2e` joint le rapport en artefact.

## Notes

- Les tests s'exécutent en série (un seul worker) : la génération de PDF est coûteuse et les comptes sont partagés dans une même base.
- Le PDF se régénère 400 ms après la dernière modification ; `settlePreview()` attend ce délai plutôt que de deviner.
- Les mots de passe des tests sont des valeurs jetables pour des comptes locaux ; la clé applicative de test est factice.