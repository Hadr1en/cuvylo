<?php

declare(strict_types=1);

namespace Cuvylo\Support;

/** Jetons aléatoires opaques (base64url sans remplissage) et leur empreinte de stockage. */
final class Token
{
    /** 32 octets → 43 caractères. */
    public static function generate(int $bytes = 32): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function looksValid(string $token, int $length = 43): bool
    {
        return preg_match('/^[A-Za-z0-9_-]{' . $length . '}$/D', $token) === 1;
    }
}
