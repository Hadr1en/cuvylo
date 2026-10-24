<?php

declare(strict_types=1);

namespace Cuvylo\Support;

use RuntimeException;

/**
 * Chiffrement authentifié AES-256-GCM (extension openssl) pour les données sensibles stockées en base (TOTP).
 * La clé est dérivée d'APP_KEY par HMAC avec un contexte : la même APP_KEY sert ailleurs (CSRF, HMAC d'IP)
 * sans que les usages se recouvrent. Format : `v1:` + base64(iv[12] ‖ tag[16] ‖ chiffré).
 */
final class Sealer
{
    private const CIPHER = 'aes-256-gcm';
    private const PREFIX = 'v1:';

    private readonly string $key;

    public function __construct(string $appKey, string $context = 'cuvylo/totp')
    {
        $this->key = hash_hmac('sha256', $context, $appKey, true);
    }

    public static function available(): bool
    {
        return function_exists('openssl_encrypt') && in_array(self::CIPHER, openssl_get_cipher_methods(), true);
    }

    public function seal(string $plain): string
    {
        if (!self::available()) {
            throw new RuntimeException('openssl (aes-256-gcm) indisponible.');
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, self::CIPHER, $this->key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($cipher === false) {
            throw new RuntimeException('Chiffrement impossible.');
        }

        return self::PREFIX . base64_encode($iv . $tag . $cipher);
    }

    /** @return string|null Clair, null si le message est altéré, mal formé ou chiffré avec une autre clé. */
    public function open(string $sealed): ?string
    {
        if (!str_starts_with($sealed, self::PREFIX) || !self::available()) {
            return null;
        }
        $raw = base64_decode(substr($sealed, strlen(self::PREFIX)), true);
        if ($raw === false || strlen($raw) < 28) {
            return null;
        }
        $plain = openssl_decrypt(substr($raw, 28), self::CIPHER, $this->key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));

        return $plain === false ? null : $plain;
    }
}
