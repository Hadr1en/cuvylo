<?php

declare(strict_types=1);

namespace Cuvylo;

use Cuvylo\Mail\MailConfig;
use RuntimeException;

final class Config
{
    /**
     * @param list<string> $adminEmails E-mails (minuscules) ayant accès à l'administration
     */
    public function __construct(
        public readonly string $appEnv,
        public readonly string $appUrl,
        public readonly string $appKey,
        public readonly string $dbDsn,
        public readonly ?string $dbUser,
        public readonly ?string $dbPassword,
        public readonly int $sessionLifetimeMinutes,
        public readonly int $sessionAbsoluteLifetimeDays,
        public readonly bool $registrationEnabled,
        public readonly ?string $registrationInviteCode,
        public readonly ?string $logPath,
        public readonly LegalInfo $legal = new LegalInfo(null, null, null, null),
        public readonly array $adminEmails = [],
        public readonly int $storageLimitMb = 25,
        /** Dossier de l'application (CUVYLO_HOME) : fichier MAINTENANCE, var/. Null en tests unitaires. */
        public readonly ?string $home = null,
        /** Inscriptions acceptées par heure et par adresse IP (anti-abus). */
        public readonly int $registrationsPerIpHour = 10,
        /** Code exigé par l'écran d'installation (création du premier compte, administrateur). Null : installation impossible. */
        public readonly ?string $setupCode = null,
        /** Envoi d'e-mails (réinitialisation du mot de passe). Désactivé par défaut. */
        public readonly MailConfig $mail = new MailConfig(),
    ) {
    }

    /** @param array<string, string> $env */
    public static function fromEnv(array $env, ?string $home = null): self
    {
        $appEnv = $env['APP_ENV'] ?? 'production';
        if (!in_array($appEnv, ['production', 'development', 'testing'], true)) {
            throw new RuntimeException('APP_ENV invalide.');
        }

        $appUrl = rtrim($env['APP_URL'] ?? '', '/');
        $parts = parse_url($appUrl);
        if ($parts === false || !isset($parts['scheme'], $parts['host']) || !in_array($parts['scheme'], ['http', 'https'], true)) {
            throw new RuntimeException('APP_URL invalide (origine attendue, ex. https://cv.example.fr).');
        }
        if ($appEnv === 'production' && $parts['scheme'] !== 'https') {
            throw new RuntimeException('APP_URL doit être en https en production.');
        }

        $rawKey = $env['APP_KEY'] ?? '';
        $decoded = base64_decode($rawKey, true);
        $key = ($decoded !== false && $decoded !== '') ? $decoded : $rawKey;
        if (strlen($key) < 32) {
            throw new RuntimeException('APP_KEY doit contenir au moins 32 octets (base64 recommandé).');
        }

        $dsn = $env['DB_DSN'] ?? '';
        if ($dsn === '') {
            throw new RuntimeException('DB_DSN est requis.');
        }

        return new self(
            $appEnv,
            $appUrl,
            $key,
            $dsn,
            self::nullable($env['DB_USER'] ?? null),
            self::nullable($env['DB_PASSWORD'] ?? null),
            self::positiveInt($env['SESSION_LIFETIME_MINUTES'] ?? null, 10080, 'SESSION_LIFETIME_MINUTES'),
            self::positiveInt($env['SESSION_ABSOLUTE_LIFETIME_DAYS'] ?? null, 30, 'SESSION_ABSOLUTE_LIFETIME_DAYS'),
            // Fermé par défaut : une variable oubliée ne doit pas ouvrir l'instance à tout Internet.
            filter_var(($env['REGISTRATION_ENABLED'] ?? '') === '' ? 'false' : $env['REGISTRATION_ENABLED'], FILTER_VALIDATE_BOOLEAN),
            self::nullable($env['REGISTRATION_INVITE_CODE'] ?? null),
            self::nullable($env['LOG_PATH'] ?? null),
            LegalInfo::fromEnv($env),
            self::emails($env['ADMIN_EMAILS'] ?? ''),
            self::positiveInt($env['USER_STORAGE_LIMIT_MB'] ?? null, 25, 'USER_STORAGE_LIMIT_MB'),
            $home,
            self::positiveInt($env['REGISTRATION_MAX_PER_IP_HOUR'] ?? null, 10, 'REGISTRATION_MAX_PER_IP_HOUR'),
            self::setupCode($env['SETUP_CODE'] ?? null),
            MailConfig::fromEnv($env, $appEnv),
        );
    }

    /** Même configuration, inscriptions ouvertes ou fermées (réglage de l'administration, prioritaire sur .env). */
    public function withRegistrationEnabled(bool $enabled): self
    {
        return new self(
            $this->appEnv,
            $this->appUrl,
            $this->appKey,
            $this->dbDsn,
            $this->dbUser,
            $this->dbPassword,
            $this->sessionLifetimeMinutes,
            $this->sessionAbsoluteLifetimeDays,
            $enabled,
            $this->registrationInviteCode,
            $this->logPath,
            $this->legal,
            $this->adminEmails,
            $this->storageLimitMb,
            $this->home,
            $this->registrationsPerIpHour,
            $this->setupCode,
            $this->mail,
        );
    }

    /** Origine publique (`https://hote[:port]`) servant au contrôle de l'en-tête Origin. */
    public function origin(): string
    {
        $parts = parse_url($this->appUrl);

        return $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    }

    public function secureCookies(): bool
    {
        return str_starts_with($this->appUrl, 'https://');
    }

    public function isAdmin(string $email): bool
    {
        return in_array(mb_strtolower(trim($email)), $this->adminEmails, true);
    }

    /**
     * Administrateur : compte créé par l'écran d'installation (`is_admin`) ou adresse listée dans ADMIN_EMAILS.
     *
     * @param array<string, mixed> $user ligne de la table users
     */
    public function isAdminUser(array $user): bool
    {
        return (int) ($user['is_admin'] ?? 0) === 1 || $this->isAdmin((string) ($user['email'] ?? ''));
    }

    /** Code d'installation : vide = désactivé ; sinon assez long pour ne pas être deviné. */
    private static function setupCode(?string $value): ?string
    {
        $value = $value === null ? '' : trim($value);
        if ($value === '') {
            return null;
        }
        if (mb_strlen($value) < 16) {
            throw new RuntimeException('SETUP_CODE doit contenir au moins 16 caractères (ou rester vide).');
        }

        return $value;
    }

    public function storageLimitBytes(): int
    {
        return $this->storageLimitMb * 1024 * 1024;
    }

    /** Présence du fichier témoin `MAINTENANCE` dans CUVYLO_HOME. */
    public function maintenance(): bool
    {
        return $this->home !== null && is_file($this->home . '/MAINTENANCE');
    }

    private static function nullable(?string $value): ?string
    {
        return ($value === null || $value === '') ? null : $value;
    }

    /** @return list<string> */
    private static function emails(string $value): array
    {
        $emails = [];
        foreach (explode(',', $value) as $email) {
            $email = mb_strtolower(trim($email));
            if ($email === '') {
                continue;
            }
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                throw new RuntimeException('ADMIN_EMAILS doit contenir des adresses e-mail séparées par des virgules.');
            }
            $emails[] = $email;
        }

        return array_values(array_unique($emails));
    }

    private static function positiveInt(?string $value, int $default, string $name): int
    {
        if ($value === null || $value === '') {
            return $default;
        }
        if (!ctype_digit($value) || (int) $value < 1) {
            throw new RuntimeException($name . ' doit être un entier positif.');
        }

        return (int) $value;
    }
}
