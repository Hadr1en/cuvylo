<?php

declare(strict_types=1);

namespace Cuvylo\Support;

/**
 * Documents JSON stockés en base, éventuellement compressés (`gz:` + base64 de `gzcompress`).
 * La lecture accepte les deux formes : les lignes antérieures à la compression restent lisibles.
 */
final class StoredJson
{
    private const PREFIX = 'gz:';

    public static function encode(mixed $value, bool $compress = false): string
    {
        $json = Json::encode($value);
        if (!$compress || !function_exists('gzcompress')) {
            return $json;
        }
        $packed = gzcompress($json, 6);

        return $packed === false ? $json : self::PREFIX . base64_encode($packed);
    }

    public static function decode(string $stored): mixed
    {
        if (str_starts_with($stored, self::PREFIX)) {
            $raw = base64_decode(substr($stored, strlen(self::PREFIX)), true);
            $json = $raw === false ? false : @gzuncompress($raw);
            if ($json === false) {
                throw new \RuntimeException('Document compressé illisible.');
            }

            return Json::decode($json);
        }

        return Json::decode($stored);
    }
}
