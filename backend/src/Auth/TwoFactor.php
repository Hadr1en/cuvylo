<?php

declare(strict_types=1);

namespace Cuvylo\Auth;

use Cuvylo\Config;
use Cuvylo\Support\Base32;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Json;
use Cuvylo\Support\Sealer;

/**
 * Double authentification TOTP. Le secret est stocké chiffré (AES-256-GCM, clé dérivée d'APP_KEY) avec le
 * dernier pas accepté (anti-rejeu) ; les 10 codes de secours ne sont stockés que sous forme d'empreintes HMAC
 * et sont consommés à l'usage.
 */
final class TwoFactor
{
    public const RECOVERY_CODES = 10;

    private readonly Sealer $sealer;

    public function __construct(private readonly Config $config, private readonly Clock $clock)
    {
        $this->sealer = new Sealer($config->appKey, 'cuvylo/totp');
    }

    public static function available(): bool
    {
        return Sealer::available();
    }

    /** @return array{secret: string, sealed: string} Nouveau secret (à confirmer) et sa forme chiffrée. */
    public function newPending(): array
    {
        $secret = Totp::generateSecret();

        return ['secret' => $secret, 'sealed' => $this->seal($secret, null)];
    }

    public function seal(string $secret, ?int $lastStep): string
    {
        return $this->sealer->seal(Json::encode(['s' => $secret, 'l' => $lastStep]));
    }

    /** @return array{s: string, l: int|null}|null */
    public function open(?string $sealed): ?array
    {
        if ($sealed === null || $sealed === '') {
            return null;
        }
        $plain = $this->sealer->open($sealed);
        if ($plain === null) {
            return null;
        }
        $state = json_decode($plain, true);
        if (!is_array($state) || !is_string($state['s'] ?? null)) {
            return null;
        }

        return ['s' => $state['s'], 'l' => is_int($state['l'] ?? null) ? $state['l'] : null];
    }

    /**
     * Vérifie un code TOTP contre un secret chiffré.
     *
     * @return string|null Nouvelle forme chiffrée (dernier pas mis à jour) si le code est bon, null sinon.
     */
    public function verifyTotp(?string $sealed, string $code): ?string
    {
        $state = $this->open($sealed);
        if ($state === null) {
            return null;
        }
        $step = Totp::verify($state['s'], $code, $this->clock->now(), $state['l']);

        return $step === null ? null : $this->seal($state['s'], $step);
    }

    /** @return array{codes: list<string>, stored: string} Codes en clair (montrés une fois) et empreintes à stocker. */
    public function newRecoveryCodes(): array
    {
        $codes = [];
        for ($i = 0; $i < self::RECOVERY_CODES; $i++) {
            $raw = strtolower(substr(Base32::encode(random_bytes(7)), 0, 10));
            $codes[] = substr($raw, 0, 5) . '-' . substr($raw, 5, 5);
        }

        return ['codes' => $codes, 'stored' => Json::encode(array_map(fn (string $c): string => $this->recoveryHash($c), $codes))];
    }

    /**
     * Consomme un code de secours.
     *
     * @return string|null Liste d'empreintes restantes (à stocker) si le code était valide, null sinon.
     */
    public function consumeRecovery(?string $stored, string $code): ?string
    {
        if ($stored === null || $stored === '') {
            return null;
        }
        $hashes = json_decode($stored, true);
        if (!is_array($hashes)) {
            return null;
        }
        $candidate = $this->recoveryHash($code);
        foreach ($hashes as $i => $hash) {
            if (is_string($hash) && hash_equals($hash, $candidate)) {
                unset($hashes[$i]);

                return Json::encode(array_values($hashes));
            }
        }

        return null;
    }

    public static function remainingRecovery(?string $stored): int
    {
        $hashes = $stored === null ? null : json_decode($stored, true);

        return is_array($hashes) ? count($hashes) : 0;
    }

    private function recoveryHash(string $code): string
    {
        $normalized = strtolower((string) preg_replace('/[\s-]+/', '', $code));

        return hash_hmac('sha256', 'recovery|' . $normalized, $this->config->appKey);
    }
}
