<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

use Cuvylo\Support\Clock;

/** Fonction mail() de PHP, quand l'hébergement la fournit (fréquent en mutualisé), sans identifiants. */
final class PhpMailMailer extends Mailer
{
    public function __construct(private readonly MailConfig $config, private readonly Clock $clock)
    {
    }

    public function enabled(): bool
    {
        return true;
    }

    public function send(Message $message): void
    {
        $headers = $message->headers((string) $this->config->from, $this->config->fromName, $this->clock->now());
        // Expéditeur d'enveloppe = MAIL_FROM : meilleure délivrabilité (SPF) qu'une adresse technique de l'hébergeur.
        $ok = mail($message->to, Message::encodeHeader($message->subject), $message->encodedBody(), $headers, '-f' . $this->config->from);
        if (!$ok) {
            throw new MailException('mail() a refusé le message.');
        }
    }
}
