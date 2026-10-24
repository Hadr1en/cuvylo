<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

use Closure;
use Cuvylo\Support\Clock;

/**
 * Client SMTP minimal sans dépendance : EHLO, STARTTLS (si demandé), AUTH PLAIN ou LOGIN, MAIL/RCPT/DATA.
 * Fonctionne avec tout fournisseur SMTP authentifié. Jamais de connexion ni d'authentification en clair :
 * TLS d'emblée (port 465) ou STARTTLS obligatoire (port 587). Les erreurs ne reprennent que le code SMTP
 * (le texte du serveur peut contenir des adresses).
 */
final class SmtpMailer extends Mailer
{
    /** @var Closure(): SmtpConnection */
    private readonly Closure $connect;

    /** @param (Closure(): SmtpConnection)|null $connect fabrique de connexion (tests) */
    public function __construct(private readonly MailConfig $config, private readonly Clock $clock, ?Closure $connect = null)
    {
        $this->connect = $connect ?? static fn (): SmtpConnection => StreamSmtpConnection::open((string) $config->smtpHost, $config->smtpPort, $config->smtpSecure);
    }

    public function enabled(): bool
    {
        return true;
    }

    public function send(Message $message): void
    {
        $from = (string) $this->config->from;
        $conn = ($this->connect)();
        try {
            $this->expect($conn, [220]);
            $helo = substr($from, (int) strrpos($from, '@') + 1);
            $capabilities = $this->command($conn, 'EHLO ' . $helo, [250]);
            if ($this->config->smtpSecure === 'starttls') {
                $this->command($conn, 'STARTTLS', [220]);
                $conn->startTls();
                $capabilities = $this->command($conn, 'EHLO ' . $helo, [250]);
            }
            $this->authenticate($conn, $capabilities);
            $this->command($conn, 'MAIL FROM:<' . $from . '>', [250]);
            $this->command($conn, 'RCPT TO:<' . $message->to . '>', [250, 251]);
            $this->command($conn, 'DATA', [354]);
            // Transparence (RFC 5321 §4.5.2) : un point en début de ligne est doublé.
            $data = preg_replace('/^\./m', '..', $message->render($from, $this->config->fromName, $this->clock->now()));
            $conn->write($data . ".\r\n");
            $this->expect($conn, [250]);
            try {
                $conn->write("QUIT\r\n");
                $conn->read();
            } catch (MailException) {
                // Message déjà accepté : une fin de session brutale n'est pas une erreur.
            }
        } finally {
            $conn->close();
        }
    }

    /** @param list<string> $capabilities */
    private function authenticate(SmtpConnection $conn, array $capabilities): void
    {
        $methods = [];
        foreach ($capabilities as $line) {
            if (preg_match('/^AUTH[ =](.+)$/i', $line, $m) === 1) {
                $methods = array_merge($methods, preg_split('/\s+/', strtoupper(trim($m[1]))) ?: []);
            }
        }
        $user = (string) $this->config->smtpUser;
        $password = (string) $this->config->smtpPassword;
        if (in_array('PLAIN', $methods, true) || $methods === []) {
            $this->command($conn, 'AUTH PLAIN ' . base64_encode("\0" . $user . "\0" . $password), [235], 'AUTH PLAIN');
        } elseif (in_array('LOGIN', $methods, true)) {
            $this->command($conn, 'AUTH LOGIN', [334]);
            $this->command($conn, base64_encode($user), [334], 'AUTH LOGIN (utilisateur)');
            $this->command($conn, base64_encode($password), [235], 'AUTH LOGIN (mot de passe)');
        } else {
            throw new MailException('Le serveur SMTP ne propose ni AUTH PLAIN ni AUTH LOGIN.');
        }
    }

    /**
     * @param list<int> $accepted
     * @return list<string>
     */
    private function command(SmtpConnection $conn, string $line, array $accepted, ?string $label = null): array
    {
        $conn->write($line . "\r\n");

        return $this->expect($conn, $accepted, $label ?? strtok($line, ' '));
    }

    /**
     * @param list<int> $accepted
     * @return list<string>
     */
    private function expect(SmtpConnection $conn, array $accepted, string $step = 'connexion'): array
    {
        [$code, $lines] = $conn->read();
        if (!in_array($code, $accepted, true)) {
            // Seulement l'étape et le code : jamais les identifiants ni le texte du serveur.
            throw new MailException('Refus du serveur SMTP à l\'étape ' . $step . ' (code ' . $code . ').');
        }

        return $lines;
    }
}
