<?php

declare(strict_types=1);

namespace Cuvylo\Validation;

/**
 * Collecteur d'erreurs + vérifications de types élémentaires.
 * Chaque méthode retourne la valeur typée si elle est valide, null sinon (l'erreur est alors enregistrée).
 * Une seule erreur par chemin : la première l'emporte. Au plus MAX_ERRORS erreurs sont conservées.
 */
final class Fields
{
    public const MAX_SHORT = 200;
    public const MAX_LONG = 4000;
    public const MAX_URL = 500;
    public const MAX_ERRORS = 50;

    /**
     * Caractères refusés partout : contrôles C0 (sauf tabulation/retours en multiligne), DEL, contrôles C1,
     * et contrôles bidirectionnels (U+061C, U+200E/F, U+202A–U+202E, U+2066–U+2069) qui inversent visuellement le texte.
     */
    private const FORBIDDEN_COMMON = '\x{7F}-\x{9F}\x{061C}\x{200E}\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}';
    private const CTRL_SINGLE_LINE = '/[\x{00}-\x{1F}' . self::FORBIDDEN_COMMON . ']/u';
    private const CTRL_MULTILINE = '/[\x{00}-\x{08}\x{0B}\x{0C}\x{0E}-\x{1F}' . self::FORBIDDEN_COMMON . ']/u';

    /** @var array<string, string> */
    private array $errors = [];

    public static function path(string $parent, string|int $key): string
    {
        return $parent === '' ? (string) $key : $parent . '.' . $key;
    }

    public function error(string $path, string $code): void
    {
        if (!isset($this->errors[$path]) && count($this->errors) >= self::MAX_ERRORS) {
            return;
        }
        $this->errors[$path] ??= $code;
    }

    public function ok(): bool
    {
        return $this->errors === [];
    }

    /** @return array<string, string> */
    public function errors(): array
    {
        return $this->errors;
    }

    public function assertOk(): void
    {
        if ($this->errors !== []) {
            throw new ValidationException($this->errors);
        }
    }

    /** Vrai si la chaîne contient un caractère de contrôle interdit (C0, C1, bidi). */
    public static function hasForbiddenCharacters(string $value, bool $multiline = false): bool
    {
        return preg_match($multiline ? self::CTRL_MULTILINE : self::CTRL_SINGLE_LINE, $value) !== 0;
    }

    /**
     * Objet JSON : tableau associatif aux clés exactement connues.
     *
     * @param list<string> $required
     * @param list<string> $optional
     * @return array<string, mixed>|null
     */
    public function assoc(mixed $value, string $path, array $required, array $optional = []): ?array
    {
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            $this->error($path, 'invalid_type');

            return null;
        }
        foreach (array_keys($value) as $key) {
            if (!in_array((string) $key, $required, true) && !in_array((string) $key, $optional, true)) {
                $this->error(self::path($path, $key), 'unknown_field');
            }
        }
        foreach ($required as $key) {
            if (!array_key_exists($key, $value)) {
                $this->error(self::path($path, $key), 'required');
            }
        }

        return $value;
    }

    /** @return list<mixed>|null */
    public function listOf(mixed $value, string $path, int $max): ?array
    {
        if (!is_array($value) || !array_is_list($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }
        if (count($value) > $max) {
            $this->error($path, 'too_many_items');

            return null;
        }

        return $value;
    }

    public function string(mixed $value, string $path, int $max = self::MAX_SHORT, bool $multiline = false, int $min = 0): ?string
    {
        if (!is_string($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }
        // preg_match échoue (false) sur de l'UTF-8 invalide : traité comme caractère interdit.
        if (!mb_check_encoding($value, 'UTF-8')) {
            $this->error($path, 'invalid_characters');

            return null;
        }
        $length = mb_strlen($value);
        if ($length > $max) {
            $this->error($path, 'too_long');

            return null;
        }
        if ($length < $min) {
            $this->error($path, 'too_short');

            return null;
        }
        if (self::hasForbiddenCharacters($value, $multiline)) {
            $this->error($path, 'invalid_characters');

            return null;
        }

        return $value;
    }

    public function bool(mixed $value, string $path): ?bool
    {
        if (!is_bool($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }

        return $value;
    }

    /** Entier (JSON number sans partie décimale) borné. */
    public function int(mixed $value, string $path, int $min, int $max): ?int
    {
        if (!is_int($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }
        if ($value < $min || $value > $max) {
            $this->error($path, 'out_of_range');

            return null;
        }

        return $value;
    }

    /** @param list<string> $allowed */
    public function enum(mixed $value, string $path, array $allowed): ?string
    {
        if (!is_string($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }
        if (!in_array($value, $allowed, true)) {
            $this->error($path, 'invalid_enum');

            return null;
        }

        return $value;
    }

    public function id(mixed $value, string $path): ?string
    {
        if (!is_string($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }
        if (preg_match('/^[A-Za-z0-9_-]{1,36}$/D', $value) !== 1) {
            $this->error($path, 'invalid_id');

            return null;
        }

        return $value;
    }

    /** Mois `YYYY-MM`, ou chaîne vide si autorisée (format v1, conservé pour compatibilité). */
    public function month(mixed $value, string $path, bool $allowEmpty = true): ?string
    {
        if (!is_string($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }
        if ($value === '' && $allowEmpty) {
            return $value;
        }
        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D', $value) !== 1) {
            $this->error($path, 'invalid_date');

            return null;
        }

        return $value;
    }

    /** Date de profil v2 : `""`, `AAAA` ou `AAAA-MM`. */
    public function partialDate(mixed $value, string $path): ?string
    {
        if (!is_string($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }
        if ($value === '' || preg_match('/^\d{4}(-(0[1-9]|1[0-2]))?$/D', $value) === 1) {
            return $value;
        }
        $this->error($path, 'invalid_date');

        return null;
    }

    /** Date calendaire `AAAA-MM-JJ` valide, ou null si `$nullable`. */
    public function day(mixed $value, string $path, bool $nullable = true): ?string
    {
        if ($value === null && $nullable) {
            return null;
        }
        if (!is_string($value)) {
            $this->error($path, 'invalid_type');

            return null;
        }
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $value, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            $this->error($path, 'invalid_date');

            return null;
        }

        return $value;
    }

    /** URL http(s) ou chaîne vide. */
    public function url(mixed $value, string $path): ?string
    {
        $url = $this->string($value, $path, self::MAX_URL);
        if ($url === null || $url === '') {
            return $url;
        }
        $parts = parse_url($url);
        $valid = preg_match('/\s/', $url) !== 1
            && filter_var($url, FILTER_VALIDATE_URL) !== false
            && is_array($parts)
            && isset($parts['scheme'], $parts['host'])
            && in_array(strtolower($parts['scheme']), ['http', 'https'], true);
        if (!$valid) {
            $this->error($path, 'invalid_url');

            return null;
        }

        return $url;
    }

    public function email(mixed $value, string $path): ?string
    {
        $email = $this->string($value, $path, 190);
        if ($email === null) {
            return null;
        }
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $this->error($path, 'invalid_email');

            return null;
        }

        return $email;
    }
}
