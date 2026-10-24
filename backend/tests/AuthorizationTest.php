<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Support\Ulid;
use Cuvylo\Tests\Support\ApiTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/** Isolation des données entre utilisateurs (IDOR) et contrôle d'accès de chaque route protégée. */
final class AuthorizationTest extends ApiTestCase
{
    /** @return array<string, array{string, string, mixed}> */
    public static function protectedRoutes(): array
    {
        $id = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

        return [
            'logout' => ['POST', '/api/auth/logout', null],
            'me' => ['GET', '/api/auth/me', null],
            'profile get' => ['GET', '/api/profile', null],
            'profile put' => ['PUT', '/api/profile', ['data' => []]],
            'cv list' => ['GET', '/api/cvs', null],
            'cv create' => ['POST', '/api/cvs', ['title' => 'x']],
            'cv get' => ['GET', "/api/cvs/$id", null],
            'cv put' => ['PUT', "/api/cvs/$id", ['title' => 'x']],
            'cv delete' => ['DELETE', "/api/cvs/$id", null],
            'versions list' => ['GET', "/api/cvs/$id/versions", null],
            'version create' => ['POST', "/api/cvs/$id/versions", ['label' => 'x']],
            'version restore' => ['POST', "/api/cvs/$id/versions/$id/restore", null],
            'version get' => ['GET', "/api/cvs/$id/versions/$id", null],
            'shares list' => ['GET', "/api/cvs/$id/shares", null],
            'share create' => ['POST', "/api/cvs/$id/shares", null],
            'share revoke' => ['DELETE', "/api/shares/$id", null],
            'password change' => ['POST', '/api/account/password', ['currentPassword' => 'x', 'newPassword' => 'y']],
            'sessions list' => ['GET', '/api/account/sessions', null],
            'session revoke' => ['DELETE', '/api/account/sessions/abcdefabcdef', null],
            'sessions revoke others' => ['POST', '/api/account/sessions/revoke-others', null],
            'totp setup' => ['POST', '/api/account/totp/setup', null],
            'totp enable' => ['POST', '/api/account/totp/enable', ['code' => '123456']],
            'totp disable' => ['POST', '/api/account/totp/disable', ['password' => 'x']],
            'usage' => ['GET', '/api/account/usage', null],
            'applications list' => ['GET', '/api/applications', null],
            'application create' => ['POST', '/api/applications', ['company' => 'x', 'position' => 'y']],
            'application get' => ['GET', "/api/applications/$id", null],
            'application put' => ['PUT', "/api/applications/$id", ['company' => 'x']],
            'application delete' => ['DELETE', "/api/applications/$id", null],
            'letters list' => ['GET', '/api/letters', null],
            'letter create' => ['POST', '/api/letters', ['title' => 'x']],
            'letter get' => ['GET', "/api/letters/$id", null],
            'letter put' => ['PUT', "/api/letters/$id", ['title' => 'x']],
            'letter delete' => ['DELETE', "/api/letters/$id", null],
        ];
    }

    #[DataProvider('protectedRoutes')]
    public function testEveryProtectedRouteRequiresAuthentication(string $method, string $path, mixed $body): void
    {
        $client = $this->client();
        $response = $client->send($method, $path, $body);
        $this->assertSame(401, $response->status, "$method $path");
        $this->assertSame('unauthenticated', $response->data()['error']['code']);
    }

    public function testUserBCannotReadOrTouchUserAsCv(): void
    {
        [$alice] = $this->registeredClient();
        [$bob] = $this->registeredClient();

        $cvId = $this->createCv($alice, 'CV secret d\'Alice');
        $versionId = $alice->post("/api/cvs/$cvId/versions", ['label' => 'v1'])->data()['version']['id'];
        $before = $alice->get("/api/cvs/$cvId")->data();

        $profile = self::sampleProfile();
        $attempts = [
            'get' => $bob->get("/api/cvs/$cvId"),
            'put' => $bob->put("/api/cvs/$cvId", ['title' => 'pwned', 'settings' => self::settings(), 'data' => $profile]),
            'delete' => $bob->delete("/api/cvs/$cvId"),
            'versions list' => $bob->get("/api/cvs/$cvId/versions"),
            'version create' => $bob->post("/api/cvs/$cvId/versions", ['label' => 'intrus']),
            'restore' => $bob->post("/api/cvs/$cvId/versions/$versionId/restore"),
            'duplicate' => $bob->post('/api/cvs', ['title' => 'copie volée', 'source' => ['type' => 'cv', 'id' => $cvId]]),
        ];
        foreach ($attempts as $name => $response) {
            $this->assertSame(404, $response->status, "$name doit répondre 404 (et non 403, pour ne pas révéler l'existence)");
            $this->assertSame('not_found', $response->data()['error']['code'], $name);
        }

        $this->assertSame($before, $alice->get("/api/cvs/$cvId")->data(), 'le CV d\'Alice est intact');
        $this->assertCount(1, $alice->get("/api/cvs/$cvId/versions")->data()['versions']);
        $this->assertSame([], $bob->get('/api/cvs')->data()['cvs'], 'rien n\'a été créé chez Bob');
    }

    public function testCvListsAreScopedToTheirOwner(): void
    {
        [$alice] = $this->registeredClient();
        [$bob] = $this->registeredClient();
        $aliceCv = $this->createCv($alice, 'Alice 1');
        $bobCv = $this->createCv($bob, 'Bob 1');

        $aliceIds = array_column($alice->get('/api/cvs')->data()['cvs'], 'id');
        $bobIds = array_column($bob->get('/api/cvs')->data()['cvs'], 'id');
        $this->assertSame([$aliceCv], $aliceIds);
        $this->assertSame([$bobCv], $bobIds);
    }

    public function testVersionOfAnotherCvOfTheSameUserCannotBeRestoredThroughWrongCv(): void
    {
        [$alice] = $this->registeredClient();
        $cvA = $this->createCv($alice, 'A');
        $cvB = $this->createCv($alice, 'B');
        $versionOfA = $alice->post("/api/cvs/$cvA/versions", ['label' => 'v'])->data()['version']['id'];

        $this->assertSame(404, $alice->post("/api/cvs/$cvB/versions/$versionOfA/restore")->status);
    }

    public function testProfilesAreIsolated(): void
    {
        [$alice, $aliceEmail] = $this->registeredClient();
        [$bob, $bobEmail] = $this->registeredClient();

        $profile = self::sampleProfile();
        $this->assertSame(200, $alice->put('/api/profile', ['data' => $profile])->status);

        $bobProfile = $bob->get('/api/profile')->data()['data'];
        $this->assertSame($bobEmail, $bobProfile['identity']['email']);
        $this->assertSame('', $bobProfile['identity']['firstName']);
        $this->assertSame('Camille', $alice->get('/api/profile')->data()['data']['identity']['firstName']);
        $this->assertNotSame($aliceEmail, $bobEmail);
    }

    public function testCvCreatedFromProfileUsesOnlyOwnersProfile(): void
    {
        [$alice] = $this->registeredClient();
        [$bob] = $this->registeredClient();
        $alice->put('/api/profile', ['data' => self::sampleProfile()]);

        $bobCv = $bob->get('/api/cvs/' . $this->createCv($bob))->data()['cv'];
        $this->assertSame('', $bobCv['data']['identity']['firstName']);
    }

    public function testRowsAreWrittenWithTheSessionUserNotAClientProvidedOne(): void
    {
        [$alice] = $this->registeredClient();
        [, $bobEmail] = $this->registeredClient();
        $bobId = $this->userId($bobEmail);

        $response = $alice->post('/api/cvs', ['title' => 'x', 'user_id' => $bobId, 'userId' => $bobId]);
        $this->assertSame(422, $response->status, 'champs inconnus rejetés');
        $count = $this->pdo->prepare('SELECT COUNT(*) FROM cvs WHERE user_id = ?');
        $count->execute([$bobId]);
        $this->assertSame(0, (int) $count->fetchColumn());
    }

    public function testMalformedIdentifiersAreNotFoundNotErrors(): void
    {
        [$alice] = $this->registeredClient();
        foreach (['abc', "1' OR '1'='1", '..%2F..%2Fetc', str_repeat('A', 27), '01HZZZZZZZZZZZZZZZZZZZZZZU'] as $bad) {
            $this->assertSame(404, $alice->get('/api/cvs/' . rawurlencode($bad))->status, $bad);
        }
        $this->assertFalse(Ulid::isValid('01HZZZZZZZZZZZZZZZZZZZZZZU'), 'la lettre U est exclue de l\'alphabet Crockford');
    }

    public function testDeletingAccountOwnedDataLeavesOthersUntouched(): void
    {
        [$alice] = $this->registeredClient();
        [$bob] = $this->registeredClient();
        $aliceCv = $this->createCv($alice);
        $bobCv = $this->createCv($bob);

        $this->assertSame(204, $alice->delete("/api/cvs/$aliceCv")->status);
        $this->assertSame(404, $alice->get("/api/cvs/$aliceCv")->status);
        $this->assertSame(200, $bob->get("/api/cvs/$bobCv")->status);
    }

    private function userId(string $email): string
    {
        $stmt = $this->pdo->prepare('SELECT id FROM users WHERE email = ?');
        $stmt->execute([$email]);

        return (string) $stmt->fetchColumn();
    }
}
