<?php

declare(strict_types=1);

namespace Cuvylo\Tests\Support;

use Cuvylo\Mail\MailException;
use Cuvylo\Mail\Mailer;
use Cuvylo\Mail\Message;

/** Mailer de test : garde les messages en mémoire, ou échoue sur demande. */
final class RecordingMailer extends Mailer
{
    /** @var list<Message> */
    public array $sent = [];
    public bool $fail = false;

    public function enabled(): bool
    {
        return true;
    }

    public function send(Message $message): void
    {
        if ($this->fail) {
            throw new MailException('Refus du serveur SMTP à l\'étape RCPT (code 550).');
        }
        $this->sent[] = $message;
    }

    /** Lien de réinitialisation contenu dans le dernier message envoyé à cette adresse. */
    public function lastResetToken(string $to): ?string
    {
        for ($i = count($this->sent) - 1; $i >= 0; $i--) {
            if ($this->sent[$i]->to === $to && preg_match('#/reinitialisation/([A-Za-z0-9_-]{43})#', $this->sent[$i]->body, $m) === 1) {
                return $m[1];
            }
        }

        return null;
    }
}
