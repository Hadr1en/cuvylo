<?php

declare(strict_types=1);

// Jamais d'erreur PHP dans la réponse : un avertissement casserait le JSON et révélerait des chemins.
// Les erreurs restent journalisées (error_log de l'hébergeur).
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

// Front controller de l'API (déployé dans www/api/). La logique vit hors de la racine web (CUVYLO_HOME).
// Emplacements essayés, dans l'ordre : dépôt (backend/public/ → backend/), puis un dossier `cuvylo/` à côté du
// dossier du site (cas normal : www/ et cuvylo/ à la racine FTP), un niveau plus haut, ou dans le dossier du site.
$home = defined('CUVYLO_HOME') ? (string) constant('CUVYLO_HOME') : (getenv('CUVYLO_HOME') ?: '');
if ($home === '') {
    foreach ([dirname(__DIR__), dirname(__DIR__, 2) . '/cuvylo', dirname(__DIR__, 3) . '/cuvylo', dirname(__DIR__) . '/cuvylo'] as $candidate) {
        if (is_file($candidate . '/src/bootstrap.php')) {
            $home = $candidate;
            break;
        }
    }
}

if ($home === '' || !is_file($home . '/src/bootstrap.php')) {
    // Dossier absent ou envoi FTP en cours : réponse JSON explicite plutôt qu'une page blanche.
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('Retry-After: 60');
    echo '{"error":{"code":"code_missing","message":"Dossier cuvylo/ introuvable : envoyez-le à côté du dossier du site (www/)."}}';

    return;
}

if (!defined('CUVYLO_HOME')) {
    define('CUVYLO_HOME', $home);
}
require_once $home . '/src/bootstrap.php';

cuvylo_run(__DIR__);
