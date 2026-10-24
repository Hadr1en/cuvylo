<?php

declare(strict_types=1);

namespace Cuvylo\Http;

use JsonException;

final class Request
{
    /** Corps JSON maximal accepté (le profil est plafonné à 450 Ko, photo comprise ; le reste est de la marge). */
    public const MAX_BODY_BYTES = 600 * 1024;
    /** En-tête (nom en minuscules) qui porte la méthode voulue d'un POST : voir effectiveMethod(). */
    public const METHOD_OVERRIDE = 'x-http-method-override';

    /** @var array<string, mixed> */
    private array $attributes = [];

    /** Méthode effective (après `X-HTTP-Method-Override`). */
    private readonly string $method;

    /**
     * @param array<string, string> $headers Noms en minuscules
     * @param array<string, string> $cookies
     */
    public function __construct(
        string $method,
        private readonly string $path,
        private readonly array $headers = [],
        private readonly array $cookies = [],
        private readonly string $body = '',
        private readonly string $ip = '0.0.0.0',
    ) {
        $this->method = self::effectiveMethod($method, $headers[self::METHOD_OVERRIDE] ?? null);
    }

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (!is_string($value)) {
                continue;
            }
            if (str_starts_with($key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = $value;
            } elseif ($key === 'CONTENT_TYPE' || $key === 'CONTENT_LENGTH') {
                $headers[strtolower(str_replace('_', '-', $key))] = $value;
            }
        }

        $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        $path = is_string($path) ? $path : '/';

        $stream = fopen('php://input', 'rb');
        $body = $stream === false ? '' : (string) stream_get_contents($stream, self::MAX_BODY_BYTES + 1);

        $cookies = [];
        foreach ($_COOKIE as $name => $value) {
            if (is_string($value)) {
                $cookies[(string) $name] = $value;
            }
        }

        return new self(
            (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            $path,
            $headers,
            $cookies,
            $body,
            (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'),
        );
    }

    /**
     * Méthode réelle d'une requête. Sur les mutualisés, le pare-feu applicatif (ModSecurity, par exemple) refuse souvent
     * PUT et DELETE : l'interface les envoie alors en POST avec `X-HTTP-Method-Override`. Seul un POST peut être
     * converti, et seulement en PUT, PATCH ou DELETE ; la protection CSRF s'applique de la même façon.
     */
    public static function effectiveMethod(string $method, ?string $override): string
    {
        $method = strtoupper($method);
        $override = strtoupper(trim((string) $override));

        return $method === 'POST' && in_array($override, ['PUT', 'PATCH', 'DELETE'], true) ? $override : $method;
    }

    public function method(): string
    {
        return $this->method;
    }

    public function path(): string
    {
        return $this->path === '/' ? '/' : rtrim($this->path, '/');
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function cookie(string $name): ?string
    {
        return $this->cookies[$name] ?? null;
    }

    public function ip(): string
    {
        return $this->ip;
    }

    public function hasBody(): bool
    {
        return $this->body !== '' || $this->isTruncated();
    }

    /**
     * Corps annoncé (Content-Length) plus long que celui reçu : PHP l'a écarté parce qu'il dépassait
     * `post_max_size` (ou la connexion a été coupée). Traité comme « trop volumineux » plutôt que « absent ».
     */
    public function isTruncated(): bool
    {
        $declared = $this->header('content-length');

        return $declared !== null && ctype_digit($declared) && (int) $declared > strlen($this->body);
    }

    /** Corps JSON facultatif : objet vide si aucun corps n'est envoyé. */
    public function jsonOrEmpty(): mixed
    {
        return $this->hasBody() ? $this->json() : [];
    }

    /** Corps JSON décodé (tableau associatif ou liste). Lève 400/413 si le corps est inexploitable. */
    public function json(): mixed
    {
        if (strlen($this->body) > self::MAX_BODY_BYTES || $this->isTruncated()
            || (ctype_digit((string) $this->header('content-length')) && (int) $this->header('content-length') > self::MAX_BODY_BYTES)) {
            throw new HttpException(413, 'payload_too_large', 'Corps de requête trop volumineux.');
        }
        if ($this->body === '') {
            throw HttpException::badRequest('Corps JSON requis.');
        }
        $contentType = strtolower((string) $this->header('content-type'));
        if (!str_starts_with($contentType, 'application/json')) {
            throw HttpException::badRequest('Content-Type application/json requis.');
        }
        try {
            return json_decode($this->body, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw HttpException::badRequest('JSON invalide.');
        }
    }

    public function setAttribute(string $name, mixed $value): void
    {
        $this->attributes[$name] = $value;
    }

    public function attribute(string $name): mixed
    {
        return $this->attributes[$name] ?? null;
    }
}
