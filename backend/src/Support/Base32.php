<?php

declare(strict_types=1);

namespace Cuvylo\Support;

/** Base32 RFC 4648 (alphabet A–Z2–7), sans remplissage : format attendu par les applications TOTP. */
final class Base32
{
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function encode(string $bytes): string
    {
        $bits = '';
        foreach (str_split($bytes) as $char) {
            if ($char === '') {
                continue;
            }
            $bits .= str_pad(decbin(ord($char)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            if ($chunk === '') {
                continue;
            }
            $out .= self::ALPHABET[bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))];
        }

        return $out;
    }

    /** @return string|null Octets décodés, null si la chaîne contient un caractère hors alphabet. */
    public static function decode(string $text): ?string
    {
        $text = strtoupper(rtrim(str_replace([' ', '-'], '', $text), '='));
        $bits = '';
        foreach (str_split($text) as $char) {
            if ($char === '') {
                continue;
            }
            $value = strpos(self::ALPHABET, $char);
            if ($value === false) {
                return null;
            }
            $bits .= str_pad(decbin($value), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $out .= chr(bindec($byte));
            }
        }

        return $out;
    }
}
