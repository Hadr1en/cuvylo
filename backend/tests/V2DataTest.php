<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Controller\CvController;
use Cuvylo\Support\Json;
use Cuvylo\Tests\Support\ApiTestCase;
use Cuvylo\Validation\CvSettingsValidator;

/** Données v2 : migration à la lecture, révisions (409), versions typées et compressées, quota. */
final class V2DataTest extends ApiTestCase
{
    public function testV1ProfileSentByAnOldClientIsStoredAsV2(): void
    {
        [$client] = $this->registeredClient();
        $put = $client->put('/api/profile', ['data' => self::sampleProfileV1()]);
        $this->assertSame(200, $put->status, $put->body());
        $this->assertSame(2, $put->data()['data']['schemaVersion']);
        $this->assertSame(self::sampleProfile(), $put->data()['data']);
    }

    public function testV2FixtureRoundTrip(): void
    {
        [$client] = $this->registeredClient();
        $put = $client->put('/api/profile', ['data' => self::sampleProfileV2()]);
        $this->assertSame(200, $put->status, $put->body());
        $this->assertSame(self::sampleProfileV2(), $client->get('/api/profile')->data()['data']);

        $cvId = $this->createCv($client);
        $this->assertSame(self::sampleProfileV2(), $client->get("/api/cvs/$cvId")->data()['cv']['data']);
    }

    public function testStoredV1DocumentsAreMigratedOnRead(): void
    {
        [$client, $email] = $this->registeredClient();
        $userId = $this->userIdOf($email);
        $cvId = $this->createCv($client);

        // État laissé par la v1 : document schemaVersion 1 et réglages à cinq champs.
        $v1Settings = ['template' => 'modern', 'accent' => '#1f4e79', 'density' => 'comfortable', 'pageBreakBefore' => [], 'keepEntriesTogether' => true];
        $this->pdo->prepare('UPDATE profiles SET data = ? WHERE user_id = ?')->execute([Json::encode(self::sampleProfileV1()), $userId]);
        $this->pdo->prepare('UPDATE cvs SET data = ?, settings = ? WHERE id = ?')->execute([Json::encode(self::sampleProfileV1()), Json::encode($v1Settings), $cvId]);

        $this->assertSame(self::sampleProfile(), $client->get('/api/profile')->data()['data']);
        $cv = $client->get("/api/cvs/$cvId")->data()['cv'];
        $this->assertSame(self::sampleProfile(), $cv['data']);
        $this->assertSame(CvSettingsValidator::normalize($v1Settings), $cv['settings'], 'réglages v1 complétés par les valeurs par défaut');

        // Réécrit en v2 à la prochaine écriture.
        $this->assertSame(200, $client->put("/api/cvs/$cvId", ['title' => 'T', 'settings' => $cv['settings'], 'data' => $cv['data']])->status);
        $stored = Json::decode((string) $this->pdo->query("SELECT data FROM cvs WHERE id = '$cvId'")->fetchColumn());
        $this->assertSame(2, $stored['schemaVersion']);
    }

    public function testProfileRevisionConflictReturnsCurrentState(): void
    {
        [$client] = $this->registeredClient();
        $initial = $client->get('/api/profile')->data();
        $this->assertSame(1, $initial['revision']);

        $first = $client->put('/api/profile', ['data' => self::sampleProfile(), 'revision' => 1]);
        $this->assertSame(200, $first->status, $first->body());
        $this->assertSame(2, $first->data()['revision']);

        // Un autre onglet resté à la révision 1 : refusé, avec l'état serveur.
        $stale = self::sampleProfile();
        $stale['summary'] = 'Ancienne saisie';
        $conflict = $client->put('/api/profile', ['data' => $stale, 'revision' => 1]);
        $this->assertSame(409, $conflict->status);
        $this->assertSame('conflict', $conflict->data()['error']['code']);
        $this->assertSame(2, $conflict->data()['error']['current']['revision']);
        $this->assertSame(self::sampleProfile()['summary'], $conflict->data()['error']['current']['data']['summary']);

        // Sans révision : accepté (compatibilité).
        $this->assertSame(200, $client->put('/api/profile', ['data' => $stale])->status);
        $this->assertSame(422, $client->put('/api/profile', ['data' => $stale, 'revision' => 'x'])->status);
    }

    public function testCvRevisionConflict(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $cv = $client->get("/api/cvs/$id")->data()['cv'];
        $this->assertSame(1, $cv['revision']);

        $ok = $client->put("/api/cvs/$id", ['title' => 'A', 'settings' => $cv['settings'], 'data' => $cv['data'], 'revision' => 1]);
        $this->assertSame(200, $ok->status, $ok->body());
        $this->assertSame(2, $ok->data()['cv']['revision']);

        $conflict = $client->put("/api/cvs/$id", ['title' => 'B', 'settings' => $cv['settings'], 'data' => $cv['data'], 'revision' => 1]);
        $this->assertSame(409, $conflict->status);
        $this->assertSame('A', $conflict->data()['error']['current']['title']);
        $this->assertSame(2, $conflict->data()['error']['current']['revision']);
        $this->assertSame('A', $client->get("/api/cvs/$id")->data()['cv']['title'], 'rien n\'a été écrit');

        // La restauration fait aussi avancer la révision.
        $version = $client->post("/api/cvs/$id/versions", ['label' => 'v'])->data()['version']['id'];
        $restored = $client->post("/api/cvs/$id/versions/$version/restore");
        $this->assertSame(3, $restored->data()['cv']['revision']);
    }

    public function testVersionsAreTypedAndAManualVersionNamedAutoIsNotPurgedFirst(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $cv = $client->get("/api/cvs/$id")->data()['cv'];
        $cv['data']['summary'] = 'modifié';
        $client->put("/api/cvs/$id", ['title' => $cv['title'], 'settings' => $cv['settings'], 'data' => $cv['data']]);
        $manual = $client->post("/api/cvs/$id/versions", ['label' => 'Auto']);
        $this->assertSame(201, $manual->status);
        $this->assertSame('manual', $manual->data()['version']['kind']);

        $this->clock->advance(CvController::MANUAL_VERSION_INTERVAL);
        $restore = $client->post("/api/cvs/$id/versions/{$manual->data()['version']['id']}/restore");
        $this->assertSame(200, $restore->status);

        $kinds = [];
        foreach ($client->get("/api/cvs/$id/versions")->data()['versions'] as $v) {
            $kinds[$v['label']] = $v['kind'];
        }
        ksort($kinds);
        $this->assertSame(['Auto' => 'manual', 'auto' => 'auto', 'avant restauration' => 'restore'], $kinds);
    }

    public function testSingleVersionCanBeReadAndIsStoredCompressed(): void
    {
        [$client] = $this->registeredClient();
        $client->put('/api/profile', ['data' => self::sampleProfileV2()]);
        $id = $this->createCv($client);
        $created = $client->post("/api/cvs/$id/versions", ['label' => 'Envoyée à ACME'])->data()['version'];

        $response = $client->get("/api/cvs/$id/versions/{$created['id']}");
        $this->assertSame(200, $response->status);
        $version = $response->data()['version'];
        $this->assertSame(['id', 'label', 'kind', 'createdAt', 'settings', 'data'], array_keys($version));
        $this->assertSame('manual', $version['kind']);
        $this->assertSame(self::sampleProfileV2(), $version['data']);
        $this->assertSame(CvSettingsValidator::defaults(), $version['settings']);

        $stored = (string) $this->pdo->query("SELECT data FROM cv_versions WHERE id = '{$created['id']}'")->fetchColumn();
        $this->assertStringStartsWith('gz:', $stored);
        $this->assertStringNotContainsString('Camille', $stored);

        [$other] = $this->registeredClient();
        $this->assertSame(404, $other->get("/api/cvs/$id/versions/{$created['id']}")->status);
        $this->assertSame(404, $client->get("/api/cvs/$id/versions/01HZZZZZZZZZZZZZZZZZZZZZZZ")->status);
    }

    public function testManualVersionsAreRateLimitedPerCv(): void
    {
        [$client] = $this->registeredClient();
        $a = $this->createCv($client, 'A');
        $b = $this->createCv($client, 'B');

        $this->assertSame(201, $client->post("/api/cvs/$a/versions", ['label' => '1'])->status);
        $limited = $client->post("/api/cvs/$a/versions", ['label' => '2']);
        $this->assertSame(429, $limited->status);
        $this->assertSame('rate_limited', $limited->data()['error']['code']);
        $this->assertSame((string) CvController::MANUAL_VERSION_INTERVAL, $limited->header('Retry-After'));
        $this->assertSame(201, $client->post("/api/cvs/$b/versions", ['label' => '1'])->status, 'limite par CV');

        $this->clock->advance(CvController::MANUAL_VERSION_INTERVAL);
        $this->assertSame(201, $client->post("/api/cvs/$a/versions", ['label' => '2'])->status);
    }

    public function testStorageQuotaIsEnforced(): void
    {
        $this->boot(['USER_STORAGE_LIMIT_MB' => '1']);
        [$client] = $this->registeredClient();
        $profile = self::sampleProfile();
        $profile['experiences'][0]['achievements'] = array_map(
            static fn (int $i): array => ['id' => 'a' . $i, 'text' => str_repeat('Réalisation chiffrée. ', 180)],
            range(0, 29),
        );
        $profile['experiences'][1]['achievements'] = $profile['experiences'][0]['achievements'];
        $profile['experiences'][] = ['id' => 'exp3'] + $profile['experiences'][1];
        $this->assertSame(200, $client->put('/api/profile', ['data' => $profile])->status);        // ≈ 390 Ko
        $this->assertSame(201, $client->post('/api/cvs', ['title' => 'Copie 1'])->status);           // ≈ 780 Ko

        $over = $client->post('/api/cvs', ['title' => 'Copie 2']);                                    // ≈ 1,17 Mo
        $this->assertSame(413, $over->status);
        $this->assertSame('quota_exceeded', $over->data()['error']['code']);

        $usage = $client->get('/api/account/usage')->data();
        $this->assertSame(1024 * 1024, $usage['limitBytes']);
        $this->assertGreaterThan(700 * 1024, $usage['bytes']);
        $this->assertLessThanOrEqual(1024 * 1024, $usage['bytes']);
        $this->assertSame(1, $usage['cvs']);

        // Réduire reste toujours possible, même près du plafond.
        $small = self::sampleProfile();
        $this->assertSame(200, $client->put('/api/profile', ['data' => $small])->status);
    }

    public function testUsageEndpointCountsEverything(): void
    {
        [$client] = $this->registeredClient();
        $cv = $this->createCv($client);
        $client->post("/api/cvs/$cv/versions", ['label' => 'v']);
        $client->post('/api/letters', ['title' => 'L']);
        $client->post('/api/applications', ['company' => 'ACME', 'position' => 'PO']);

        $usage = $client->get('/api/account/usage');
        $this->assertSame(200, $usage->status);
        $data = $usage->data();
        $this->assertSame(['bytes', 'limitBytes', 'cvs', 'versions', 'letters', 'applications', 'shares'], array_keys($data));
        $this->assertSame([1, 1, 1, 1], [$data['cvs'], $data['versions'], $data['letters'], $data['applications']]);
        $this->assertGreaterThan(0, $data['bytes']);
        $this->assertSame(25 * 1024 * 1024, $data['limitBytes']);
    }
}
