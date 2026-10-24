# Guide de déploiement — hébergement mutualisé

> **En bref :** créer une base MySQL, envoyer deux dossiers par FTP, ouvrir le site. Un assistant d'installation (comme celui de WordPress) fait le reste : vérification de l'hébergement, test de la base, tables, compte administrateur et configuration. Aucun fichier à éditer.
>
> Testé sur un mutualisé classique (Apache, PHP 8.5, MySQL, pare-feu ModSecurity). Les points marqués **[À VÉRIFIER]** dépendent de l'offre d'hébergement.

## 0. Prérequis

| À avoir | Où le trouver (espace client de l'hébergeur) |
|---|---|
| PHP 8.1 ou plus (extensions `pdo_mysql`, `mbstring`, `openssl`) | Configuration de l'hébergement ; l'assistant le vérifie de toute façon |
| Une base MySQL | Rubrique « Bases de données » |
| Le domaine en **HTTPS** (certificat actif) | Rubrique des domaines ou des certificats SSL. Sans certificat valide pour ce nom précis (sous-domaine compris), le navigateur refuse le site (`ERR_CERT_COMMON_NAME_INVALID`) : activez-le et attendez sa génération |
| Un accès FTP | Rubrique « FTP » |

Ni SSH, ni Composer, ni Node ne sont nécessaires sur le serveur.

## 1. Obtenir le paquet

**Le plus simple :** téléchargez `cuvylo-<version>.zip` sur la page [Releases](https://github.com/Hadr1en/cuvylo/releases/latest) du dépôt (empreinte SHA-256 fournie à côté) et décompressez-le : c'est le dossier `release/` décrit ci-dessous, avec un mode d'emploi `INSTALLATION.txt`. Rien à installer sur votre poste.

**Ou le construire vous-même** (en local, Codespaces ou GitHub Actions) :

```bash
npm ci --prefix frontend
node scripts/package-release.mjs      # construit le frontend et assemble release/
```

`release/` contient tout ce qui part sur le serveur, et rien d'autre :

| Dossier | Destination | Contenu |
|---|---|---|
| `release/www/` | contenu du dossier du site (`www/`) | SPA, `.htaccess` (repli SPA, type MIME du worker pdf.js, en-têtes), `api/index.php` |
| `release/cuvylo/` | `~/cuvylo/` (hors racine web) | `src/`, `migrations/`, `bin/`, `env.example` ; **pas** de `.env` : l'assistant l'écrit |
| `release/INSTALLATION.txt` | (à lire) | Mode d'emploi résumé ; les fichiers commençant par un point sont masqués par le Finder et l'Explorateur, mais indispensables |
| `release/MANIFEST.txt` | (à garder) | Version, commit, SHA-256 de chaque fichier : utile pour repérer un envoi FTP incomplet |

Pas de fichiers précompressés (`.br`, `.gz`) : sur certains mutualisés, le serveur les recompressait et le navigateur ne pouvait plus les lire (page blanche, `ERR_CONTENT_DECODING_FAILED`). La compression est laissée à l'hébergeur. Pas de fichier de configuration propre à un hébergeur non plus : il écraserait la version de PHP choisie dans l'espace client.

## 2. Base de données

Espace client de l'hébergeur → rubrique « Bases de données » → **créer une base** MySQL. Gardez la page ouverte : l'assistant demandera l'**adresse du serveur** (sur un mutualisé, rarement `localhost`), le **nom de la base**, l'**utilisateur** (souvent identiques) et son **mot de passe**, modifiable au même endroit. La base peut rester vide.

## 3. Arborescence cible

```
~/                         (racine FTP)
├─ cuvylo/              ← code PHP, HORS racine web
│  ├─ src/   migrations/   bin/
│  └─ .env                 ← écrit par l'assistant (secrets), jamais dans www/
└─ www/                    ← dossier du site (souvent www/ ou public_html/, ou celui choisi pour le domaine)
   ├─ index.html  assets/  .htaccess      ← contenu de frontend/dist/
   └─ api/                                 ← contenu de backend/public/ (index.php, .htaccess)
```

Copie : le **contenu** de `release/www/` → dans le dossier du site · le dossier `release/cuvylo/` → à la racine FTP, à côté. Avec un client FTP graphique (FileZilla…) ou `scripts/deploy-ftp.sh` (§6). **Ne téléversez jamais** `backend/vendor`, `backend/tests`, `backend/var`, ni un `.env` de développement.

`www/api/index.php` cherche `cuvylo/` à côté du dossier du site, un niveau plus haut, puis dans le dossier du site. S'il ne le trouve pas, l'API répond `code_missing` et l'écran d'installation explique où le déposer.

### 3-bis. Repli si PHP ne peut pas lire hors du dossier du site (`open_basedir`)

Placez `cuvylo/` **dans** le dossier du site (`www/cuvylo/`) : il est trouvé automatiquement, et l'assistant y écrit un `.htaccess` `Require all denied`. Vérifiez ensuite que `https://votre-domaine/cuvylo/.env` renvoie **403**.

## 4. Installation (assistant)

Ouvrez `https://votre-domaine/`. Tant que `cuvylo/.env` n'existe pas, l'API ne sert que l'assistant, et le site affiche :

1. **Vérifications** : version de PHP, extensions, droit d'écriture dans `cuvylo/`.
2. **Base de données** : serveur, nom, utilisateur, mot de passe. « Tester et continuer » essaie la connexion et dit précisément ce qui ne va pas (mot de passe refusé, base inconnue, serveur injoignable), sans jamais afficher le message technique du pilote.
3. **Votre compte** : e-mail et mot de passe de l'administrateur.
4. **Le site** : adresse (pré-remplie, https obligatoire), éditeur, e-mail de contact et hébergeur pour les pages légales ; envoi d'e-mails « Mot de passe oublié » (SMTP) en option.

« Installer Cuvylo » crée les tables, le compte administrateur et son profil, génère la clé `APP_KEY`, écrit `cuvylo/.env` (droits `0600`) puis vous connecte dans l'administration. Si PHP ne peut pas écrire dans `cuvylo/`, l'assistant affiche le contenu du fichier à déposer vous-même par FTP. Si la base contient déjà des comptes (fichier `.env` perdu), elle est reconnectée sans créer de compte.

**Faites l'installation juste après l'envoi des fichiers** : comme pour WordPress, tant qu'elle n'est pas faite, la première personne qui ouvre le site verrait l'assistant. Les tentatives sont limitées (30 par heure) et les écritures exigent la même origine ; l'assistant disparaît dès que `.env` existe. Si quelqu'un vous a devancé (l'assistant ne s'affiche plus alors que vous ne l'avez pas rempli), supprimez `cuvylo/.env` par FTP et recommencez.

### 4-bis. Configuration à la main (facultatif)

Pour tout régler vous-même, ou modifier un réglage après l'installation, éditez `~/cuvylo/.env`. Chaque réglage est expliqué dans [`.env.example`](../.env.example) :

   - `APP_ENV=production`, `APP_URL=https://votre-domaine` (sans slash final)
   - `APP_KEY` : 32 octets aléatoires en base64, générés **sur votre poste** (`php -r "echo base64_encode(random_bytes(32));"`) ; ne jamais réutiliser la clé de développement
   - `DB_DSN`, `DB_USER`, `DB_PASSWORD`
   - `LOG_PATH` : un fichier **hors `www/`** (l'assistant choisit `cuvylo/var/log/cuvylo-{month}.log`, un fichier par mois) ; vous vous engagez (page Confidentialité) à ne pas conserver les journaux plus de 12 mois : supprimez les fichiers plus anciens
   - **Informations légales** (pages `/mentions-legales`, `/confidentialite`, `/securite`) :
     - `LEGAL_PUBLISHER` : votre nom, ou vide si vous restez anonyme comme particulier (vos coordonnées sont alors connues de votre hébergeur, LCEN art. 6-III-2) ;
     - `LEGAL_CONTACT_EMAIL` : adresse où vos amis peuvent exercer leurs droits (accès, suppression…) ;
     - `LEGAL_HOST` : coordonnées **officielles** de votre hébergeur, recopiées depuis ses propres mentions légales (raison sociale, adresse, téléphone) ;
     - `SECURITY_CONTACT_EMAIL` (facultatif) : publié dans `/.well-known/security.txt`.
   - `SETUP_CODE` : seulement si vous écrivez `.env` vous-même avant toute installation : un code d'au moins 16 caractères, demandé ensuite par l'écran de création du premier compte ;
   - `ADMIN_EMAILS` (facultatif) : administrateurs supplémentaires ; le compte créé à l'installation l'est déjà ;
   - **Envoi d'e-mails** (mot de passe oublié) — n'importe quel fournisseur SMTP convient :
     - `MAIL_TRANSPORT=smtp`, `MAIL_FROM` (une adresse de votre domaine), `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, et `SMTP_SECURE=ssl` (port 465) ou `starttls` (port 587). Exemples : la boîte e-mail incluse avec l'hébergement (serveur SMTP indiqué dans l'espace client, souvent port 465), Gmail ou Google Workspace (mot de passe d'application), Brevo, Mailgun, Postmark ;
     - `MAIL_TRANSPORT=mail` : la fonction `mail()` de PHP, si l'hébergement la fournit (souvent le cas en mutualisé ; délivrabilité moindre) ;
     - vide : pas d'envoi ; « Mot de passe oublié » passe alors par l'administrateur.

     Pour éviter les indésirables, utilisez une adresse de votre domaine et vérifiez que SPF (et si possible DKIM) autorisent le serveur d'envoi. Testez : « Mot de passe oublié » sur votre propre compte ;
   - `USER_STORAGE_LIMIT_MB` : quota par compte (25 Mo par défaut, largement assez pour des dizaines de CV).

   Une erreur dans ce fichier est écrite dans le journal d'erreurs de l'hébergeur sous la forme `cuvylo: configuration invalide — <réglage fautif>` (jamais sa valeur), ou `cuvylo: base de données injoignable (access_denied…)`.

### 4-ter. Après l'installation

1. **Schéma de base : rien à faire, même lors des mises à jour.** À la première requête, l'application compare ses migrations au marqueur `~/cuvylo/var/schema.version` et applique ce qui manque, sous verrou MySQL (`GET_LOCK`) : deux visiteurs simultanés ne lancent pas deux migrations. En cas d'échec, l'API répond 503 « maintenance » et l'erreur est journalisée (sans le SQL). Avec SSH, `php ~/cuvylo/bin/migrate.php` reste possible.
2. **Qui peut créer un compte** : l'analyse d'un CV est ouverte à tous, sans compte. Pour les comptes, **Administration → Inscriptions ouvertes** laisse chacun s'inscrire ; fermé (par défaut), invitez chacun depuis **Administration → Inviter** : un lien nominatif à usage unique, valable quelques jours. Ce réglage, enregistré en base, l'emporte sur `REGISTRATION_ENABLED`.
3. **Ce que voit l'administrateur** : comptes, espace utilisé, nombre de CV, invitations ; il peut déconnecter ou supprimer un compte. Il ne voit pas le contenu des CV et ne télécharge pas la base depuis l'interface. **Mot de passe oublié** : avec l'envoi d'e-mails configuré, la personne reçoit directement un lien (1 h) ; sinon (ou si l'envoi échoue), sa demande apparaît dans l'administration et c'est seulement alors que l'administrateur peut générer un lien (24 h) à lui transmettre.

## 5. Contrôles après déploiement

> Le pare-feu applicatif de nombreux mutualisés (ModSecurity) répond **403** à toute requête dont l'identifiant contient « curl » : en ligne de commande, ajoutez `-A "Mozilla/5.0"`, sinon le 403 ne dit rien de votre installation. Il refuse aussi les méthodes `PUT` et `DELETE` : l'interface les envoie donc en `POST` avec `X-HTTP-Method-Override` (depuis la 2.1.1). Un 403 en HTML (et non en JSON) vient toujours de ce pare-feu : le journal d'erreurs indique la règle (`ModSecurity: Access denied …`).

| Contrôle | Attendu |
|---|---|
| `curl -s -A "Mozilla/5.0" https://domaine/api/health` | `{"status":"ok"}` |
| `https://domaine/profil` (rechargement direct) | L'application s'affiche (repli SPA) |
| `https://domaine/cuvylo/.env`, `…/api/.env`, `…/migrations/001_init.sql` | 403 ou 404 |
| Création de compte → profil → CV → export PDF | PDF téléchargé, texte sélectionnable |
| Console du navigateur | Aucune erreur de worker pdf.js (type MIME du `.mjs`) |
| Cookies | `__Host-cuvylo_session` : `Secure`, `HttpOnly`, `SameSite=Lax` |
| Rapports CSP (mode « Report-Only » dans `www/.htaccess`) | Aucune violation → passer l'en-tête en `Content-Security-Policy` |
| `Strict-Transport-Security` | À activer (ligne commentée) une fois HTTPS confirmé |
| `https://domaine/mentions-legales` | Éditeur, contact et hébergeur renseignés (aucun encadré « Configuration incomplète ») |
| `https://domaine/.well-known/security.txt` | Redirection vers `/api/security-txt`, contenu `text/plain` avec `Contact:` et `Expires:` |
| Inscription sans invitation | Refusée tant que « Inscriptions ouvertes » est désactivé dans l'administration |
| `https://domaine/` sans être connecté | Page publique d'analyse d'un CV |
| Lien d'invitation (`/invitation/…`) | Création de compte possible une seule fois |
| Console du navigateur, au chargement | Aucune erreur `ERR_CONTENT_DECODING_FAILED` (supprimez d'éventuels `.br`/`.gz` laissés par la version 2.0.0) |
| Page Administration | Visible pour le compte créé à l'installation et `ADMIN_EMAILS` seulement ; métadonnées des comptes, aucun contenu de CV, pas de téléchargement de la base |
| Cookies (HTTPS) | Préfixe `__Host-` (`__Host-cuvylo_session`, `__Host-cuvylo_csrf`) |

## 6. Mises à jour sans SSH

1. **Sauvegarde** d'abord (§7).
2. Zip de la nouvelle version (page Releases), ou `node scripts/package-release.mjs`
3. Envoi, au choix :
   - **Script** (FTPS, avec [lftp](https://lftp.yar.ru/)) : `FTP_HOST=… FTP_USER=… FTP_PASSWORD=… scripts/deploy-ftp.sh`. Commencez par `DRY_RUN=1` pour voir ce qui serait envoyé. Le script dépose `~/cuvylo/MAINTENANCE` (l'API répond 503 et l'interface l'annonce), synchronise le code puis la racine web, et retire le fichier. `.env` et `var/` ne sont jamais touchés.
   - **GitHub Actions** : workflow « Déploiement FTP (manuel) », déclenché à la main uniquement, en simulation par défaut. Secrets `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD` dans l'environnement `production` (ajoutez-y une validation manuelle).
   - **À la main** : créez un fichier vide `~/cuvylo/MAINTENANCE`, copiez `release/cuvylo/` puis `release/www/`, supprimez `MAINTENANCE`.
4. La migration éventuelle s'applique à la première requête (§4-ter). Contrôlez `/api/health` et la connexion.

> `mirror --delete` supprime dans `www/` ce qui n'est pas dans le paquet : n'y laissez rien d'autre que Cuvylo.

## 7. Sauvegarde et restauration

- **Base** : export SQL depuis l'espace client de l'hébergeur (rubrique Bases de données) ou phpMyAdmin ; avec SSH, `php ~/cuvylo/bin/backup.php > sauvegarde.sql` produit un export complet relisible à l'identique. La sauvegarde n'est volontairement pas téléchargeable depuis l'interface d'administration. Conservez-la hors de l'hébergement et **chiffrée** : elle contient les CV et les empreintes de mots de passe.
- **Configuration** : copie hors ligne de `~/cuvylo/.env` (contient `APP_KEY` et les accès base). Perdre ou changer `APP_KEY` invalide les sessions et jetons CSRF en cours et rend illisibles les secrets de double authentification : il faut alors les effacer en base (`UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_recovery = NULL`), chacun la réactivera.
- **Utilisateurs** : chacun peut exporter toutes ses données (page Compte) ou son profil (page Profil).
- **Restauration** : importer l'export SQL dans une base vide, restaurer `.env`, relancer les contrôles du §5. Testez cette procédure **avant** d'en avoir besoin.

## 8. Retour arrière

Les migrations sont à sens unique. Pour revenir en arrière : restaurer la sauvegarde de base prise avant la migration **et** remettre en place la version précédente de `src/` et de `dist/`.
