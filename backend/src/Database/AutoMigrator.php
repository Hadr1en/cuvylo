<?php

declare(strict_types=1);

namespace Cuvylo\Database;

use Cuvylo\Support\Logger;
use PDO;
use Throwable;

/**
 * Migration automatique au premier appel après un déploiement (hébergement sans SSH, déploiement par FTP).
 *
 * À chaque requête, comparaison peu coûteuse : nom du dernier fichier de `migrations/` ↔ marqueur
 * `var/schema.version`. Si le marqueur est absent ou en retard : verrou MySQL `GET_LOCK('cuvylo_migrate')`
 * (une seule requête migre, les autres attendent), application des migrations manquantes, mise à jour du marqueur.
 * `var/` est créé au besoin ; s'il n'est pas inscriptible, la vérification se fait en base à chaque requête
 * (correct, juste un peu plus coûteux).
 */
final class AutoMigrator
{
    public const LOCK_NAME = 'cuvylo_migrate';
    public const MARKER = 'schema.version';

    public static function latestVersion(string $migrationsDir): ?string
    {
        $files = glob(rtrim($migrationsDir, '/') . '/*.sql') ?: [];
        if ($files === []) {
            return null;
        }
        sort($files);

        return basename((string) end($files), '.sql');
    }

    /**
     * @param string $dbIdentity Identifie la base (le DSN) : le marqueur porte son empreinte, si bien qu'un marqueur
     *                           copié depuis un poste de développement (envoi FTP du dossier var/) ne fait pas
     *                           croire à la production que sa base est à jour.
     * @return bool true si le schéma est à jour, false en cas d'échec (verrou indisponible, erreur SQL).
     */
    public static function ensure(PDO $pdo, string $home, Logger $logger, string $dbIdentity = '', int $lockTimeoutSeconds = 10): bool
    {
        $latest = self::latestVersion($home . '/migrations');
        if ($latest === null) {
            return true;
        }
        $varDir = $home . '/var';
        $marker = $varDir . '/' . self::MARKER;
        $expected = self::markerContent($latest, $dbIdentity);
        if (is_file($marker) && trim((string) @file_get_contents($marker)) === $expected) {
            return true;
        }

        $mysql = !Connection::isSqlite($pdo);
        try {
            if ($mysql) {
                $lock = $pdo->prepare('SELECT GET_LOCK(?, ?)');
                $lock->execute([self::LOCK_NAME, $lockTimeoutSeconds]);
                if ((int) $lock->fetchColumn() !== 1) {
                    $logger->warning('migration_lock_unavailable');

                    return false;
                }
            }
            try {
                $applied = Migrator::run($pdo, $home . '/migrations');
            } finally {
                if ($mysql) {
                    $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
                    $release->execute([self::LOCK_NAME]);
                }
            }
            if ($applied !== []) {
                $logger->info('schema_migrated', ['versions' => implode(',', $applied)]);
            }
            self::writeMarker($varDir, $marker, $expected);

            return true;
        } catch (Throwable $e) {
            // Jamais le message : il peut contenir du SQL ou des identifiants.
            $logger->error('migration_failed', ['class' => get_class($e), 'where' => basename($e->getFile()) . ':' . $e->getLine()]);

            return false;
        }
    }

    /** `002_v2 1a2b3c4d5e6f7a8b` : dernière migration + empreinte courte (non réversible) de l'identité de la base. */
    public static function markerContent(string $version, string $dbIdentity): string
    {
        return $version . ' ' . substr(hash('sha256', 'cuvylo-schema|' . $dbIdentity), 0, 16);
    }

    private static function writeMarker(string $varDir, string $marker, string $version): void
    {
        if (!is_dir($varDir)) {
            if (!@mkdir($varDir, 0750, true) && !is_dir($varDir)) {
                return;
            }
            // Repli « tout sous www/ » : le dossier ne doit jamais être servi.
            @file_put_contents($varDir . '/.htaccess', "Require all denied\n");
        }
        $tmp = $marker . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmp, $version . "\n") !== false && !@rename($tmp, $marker)) {
            @unlink($tmp);
        }
    }
}
