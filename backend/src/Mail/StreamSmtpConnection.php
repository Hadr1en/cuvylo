<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

/** Connexion SMTP réelle : TLS d'emblée (`ssl`, port 465) ou STARTTLS (port 587), certificat toujours vérifié. */
final class StreamSmtpConnection implements SmtpConnection
{
    private const TIMEOUT = 15;

    /** @param resource $stream */
    private function __construct(private $stream)
    {
    }

    public static function open(string $host, int $port, string $secure): self
    {
        $context = stream_context_create(['ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'peer_name' => $host,
            'SNI_enabled' => true,
        ]]);
        $scheme = $secure === 'ssl' ? 'ssl' : 'tcp';
        $stream = @stream_socket_client($scheme . '://' . $host . ':' . $port, $errno, $errstr, self::TIMEOUT, STREAM_CLIENT_CONNECT, $context);
        if ($stream === false) {
            throw new MailException('Connexion SMTP impossible (' . $errno . ').');
        }
        stream_set_timeout($stream, self::TIMEOUT);

        return new self($stream);
    }

    public function read(): array
    {
        $lines = [];
        $code = 0;
        while (($line = fgets($this->stream, 1024)) !== false) {
            $code = (int) substr($line, 0, 3);
            $lines[] = rtrim(substr($line, 4), "\r\n");
            // « 250-… » annonce une suite, « 250 … » termine la réponse.
            if (strlen($line) < 4 || $line[3] !== '-') {
                return [$code, $lines];
            }
        }
        throw new MailException('Le serveur SMTP a fermé la connexion ou ne répond pas.');
    }

    public function write(string $data): void
    {
        if (@fwrite($this->stream, $data) === false) {
            throw new MailException('Écriture SMTP impossible.');
        }
    }

    public function startTls(): void
    {
        $method = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT') ? STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT : 0);
        if (@stream_socket_enable_crypto($this->stream, true, $method) !== true) {
            throw new MailException('Négociation TLS impossible avec le serveur SMTP.');
        }
    }

    public function close(): void
    {
        @fclose($this->stream);
    }
}
