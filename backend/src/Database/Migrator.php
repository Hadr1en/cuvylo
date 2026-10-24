<?php

declare(strict_types=1);

namespace Cuvylo\Database;

use PDO;
use RuntimeException;

/** Applique les fichiers `migrations/*.sql` dans l'ordre, une seule fois chacun. Sens unique : pas de retour arrière. */
final class Migrator
{
    /** @return list<string> Versions appliquées pendant cet appel. */
    public static function run(PDO $pdo, string $directory): array
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)');

        $done = $pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
        $files = glob(rtrim($directory, '/') . '/*.sql') ?: [];
        sort($files);

        $applied = [];
        foreach ($files as $file) {
            $version = basename($file, '.sql');
            if (in_array($version, $done, true)) {
                continue;
            }
            foreach (self::statements((string) file_get_contents($file), Connection::isSqlite($pdo)) as $sql) {
                $pdo->exec($sql);
            }
            $insert = $pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
            $insert->execute([$version, gmdate('Y-m-d H:i:s')]);
            $applied[] = $version;
        }

        return $applied;
    }

    /** @return list<string> */
    public static function statements(string $script, bool $sqlite): array
    {
        $lines = array_filter(
            preg_split('/\R/', $script) ?: [],
            static fn (string $line): bool => !str_starts_with(ltrim($line), '--'),
        );

        $result = [];
        foreach (explode(';', implode("\n", $lines)) as $statement) {
            $statement = trim($statement);
            if ($statement === '') {
                continue;
            }
            if ($sqlite) {
                $statement = (string) preg_replace('/\)\s*ENGINE\s*=.*$/s', ')', $statement);
            }
            if (str_contains($statement, "'") && substr_count($statement, "'") % 2 !== 0) {
                throw new RuntimeException('Migration invalide : guillemet non fermé (les ";" dans des chaînes ne sont pas gérés).');
            }
            $result[] = $statement;
        }

        return $result;
    }
}
