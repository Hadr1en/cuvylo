<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Auth\Csrf;
use Cuvylo\Tests\Support\ApiTestCase;

final class AccountTest extends ApiTestCase
{
    public function testExportContainsEverythingOfTheUserAndNothingOfOthers(): void
    {
        [$alice, $aliceEmail] = $this->registeredClient(self::uniqueEmail('alice'));
        $this->assertSame(200, $alice->put('/api/profile', ['data' => self::sampleProfile()])->status);
        $cvId = $this->createCv($alice, 'CV d’Alice');
        $this->assertSame(201, $alice->post("/api/cvs/$cvId/versions", ['label' => 'Avant envoi'])->status);

        [$bob] = $this->registeredClient(self::uniqueEmail('bob'));
        $this->createCv($bob, 'CV de Bob');

        $response = $alice->get('/api/account/export');
        $this->assertSame(200, $response->status);
        $this->assertStringContainsString('attachment; filename="cuvylo-export-', (string) $response->header('Content-Disposition'));

        $export = $response->data();
        $this->assertSame('cuvylo-account', $export['format']);
        $this->assertSame(2, $export['version'], 'v2 : lettres, candidatures et partages ajoutés');
        $this->assertSame($aliceEmail, $export['account']['email']);
        $this->assertSame('Camille', $export['profile']['data']['identity']['firstName']);
        $this->assertCount(1, $export['cvs']);
        $this->assertSame('CV d’Alice', $export['cvs'][0]['title']);
        $this->assertSame('Avant envoi', $export['cvs'][0]['versions'][0]['label']);
        $this->assertArrayHasKey('data', $export['cvs'][0]['versions'][0]);

        $raw = $response->body();
        $this->assertStringNotContainsString('CV de Bob', $raw);
        $this->assertStringNotContainsString('password', $raw, 'ni hash ni mot de passe dans l’export');
    }

    public function testExportRequiresSession(): void
    {
        $this->assertSame(401, $this->client()->get('/api/account/export')->status);
    }

    public function testDeleteRequiresTheCurrentPassword(): void
    {
        [$client] = $this->registeredClient();
        $response = $client->send('DELETE', '/api/account', ['password' => 'pas-le-bon-mot-de-passe']);

        $this->assertSame(422, $response->status);
        $this->assertSame(['password' => 'invalid_password'], self::errorFields($response));
        $this->assertSame(200, $client->get('/api/auth/me')->status, 'le compte existe toujours');
    }

    public function testDeleteRequiresCsrf(): void
    {
        [$client] = $this->registeredClient();
        $response = $client->send('DELETE', '/api/account', ['password' => self::PASSWORD], [Csrf::HEADER => '']);
        $this->assertSame(403, $response->status);
        $this->assertSame(200, $client->get('/api/auth/me')->status);
    }

    public function testDeleteErasesAllUserDataAndOnlyThem(): void
    {
        [$alice, $aliceEmail] = $this->registeredClient(self::uniqueEmail('alice'));
        $cvId = $this->createCv($alice);
        $this->assertSame(201, $alice->post("/api/cvs/$cvId/versions", ['label' => 'v1'])->status);
        $this->assertSame(201, $alice->post("/api/cvs/$cvId/shares", [])->status);
        $this->assertSame(201, $alice->post('/api/letters', ['title' => 'Lettre'])->status);
        $this->assertSame(201, $alice->post('/api/applications', ['company' => 'ACME', 'position' => 'Cheffe de projet', 'cvId' => $cvId])->status);
        $userId = $alice->get('/api/auth/me')->data()['user']['id'];

        [$bob] = $this->registeredClient(self::uniqueEmail('bob'));
        $bobCv = $this->createCv($bob);

        $response = $alice->send('DELETE', '/api/account', ['password' => self::PASSWORD]);
        $this->assertSame(204, $response->status);
        $this->assertSame('', $response->cookies()[$this->cookies->sessionName()]['value'] ?? null, 'cookie de session effacé');

        foreach ([
            'users' => 'id', 'profiles' => 'user_id', 'cvs' => 'user_id', 'cv_versions' => 'user_id', 'sessions' => 'user_id',
            'shares' => 'user_id', 'letters' => 'user_id', 'applications' => 'user_id', 'password_resets' => 'user_id',
        ] as $table => $column) {
            $stmt = $this->pdo->prepare("SELECT COUNT(*) FROM $table WHERE $column = ?");
            $stmt->execute([$userId]);
            $this->assertSame(0, (int) $stmt->fetchColumn(), "$table vidé pour l’utilisateur");
        }

        // L'ancienne session ne rouvre rien ; l'e-mail est de nouveau libre.
        $this->assertSame(401, $alice->get('/api/auth/me')->status);
        $this->assertSame(201, $this->client()->post('/api/auth/register', ['email' => $aliceEmail, 'password' => self::PASSWORD])->status);

        // Bob n'est pas touché.
        $this->assertSame(200, $bob->get("/api/cvs/$bobCv")->status);
    }

    public function testRepeatedWrongPasswordsAreRateLimited(): void
    {
        [$client] = $this->registeredClient(null, '203.0.113.' . random_int(1, 254));
        for ($i = 0; $i < 5; $i++) {
            $this->assertSame(422, $client->send('DELETE', '/api/account', ['password' => 'mauvais-' . $i])->status);
        }
        $this->assertSame(429, $client->send('DELETE', '/api/account', ['password' => self::PASSWORD])->status);
        $this->assertSame(200, $client->get('/api/auth/me')->status);
    }
}
