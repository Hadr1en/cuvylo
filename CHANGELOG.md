# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versionnage sémantique à partir de la 1.0.

## [2.3.1] — 2026-10-24

- Guide de contribution (`CONTRIBUTING.md`), code de conduite (`CODE_OF_CONDUCT.md`), modèles d'issues, signalement privé des failles par GitHub.
- Aperçu des liens partagés : image, titre et description (Open Graph), icône d'écran d'accueil ; `robots.txt` laisse les réseaux sociaux lire la page d'accueil (l'API et les CV partagés restent exclus, les pages restent en `noindex`).

## [2.3.0] — 2026-10-24

### Ajouté
- Lien « Cuvylo · code source » dans le pied de page de toutes les pages : chaque instance indique d'où vient le logiciel.
- **Administration → « Inscriptions ouvertes »** : un interrupteur ouvre les inscriptions à tous ou les réserve aux invitations, sans éditer `.env`. Le réglage est enregistré en base (migration `004_settings`, appliquée automatiquement) et l'emporte sur `REGISTRATION_ENABLED`.

### Changé
- Documentation et textes de l'assistant indépendants de tout hébergeur : on parle d'« hébergement mutualisé » et d'« espace client ». Le guide devient [docs/deploiement.md](docs/deploiement.md) ; le workflow manuel s'appelle « Déploiement FTP (manuel) ».
- README réécrit pour une présentation publique ; le dépôt ne garde que la documentation utile aux utilisateurs et aux contributeurs (déploiement, sécurité, installation locale, tests).

### Corrigé
- **Partage : le destinataire ne reçoit que ce que le PDF montre.** Les rubriques masquées, les entrées non affichées et la photo désactivée ne sont plus transmises. En mode anonyme, l'anonymisation serveur applique exactement la politique du navigateur : initiales, coordonnées, mentions personnelles, adresse ramenée à la ville, liens de projets, publications et certifications retirés, nom et téléphone effacés des textes libres. Le titre public est neutre (« Dossier de compétences »). Un test de parité PHP/TypeScript garantit des sorties identiques, et les liens existants sont filtrés à la lecture.
- **Enregistrement : `flush()` est une vraie barrière.** Il attend l'envoi en cours et la file, puis échoue explicitement si le document n'est pas enregistré (échec, conflit, saisie invalide). Créer une version, une copie adaptée ou un partage s'arrête alors avec la raison, au lieu de partir de l'ancien état.
- **Comparaison à une offre** : les rubriques masquées ne comptent plus. Sur un PDF analysé, la comparaison porte sur tout le texte extrait, et non plus sur un brouillon plafonné à 4 000 caractères par bloc, sans la mention trompeuse « seulement dans les compétences ».
- **Lettres** : récupération du brouillon local après une coupure, résolution d'un conflit entre onglets (garder sa version ou reprendre celle enregistrée).
- **Partages expirés** : leur contenu est effacé dès la première utilisation du site qui suit l'expiration ; la politique de confidentialité le précise.
- Page Sécurité : lien `security.txt` direct par l'API (certains hébergeurs réservent `/.well-known`) ; `robots.txt` réel.
- Analyse d'un PDF : seul le lecteur pdf.js est chargé (sans le générateur, environ 445 Ko compressés de moins), plafond de 10 pages, bouton « Annuler », encadré « À faire en priorité » en tête du résultat ; mention « sur invitation » annoncée dès le titre de l'encart des comptes.
- Export d'un CV anonymisé : nom de fichier neutre.

### Retiré
- Import des sauvegardes de profil JSON au format antérieur à la 2.0 (seul le format `cuvylo-profile` est reconnu).

## [2.2.0] — 2026-10-24

### Ajouté
- **Analyse ATS sans compte** : la page d'accueil d'un visiteur (`/` sans session, `/analyser`) analyse un CV PDF comme dans l'application, puis le compare à une offre collée (le texte importé du PDF sert de contenu). Rien n'est envoyé au serveur. Un site pas encore installé mène toujours à l'assistant.
- Engagements affichés : gratuit, sans compte pour l'analyse, fichier qui ne quitte pas le navigateur, ni publicité ni e-mail collecté ; les comptes servent à créer des CV et suivre ses candidatures. Bouton « Créer un compte » seulement si les inscriptions sont ouvertes (sinon : comptes sur invitation).
- Écran de connexion : lien « Analyser un PDF sans compte » ; textes et politique de confidentialité précisés (service gratuit, e-mail utilisé uniquement pour la connexion et la réinitialisation, ni publicité ni newsletter).

## [2.1.1] — 2026-10-24

### Corrigé
- **Impossible d'enregistrer le profil sur certains mutualisés** (403 du pare-feu applicatif ModSecurity, qui refuse les requêtes `PUT` et `DELETE`) : l'interface envoie ces requêtes en `POST` avec l'en-tête `X-HTTP-Method-Override`, que le serveur applique (seulement depuis un `POST`, seulement vers `PUT`, `PATCH` ou `DELETE`, protection CSRF inchangée). Concerne aussi la modification et la suppression des CV, lettres, candidatures, partages et sessions.
- Un refus du pare-feu de l'hébergeur (403 non JSON) affiche désormais un message explicite au lieu d'une erreur générique.

## [2.1.0] — 2026-10-24

Installation « à la WordPress » : plus aucun fichier à éditer sur un hébergement mutualisé.

### Ajouté
- **Assistant d'installation** (`/installation`, servi tant que `cuvylo/.env` n'existe pas) : vérification de l'hébergement (PHP, extensions, droits), test de la base MySQL avec une cause claire en cas d'échec (accès refusé, base inconnue, serveur injoignable, extension manquante), compte administrateur, informations légales, envoi d'e-mails facultatif. Il crée les tables, génère `APP_KEY`, écrit `.env` (droits 0600) et connecte l'administrateur. Si le dossier n'est pas modifiable, il affiche le fichier à déposer ; une base qui contient déjà des comptes est reconnectée sans en créer.
- `api/index.php` trouve `cuvylo/` à côté du dossier du site, un niveau plus haut ou dedans ; sinon l'API répond `code_missing` et l'écran d'installation explique où le déposer.
- Journal d'erreurs lisible : `cuvylo: configuration invalide — <réglage>` ou `cuvylo: base de données injoignable (<cause>)`, jamais de valeur secrète.

### Corrigé
- **Page blanche sur certains mutualisés** (`ERR_CONTENT_DECODING_FAILED`) : le paquet ne contient plus de fichiers précompressés `.br`/`.gz`, que le serveur recompressait.
- Le paquet ne contient plus de fichier de configuration propre à un hébergeur, qui imposait PHP 8.3 et écrasait la version choisie dans l'espace client.
- Fichiers cachés (`.env`…) refusés aussi par le `.htaccess` du dossier du site.

### Documentation
- `INSTALLATION.txt` en trois étapes ; guide de déploiement réécrit (assistant, certificat SSL, pare-feu de l'hébergeur qui refuse `curl` sans identifiant de navigateur, journal d'erreurs).

## [2.0.0] — 2026-10-24

Première version publiée : paquet d'installation `cuvylo-2.0.0.zip` sur la page Releases du dépôt GitHub (mode d'emploi `INSTALLATION.txt` inclus).

### Ajouté
- **Nom Cuvylo** et logo (`docs/logo/`, favicon) ; dépôt GitHub `Hadr1en/cuvylo`, cookies, clés locales, espace de noms PHP (`Cuvylo\`), dossier serveur (`~/cuvylo`, `CUVYLO_HOME`).
- **Nouvelle identité visuelle « Marine »** : navigation latérale marine, surfaces blanches, une seule couleur d'action, Source Sans 3 ; thème sombre complet ; listes en tableaux, dialogues natifs (`<dialog>`), notifications annulables.
- **Données v2** : missions clients sous une expérience, activités en parallèle, dates « année seule », compétences par expérience, projets, distinctions, publications et interventions, centres d'intérêt, rubriques libres (10), photo facultative (recadrée, métadonnées supprimées), informations complémentaires. Migration v1 → v2 automatique et sans perte (PHP et TypeScript).
- **10 nouveaux modèles** (18 au total) : Consultant, Direction, Médias, Ingénierie, Académique, Européen, Grille, Encre, Barre latérale, Dossier de compétences (matrice compétence × durée, calculée sans double compte des périodes). Paires typographiques au choix, intitulés en anglais, photo, anonymisation, **ajustement automatique à 1 ou 2 pages** avec plancher de lisibilité.
- **Exports** : PDF une colonne pour les modèles à deux colonnes, Word (.docx), texte brut, JSON Resume.
- **Partage par lien** (instantané figé, expiration, révocation, QR code généré localement, page publique non indexée).
- **Candidatures** (statut, CV envoyé, relances) et **lettres de motivation** assorties au CV, avec aperçu PDF.
- **Relecture du style** en français (formulations faibles, temps mélangés, nominalisations, mots vagues…) : signale, ne réécrit jamais.
- **Comparaison de versions** ; versions typées (manuelle, automatique, avant restauration).
- **Compte** : changement de mot de passe, sessions ouvertes, double authentification TOTP avec codes de secours, espace utilisé.
- **Administration** (`ADMIN_EMAILS`) : comptes, invitations nominatives à usage unique (`/invitation/…`), liens de réinitialisation (`/reinitialisation/…`), sauvegarde SQL complète.
- **Exploitation sans SSH** : migration automatique sous verrou, mode maintenance (fichier `MAINTENANCE`), journal mensuel, `scripts/package-release.mjs` (paquet + précompression Brotli/gzip + manifeste SHA-256), `scripts/deploy-ftp.sh` (FTPS), workflow de déploiement **manuel** uniquement.

- **Installation guidée** (`/installation`) : sur une base vide, création du premier compte administrateur, protégée par `SETUP_CODE` (`.env`), fermée ensuite. Migration `003_setup.sql`.
- **« Mot de passe oublié » classique** (`/mot-de-passe-oublie`) : lien par e-mail valable 1 h, usage unique, puis e-mail de confirmation (aussi après un changement depuis la page Compte). Envoi par n'importe quel serveur SMTP (client intégré, TLS obligatoire) ou par `mail()` ; transport « fichier » pour le développement et les tests. Sans envoi configuré, la demande autorise l'administrateur, pendant 7 jours, à générer un lien.
- **Licence PolyForm Noncommercial 1.0.0** (`LICENSE.md`), résumé et composants tiers dans `NOTICE.md`, licences SIL OFL des polices embarquées.
- `bin/backup.php` : sauvegarde SQL complète en ligne de commande.
- `REGISTRATION_MAX_PER_IP_HOUR` : limite d'inscriptions par heure et par IP (10 par défaut).

### Changé
- **Administration restreinte** : plus de téléchargement de la base depuis l'interface ; lien de réinitialisation uniquement après une demande de l'utilisateur ; jamais d'accès au contenu des CV.
- `REGISTRATION_ENABLED` vaut `false` par défaut : les comptes se créent sur invitation.
- Enregistrement automatique : validation locale avant envoi (erreurs affichées sous les champs, plus de blocage silencieux), brouillon local en cas d'échec, conflit entre onglets détecté (révision), envoi en attente au départ de la page, reconnexion sans quitter la page quand la session expire.
- Aperçu : un seul chargement pdf.js par rendu, worker partagé, rendus en file, miniatures annulables, pas de page blanche pendant le redessin.
- Polices PDF regénérées en sous-ensembles latin étendu (Ł, ř, ș, ő…) ; la règle ATS des caractères s'appuie sur la couverture réelle des polices.
- Cookies préfixés `__Host-` en HTTPS ; limitation IPv6 par /64 ; délai progressif par e-mail.

### Corrigé
- Caractères latins étendus, autosave bloqué par un champ invalide, restauration écrasée par un envoi en retard, extraction de mots-clés bruitée, pluriel « moiss », dates des activités parallèles, contrastes, absence de filet d'erreur.
- Sauvegarde SQL : littéraux en SQL standard (`NO_BACKSLASH_ESCAPES`), relue à l'identique quelle que soit la base d'origine.

## Avant la 2.0.0

Versions de développement, non publiées.
