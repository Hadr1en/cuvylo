<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

use Cuvylo\Support\Clock;

/** Écrit chaque message dans MAIL_FILE_DIR (développement, tests de bout en bout). Refusé en production. */
final class FileMailer extends Mailer
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
        $dir = (string) $this->config->fileDir;
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new MailException('Dossier MAIL_FILE_DIR inaccessible.');
        }
        $name = gmdate('Ymd-His', $this->clock->now()) . '-' . bin2hex(random_bytes(4)) . '.eml';
        if (file_put_contents($dir . '/' . $name, $message->render((string) $this->config->from, $this->config->fromName, $this->clock->now())) === false) {
            throw new MailException('Écriture du message impossible.');
        }
    }
}
