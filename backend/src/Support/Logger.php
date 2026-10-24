<?php

declare(strict_types=1);

namespace Cuvylo\Support;

/**
 * Journal JSON, une ligne par évènement.
 * Garde-fou : toute clé de contexte évoquant un secret ou une donnée personnelle est masquée,
 * les valeurs non scalaires sont ignorées. Les appelants ne doivent de toute façon jamais y mettre de contenu utilisateur.
 */
final class Logger
{
    private const SENSITIVE_KEY = '/(pass|token|secret|cookie|authorization|email|key|body|data|session|csrf|hash|name|content)/i';

    /** @var callable(string): void */
    private $sink;

    /** @param callable(string): void $sink */
    public function __construct(callable $sink)
    {
        $this->sink = $sink;
    }

    /**
     * Journal fichier. `{month}` dans le chemin est remplacé par le mois UTC courant (`2026-10`) :
     * un fichier par mois, sans tâche de rotation.
     */
    public static function toFile(?string $path, ?callable $now = null): self
    {
        return new self(static function (string $line) use ($path, $now): void {
            if ($path !== null && $path !== '') {
                $file = self::resolvePath($path, $now === null ? time() : (int) $now());
                if (@file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX) !== false) {
                    return;
                }
            }
            error_log($line);
        });
    }

    public static function resolvePath(string $path, int $timestamp): string
    {
        return str_replace('{month}', gmdate('Y-m', $timestamp), $path);
    }

    public static function null(): self
    {
        return new self(static function (string $line): void {
        });
    }

    /** @param array<string, mixed> $context */
    public function info(string $event, array $context = []): void
    {
        $this->write('info', $event, $context);
    }

    /** @param array<string, mixed> $context */
    public function warning(string $event, array $context = []): void
    {
        $this->write('warning', $event, $context);
    }

    /** @param array<string, mixed> $context */
    public function error(string $event, array $context = []): void
    {
        $this->write('error', $event, $context);
    }

    /** @param array<string, mixed> $context */
    private function write(string $level, string $event, array $context): void
    {
        $entry = ['ts' => gmdate('Y-m-d\TH:i:s\Z'), 'level' => $level, 'event' => $event];
        foreach ($context as $key => $value) {
            $key = (string) $key;
            if (preg_match(self::SENSITIVE_KEY, $key) === 1) {
                $entry[$key] = '[redacted]';
            } elseif (is_scalar($value) || $value === null) {
                $entry[$key] = is_string($value) ? mb_substr($value, 0, 200) : $value;
            }
        }
        ($this->sink)(Json::encode($entry));
    }
}
