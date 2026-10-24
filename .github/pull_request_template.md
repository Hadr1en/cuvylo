## Quoi et pourquoi

<!-- Une ou deux phrases. -->

## Vérifications

<!-- Voir CONTRIBUTING.md. La CI doit être verte avant la relecture. -->
- [ ] Branche créée depuis `main`, une seule intention par pull request
- [ ] `cd frontend && npm run lint && npm run typecheck && npm test`
- [ ] `cd backend && php vendor/bin/phpunit`
- [ ] `cd frontend && npm run e2e` (si l'interface, l'API ou le PDF changent)
- [ ] Migration **à sens unique** ajoutée si le schéma change ; CHANGELOG complété si le comportement change pour les utilisateurs

## Données et sécurité

- [ ] Aucun secret, `.env`, base locale ni donnée personnelle réelle (exemples fictifs uniquement)
- [ ] Aucune promesse de compatibilité ATS ajoutée (on signale des risques, jamais une garantie)
