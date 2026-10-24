<?php

declare(strict_types=1);

namespace Cuvylo\Tests\Support;

use Cuvylo\Support\Clock;

final class FakeClock extends Clock
{
    public function __construct(private int $now)
    {
    }

    public function now(): int
    {
        return $this->now;
    }

    public function advance(int $seconds): void
    {
        $this->now += $seconds;
    }
}
