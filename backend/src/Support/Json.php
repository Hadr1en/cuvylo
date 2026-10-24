<?php

declare(strict_types=1);

namespace Cuvylo\Support;

final class Json
{
    public static function encode(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public static function decode(string $json): mixed
    {
        return json_decode($json, true, 64, JSON_THROW_ON_ERROR);
    }

    /** Forme canonique (clés d'objets triées) pour comparer deux documents sans tenir compte de l'ordre des clés. */
    public static function canonical(mixed $value): string
    {
        return self::encode(self::sortKeys($value));
    }

    private static function sortKeys(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        $sorted = array_map([self::class, 'sortKeys'], $value);
        if (!array_is_list($sorted)) {
            ksort($sorted);
        }

        return $sorted;
    }
}
