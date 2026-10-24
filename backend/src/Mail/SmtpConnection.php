<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

/** Canal SMTP (séparé du dialogue pour pouvoir tester celui-ci sans réseau). */
interface SmtpConnection
{
    /** @return array{int, list<string>} code de réponse et lignes de texte (réponse multi-lignes réunie). */
    public function read(): array;

    public function write(string $data): void;

    /** Passe la connexion en TLS (après STARTTLS), certificat vérifié. */
    public function startTls(): void;

    public function close(): void;
}
