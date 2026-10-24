<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Support\Logger;
use Cuvylo\Tests\Support\ApiTestCase;
use PHPUnit\Framework\TestCase;

final class LoggingTest extends ApiTestCase
{
    public function testNoSensitiveDataEndsUpInLogs(): void
    {
        $email = self::uniqueEmail('log');
        $client = $this->client();

        $client->post('/api/auth/register', ['email' => $email, 'password' => self::PASSWORD]);
        $session = (string) $client->sessionToken();
        $csrf = (string) $client->csrfToken();

        $client->post('/api/auth/login', ['email' => $email, 'password' => 'a wrong password here']);
        $client->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $session = (string) $client->sessionToken();
        $csrf = (string) $client->csrfToken();

        $profile = self::sampleProfile();
        $profile['summary'] = 'Texte de profil très personnel Zorglub42';
        $client->put('/api/profile', ['data' => $profile]);
        $client->post('/api/cvs', ['title' => 'Titre confidentiel Zorglub42']);
        $client->get('/api/cvs');
        $client->post('/api/auth/logout');

        $logs = implode("\n", $this->logLines);
        $this->assertNotSame('', $logs, 'les requêtes doivent être journalisées');

        foreach ([
            'mot de passe' => self::PASSWORD,
            'mauvais mot de passe' => 'a wrong password here',
            'e-mail' => $email,
            'jeton de session' => $session,
            'hash du jeton de session' => hash('sha256', $session),
            'jeton CSRF' => $csrf,
            'contenu de profil' => 'Zorglub42',
            'nom de famille du profil' => 'Exemple',
            'cookie' => 'cuvylo_session',
        ] as $what => $needle) {
            $this->assertStringNotContainsString($needle, $logs, "Le journal ne doit pas contenir : $what");
        }

        foreach ($this->logLines as $line) {
            $entry = json_decode($line, true, 8, JSON_THROW_ON_ERROR);
            $this->assertSame(['ts', 'level', 'event', 'request_id', 'method', 'path', 'status', 'ms', 'user_id'], array_keys($entry));
        }
    }

    public function testUnhandledErrorsAreLoggedWithoutMessageAndAnswerGenericError(): void
    {
        [$client, $email] = $this->registeredClient();
        $this->logLines = [];

        // On casse la base pour provoquer une exception interne contenant potentiellement des valeurs SQL.
        $this->pdo->exec('ALTER TABLE profiles RENAME TO profiles_gone');
        $response = $client->get('/api/profile');
        $this->pdo->exec('ALTER TABLE profiles_gone RENAME TO profiles');

        $this->assertSame(500, $response->status);
        $this->assertSame(['error' => ['code' => 'server_error', 'message' => 'Erreur interne.']], $response->data());

        $logs = implode("\n", $this->logLines);
        $this->assertStringContainsString('unhandled_exception', $logs);
        $this->assertStringContainsString('PDOException', $logs);
        $this->assertStringNotContainsString('profiles', $logs, 'le message de l\'exception (SQL) n\'est pas journalisé');
        $this->assertStringNotContainsString($email, $logs);
    }

    public function testLoggerRedactsSensitiveKeysAndDropsStructures(): void
    {
        $lines = [];
        $logger = new Logger(function (string $line) use (&$lines): void {
            $lines[] = $line;
        });
        $logger->info('probe', [
            'password' => 'hunter2', 'access_token' => 'abc', 'Authorization' => 'Bearer x', 'user_email' => 'a@b.c',
            'request_body' => '{"x":1}', 'cookie' => 'k=v', 'status' => 200, 'nested' => ['secret' => 'x'], 'method' => 'GET',
        ]);

        $entry = json_decode($lines[0], true, 8, JSON_THROW_ON_ERROR);
        foreach (['password', 'access_token', 'Authorization', 'user_email', 'request_body', 'cookie'] as $key) {
            $this->assertSame('[redacted]', $entry[$key], $key);
        }
        $this->assertSame(200, $entry['status']);
        $this->assertSame('GET', $entry['method']);
        $this->assertArrayNotHasKey('nested', $entry);
        $this->assertStringNotContainsString('hunter2', $lines[0]);
    }
}
