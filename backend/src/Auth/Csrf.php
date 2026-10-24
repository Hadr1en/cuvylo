<?php

declare(strict_types=1);

namespace Cuvylo\Auth;

use Cuvylo\Config;

/**
 * Jeton CSRF « double-submit » signé : `<aléa>.<HMAC(aléa, APP_KEY)>`.
 * La signature empêche un attaquant (cookie injecté depuis un sous-domaine) de fabriquer un couple cookie/en-tête valide.
 * Pour une requête authentifiée, le hash du jeton est en plus lié à la session (`sessions.csrf_hash`).
 */
final class Csrf
{
    /** Nom de base du cookie ; le nom effectif (préfixe `__Host-` en HTTPS) est donné par Cookies::csrfName(). */
    public const COOKIE = Cookies::CSRF;
    public const HEADER = 'x-csrf-token';

    public function __construct(private readonly Config $config)
    {
    }

    public function issue(): string
    {
        $nonce = bin2hex(random_bytes(16));

        return $nonce . '.' . $this->sign($nonce);
    }

    public function isGenuine(string $token): bool
    {
        $parts = explode('.', $token);
        if (count($parts) !== 2 || $parts[0] === '' || preg_match('/^[a-f0-9]{32}$/D', $parts[0]) !== 1) {
            return false;
        }

        return hash_equals($this->sign($parts[0]), $parts[1]);
    }

    public function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    private function sign(string $nonce): string
    {
        return hash_hmac('sha256', 'csrf|' . $nonce, $this->config->appKey);
    }
}
