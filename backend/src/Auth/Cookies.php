<?php

declare(strict_types=1);

namespace Cuvylo\Auth;

use Cuvylo\Config;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;

/**
 * Cookies de session et CSRF. En HTTPS, préfixe `__Host-` : le navigateur n'accepte alors le cookie que
 * s'il est `Secure`, sans `Domain` et en `Path=/`, ce qui empêche un sous-domaine compromis d'imposer
 * sa propre session ou son propre jeton. Le nom non préfixé n'est jamais lu en HTTPS.
 */
final class Cookies
{
    /** Noms de base (sans préfixe). */
    public const SESSION = 'cuvylo_session';
    public const CSRF = 'cuvylo_csrf';
    public const HOST_PREFIX = '__Host-';

    public function __construct(private readonly Config $config)
    {
    }

    public function sessionName(): string
    {
        return $this->prefixed(self::SESSION);
    }

    public function csrfName(): string
    {
        return $this->prefixed(self::CSRF);
    }

    public function sessionToken(Request $request): ?string
    {
        return $request->cookie($this->sessionName());
    }

    public function csrfToken(Request $request): ?string
    {
        return $request->cookie($this->csrfName());
    }

    public function setSession(Response $response, string $token, int $expires): Response
    {
        return $response->withCookie($this->sessionName(), $token, $this->options($expires, true));
    }

    public function clearSession(Response $response): Response
    {
        return $response->withCookie($this->sessionName(), '', $this->options(1, true));
    }

    /** Cookie CSRF : lisible par le JavaScript de l'application (non HttpOnly), c'est le principe du double-submit. */
    public function setCsrf(Response $response, string $token, int $expires): Response
    {
        return $response->withCookie($this->csrfName(), $token, $this->options($expires, false));
    }

    private function prefixed(string $name): string
    {
        return $this->config->secureCookies() ? self::HOST_PREFIX . $name : $name;
    }

    /** @return array<string, mixed> */
    private function options(int $expires, bool $httpOnly): array
    {
        return [
            'expires' => $expires,
            'path' => '/',
            'secure' => $this->config->secureCookies(),
            'httponly' => $httpOnly,
            'samesite' => 'Lax',
        ];
    }
}
