# Installation locale

Testée sur macOS avec Node 24, PHP 8.5 et Composer 2.10. Versions minimales visées : **Node 22**, **PHP 8.1**.

## Prérequis

| Outil | Version | Rôle |
|---|---|---|
| Node.js + npm | ≥ 22 | Compiler le frontend (local ou GitHub Codespaces ; **jamais requis en production**) |
| PHP | ≥ 8.1 avec `pdo_sqlite`, `mbstring` | API et tests |
| Composer | 2.x | Installe PHPUnit uniquement (aucune dépendance de production) |

## 1. Backend

```bash
composer install --working-dir=backend
cp .env.example backend/.env
```

Éditez `backend/.env` :

- `APP_ENV=development`
- `APP_URL=http://localhost:5173` (origine servie par Vite : le contrôle `Origin` et les cookies en dépendent)
- `APP_KEY` : générez-la avec la commande ci-dessous et collez le résultat. Ne la partagez ni ne la committez.
- `DB_DSN=sqlite:/chemin/absolu/vers/backend/var/dev.sqlite` (SQLite local ; MySQL en production)

```bash
php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"
mkdir -p backend/var
php backend/bin/migrate.php
php -S 127.0.0.1:8080 backend/bin/dev-router.php
```

> Si `php -S` échoue sur un verrou opcache (environnements sandboxés), ajoutez `-d opcache.enable_cli=0`.

## 2. Frontend

```bash
cd frontend
npm ci
npm run dev
```

Ouvrez <http://localhost:5173>, créez un compte, puis renseignez le profil. Vite proxifie `/api` vers `http://127.0.0.1:8080` (modifiable par `VITE_DEV_API`).

## 3. Vérifier la qualité

```bash
# Frontend
cd frontend
npm run lint
npm run typecheck
npm test
npm run build

# Backend
cd ../backend
php vendor/bin/phpunit
```

Les tests PHP tournent sur SQLite en mémoire, sans serveur. Pour les rejouer sur MySQL : `TEST_DB_DSN="mysql:host=127.0.0.1;port=3307;dbname=cuvylo_test;charset=utf8mb4" TEST_DB_USER=root php vendor/bin/phpunit` (la base n'est jamais vidée : les tests utilisent des comptes uniques).

## Dépannage

| Symptôme | Cause probable |
|---|---|
| `403 Jeton CSRF invalide` en dev | `APP_URL` ne correspond pas à l'origine du navigateur (`http://localhost:5173`) |
| Connexion qui « oublie » la session | `APP_URL` en `https://` en local : le cookie `Secure` n'est pas renvoyé en `http://` |
| `Unable to create opcache lock file` | Ajouter `-d opcache.enable_cli=0` à `php -S` |
| Vitest : `Failed to create Vitest API token` | Sandbox qui interdit d'écrire un fichier au nom contenant « secret » ; lancer hors sandbox |
