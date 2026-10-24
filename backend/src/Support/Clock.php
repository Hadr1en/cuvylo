<?php

declare(strict_types=1);

namespace Cuvylo\Support;

/** Horloge injectable (tests : voir tests/Support/FakeClock.php). */
class Clock
{
    public function now(): int
    {
        return time();
    }

    /** Horodatage au format de stockage SQL (UTC). */
    public function sql(?int $timestamp = null): string
    {
        return gmdate('Y-m-d H:i:s', $timestamp ?? $this->now());
    }

    public static function sqlToTimestamp(string $sql): int
    {
        $ts = strtotime($sql . ' UTC');

        return $ts === false ? 0 : $ts;
    }

    /** `2026-10-24 09:30:00` → `2026-10-24T09:30:00Z`. */
    public static function sqlToIso(string $sql): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', self::sqlToTimestamp($sql));
    }
}
