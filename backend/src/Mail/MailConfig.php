<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

use RuntimeException;

/**
 * Envoi d'e-mails (réinitialisation de mot de passe et confirmation de changement). Transports :
 * - `` (vide) : aucun envoi ; « Mot de passe oublié » passe alors par l'administrateur ;
 * - `smtp`  : n'importe quel serveur SMTP authentifié (boîte e-mail de votre domaine, Gmail, Brevo, Mailgun…) — recommandé ;
 * - `mail`  : fonction mail() de PHP, quand l'hébergement la fournit ;
 * - `file`  : écrit chaque message dans un dossier (.eml) — développement et tests uniquement.
 */
final class MailConfig
{
    public const TRANSPORTS = ['', 'smtp', 'mail', 'file'];

    public function __construct(
        public readonly string $transport = '',
        public readonly ?string $from = null,
        public readonly string $fromName = 'Cuvylo',
        public readonly ?string $smtpHost = null,
        public readonly int $smtpPort = 465,
        /** `ssl` (TLS dès la connexion, port 465) ou `starttls` (port 587). Jamais de connexion en clair. */
        public readonly string $smtpSecure = 'ssl',
        public readonly ?string $smtpUser = null,
        public readonly ?string $smtpPassword = null,
        public readonly ?string $fileDir = null,
    ) {
    }

    public function enabled(): bool
    {
        return $this->transport !== '';
    }

    /** @param array<string, string> $env */
    public static function fromEnv(array $env, string $appEnv): self
    {
        $transport = strtolower(trim($env['MAIL_TRANSPORT'] ?? ''));
        if (!in_array($transport, self::TRANSPORTS, true)) {
            throw new RuntimeException('MAIL_TRANSPORT doit valoir smtp, mail, file ou rester vide.');
        }
        if ($transport === '') {
            return new self();
        }
        if ($transport === 'file' && $appEnv === 'production') {
            throw new RuntimeException('MAIL_TRANSPORT=file est réservé au développement et aux tests.');
        }

        $from = trim($env['MAIL_FROM'] ?? '');
        if (filter_var($from, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('MAIL_FROM doit être une adresse e-mail valide (expéditeur des messages).');
        }
        $fromName = trim($env['MAIL_FROM_NAME'] ?? '') ?: 'Cuvylo';
        if (preg_match('/[\x00-\x1F\x7F]/', $fromName) === 1 || mb_strlen($fromName) > 80) {
            throw new RuntimeException('MAIL_FROM_NAME : une ligne de 80 caractères au plus.');
        }

        if ($transport === 'smtp') {
            $host = trim($env['SMTP_HOST'] ?? '');
            if ($host === '' || preg_match('/^[A-Za-z0-9.-]+$/', $host) !== 1) {
                throw new RuntimeException('SMTP_HOST est requis (ex. smtp.example.org).');
            }
            $secure = strtolower(trim($env['SMTP_SECURE'] ?? '') ?: 'ssl');
            if (!in_array($secure, ['ssl', 'starttls'], true)) {
                throw new RuntimeException('SMTP_SECURE doit valoir ssl (port 465) ou starttls (port 587).');
            }
            $port = trim($env['SMTP_PORT'] ?? '') ?: ($secure === 'ssl' ? '465' : '587');
            if (!ctype_digit($port) || (int) $port < 1 || (int) $port > 65535) {
                throw new RuntimeException('SMTP_PORT invalide.');
            }
            $user = trim($env['SMTP_USER'] ?? '');
            $password = $env['SMTP_PASSWORD'] ?? '';
            if ($user === '' || $password === '') {
                throw new RuntimeException('SMTP_USER et SMTP_PASSWORD sont requis pour MAIL_TRANSPORT=smtp.');
            }

            return new self('smtp', $from, $fromName, $host, (int) $port, $secure, $user, $password);
        }

        if ($transport === 'file') {
            $dir = trim($env['MAIL_FILE_DIR'] ?? '');
            if ($dir === '') {
                throw new RuntimeException('MAIL_FILE_DIR est requis pour MAIL_TRANSPORT=file.');
            }

            return new self('file', $from, $fromName, fileDir: $dir);
        }

        return new self('mail', $from, $fromName);
    }
}
