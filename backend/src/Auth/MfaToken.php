<?php

declare(strict_types=1);

namespace Cuvylo\Auth;

use Cuvylo\Config;
use Cuvylo\Support\Clock;

/**
 * Jeton d'étape « deuxième facteur » : prouve que le mot de passe a été vérifié, sans ouvrir de session.
 * Format `<userId>.<expiration>.<aléa>.<HMAC>` (HMAC-SHA-256 d'APP_KEY avec un contexte dédié), valable 5 minutes.
 * Lié à l'empreinte du hash de mot de passe : un changement de mot de passe l'invalide.
 */
final class MfaToken
{
    public const TTL_SECONDS = 300;

    public function __construct(private readonly Config $config, private readonly Clock $clock)
    {
    }

    public function issue(string $userId, string $passwordHash): string
    {
        $payload = $userId . '.' . ($this->clock->now() + self::TTL_SECONDS) . '.' . bin2hex(random_bytes(8));

        return $payload . '.' . $this->sign($payload, $passwordHash);
    }

    /** Identifiant d'utilisateur extrait du jeton, sans vérifier la signature (la vérification suit avec le hash). */
    public static function userId(string $token): ?string
    {
        $parts = explode('.', $token);

        return count($parts) === 4 && preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/D', $parts[0]) === 1 ? $parts[0] : null;
    }

    public function isValid(string $token, string $userId, string $passwordHash): bool
    {
        $parts = explode('.', $token);
        if (count($parts) !== 4 || $parts[0] !== $userId || !ctype_digit($parts[1])) {
            return false;
        }
        if ((int) $parts[1] < $this->clock->now()) {
            return false;
        }

        return hash_equals($this->sign($parts[0] . '.' . $parts[1] . '.' . $parts[2], $passwordHash), $parts[3]);
    }

    private function sign(string $payload, string $passwordHash): string
    {
        return hash_hmac('sha256', 'mfa|' . $payload . '|' . hash('sha256', $passwordHash), $this->config->appKey);
    }
}
