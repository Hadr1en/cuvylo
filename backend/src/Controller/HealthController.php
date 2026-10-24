<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Auth\Cookies;
use Cuvylo\Auth\Csrf;
use Cuvylo\Auth\SessionManager;
use Cuvylo\Config;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Support\Clock;

final class HealthController
{
    public function __construct(
        private readonly Config $config,
        private readonly Csrf $csrf,
        private readonly Cookies $cookies,
        private readonly SessionManager $sessions,
        private readonly Clock $clock,
    ) {
    }

    public function health(Request $request): Response
    {
        return Response::json(['status' => 'ok']);
    }

    /**
     * Émet (ou renvoie) le jeton CSRF. Un jeton valide déjà présent dans le cookie est conservé,
     * pour ne pas invalider les autres onglets ouverts.
     */
    public function csrf(Request $request): Response
    {
        $existing = $this->cookies->csrfToken($request);
        $session = $request->attribute('session');

        $reusable = $existing !== null
            && $this->csrf->isGenuine($existing)
            && ($session === null || hash_equals($session['csrf_hash'], $this->csrf->hash($existing)));

        $token = $reusable ? $existing : $this->csrf->issue();
        if (!$reusable && $session !== null) {
            $this->sessions->rebindCsrf($session['id_hash'], $this->csrf->hash($token));
        }

        $response = Response::json(['csrfToken' => $token]);

        return $this->cookies->setCsrf($response, $token, $this->clock->now() + $this->config->sessionAbsoluteLifetimeDays * 86400);
    }
}
