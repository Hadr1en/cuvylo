<?php

declare(strict_types=1);

namespace Cuvylo\Support;

/**
 * Libellé grossier d'appareil pour la liste des sessions : navigateur + système, sans version
 * ni autre détail (minimisation : le User-Agent complet n'est jamais conservé).
 */
final class DeviceLabel
{
    public static function fromUserAgent(?string $userAgent): string
    {
        $ua = (string) $userAgent;
        if ($ua === '') {
            return 'Appareil inconnu';
        }

        $browser = match (true) {
            str_contains($ua, 'Edg/') || str_contains($ua, 'Edge/') => 'Edge',
            str_contains($ua, 'OPR/') || str_contains($ua, 'Opera') => 'Opera',
            str_contains($ua, 'SamsungBrowser/') => 'Samsung Internet',
            str_contains($ua, 'Firefox/') || str_contains($ua, 'FxiOS/') => 'Firefox',
            str_contains($ua, 'Chrome/') || str_contains($ua, 'CriOS/') || str_contains($ua, 'Chromium/') => 'Chrome',
            str_contains($ua, 'Safari/') => 'Safari',
            default => null,
        };

        $os = match (true) {
            str_contains($ua, 'iPhone') || str_contains($ua, 'iPod') => 'iOS',
            str_contains($ua, 'iPad') => 'iPadOS',
            str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'CrOS') => 'ChromeOS',
            str_contains($ua, 'Windows') => 'Windows',
            str_contains($ua, 'Mac OS X') || str_contains($ua, 'Macintosh') => 'macOS',
            str_contains($ua, 'Linux') => 'Linux',
            default => null,
        };

        if ($browser === null && $os === null) {
            return 'Appareil inconnu';
        }

        return ($browser ?? 'Navigateur inconnu') . ' · ' . ($os ?? 'système inconnu');
    }
}
