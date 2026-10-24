<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

use Cuvylo\Support\Clock;

/** Envoi d'un message. Une erreur d'envoi lève MailException (jamais de détail sensible dans le message). */
abstract class Mailer
{
    abstract public function enabled(): bool;

    /** @throws MailException */
    abstract public function send(Message $message): void;

    public static function fromConfig(MailConfig $config, Clock $clock): self
    {
        return match ($config->transport) {
            'smtp' => new SmtpMailer($config, $clock),
            'mail' => new PhpMailMailer($config, $clock),
            'file' => new FileMailer($config, $clock),
            default => new NullMailer(),
        };
    }
}
