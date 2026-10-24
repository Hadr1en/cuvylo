<?php

declare(strict_types=1);

namespace Cuvylo\Auth;

/**
 * `password_hash` natif. Le mot de passe est d'abord condensé (SHA-256 → base64, 44 car.) :
 * bcrypt tronque silencieusement au-delà de 72 octets, ce qui ferait ignorer la fin d'une longue phrase de passe.
 */
final class LoginHasher
{
    private static ?string $dummyHash = null;

    public function hash(string $plain): string
    {
        return password_hash(self::prepare($plain), PASSWORD_DEFAULT);
    }

    public function verify(string $plain, string $hash): bool
    {
        return password_verify(self::prepare($plain), $hash);
    }

    public function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_DEFAULT);
    }

    /** Vérification factice (compte inconnu) pour que le temps de réponse ne révèle pas l'existence du compte. */
    public function dummyVerify(string $plain): void
    {
        self::$dummyHash ??= password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
        password_verify(self::prepare($plain), self::$dummyHash);
    }

    private static function prepare(string $plain): string
    {
        return base64_encode(hash('sha256', $plain, true));
    }
}
