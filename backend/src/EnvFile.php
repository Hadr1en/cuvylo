<?php

declare(strict_types=1);

namespace Cuvylo;

/** Lecteur minimal de fichier `.env` (KEY=VALUE, commentaires `#`, guillemets simples ou doubles). */
final class EnvFile
{
    public const KEYS = [
        'APP_ENV', 'APP_URL', 'APP_KEY', 'DB_DSN', 'DB_USER', 'DB_PASSWORD',
        'SESSION_LIFETIME_MINUTES', 'SESSION_ABSOLUTE_LIFETIME_DAYS',
        'REGISTRATION_ENABLED', 'REGISTRATION_INVITE_CODE', 'LOG_PATH',
        'LEGAL_PUBLISHER', 'LEGAL_CONTACT_EMAIL', 'LEGAL_HOST', 'SECURITY_CONTACT_EMAIL',
        'ADMIN_EMAILS', 'USER_STORAGE_LIMIT_MB', 'REGISTRATION_MAX_PER_IP_HOUR', 'SETUP_CODE',
        'MAIL_TRANSPORT', 'MAIL_FROM', 'MAIL_FROM_NAME', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FILE_DIR',
    ];

    /** @return array<string, string> */
    public static function parse(string $contents): array
    {
        $values = [];
        foreach (preg_split('/\R/', $contents) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            if (str_starts_with($line, 'export ')) {
                $line = ltrim(substr($line, 7));
            }
            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }
            $key = trim(substr($line, 0, $pos));
            if (preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $key) !== 1) {
                continue;
            }
            $values[$key] = self::parseValue(trim(substr($line, $pos + 1)));
        }

        return $values;
    }

    /** @return array<string, string> Tableau vide si le fichier n'existe pas. */
    public static function load(string $path): array
    {
        if (!is_file($path) || !is_readable($path)) {
            return [];
        }

        return self::parse((string) file_get_contents($path));
    }

    /**
     * Fichier `.env`, puis variables d'environnement réelles (prioritaires) pour les clés connues.
     *
     * @return array<string, string>
     */
    public static function loadWithEnvironment(string $path): array
    {
        $values = self::load($path);
        foreach (self::KEYS as $key) {
            $real = getenv($key);
            if ($real !== false) {
                $values[$key] = $real;
            }
        }

        return $values;
    }

    /**
     * Contenu d'un fichier `.env` relu à l'identique par parse() : chaque valeur est entre guillemets doubles
     * (parse() s'arrête au DERNIER guillemet, un guillemet interne est donc conservé ; « # » n'y est pas un commentaire).
     *
     * @param array<string, string> $values
     * @param list<string> $comments lignes de commentaire placées en tête
     */
    public static function render(array $values, array $comments = []): string
    {
        $lines = array_map(static fn (string $c): string => '# ' . $c, $comments);
        if ($lines !== []) {
            $lines[] = '';
        }
        foreach ($values as $key => $value) {
            if (preg_match('/^[A-Z_][A-Z0-9_]*$/', $key) !== 1 || preg_match('/[\x00-\x1F\x7F]/', $value) === 1) {
                throw new \InvalidArgumentException('Clé ou valeur impossible à écrire dans .env : ' . $key);
            }
            $lines[] = $key . '="' . $value . '"';
        }

        return implode("\n", $lines) . "\n";
    }

    private static function parseValue(string $raw): string
    {
        if ($raw === '') {
            return '';
        }
        $quote = $raw[0];
        if (($quote === '"' || $quote === "'") && strlen($raw) >= 2) {
            $end = strrpos($raw, $quote);
            if ($end !== false && $end > 0) {
                return substr($raw, 1, $end - 1);
            }
        }
        $hash = strpos($raw, ' #');

        return $hash === false ? $raw : rtrim(substr($raw, 0, $hash));
    }
}
