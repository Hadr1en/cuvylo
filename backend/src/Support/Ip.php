<?php

declare(strict_types=1);

namespace Cuvylo\Support;

/** Normalisation d'adresse IP pour la limitation de débit. */
final class Ip
{
    /**
     * IPv4 inchangée ; IPv6 ramenée à son préfixe /64 (un abonné dispose en général d'un /64 entier :
     * limiter adresse par adresse serait contournable en changeant d'adresse dans le préfixe).
     * Les IPv4 encapsulées (`::ffff:a.b.c.d`) redeviennent des IPv4. Toute autre valeur est rendue telle quelle.
     */
    public static function rateLimitKey(string $ip): string
    {
        $ip = trim($ip);
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            return $ip;
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
            return $ip;
        }
        $packed = inet_pton($ip);
        if ($packed === false || strlen($packed) !== 16) {
            return $ip;
        }
        if (str_starts_with($packed, str_repeat("\0", 10) . "\xff\xff")) {
            return (string) inet_ntop(substr($packed, 12));
        }
        $prefix = substr($packed, 0, 8) . str_repeat("\0", 8);

        return inet_ntop($prefix) . '/64';
    }
}
