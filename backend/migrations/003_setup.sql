-- Cuvylo — installation guidée et administration restreinte. SQL portable MySQL 5.7+/8 et SQLite,
-- un ALTER TABLE … ADD COLUMN par instruction, aucune instruction destructrice.

-- Compte administrateur créé par l'écran d'installation (en plus des adresses listées dans ADMIN_EMAILS).
ALTER TABLE users ADD COLUMN is_admin INT NOT NULL DEFAULT 0;

-- Demande de réinitialisation faite par l'utilisateur (« Mot de passe oublié ») : sans elle,
-- l'administrateur ne peut pas générer de lien de réinitialisation pour ce compte.
ALTER TABLE users ADD COLUMN reset_requested_at DATETIME NULL;
