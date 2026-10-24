<?php

declare(strict_types=1);

/**
 * Prépare la base MySQL des tests de bout en bout : crée la base si elle n'existe pas, puis applique
 * les migrations. CLI uniquement ; la base visée vient de DB_DSN (variable d'environnement).
 *
 * Aucune instruction destructrice : la base est créée au besoin et jamais vidée ni supprimée. Les tests
 * e2e s'isolent en créant des comptes aux e-mails uniques.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

$home = dirname(__DIR__);
require $home . '/src/autoload.php';

use Cuvylo\Config;
use Cuvylo\Database\Connection;
use Cuvylo\Database\Migrator;
use Cuvylo\EnvFile;

try {
    $config = Config::fromEnv(EnvFile::loadWithEnvironment($home . '/.env'));

    if (str_starts_with($config->dbDsn, 'mysql:')) {
        if (!preg_match('/dbname=([A-Za-z0-9_]{1,64})/', $config->dbDsn, $m)) {
            throw new RuntimeException('DB_DSN doit contenir dbname=<nom> (lettres, chiffres, _).');
        }
        $server = (string) preg_replace('/;?dbname=[A-Za-z0-9_]+/', '', $config->dbDsn);
        $root = Connection::open($server, $config->dbUser, $config->dbPassword);
        $root->exec('CREATE DATABASE IF NOT EXISTS `' . $m[1] . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    }

    $pdo = Connection::open($config->dbDsn, $config->dbUser, $config->dbPassword);
    $applied = Migrator::run($pdo, $home . '/migrations');
} catch (Throwable $e) {
    fwrite(STDERR, 'Préparation e2e impossible : ' . get_class($e) . ($e instanceof RuntimeException ? ' — ' . $e->getMessage() : '') . "\n");
    exit(1);
}

echo $applied === [] ? "Base e2e à jour.\n" : 'Base e2e prête, migrations : ' . implode(', ', $applied) . "\n";
