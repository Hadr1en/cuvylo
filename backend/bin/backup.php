<?php

declare(strict_types=1);

// Sauvegarde SQL complète (schéma + données) sur la sortie standard. CLI uniquement : la sauvegarde
// n'est pas téléchargeable depuis l'interface d'administration.
//
//   php bin/backup.php > sauvegarde.sql            (puis la chiffrer et la stocker hors du serveur)
//   php bin/backup.php --env=/chemin/.env > …
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

$home = dirname(__DIR__);
require $home . '/src/autoload.php';

use Cuvylo\Config;
use Cuvylo\Database\Connection;
use Cuvylo\Database\SqlDump;
use Cuvylo\EnvFile;

$envPath = $home . '/.env';
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--env=')) {
        $envPath = substr($arg, 6);
    }
}

try {
    $config = Config::fromEnv(EnvFile::loadWithEnvironment($envPath));
    $pdo = Connection::open($config->dbDsn, $config->dbUser, $config->dbPassword);
    (new SqlDump($pdo, $home . '/migrations'))->write(static function (string $chunk): void {
        echo $chunk;
    }, gmdate('Y-m-d H:i:s'));
} catch (Throwable $e) {
    // Le message d'une PDOException peut contenir des identifiants : on n'affiche que la classe.
    fwrite(STDERR, 'Sauvegarde impossible : ' . get_class($e) . ($e instanceof RuntimeException ? ' — ' . $e->getMessage() : '') . "\n");
    exit(1);
}
