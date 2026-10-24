-- Cuvylo — schéma initial (MySQL — InnoDB, utf8mb4, SQL de base ; compatible SQLite pour les tests).
-- Seule la clause ENGINE est propre à MySQL : le migrateur la retire sous SQLite.
-- Migrations à sens unique : le retour arrière passe par la restauration d'une sauvegarde.

CREATE TABLE users (
    id CHAR(26) NOT NULL PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(80) NULL,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX users_email_unique ON users (email);

CREATE TABLE sessions (
    id_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id CHAR(26) NOT NULL,
    csrf_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    ip_hash CHAR(64) NOT NULL,
    ua_hash CHAR(64) NOT NULL,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE login_attempts (
    id CHAR(26) NOT NULL PRIMARY KEY,
    email_hash CHAR(64) NOT NULL,
    ip_hash CHAR(64) NOT NULL,
    attempted_at DATETIME NOT NULL,
    success TINYINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX login_attempts_pair_idx ON login_attempts (email_hash, ip_hash, attempted_at);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip_hash, attempted_at);

CREATE TABLE profiles (
    user_id CHAR(26) NOT NULL PRIMARY KEY,
    data LONGTEXT NOT NULL,
    updated_at DATETIME NOT NULL,
    CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cvs (
    id CHAR(26) NOT NULL PRIMARY KEY,
    user_id CHAR(26) NOT NULL,
    title VARCHAR(120) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    settings TEXT NOT NULL,
    data LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CONSTRAINT fk_cvs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX cvs_user_updated_idx ON cvs (user_id, updated_at);

CREATE TABLE cv_versions (
    id CHAR(26) NOT NULL PRIMARY KEY,
    cv_id CHAR(26) NOT NULL,
    user_id CHAR(26) NOT NULL,
    label VARCHAR(120) NOT NULL,
    settings TEXT NOT NULL,
    data LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    CONSTRAINT fk_cv_versions_cv FOREIGN KEY (cv_id) REFERENCES cvs (id) ON DELETE CASCADE,
    CONSTRAINT fk_cv_versions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX cv_versions_cv_idx ON cv_versions (cv_id, created_at);
