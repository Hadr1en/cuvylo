<?php

declare(strict_types=1);

namespace Cuvylo\Auth;

use Cuvylo\Support\Base32;

/** TOTP RFC 6238 : HMAC-SHA-1, pas de 30 s, 6 chiffres, tolérance d'un pas avant/après. */
final class Totp
{
    public const PERIOD = 30;
    public const DIGITS = 6;
    public const WINDOW = 1;

    /** Nouveau secret aléatoire de 160 bits, encodé en base32. */
    public static function generateSecret(): string
    {
        return Base32::encode(random_bytes(20));
    }

    public static function code(string $secretBase32, int $step): string
    {
        $key = Base32::decode($secretBase32) ?? '';
        $counter = pack('N2', ($step >> 32) & 0xFFFFFFFF, $step & 0xFFFFFFFF);
        $hash = hash_hmac('sha1', $counter, $key, true);
        $offset = ord($hash[19]) & 0x0F;
        $value = ((ord($hash[$offset]) & 0x7F) << 24)
            | (ord($hash[$offset + 1]) << 16)
            | (ord($hash[$offset + 2]) << 8)
            | ord($hash[$offset + 3]);

        return str_pad((string) ($value % (10 ** self::DIGITS)), self::DIGITS, '0', STR_PAD_LEFT);
    }

    public static function step(int $timestamp): int
    {
        return intdiv($timestamp, self::PERIOD);
    }

    /**
     * @param int|null $lastUsedStep Dernier pas accepté (anti-rejeu) : un pas ≤ à celui-ci est refusé.
     * @return int|null Pas reconnu, null si le code est faux, rejoué ou mal formé.
     */
    public static function verify(string $secretBase32, string $code, int $timestamp, ?int $lastUsedStep = null): ?int
    {
        $code = preg_replace('/\s+/', '', $code) ?? '';
        if (preg_match('/^\d{' . self::DIGITS . '}$/D', $code) !== 1) {
            return null;
        }
        $current = self::step($timestamp);
        for ($delta = -self::WINDOW; $delta <= self::WINDOW; $delta++) {
            $step = $current + $delta;
            if ($lastUsedStep !== null && $step <= $lastUsedStep) {
                continue;
            }
            if (hash_equals(self::code($secretBase32, $step), $code)) {
                return $step;
            }
        }

        return null;
    }

    public static function uri(string $secretBase32, string $account, string $issuer = 'Cuvylo'): string
    {
        return 'otpauth://totp/' . rawurlencode($issuer) . ':' . rawurlencode($account)
            . '?secret=' . $secretBase32
            . '&issuer=' . rawurlencode($issuer)
            . '&algorithm=SHA1&digits=' . self::DIGITS . '&period=' . self::PERIOD;
    }
}
