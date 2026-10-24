<?php

declare(strict_types=1);

use Cuvylo\Config;
use Cuvylo\Database\AutoMigrator;
use Cuvylo\Database\Connection;
use Cuvylo\EnvFile;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Install\InstallKernel;
use Cuvylo\Kernel;
use Cuvylo\Support\Logger;

/**
 * Amorçage de l'API. `CUVYLO_HOME` = dossier contenant src/, migrations/ et .env.
 * Ordre de résolution : constante déjà définie, variable d'environnement, dépôt local (backend/), puis `~/cuvylo` (frère de www/).
 */
function cuvylo_home(string $publicDir): string
{
    if (defined('CUVYLO_HOME')) {
        return (string) constant('CUVYLO_HOME');
    }
    $fromEnv = getenv('CUVYLO_HOME');
    if (is_string($fromEnv) && $fromEnv !== '') {
        return $fromEnv;
    }
    if (is_file(dirname($publicDir) . '/src/autoload.php')) {
        return dirname($publicDir);
    }

    return dirname($publicDir, 2) . '/cuvylo';
}

function cuvylo_run(string $publicDir): void
{
    $home = cuvylo_home($publicDir);
    require_once $home . '/src/autoload.php';

    try {
        $request = Request::fromGlobals();

        // Mode maintenance : réponse immédiate, sans même ouvrir la base (sauf santé et informations d'instance).
        if (is_file($home . '/MAINTENANCE') && !in_array($request->path(), Kernel::MAINTENANCE_EXEMPT, true)) {
            Kernel::maintenanceResponse()->send();

            return;
        }

        // Pas encore de configuration : l'assistant d'installation répond à la place de l'application.
        if (InstallKernel::needed($home)) {
            (new InstallKernel($home))->handle($request)->send();

            return;
        }

        $config = Config::fromEnv(EnvFile::loadWithEnvironment($home . '/.env'), $home);
        $logger = Logger::toFile($config->logPath);
        $pdo = Connection::open($config->dbDsn, $config->dbUser, $config->dbPassword);

        if (!AutoMigrator::ensure($pdo, $home, $logger, $config->dbDsn)) {
            $response = Kernel::maintenanceResponse();
        } else {
            $kernel = new Kernel($config, $pdo, $logger);
            $response = $kernel->handle($request);
        }
    } catch (PDOException $e) {
        // Jamais le message du pilote : il peut citer l'utilisateur ou l'hôte.
        error_log('cuvylo: base de données injoignable (' . InstallKernel::databaseError($e) . ') — vérifiez DB_DSN, DB_USER et DB_PASSWORD dans .env');
        $response = Kernel::secure(Response::error(503, 'database_unavailable', 'Base de données injoignable.', [], ['Retry-After' => '60']));
    } catch (RuntimeException $e) {
        // Messages de Config : ils nomment le réglage fautif, jamais sa valeur.
        error_log('cuvylo: configuration invalide — ' . $e->getMessage());
        $response = Kernel::secure(Response::error(500, 'invalid_config', 'Configuration du serveur invalide.'));
    } catch (Throwable $e) {
        error_log('cuvylo bootstrap failure: ' . get_class($e) . ' ' . basename($e->getFile()) . ':' . $e->getLine());
        $response = Response::error(500, 'server_error', 'Erreur interne.');
    }

    $response->send();
}
