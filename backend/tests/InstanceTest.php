<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Config;
use Cuvylo\EnvFile;
use Cuvylo\Tests\Support\ApiTestCase;
use RuntimeException;

final class InstanceTest extends ApiTestCase
{
    public function testPublicInfoWithoutSessionAndWithoutSecrets(): void
    {
        $this->boot([
            'LEGAL_PUBLISHER' => 'Camille Exemple',
            'LEGAL_CONTACT_EMAIL' => 'contact@example.test',
            'LEGAL_HOST' => 'Hébergeur Exemple, 1 rue de Test, 59000 Lille',
            'REGISTRATION_INVITE_CODE' => 'code-secret-ami',
        ]);
        $response = $this->client()->get('/api/instance');

        $this->assertSame(200, $response->status);
        $data = $response->data();
        $this->assertSame(['open' => true, 'inviteRequired' => true], $data['registration']);
        $this->assertSame('Camille Exemple', $data['legal']['publisher']);
        $this->assertSame('contact@example.test', $data['legal']['contactEmail']);
        $this->assertSame('contact@example.test', $data['legal']['securityEmail'], 'contact sécurité = contact général par défaut');
        $this->assertSame(30, $data['retention']['sessionMaxDays']);
        $this->assertSame(24, $data['retention']['loginAttemptsHours']);

        // Ni le code d'invitation, ni la clé, ni la base ne fuient.
        $body = $response->body();
        foreach (['code-secret-ami', 'APP_KEY', 'sqlite', 'DB_'] as $secret) {
            $this->assertStringNotContainsString($secret, $body);
        }
    }

    /** Régression : les clés absentes du fichier .env doivent pouvoir venir de l'environnement réel. */
    public function testLegalSettingsCanComeFromTheRealEnvironment(): void
    {
        putenv('LEGAL_CONTACT_EMAIL=env@example.test');
        try {
            $values = EnvFile::loadWithEnvironment(sys_get_temp_dir() . '/cuvylo-absent-' . bin2hex(random_bytes(4)) . '.env');
            $this->assertSame('env@example.test', $values['LEGAL_CONTACT_EMAIL'] ?? null);
        } finally {
            putenv('LEGAL_CONTACT_EMAIL');
        }
    }

    public function testUnconfiguredLegalFieldsAreNull(): void
    {
        $data = $this->client()->get('/api/instance')->data();
        $this->assertNull($data['legal']['publisher']);
        $this->assertNull($data['legal']['contactEmail']);
        $this->assertNull($data['legal']['host']);
        $this->assertSame(['open' => true, 'inviteRequired' => false], $data['registration']);
    }

    public function testInvalidLegalEmailIsRejectedAtBoot(): void
    {
        $this->expectException(RuntimeException::class);
        Config::fromEnv([
            'APP_ENV' => 'testing',
            'APP_URL' => 'https://cv.example.test',
            'APP_KEY' => base64_encode(str_repeat('k', 32)),
            'DB_DSN' => 'sqlite::memory:',
            'LEGAL_CONTACT_EMAIL' => 'pas-un-email',
        ]);
    }

    public function testMultilineLegalValueIsRejected(): void
    {
        $this->expectException(RuntimeException::class);
        Config::fromEnv([
            'APP_ENV' => 'testing',
            'APP_URL' => 'https://cv.example.test',
            'APP_KEY' => base64_encode(str_repeat('k', 32)),
            'DB_DSN' => 'sqlite::memory:',
            'LEGAL_HOST' => "Hébergeur\nInjecté",
        ]);
    }

    public function testInstanceRoutePurgesExpiredSessionsAndOldAttempts(): void
    {
        [$client] = $this->registeredClient();
        $this->client()->post('/api/auth/login', ['email' => self::uniqueEmail('x'), 'password' => 'mauvais-mot-de-passe']);
        $this->assertGreaterThan(0, (int) $this->pdo->query('SELECT COUNT(*) FROM login_attempts')->fetchColumn());

        $this->clock->advance(31 * 86400);
        $this->client()->get('/api/instance');

        $this->assertSame(0, (int) $this->pdo->query('SELECT COUNT(*) FROM login_attempts WHERE attempted_at <= ' . $this->pdo->quote($this->clock->sql($this->clock->now() - 86400)))->fetchColumn());
        $this->assertSame(401, $client->get('/api/auth/me')->status);
    }

    public function testSessionsNoLongerStoreIpOrBrowserFingerprints(): void
    {
        $this->registeredClient();
        $rows = $this->pdo->query('SELECT ip_hash, ua_hash FROM sessions')->fetchAll();
        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertSame('', trim((string) $row['ip_hash']));
            $this->assertSame('', trim((string) $row['ua_hash']));
        }
    }

    public function testSecurityTxtFollowsRfc9116(): void
    {
        $this->boot(['SECURITY_CONTACT_EMAIL' => 'securite@example.test']);
        $response = $this->client()->get('/api/security-txt');

        $this->assertSame(200, $response->status);
        $this->assertStringStartsWith('text/plain', (string) $response->header('Content-Type'));
        $body = $response->body();
        $this->assertStringContainsString("Contact: mailto:securite@example.test\n", $body);
        $this->assertStringContainsString("Canonical: https://cv.example.test/.well-known/security.txt\n", $body);
        $this->assertSame(1, preg_match('/^Expires: (\S+)$/m', $body, $m));
        $expires = strtotime($m[1]);
        $this->assertGreaterThan($this->clock->now(), $expires);
        $this->assertLessThan($this->clock->now() + 365 * 86400, $expires, 'la RFC impose moins d’un an');
    }

    public function testSecurityTxtIs404WithoutContact(): void
    {
        $this->assertSame(404, $this->client()->get('/api/security-txt')->status);
    }
}
