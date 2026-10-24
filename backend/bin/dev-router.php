<?php

declare(strict_types=1);

// Routeur du serveur PHP intégré (développement local uniquement) :
//   php -S 127.0.0.1:8080 bin/dev-router.php
// Apache/.htaccess joue ce rôle en production.
$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
if (is_string($path) && str_starts_with($path, '/api')) {
    require dirname(__DIR__) . '/public/index.php';

    return true;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo "Utilisez le serveur Vite pour le frontend ; ici seul /api est servi.\n";

return true;
