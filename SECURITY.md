# Sécurité — Cuvylo

## Signaler une vulnérabilité

- **Sur une instance en ligne** : utilisez le contact publié par cette instance, page `/securite` ou `/.well-known/security.txt` (RFC 9116, généré à partir de `SECURITY_CONTACT_EMAIL` ou à défaut `LEGAL_CONTACT_EMAIL`).
- **Dans le code** : le dépôt est privé ; contactez directement son propriétaire.

Dans les deux cas : décrivez le problème, les étapes pour le reproduire et son impact ; aucun ticket public, aucune donnée personnelle réelle dans le rapport, et un délai raisonnable avant toute publication.

## Conformité de l'instance (éditeur, RGPD)

Chaque personne qui installe Cuvylo est **l'éditeur** de son site (LCEN) et **le responsable de traitement** des comptes qu'elle héberge (RGPD) ; ni ce dépôt ni sa documentation ne l'en déchargent. L'application fournit les outils :

| Obligation | Ce que fournit l'application |
|---|---|
| Mentions légales (LCEN art. 6-III) | Page `/mentions-legales`, alimentée par `LEGAL_PUBLISHER` (vide = particulier anonyme), `LEGAL_CONTACT_EMAIL`, `LEGAL_HOST` |
| Information des personnes (RGPD art. 13) | Page `/confidentialite` : données, finalités, bases légales, durées **réelles** (lues dans la configuration), cookies, droits |
| Droit d'accès et de rectification | Édition directe dans l'application |
| Droit à la portabilité (art. 20) | `Compte` → export JSON complet (`GET /api/account/export`) |
| Droit à l'effacement (art. 17) | `Compte` → suppression immédiate et définitive, mot de passe redemandé (`DELETE /api/account`) |
| Minimisation | Pas d'IP conservée avec les sessions (seulement un libellé d'appareil grossier, pour la liste des sessions) ; tentatives de connexion en HMAC, effacées après 24 h ; journaux sans IP, e-mail ni contenu |
| Cookies | Uniquement `cuvylo_session` et `cuvylo_csrf` (préfixés `__Host-` en HTTPS), strictement nécessaires : pas de bandeau de consentement |
| Accès de l'exploitant | L'interface d'administration ne montre que des métadonnées (comptes, espace, nombre de CV) ; elle ne permet ni de lire un CV, ni de télécharger la base, ni de réinitialiser un mot de passe sans demande de l'utilisateur |

Restent à la charge de l'exploitant : renseigner sa configuration légale, conserver les journaux techniques **12 mois au plus** (aucune rotation automatique), réserver l'accès à ses invités (invitations nominatives), protéger l'accès à l'hébergement et à la base (qui, eux, donnent accès à tout), et répondre aux demandes reçues à l'adresse de contact. Ces repères sont généraux et ne constituent pas un conseil juridique.

## Données traitées

Un CV contient des données personnelles (identité, coordonnées, parcours). Aucune donnée réelle ne doit figurer dans le dépôt, les tests ou les captures d'écran : tous les exemples sont fictifs (`shared/fixtures/`, domaines `example.test`).

## Mesures en place

Ces mesures sont couvertes par les tests PHP, qui appellent `Kernel::handle()` en processus. Les attributs réels des cookies et des en-têtes tels qu'émis par PHP/Apache n'ont **pas** de test automatisé et sont à contrôler au déploiement (docs/deploiement.md §5).

| Sujet | Mesure |
|---|---|
| Mots de passe | `password_hash(PASSWORD_DEFAULT)` appliqué au condensé SHA-256 du mot de passe (contourne la troncature à 72 octets de bcrypt) ; minimum 12 caractères |
| Sessions | Jeton aléatoire 256 bits en cookie `HttpOnly; Secure; SameSite=Lax` ; **seul le hash** est stocké en base ; expiration glissante + plafond absolu ; nouveau jeton à chaque connexion ; déconnexion = suppression en base |
| CSRF | Jeton signé (HMAC, `APP_KEY`) en cookie + en-tête, lié à la session ; contrôle `Origin` et `Sec-Fetch-Site` sur toute écriture |
| Force brute | 5 échecs / 15 min par (e-mail, IP), 20 / 15 min par IP ; e-mail et IP stockés hachés ; vérification factice quand le compte n'existe pas |
| Autorisations | Toute requête SQL sur profils, CV et versions est filtrée par `user_id` de la session ; une ressource d'un autre utilisateur répond **404** ; tests d'autorisation sur chaque route (lecture, modification, suppression, versions, restauration, duplication, liste) |
| Validation | Schéma strict côté serveur : champs inconnus rejetés, longueurs bornées, URL `http(s)` uniquement, identifiants restreints, caractères de contrôle refusés, document ≤ 200 Ko |
| Injection | PDO avec requêtes préparées exclusivement ; texte brut uniquement (aucun HTML interprété, ni à l'écran — React échappe — ni dans le PDF) |
| Journaux | Une ligne JSON par requête (identifiant, méthode, chemin, statut, durée, `user_id`) ; jamais de mot de passe, jeton, e-mail en clair, contenu de CV ni message d'exception |
| Secrets | `.env` hors racine web, jamais committé (`.gitignore`) ; aucune variable secrète dans le build frontend |
| En-têtes | API : `nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`, CSP `default-src 'none'`. Frontend : voir `frontend/public/.htaccess` |
| Migrations | SQL à sens unique, sans instruction destructrice (vérifié par test) ; appliquées automatiquement sous verrou |
| Installation | Assistant servi **uniquement** tant que `cuvylo/.env` n'existe pas : écritures de même origine (corps JSON, `Origin` = `Host`, `Sec-Fetch-Site`), 30 tentatives par heure au total, messages d'erreur de la base réduits à une cause (jamais le texte du pilote), `.env` créé en exclusif (jamais écrasé) avec les droits `0600`, `APP_KEY` générée sur le serveur, https exigé hors poste local. Configuration écrite à la main : premier compte protégé par `SETUP_CODE` (≥ 16 caractères, comparaison à temps constant, échecs limités par IP) |
| Double authentification | TOTP (RFC 6238) avec anti-rejeu, secret chiffré (AES-256-GCM), 10 codes de secours stockés en empreinte |
| Partage par lien | Jeton aléatoire de 128 bits ; l'instantané ne contient que ce que le PDF affiche (rubriques masquées, entrées vides et photo désactivée exclues) ; en mode anonyme, anonymisation serveur identique à celle du navigateur (test de parité) et titre neutre ; contenu effacé à la révocation et après l'expiration ; `noindex` |
| Administration | 404 pour tout compte non administrateur ; métadonnées seulement ; lien de réinitialisation seulement après une demande « Mot de passe oublié » (7 jours), valable 24 h, usage unique ; actions journalisées sans e-mail |
| Mot de passe oublié | Lien envoyé par e-mail à l'adresse du compte : jeton aléatoire 256 bits (seule l'empreinte est stockée), valable 1 h, usage unique, un seul lien actif ; 3 e-mails par heure et par compte au plus, limite par IP ; même réponse que le compte existe ou non ; sessions fermées et e-mail de confirmation après le changement |
| Envoi d'e-mails | SMTP générique sans dépendance, **TLS obligatoire** (465 ou STARTTLS 587, certificat vérifié), AUTH PLAIN/LOGIN ; en-têtes protégés contre l'injection ; erreurs journalisées avec le seul code SMTP |

## Limites connues (à connaître avant d'ouvrir à d'autres utilisateurs)

| Limite | Conséquence | Piste |
|---|---|---|
| Sans envoi d'e-mails configuré (`MAIL_TRANSPORT` vide, ou envoi en échec), « Mot de passe oublié » passe par l'administrateur, qui peut alors faire lui-même la demande pour un compte | Prise de main possible par un administrateur malveillant ; la personne s'en aperçoit (son mot de passe ne fonctionne plus) | Configurer l'envoi d'e-mails : le lien part alors directement à l'utilisateur et l'administrateur ne le voit pas. De toute façon, l'exploitant a accès à la base |
| Le temps de réponse de « Mot de passe oublié » est un peu plus long quand un e-mail part réellement | Un tiers patient pourrait en déduire qu'une adresse a un compte | Acceptable pour une petite instance ; file d'envoi asynchrone sinon |
| E-mails non signés par l'application (DKIM) | Délivrabilité dépendante du fournisseur SMTP | Utiliser une adresse du domaine, avec SPF/DKIM configurés chez le fournisseur |
| Entre l'envoi des fichiers et l'installation, l'assistant est ouvert à quiconque trouve l'adresse du site (comme WordPress) | Un tiers rapide pourrait installer l'instance sur une base à lui et en devenir administrateur | Installer juste après l'envoi ; si l'assistant ne s'affiche plus sans que vous l'ayez rempli, supprimer `cuvylo/.env` par FTP et recommencer. Pour fermer cette fenêtre, écrire `.env` soi-même avec `SETUP_CODE` (guide de déploiement §4-bis) |
| Si PHP ne peut pas écrire dans `cuvylo/`, l'assistant affiche le contenu de `.env` (accès à la base, clé) dans le navigateur de la personne qui installe | Contenu visible à l'écran le temps de le copier | Il ne s'affiche qu'à la personne qui vient de saisir ces accès ; jamais journalisé |
| L'inscription révèle qu'un e-mail est déjà utilisé (`already_registered`) | Énumération de comptes possible à l'inscription | Acceptable pour un usage personnel ; à revoir en multi-utilisateurs |
| `REMOTE_ADDR` utilisé tel quel | Derrière un proxy, la limitation par IP voit l'IP du proxy **[À VÉRIFIER selon l'hébergeur]** | Valider au déploiement |
| CSP du frontend en mode « Report-Only » | Pas encore bloquante | Passer en enforcement après vérification en production |
| Données non chiffrées au repos dans MySQL | Un accès à la base expose les CV | Chiffrer les sauvegardes ; limiter les accès à l'espace client de l'hébergeur |
| La fiche de poste collée dans l'éditeur est gardée dans le `localStorage` du navigateur (jamais envoyée au serveur ; effacée à la déconnexion) | Non synchronisée entre appareils | Le texte d'une offre peut aussi être conservé, volontairement, avec la candidature correspondante (côté serveur) |
| Sauvegarde non automatisée | Export manuel (espace client de l'hébergeur, ou `bin/backup.php` en SSH) | Tâche planifiée si l'offre le permet |
| Attributs des cookies et en-têtes HTTP émis par PHP/Apache non vérifiés par un test | Le chemin `public/index.php` est exercé par les tests e2e (serveur PHP intégré), mais pas derrière l'Apache d'un hébergeur | Contrôles de docs/deploiement.md §5 |
| Tests PHP exécutés sur SQLite ; MySQL couvert par la CI (5.7 et 8.0) et par un essai local | Écarts de dialecte possibles avec la version exacte de l'offre d'hébergement | Vérifier la version MySQL de l'offre (docs/deploiement.md) |

## Compatibilité ATS

Le projet ne **garantit** la compatibilité avec aucun système de suivi de candidatures. L'onglet « Analyse ATS » (et la page « Analyser un PDF ») signale des risques d'extraction connus à partir du texte réellement extrait du PDF, sans note globale ni promesse : chaque ATS a son propre analyseur.

## Dépendances

- Production PHP : **aucune** (autoloader maison). Production front : fichiers statiques.
- Développement : PHPUnit ; React, Vite, `@react-pdf/renderer`, `pdfjs-dist`, `zod`, Tailwind, `docx`, `fflate`, `uqr` (licences : [NOTICE.md](NOTICE.md)). Exécuter `npm audit` et `composer audit` avant chaque déploiement. ESLint est volontairement en v9 (compatibilité du plugin d'accessibilité) et ne fait plus l'objet de support amont : à migrer.
