<?php

declare(strict_types=1);

// CLI uniquement : aucun point d'entrée web pour les migrations.
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

$envPath = $home . '/.env';
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--env=')) {
        $envPath = substr($arg, 6);
    }
}

try {
    $config = Config::fromEnv(EnvFile::loadWithEnvironment($envPath));
    $pdo = Connection::open($config->dbDsn, $config->dbUser, $config->dbPassword);
    $applied = Migrator::run($pdo, $home . '/migrations');
} catch (Throwable $e) {
    // Le message d'une PDOException peut contenir des identifiants : on n'affiche que la classe.
    fwrite(STDERR, 'Migration impossible : ' . get_class($e) . ($e instanceof RuntimeException ? ' — ' . $e->getMessage() : '') . "\n");
    exit(1);
}

echo $applied === [] ? "Base déjà à jour.\n" : 'Migrations appliquées : ' . implode(', ', $applied) . "\n";
