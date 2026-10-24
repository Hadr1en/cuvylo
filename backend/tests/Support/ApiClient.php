<?php

declare(strict_types=1);

namespace Cuvylo\Tests\Support;

use Cuvylo\Auth\Cookies;
use Cuvylo\Auth\Csrf;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Kernel;
use Cuvylo\Support\Json;

/**
 * Navigateur simulé : garde un pot de cookies, joue le rôle du frontend (GET /api/csrf puis en-tête X-CSRF-Token).
 * Le pot est indexé par les noms de BASE (`cuvylo_session`, `cuvylo_csrf`) ; la traduction vers les noms réellement
 * émis par le serveur (préfixe `__Host-` en HTTPS) se fait à l'envoi et à la réception.
 */
final class ApiClient
{
    /** @var array<string, string> */
    public array $jar = [];

    public bool $autoCsrf = true;

    /** @var array<string, string> */
    public array $extraHeaders = [];

    public readonly string $ip;

    /** @var array<string, string> nom réel → nom de base */
    private array $names;

    public function __construct(private readonly Kernel $kernel, private readonly string $origin, ?string $ip = null, ?Cookies $cookies = null)
    {
        $this->ip = $ip ?? sprintf('10.%d.%d.%d', random_int(1, 254), random_int(1, 254), random_int(1, 254));
        $this->names = $cookies === null
            ? [Cookies::SESSION => Cookies::SESSION, Cookies::CSRF => Cookies::CSRF]
            : [$cookies->sessionName() => Cookies::SESSION, $cookies->csrfName() => Cookies::CSRF];
    }

    public function get(string $path): Response
    {
        return $this->send('GET', $path);
    }

    public function post(string $path, mixed $body = null): Response
    {
        return $this->send('POST', $path, $body);
    }

    public function put(string $path, mixed $body = null): Response
    {
        return $this->send('PUT', $path, $body);
    }

    public function delete(string $path, mixed $body = null): Response
    {
        return $this->send('DELETE', $path, $body);
    }

    public function send(string $method, string $path, mixed $body = null, array $headers = []): Response
    {
        $headers = $headers + $this->extraHeaders + ['origin' => $this->origin, 'user-agent' => 'phpunit'];
        $raw = '';
        if ($body !== null) {
            $raw = is_string($body) ? $body : Json::encode($body);
            $headers += ['content-type' => 'application/json'];
        }
        if ($method !== 'GET' && $this->autoCsrf) {
            if (!isset($this->jar[Csrf::COOKIE])) {
                $this->get('/api/csrf');
            }
            $headers += [Csrf::HEADER => $this->jar[Csrf::COOKIE] ?? ''];
        }

        $cookies = [];
        $toReal = array_flip($this->names);
        foreach ($this->jar as $name => $value) {
            $cookies[$toReal[$name] ?? $name] = $value;
        }

        $response = $this->kernel->handle(new Request($method, $path, $headers, $cookies, $raw, $this->ip));
        $this->absorb($response);

        return $response;
    }

    public function csrfToken(): ?string
    {
        return $this->jar[Csrf::COOKIE] ?? null;
    }

    public function sessionToken(): ?string
    {
        return $this->jar[Cookies::SESSION] ?? null;
    }

    private function absorb(Response $response): void
    {
        foreach ($response->cookies() as $name => $cookie) {
            $name = $this->names[$name] ?? $name;
            if ($cookie['value'] === '' || ($cookie['options']['expires'] ?? 1) <= 1) {
                unset($this->jar[$name]);
            } else {
                $this->jar[$name] = $cookie['value'];
            }
        }
    }
}
