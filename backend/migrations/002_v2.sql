-- Cuvylo — v2. SQL portable MySQL 5.7+/8 et SQLite : un ALTER TABLE … ADD COLUMN par
-- instruction, aucune clé étrangère dans un ALTER, aucune instruction destructrice (migrations à sens unique).
-- Seule la clause ENGINE est propre à MySQL : le migrateur la retire sous SQLite.

-- Versions typées (corrige le type codé dans le libellé). Le rattrapage compare les octets (HEX) :
-- insensible à la collation, donc une version manuelle nommée « Auto » reste manuelle sous MySQL comme sous SQLite.
ALTER TABLE cv_versions ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'manual';
UPDATE cv_versions SET kind = 'auto' WHERE HEX(label) = '6175746F';
UPDATE cv_versions SET kind = 'restore' WHERE HEX(label) = '6176616E7420726573746175726174696F6E';
CREATE INDEX cv_versions_kind_idx ON cv_versions (cv_id, kind, created_at);

-- Contrôle de concurrence optimiste.
ALTER TABLE cvs ADD COLUMN revision INT NOT NULL DEFAULT 1;
ALTER TABLE profiles ADD COLUMN revision INT NOT NULL DEFAULT 1;

-- Libellé grossier d'appareil (navigateur + système) pour la liste des sessions.
ALTER TABLE sessions ADD COLUMN device VARCHAR(60) NOT NULL DEFAULT '';

-- Double authentification (secrets chiffrés AES-256-GCM) et dernière connexion.
ALTER TABLE users ADD COLUMN totp_secret TEXT NULL;
ALTER TABLE users ADD COLUMN totp_pending TEXT NULL;
ALTER TABLE users ADD COLUMN totp_recovery TEXT NULL;
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL;

-- Purge et délai progressif par e-mail.
CREATE INDEX login_attempts_time_idx ON login_attempts (attempted_at);
CREATE INDEX login_attempts_email_idx ON login_attempts (email_hash, attempted_at);

-- Invitations nominatives à usage unique (seule l'empreinte SHA-256 du jeton est stockée).
CREATE TABLE invitations (
    id CHAR(26) NOT NULL PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    note VARCHAR(120) NOT NULL,
    created_by CHAR(26) NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    used_by CHAR(26) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX invitations_token_unique ON invitations (token_hash);

-- Liens de réinitialisation générés par l'administrateur (empreinte SHA-256 du jeton).
CREATE TABLE password_resets (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id CHAR(26) NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX password_resets_user_idx ON password_resets (user_id);

-- Liens de partage : instantané figé d'un CV.
CREATE TABLE shares (
    id CHAR(26) NOT NULL PRIMARY KEY,
    user_id CHAR(26) NOT NULL,
    cv_id CHAR(26) NOT NULL,
    slug CHAR(22) NOT NULL,
    title VARCHAR(120) NOT NULL,
    settings TEXT NOT NULL,
    data LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NULL,
    revoked_at DATETIME NULL,
    views INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_shares_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_shares_cv FOREIGN KEY (cv_id) REFERENCES cvs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX shares_slug_unique ON shares (slug);
CREATE INDEX shares_user_cv_idx ON shares (user_id, cv_id);

-- Suivi des candidatures.
CREATE TABLE applications (
    id CHAR(26) NOT NULL PRIMARY KEY,
    user_id CHAR(26) NOT NULL,
    company VARCHAR(200) NOT NULL,
    position VARCHAR(200) NOT NULL,
    url VARCHAR(500) NOT NULL,
    posting LONGTEXT NOT NULL,
    cv_id CHAR(26) NULL,
    status VARCHAR(16) NOT NULL,
    applied_at DATE NULL,
    next_action_at DATE NULL,
    notes TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    revision INT NOT NULL DEFAULT 1,
    CONSTRAINT fk_applications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX applications_user_updated_idx ON applications (user_id, updated_at);

-- Lettres de motivation.
CREATE TABLE letters (
    id CHAR(26) NOT NULL PRIMARY KEY,
    user_id CHAR(26) NOT NULL,
    title VARCHAR(120) NOT NULL,
    cv_id CHAR(26) NULL,
    settings TEXT NOT NULL,
    data LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    revision INT NOT NULL DEFAULT 1,
    CONSTRAINT fk_letters_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX letters_user_updated_idx ON letters (user_id, updated_at);
