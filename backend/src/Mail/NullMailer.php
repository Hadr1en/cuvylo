<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

/** Envoi désactivé (MAIL_TRANSPORT vide) : « Mot de passe oublié » passe alors par l'administrateur. */
final class NullMailer extends Mailer
{
    public function enabled(): bool
    {
        return false;
    }

    public function send(Message $message): void
    {
        throw new MailException('Envoi d\'e-mails non configuré.');
    }
}
