<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Http\Response;
use Cuvylo\Tests\Support\ApiTestCase;

/** Écran d'installation : premier compte, administrateur, protégé par SETUP_CODE et fermé ensuite. */
final class SetupTest extends ApiTestCase
{
    private const CODE = 'code-installation-de-test-2026';

    /** @param array<string, string> $env */
    private function fresh(array $env = ['SETUP_CODE' => self::CODE]): void
    {
        // Inscription libre fermée, comme en production.
        $this->boot($env + ['REGISTRATION_ENABLED' => 'false']);
        if ((int) $this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
            // Sous MySQL (TEST_DB_DSN), la base partagée n'est jamais vidée : l'installation n'a de sens que sur une base neuve.
            $this->markTestSkipped('Base non vide : installation testée sur SQLite en mémoire.');
        }
    }

    private function install(string $code = self::CODE, ?string $email = null): Response
    {
        return $this->client()->post('/api/setup', [
            'setupCode' => $code,
            'email' => $email ?? self::uniqueEmail('proprio'),
            'password' => self::PASSWORD,
            'displayName' => 'Propriétaire',
        ]);
    }

    public function testFirstAccountBecomesAdminAndSetupClosesAfterwards(): void
    {
        $this->fresh();
        $this->assertSame(['needed' => true, 'configured' => true], $this->client()->get('/api/setup')->data());

        $owner = $this->client();
        $response = $owner->post('/api/setup', ['setupCode' => self::CODE, 'email' => 'Owner@Example.test', 'password' => self::PASSWORD]);
        $this->assertSame(201, $response->status, $response->body());
        $this->assertTrue($response->data()['user']['isAdmin'], 'administrateur sans passer par ADMIN_EMAILS');
        $this->assertSame('owner@example.test', $response->data()['user']['email']);
        $this->assertSame(200, $owner->get('/api/admin/overview')->status, 'session ouverte et administration accessible');
        $this->assertSame(200, $owner->get('/api/profile')->status, 'profil créé');

        $this->assertSame(['needed' => false, 'configured' => false], $this->client()->get('/api/setup')->data());
        $again = $this->install();
        $this->assertSame(403, $again->status);
        $this->assertSame('setup_closed', $again->data()['error']['code']);
    }

    public function testWrongCodeIsRefusedAndAttemptsAreLimited(): void
    {
        $this->fresh();
        $wrong = $this->install('mauvais-code-de-seize-car');
        $this->assertSame(422, $wrong->status);
        $this->assertSame(['setupCode' => 'invalid_code'], self::errorFields($wrong));

        $status = 0;
        for ($i = 0; $i < 10 && $status !== 429; $i++) {
            $status = $this->install('encore-un-mauvais-code')->status;
        }
        $this->assertSame(429, $status, 'tentatives limitées par IP');
        $this->assertSame(0, (int) $this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn());
    }

    public function testSetupIsImpossibleWithoutCodeInEnv(): void
    {
        $this->fresh([]);
        $this->assertSame(['needed' => true, 'configured' => false], $this->client()->get('/api/setup')->data());
        $response = $this->install();
        $this->assertSame(403, $response->status);
        $this->assertSame('setup_not_configured', $response->data()['error']['code']);
    }

    public function testInvalidInputIsRejectedWithoutCreatingAnything(): void
    {
        $this->fresh();
        $response = $this->client()->post('/api/setup', ['setupCode' => self::CODE, 'email' => 'pas-une-adresse', 'password' => 'court']);
        $this->assertSame(422, $response->status);
        $this->assertSame(['email', 'password'], array_keys(self::errorFields($response)));
        $this->assertSame(0, (int) $this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn());
    }
}
