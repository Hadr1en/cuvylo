<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

use InvalidArgumentException;

/**
 * Message texte (UTF-8, sans HTML). Le destinataire est validé et aucun champ d'en-tête ne peut
 * contenir de retour à la ligne : pas d'injection d'en-têtes.
 */
final class Message
{
    public function __construct(
        public readonly string $to,
        public readonly string $subject,
        public readonly string $body,
    ) {
        if (filter_var($to, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $to) === 1) {
            throw new InvalidArgumentException('Destinataire invalide.');
        }
        if (preg_match('/[\r\n]/', $subject) === 1) {
            throw new InvalidArgumentException('Objet invalide.');
        }
    }

    /** Encodage RFC 2047 d'un texte d'en-tête non ASCII. */
    public static function encodeHeader(string $text): string
    {
        return preg_match('/[^\x20-\x7E]/', $text) === 1 ? '=?UTF-8?B?' . base64_encode($text) . '?=' : $text;
    }

    /** @return array<string, string> En-têtes (hors To et Subject, fournis séparément à mail()). */
    public function headers(string $from, string $fromName, int $timestamp): array
    {
        $domain = substr($from, (int) strrpos($from, '@') + 1);

        return [
            'From' => self::encodeHeader($fromName) . ' <' . $from . '>',
            'Date' => gmdate('D, d M Y H:i:s', $timestamp) . ' +0000',
            'Message-ID' => '<' . bin2hex(random_bytes(12)) . '@' . $domain . '>',
            'MIME-Version' => '1.0',
            'Content-Type' => 'text/plain; charset=UTF-8',
            'Content-Transfer-Encoding' => 'base64',
            'Auto-Submitted' => 'auto-generated',
        ];
    }

    /** Corps encodé en base64 (lignes de 76 caractères), sans problème de point en début de ligne. */
    public function encodedBody(): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $this->body);

        return rtrim(chunk_split(base64_encode(str_replace("\n", "\r\n", $text)), 76, "\r\n"));
    }

    /** Message complet (RFC 5322) pour SMTP ou fichier .eml. */
    public function render(string $from, string $fromName, int $timestamp): string
    {
        $lines = ['To: ' . $this->to, 'Subject: ' . self::encodeHeader($this->subject)];
        foreach ($this->headers($from, $fromName, $timestamp) as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }

        return implode("\r\n", $lines) . "\r\n\r\n" . $this->encodedBody() . "\r\n";
    }
}
