<?php

declare(strict_types=1);

namespace Cuvylo\Http;

use Cuvylo\Support\Json;

final class Response
{
    /** @var array<string, array{value: string, options: array<string, mixed>}> */
    private array $cookies = [];

    /** @var (callable(callable(string): void): void)|null */
    private $streamWriter = null;

    /** @param array<string, string> $headers */
    private function __construct(
        public readonly int $status,
        private readonly ?string $body,
        private array $headers,
    ) {
    }

    /** @param array<string, string> $headers */
    public static function json(mixed $payload, int $status = 200, array $headers = []): self
    {
        return new self($status, Json::encode($payload), ['Content-Type' => 'application/json; charset=utf-8'] + $headers);
    }

    /** @param array<string, string> $headers */
    public static function text(string $body, int $status = 200, array $headers = []): self
    {
        return new self($status, $body, ['Content-Type' => 'text/plain; charset=utf-8'] + $headers);
    }

    public static function noContent(): self
    {
        return new self(204, null, []);
    }

    /**
     * Réponse diffusée en flux (sauvegarde SQL) : `$writer` reçoit une fonction d'écriture et l'appelle par morceaux.
     *
     * @param callable(callable(string): void): void $writer
     * @param array<string, string> $headers
     */
    public static function stream(callable $writer, string $contentType, array $headers = []): self
    {
        $response = new self(200, null, ['Content-Type' => $contentType] + $headers);
        $response->streamWriter = $writer;

        return $response;
    }

    /**
     * @param array<string, string> $fields
     * @param array<string, string> $headers
     * @param array<string, mixed>  $extra
     */
    public static function error(int $status, string $code, string $message, array $fields = [], array $headers = [], array $extra = []): self
    {
        $error = ['code' => $code, 'message' => $message];
        if ($fields !== []) {
            $error['fields'] = $fields;
        }
        foreach ($extra as $key => $value) {
            $error[$key] ??= $value;
        }

        return self::json(['error' => $error], $status, $headers);
    }

    public function withHeader(string $name, string $value): self
    {
        $this->headers[$name] = $value;

        return $this;
    }

    /** @param array<string, mixed> $options expires, path, secure, httponly, samesite */
    public function withCookie(string $name, string $value, array $options): self
    {
        $this->cookies[$name] = ['value' => $value, 'options' => $options];

        return $this;
    }

    public function hasCookie(string $name): bool
    {
        return isset($this->cookies[$name]);
    }

    /** @return array<string, array{value: string, options: array<string, mixed>}> */
    public function cookies(): array
    {
        return $this->cookies;
    }

    /** @return array<string, string> */
    public function headers(): array
    {
        return $this->headers;
    }

    public function header(string $name): ?string
    {
        foreach ($this->headers as $key => $value) {
            if (strcasecmp($key, $name) === 0) {
                return $value;
            }
        }

        return null;
    }

    /** Corps complet (un flux est alors entièrement produit en mémoire : réservé aux tests). */
    public function body(): string
    {
        if ($this->streamWriter !== null) {
            $buffer = '';
            ($this->streamWriter)(static function (string $chunk) use (&$buffer): void {
                $buffer .= $chunk;
            });

            return $buffer;
        }

        return $this->body ?? '';
    }

    public function isStream(): bool
    {
        return $this->streamWriter !== null;
    }

    /** Corps décodé (utile aux tests). */
    public function data(): mixed
    {
        return $this->body === null ? null : Json::decode($this->body);
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header($name . ': ' . $value);
        }
        foreach ($this->cookies as $name => $cookie) {
            setcookie($name, $cookie['value'], $cookie['options']);
        }
        if ($this->streamWriter !== null) {
            while (ob_get_level() > 0) {
                ob_end_flush();
            }
            ($this->streamWriter)(static function (string $chunk): void {
                echo $chunk;
                flush();
            });

            return;
        }
        if ($this->body !== null) {
            echo $this->body;
        }
    }
}
