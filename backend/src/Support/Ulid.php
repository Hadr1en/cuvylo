<?php

declare(strict_types=1);

namespace Cuvylo\Support;

/** ULID : 48 bits d'horodatage (ms) + 80 bits aléatoires, encodés en Crockford base32 (26 car.). */
final class Ulid
{
    private const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    public const PATTERN = '/^[0-9A-HJKMNP-TV-Z]{26}$/D';

    public static function generate(?int $timestampSeconds = null): string
    {
        $ms = ($timestampSeconds ?? time()) * 1000 + random_int(0, 999);

        $time = '';
        for ($i = 0; $i < 10; $i++) {
            $time = self::ALPHABET[$ms % 32] . $time;
            $ms = intdiv($ms, 32);
        }

        $random = '';
        for ($i = 0; $i < 16; $i++) {
            $random .= self::ALPHABET[random_int(0, 31)];
        }

        return $time . $random;
    }

    public static function isValid(string $value): bool
    {
        return preg_match(self::PATTERN, $value) === 1;
    }
}
