-- Cuvylo — réglages modifiables depuis l'administration, sans éditer .env (ils l'emportent sur lui).
-- SQL portable MySQL 5.7+/8 et SQLite, aucune instruction destructrice.

-- registration_open : « 1 » inscriptions ouvertes à tous, « 0 » sur invitation seulement.
CREATE TABLE settings (
    name VARCHAR(64) NOT NULL PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
