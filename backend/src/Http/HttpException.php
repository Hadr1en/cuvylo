<?php

declare(strict_types=1);

namespace Cuvylo\Http;

use RuntimeException;

/** Erreur destinée au client : statut HTTP + code machine + message générique. */
class HttpException extends RuntimeException
{
    /**
     * @param array<string, string> $fields  Chemin pointé → code d'erreur
     * @param array<string, string> $headers En-têtes additionnels (ex. Retry-After)
     * @param array<string, mixed>  $extra   Propriétés ajoutées à l'objet `error` (ex. `current` pour un 409)
     */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $fields = [],
        public readonly array $headers = [],
        public readonly array $extra = [],
    ) {
        parent::__construct($message);
    }

    public static function notFound(): self
    {
        return new self(404, 'not_found', 'Ressource introuvable.');
    }

    public static function unauthenticated(): self
    {
        return new self(401, 'unauthenticated', 'Authentification requise.');
    }

    public static function badRequest(string $message): self
    {
        return new self(400, 'bad_request', $message);
    }

    public static function rateLimited(int $retryAfter, string $message = 'Trop de tentatives. Réessayez plus tard.'): self
    {
        return new self(429, 'rate_limited', $message, [], ['Retry-After' => (string) max(1, $retryAfter)]);
    }

    /** 409 avec l'état serveur courant, pour que le client puisse fusionner ou recharger. */
    public static function conflict(string $message, mixed $current = null): self
    {
        return new self(409, 'conflict', $message, [], [], $current === null ? [] : ['current' => $current]);
    }

    public static function quotaExceeded(): self
    {
        return new self(413, 'quota_exceeded', 'Espace de stockage du compte épuisé.');
    }
}
