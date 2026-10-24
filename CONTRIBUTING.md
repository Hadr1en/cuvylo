# Contribuer à Cuvylo

Merci de votre intérêt ! Les contributions sont les bienvenues : corrections, nouveaux modèles de CV, règles d'analyse ATS, traductions, documentation.

En participant, vous vous engagez à respecter le [code de conduite](CODE_OF_CONDUCT.md).

## En bref

1. **Forkez** le dépôt, puis créez une branche depuis `main` : `fix/…`, `feat/…` ou `docs/…`.
2. Faites vos modifications, avec des tests.
3. Ouvrez une **pull request** vers `main`. La CI doit être verte, et le mainteneur relit puis fusionne : rien n'est fusionné automatiquement.

La branche `main` est protégée : personne, mainteneur compris, n'y pousse directement. Tout passe par une pull request.

## Avant d'ouvrir une pull request

- Pour un changement important (nouvelle fonctionnalité, changement de comportement), ouvrez d'abord une issue pour en discuter.
- Lancez les vérifications (voir [docs/installation.md](docs/installation.md) pour préparer l'environnement) :

  ```bash
  cd frontend && npm run lint && npm run typecheck && npm test
  cd backend && php vendor/bin/phpunit
  cd frontend && npm run e2e    # si l'interface, l'API ou le PDF changent (MySQL local requis, voir docs/tests-e2e.md)
  ```

- Un changement de schéma de base passe par une **nouvelle** migration dans `backend/migrations/`, à sens unique, sans instruction destructrice (elle s'applique toute seule chez les utilisateurs).
- Un changement visible pour les utilisateurs se note dans [CHANGELOG.md](CHANGELOG.md), section « Non publié ».
- Gardez le style du code alentour : français dans l'interface et les commentaires, TypeScript strict, PHP sans dépendance de production.

## Règles du projet

- **Aucune donnée réelle** : exemples et tests utilisent des profils fictifs (`shared/fixtures/`, domaines `example.test`). Jamais de `.env`, de base locale ni de secret dans un commit.
- **Honnêteté sur les ATS** : l'outil signale des risques, il ne promet jamais une compatibilité ni un score. La comparaison à une offre ne suggère jamais d'ajouter une compétence que la personne n'a pas.
- **Sans IA ni service externe** : l'analyse reste locale et déterministe.
- **Hébergement mutualisé** : tout doit fonctionner avec PHP 8.1+, MySQL et un simple accès FTP, sans SSH, Composer ni Node côté serveur.

## Sécurité

Une faille ? Pas d'issue publique : utilisez le [signalement privé](https://github.com/Hadr1en/cuvylo/security/advisories/new). Voir [SECURITY.md](SECURITY.md).

## Licence des contributions

Cuvylo est sous [PolyForm Noncommercial 1.0.0](LICENSE.md). En ouvrant une pull request, vous acceptez que votre contribution soit distribuée sous cette même licence.
