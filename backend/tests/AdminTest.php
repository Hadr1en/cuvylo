<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Database\Connection;
use Cuvylo\Database\Migrator;
use Cuvylo\Database\SqlDump;
use Cuvylo\Kernel;
use Cuvylo\Repository\SettingsRepository;
use Cuvylo\Support\Logger;
use Cuvylo\Tests\Support\ApiClient;
use Cuvylo\Tests\Support\ApiTestCase;

/** Administration (ADMIN_EMAILS) : invisible pour les autres comptes, invitations, comptes ; la sauvegarde SQL n'est plus servie par l'API. */
final class AdminTest extends ApiTestCase
{
    private ApiClient $admin;
    private string $adminEmail;

    protected function setUp(): void
    {
        $this->adminEmail = self::uniqueEmail('admin');
        $this->boot(['ADMIN_EMAILS' => strtoupper($this->adminEmail)]);
        [$this->admin] = $this->registeredClient($this->adminEmail);
    }

    /** @return array<string, array{string, string, mixed}> */
    public static function adminRoutes(): array
    {
        $id = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

        return [
            'overview' => ['GET', '/api/admin/overview', null],
            'settings' => ['GET', '/api/admin/settings', null],
            'update settings' => ['PUT', '/api/admin/settings', ['registrationOpen' => true]],
            'invitations' => ['GET', '/api/admin/invitations', null],
            'create invitation' => ['POST', '/api/admin/invitations', ['note' => 'x']],
            'delete invitation' => ['DELETE', "/api/admin/invitations/$id", null],
            'reset link' => ['POST', "/api/admin/users/$id/reset-link", null],
            'revoke sessions' => ['POST', "/api/admin/users/$id/revoke-sessions", null],
            'delete user' => ['DELETE', "/api/admin/users/$id", ['password' => 'x']],
        ];
    }

    /** @dataProvider-like : chaque route est invisible (404) pour un compte ordinaire et exige une session (401). */
    public function testAdminRoutesAreHiddenFromRegularUsersAndAnonymous(): void
    {
        [$user] = $this->registeredClient();
        foreach (self::adminRoutes() as $name => [$method, $path, $body]) {
            $response = $user->send($method, $path, $body);
            $this->assertSame(404, $response->status, "$name (compte ordinaire)");
            $this->assertSame(401, $this->client()->send($method, $path, $body)->status, "$name (anonyme)");
        }
    }

    public function testOverviewListsAccountsWithStorage(): void
    {
        [$bob, $bobEmail] = $this->registeredClient();
        $bob->put('/api/profile', ['data' => self::sampleProfileV2()]);
        $this->createCv($bob);

        $overview = $this->admin->get('/api/admin/overview');
        $this->assertSame(200, $overview->status, $overview->body());
        $data = $overview->data();
        $accounts = array_column($data['users'], null, 'email');
        $this->assertArrayHasKey($bobEmail, $accounts);
        $this->assertSame(1, $accounts[$bobEmail]['cvs']);
        $this->assertGreaterThan(5000, $accounts[$bobEmail]['bytes']);
        $this->assertFalse($accounts[$bobEmail]['mfaEnabled']);
        $this->assertNotNull($accounts[$bobEmail]['lastLoginAt']);
        $this->assertTrue($accounts[$this->adminEmail]['isAdmin']);
        $this->assertSame(['id', 'email', 'displayName', 'createdAt', 'lastLoginAt', 'bytes', 'cvs', 'mfaEnabled', 'isAdmin', 'resetRequestedAt'], array_keys($accounts[$bobEmail]));
        $this->assertNull($accounts[$bobEmail]['resetRequestedAt']);
        $this->assertStringNotContainsString(json_encode(self::sampleProfileV2()['summary'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $overview->body(), 'aucun contenu de CV');
        $this->assertStringNotContainsString('Cabinet Imaginaire', $overview->body(), 'aucun contenu de CV');
        $this->assertGreaterThanOrEqual(2, $data['totals']['users']);
        $this->assertGreaterThanOrEqual(1, $data['totals']['cvs']);
        $this->assertSame(25 * 1024 * 1024, $data['limitBytes']);
        $this->assertArrayHasKey('databaseBytes', $data);
        $this->assertStringNotContainsString('password', $overview->body());
        $this->assertStringNotContainsString('totp', $overview->body());
    }

    /** La base MySQL des tests est partagée : le réglage ne doit pas fuiter vers les autres tests (REGISTRATION_ENABLED). */
    private function forgetRegistrationSetting(): void
    {
        $this->pdo->prepare('DELETE FROM settings WHERE name = ?')->execute([SettingsRepository::REGISTRATION_OPEN]);
    }

    /** Réglage fait dans l'administration : prioritaire sur REGISTRATION_ENABLED, pris en compte dès la requête suivante. */
    public function testRegistrationCanBeOpenedAndClosedFromTheAdministration(): void
    {
        $this->forgetRegistrationSetting();
        try {
            $this->checkRegistrationToggle();
        } finally {
            $this->forgetRegistrationSetting();
        }
    }

    private function checkRegistrationToggle(): void
    {
        $this->assertTrue($this->admin->get('/api/admin/settings')->data()['registrationOpen'], 'REGISTRATION_ENABLED=true dans ces tests');

        $closed = $this->admin->put('/api/admin/settings', ['registrationOpen' => false]);
        $this->assertSame(['registrationOpen' => false], $closed->data());
        $this->assertStringContainsString('registration_closed', implode("\n", $this->logLines));
        // Chaque requête réelle construit un noyau neuf : on fait de même.
        $next = new ApiClient(new Kernel($this->config, $this->pdo, Logger::null(), $this->clock), $this->config->origin(), null, $this->cookies);
        $this->assertFalse($next->get('/api/instance')->data()['registration']['open']);
        $refused = $next->post('/api/auth/register', ['email' => self::uniqueEmail('libre'), 'password' => self::PASSWORD]);
        $this->assertSame(403, $refused->status);
        $this->assertSame('registration_closed', $refused->data()['error']['code']);

        $this->assertSame(200, $this->admin->put('/api/admin/settings', ['registrationOpen' => true])->status);
        $reopened = new ApiClient(new Kernel($this->config, $this->pdo, Logger::null(), $this->clock), $this->config->origin(), null, $this->cookies);
        $this->assertTrue($reopened->get('/api/instance')->data()['registration']['open']);
        $this->assertSame(201, $reopened->post('/api/auth/register', ['email' => self::uniqueEmail('libre'), 'password' => self::PASSWORD])->status);

        $this->assertSame(422, $this->admin->put('/api/admin/settings', ['registrationOpen' => 'oui'])->status);
    }

    public function testInvitationsListShowsNoTokenAndCanBeDeleted(): void
    {
        $created = $this->admin->post('/api/admin/invitations', ['note' => 'Pour Alice', 'expiresInDays' => 14]);
        $this->assertSame(201, $created->status, $created->body());
        $invitation = $created->data()['invitation'];
        $this->assertSame(['id', 'url', 'expiresAt'], array_keys($invitation));
        $token = basename($invitation['url']);

        $list = $this->admin->get('/api/admin/invitations');
        $this->assertStringNotContainsString($token, $list->body(), 'le lien n\'est montré qu\'une fois');
        $entry = array_column($list->data()['invitations'], null, 'id')[$invitation['id']];
        $this->assertSame('Pour Alice', $entry['note']);
        $this->assertSame('pending', $entry['status']);

        $bobEmail = self::uniqueEmail('alice');
        $this->client()->post('/api/auth/register', ['email' => $bobEmail, 'password' => self::PASSWORD, 'inviteToken' => $token]);
        $used = array_column($this->admin->get('/api/admin/invitations')->data()['invitations'], null, 'id')[$invitation['id']];
        $this->assertSame('used', $used['status']);
        $this->assertSame($bobEmail, $used['usedBy']);

        $this->assertSame(204, $this->admin->delete('/api/admin/invitations/' . $invitation['id'])->status);
        $this->assertSame(404, $this->admin->delete('/api/admin/invitations/' . $invitation['id'])->status);
        $this->assertSame(422, $this->admin->post('/api/admin/invitations', [])->status);
    }

    public function testRevokeSessionsLogsTheUserOutEverywhere(): void
    {
        [$bob, $bobEmail] = $this->registeredClient();
        $this->assertSame(204, $this->admin->post('/api/admin/users/' . $this->userIdOf($bobEmail) . '/revoke-sessions')->status);
        $this->assertSame(401, $bob->get('/api/auth/me')->status);
        $this->assertSame(200, $this->admin->get('/api/auth/me')->status);
    }

    public function testDeleteUserRequiresTheAdminPassword(): void
    {
        [$bob, $bobEmail] = $this->registeredClient();
        $bobId = $this->userIdOf($bobEmail);
        $this->createCv($bob);

        $wrong = $this->admin->delete("/api/admin/users/$bobId", ['password' => self::PASSWORD . ' faux']);
        $this->assertSame(422, $wrong->status);
        $this->assertSame(['password' => 'invalid_password'], self::errorFields($wrong));
        $this->assertSame(200, $bob->get('/api/auth/me')->status);

        $adminId = $this->userIdOf($this->adminEmail);
        $this->assertSame(409, $this->admin->delete("/api/admin/users/$adminId", ['password' => self::PASSWORD])->status, 'pas soi-même');

        $this->assertSame(204, $this->admin->delete("/api/admin/users/$bobId", ['password' => self::PASSWORD])->status);
        $this->assertSame(401, $bob->get('/api/auth/me')->status);
        $this->assertSame(0, (int) $this->pdo->query("SELECT COUNT(*) FROM cvs WHERE user_id = '$bobId'")->fetchColumn());
        $this->assertSame(404, $this->admin->delete("/api/admin/users/$bobId", ['password' => self::PASSWORD])->status);
        $this->assertStringContainsString('admin_action', implode("\n", $this->logLines));
        $this->assertStringNotContainsString($bobEmail, implode("\n", $this->logLines));
    }

    public function testBackupIsACompleteImportableSqlDump(): void
    {
        [$bob] = $this->registeredClient();
        $profile = self::sampleProfileV2();
        $profile['summary'] = "Apostrophe ' et \"guillemets\" ; point-virgule\nnouvelle ligne \\ antislash";
        $bob->put('/api/profile', ['data' => $profile]);
        $cv = $this->createCv($bob, "CV d'été");
        $bob->post("/api/cvs/$cv/versions", ['label' => 'v1']);

        // L'administrateur ne peut pas télécharger la base par l'API ; la sauvegarde passe par bin/backup.php.
        $this->assertSame(404, $this->admin->get('/api/admin/backup')->status);
        $sql = '';
        (new SqlDump($this->pdo, dirname(__DIR__) . '/migrations'))->write(static function (string $chunk) use (&$sql): void {
            $sql .= $chunk;
        }, '2026-10-24 10:00:00');
        $this->assertStringContainsString('à conserver chiffrée', $sql);
        $this->assertStringContainsString('CREATE TABLE users', $sql, 'schéma inclus');
        foreach (SqlDump::TABLES as $table) {
            $this->assertStringContainsString("-- ── Données : $table ──", $sql);
        }
        $this->assertStringContainsString('INSERT INTO `cvs`', $sql);
        $this->assertStringContainsString('INSERT INTO `cv_versions`', $sql);
        $this->assertStringNotContainsString(self::PASSWORD, $sql);

        // Les INSERT se rejouent tels quels dans une base neuve (échappement correct, colonnes cohérentes).
        $fresh = Connection::open('sqlite::memory:');
        Migrator::run($fresh, dirname(__DIR__) . '/migrations');
        $fresh->exec('PRAGMA foreign_keys = OFF');
        $inserted = 0;
        foreach (preg_split("/;\n/", $sql) ?: [] as $statement) {
            $statement = trim((string) preg_replace('/\A(\s*--[^\n]*\n)+/', '', $statement));
            if (str_starts_with($statement, 'INSERT INTO `schema_migrations`') || !str_starts_with($statement, 'INSERT INTO')) {
                continue;
            }
            $fresh->exec($statement);
            $inserted++;
        }
        $this->assertGreaterThan(5, $inserted);
        $summary = $fresh->query("SELECT data FROM profiles WHERE data LIKE '%Apostrophe%'")->fetchColumn();
        $this->assertNotFalse($summary);
        $this->assertStringContainsString("Apostrophe ' et", json_decode((string) $summary, true)['summary']);
        $this->assertSame("CV d'été", $fresh->query("SELECT title FROM cvs WHERE id = '$cv'")->fetchColumn());
    }
}
