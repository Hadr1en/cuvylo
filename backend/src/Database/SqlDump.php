<?php

declare(strict_types=1);

namespace Cuvylo\Database;

use PDO;

/**
 * Sauvegarde SQL complète générée en PHP (pas de mysqldump sur un mutualisé), produite en flux :
 * schéma (les fichiers de migrations, dans l'ordre) puis une instruction INSERT par ligne, table par table.
 * Le fichier s'importe tel quel dans une base MySQL vide (phpMyAdmin) : schéma, données et historique des migrations.
 */
final class SqlDump
{
    /** Ordre compatible avec les clés étrangères (parents d'abord). */
    public const TABLES = [
        'schema_migrations', 'users', 'profiles', 'cvs', 'cv_versions', 'sessions', 'login_attempts',
        'invitations', 'password_resets', 'shares', 'applications', 'letters',
    ];

    public function __construct(private readonly PDO $pdo, private readonly string $migrationsDir)
    {
    }

    /** @param callable(string): void $write */
    public function write(callable $write, string $generatedAt): void
    {
        $write("-- Cuvylo — sauvegarde SQL complète générée le {$generatedAt} (UTC)\n");
        $write("-- CONTIENT DES DONNÉES PERSONNELLES ET DES HACHAGES (mots de passe, sessions) : à conserver chiffrée.\n");
        $write("-- Restauration : importer ce fichier dans une base MySQL VIDE (schéma + données).\n\n");
        // Littéraux en SQL standard (apostrophe doublée, antislash littéral) : on désactive l'échappement
        // MySQL par antislash pour que le fichier se relise à l'identique, quelle que soit la base d'origine.
        $write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES');\n\n");

        $write("-- ── Schéma ──\n");
        $write("CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL);\n");
        $files = glob(rtrim($this->migrationsDir, '/') . '/*.sql') ?: [];
        sort($files);
        foreach ($files as $file) {
            $write("\n-- " . basename($file) . "\n");
            foreach (Migrator::statements((string) file_get_contents($file), false) as $statement) {
                $write($statement . ";\n");
            }
        }

        $unbuffered = $this->unbufferedAttribute();
        foreach (self::TABLES as $table) {
            $write("\n-- ── Données : {$table} ──\n");
            if ($unbuffered !== null) {
                $this->pdo->setAttribute($unbuffered, false);
            }
            try {
                $stmt = $this->pdo->query('SELECT * FROM ' . $table);
                while (($row = $stmt->fetch(PDO::FETCH_ASSOC)) !== false) {
                    $columns = implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', array_keys($row)));
                    $values = implode(', ', array_map(static fn (mixed $v): string => $v === null ? 'NULL' : self::literal((string) $v), array_values($row)));
                    $write('INSERT INTO `' . $table . '` (' . $columns . ') VALUES (' . $values . ");\n");
                }
                $stmt->closeCursor();
            } finally {
                if ($unbuffered !== null) {
                    $this->pdo->setAttribute($unbuffered, true);
                }
            }
        }

        $write("\nSET FOREIGN_KEY_CHECKS = 1;\n-- Fin de la sauvegarde.\n");
    }

    /**
     * Littéral SQL standard, identique quel que soit le pilote (PDO::quote échappe différemment sous
     * MySQL et SQLite). Les octets nuls et caractères de contrôle sont refusés en amont par la validation.
     */
    public static function literal(string $value): string
    {
        return "'" . str_replace("'", "''", $value) . "'";
    }

    /** Lecture non tamponnée sous MySQL : les tables volumineuses ne sont pas chargées en mémoire d'un bloc. */
    private function unbufferedAttribute(): ?int
    {
        if (Connection::isSqlite($this->pdo)) {
            return null;
        }
        if (class_exists(\Pdo\Mysql::class) && defined('Pdo\Mysql::ATTR_USE_BUFFERED_QUERY')) {
            return (int) constant('Pdo\Mysql::ATTR_USE_BUFFERED_QUERY');
        }

        return defined('PDO::MYSQL_ATTR_USE_BUFFERED_QUERY') ? (int) constant('PDO::MYSQL_ATTR_USE_BUFFERED_QUERY') : null;
    }
}
