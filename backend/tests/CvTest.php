<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Controller\CvController;
use Cuvylo\Repository\CvRepository;
use Cuvylo\Support\Ulid;
use Cuvylo\Tests\Support\ApiClient;
use Cuvylo\Tests\Support\ApiTestCase;

final class CvTest extends ApiTestCase
{
    public function testProfileRoundTripAndValidation(): void
    {
        [$client] = $this->registeredClient();
        $profile = self::sampleProfile();

        $put = $client->put('/api/profile', ['data' => $profile]);
        $this->assertSame(200, $put->status, $put->body());
        $this->assertSame($profile, $put->data()['data']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $put->data()['updatedAt']);
        $this->assertSame($profile, $client->get('/api/profile')->data()['data']);

        $profile['experiences'][0]['startDate'] = '2021-99';
        $bad = $client->put('/api/profile', ['data' => $profile]);
        $this->assertSame(422, $bad->status);
        $this->assertSame('invalid_date', self::errorFields($bad)['data.experiences.0.startDate']);

        $this->assertSame(422, $client->put('/api/profile', ['data' => self::sampleProfile(), 'extra' => 1])->status);
        $this->assertSame(422, $client->put('/api/profile', [])->status);
    }

    public function testProfileAcceptsHalfFilledAutosave(): void
    {
        [$client] = $this->registeredClient();
        $profile = self::sampleProfile();
        $profile['experiences'][] = [
            'id' => 'new1', 'title' => '', 'company' => '', 'location' => '', 'startDate' => '', 'endDate' => '',
            'current' => false, 'description' => '', 'achievements' => [], 'parallel' => false, 'skills' => [], 'missions' => [],
        ];
        $profile['education'][] = ['id' => 'new2', 'degree' => '', 'school' => '', 'location' => '', 'startDate' => '', 'endDate' => '', 'description' => ''];
        $this->assertSame(200, $client->put('/api/profile', ['data' => $profile])->status);
    }

    public function testCreateCvFromProfileIsAnIndependentSnapshot(): void
    {
        [$client] = $this->registeredClient();
        $profile = self::sampleProfile();
        $client->put('/api/profile', ['data' => $profile]);

        $created = $client->post('/api/cvs', ['title' => '  Chef de projet  ']);
        $this->assertSame(201, $created->status, $created->body());
        $cv = $created->data()['cv'];
        $this->assertSame('Chef de projet', $cv['title']);
        $this->assertSame('base', $cv['kind']);
        $this->assertSame('classic', $cv['template']);
        $this->assertTrue(Ulid::isValid($cv['id']));
        $this->assertSame($profile, $cv['data']);
        $this->assertSame(self::settings(), $cv['settings']);

        $profile['summary'] = 'Résumé modifié après la création du CV';
        $client->put('/api/profile', ['data' => $profile]);
        $this->assertNotSame($profile['summary'], $client->get('/api/cvs/' . $cv['id'])->data()['cv']['data']['summary']);

        // Et inversement : modifier le CV ne touche pas le profil maître.
        $cvData = $cv['data'];
        $cvData['summary'] = 'Version adaptée à une offre';
        $this->assertSame(200, $client->put('/api/cvs/' . $cv['id'], ['title' => 'Adapté', 'settings' => $cv['settings'], 'data' => $cvData])->status);
        $this->assertSame($profile['summary'], $client->get('/api/profile')->data()['data']['summary']);
    }

    public function testCreateTailoredCvWithSettingsAndDuplicate(): void
    {
        [$client] = $this->registeredClient();
        $settings = self::settings(['template' => 'modern', 'accent' => '#aa3300', 'pageBreakBefore' => ['education']]);
        $created = $client->post('/api/cvs', ['title' => 'Offre ACME', 'kind' => 'tailored', 'settings' => $settings]);
        $this->assertSame(201, $created->status, $created->body());
        $this->assertSame('tailored', $created->data()['cv']['kind']);
        $this->assertSame('modern', $created->data()['cv']['template']);

        $copy = $client->post('/api/cvs', ['title' => 'Copie', 'source' => ['type' => 'cv', 'id' => $created->data()['cv']['id']]]);
        $this->assertSame(201, $copy->status, $copy->body());
        $this->assertSame($settings, $copy->data()['cv']['settings'], 'la duplication conserve les réglages');
        $this->assertSame($created->data()['cv']['data'], $copy->data()['cv']['data']);
        $this->assertNotSame($created->data()['cv']['id'], $copy->data()['cv']['id']);
    }

    public function testCreateValidation(): void
    {
        [$client] = $this->registeredClient();
        foreach ([
            [['title' => ''], 'title'],
            [['title' => str_repeat('a', 121)], 'title'],
            [['title' => 'ok', 'kind' => 'weird'], 'kind'],
            [['title' => 'ok', 'source' => ['type' => 'cv']], 'source.id'],
            [['title' => 'ok', 'source' => ['type' => 'cv', 'id' => 'nope']], 'source.id'],
            [['title' => 'ok', 'source' => ['type' => 'file']], 'source.type'],
            [['title' => 'ok', 'settings' => ['template' => 'x']], 'settings.template'],
            [['nope' => 1], 'title'],
        ] as [$body, $field]) {
            $response = $client->post('/api/cvs', $body);
            $this->assertSame(422, $response->status, json_encode($body));
            $this->assertArrayHasKey($field, self::errorFields($response), json_encode($body));
        }
    }

    public function testListIsSortedByLastUpdateAndContainsSummariesOnly(): void
    {
        [$client] = $this->registeredClient();
        $first = $this->createCv($client, 'Premier');
        $this->clock->advance(60);
        $second = $this->createCv($client, 'Second');
        $this->clock->advance(60);
        $cv = $client->get("/api/cvs/$first")->data()['cv'];
        $client->put("/api/cvs/$first", ['title' => 'Premier (modifié)', 'settings' => $cv['settings'], 'data' => $cv['data']]);

        $list = $client->get('/api/cvs')->data()['cvs'];
        $this->assertSame([$first, $second], array_column($list, 'id'));
        $this->assertArrayNotHasKey('data', $list[0]);
        $this->assertSame(['id', 'title', 'kind', 'template', 'createdAt', 'updatedAt'], array_keys($list[0]));
    }

    public function testUpdateValidatesBody(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $cv = $client->get("/api/cvs/$id")->data()['cv'];

        $badData = $cv['data'];
        $badData['experiences'][0]['startDate'] = 'bad';
        $this->assertSame(422, $client->put("/api/cvs/$id", ['title' => 'x', 'settings' => $cv['settings'], 'data' => $badData])->status);
        $this->assertSame(422, $client->put("/api/cvs/$id", ['title' => 'x', 'settings' => ['template' => 'classic'], 'data' => $cv['data']])->status);
        $this->assertSame(422, $client->put("/api/cvs/$id", ['title' => '', 'settings' => $cv['settings'], 'data' => $cv['data']])->status);
        $this->assertSame(422, $client->put("/api/cvs/$id", ['title' => 'x', 'settings' => $cv['settings']])->status);
        $this->assertSame($cv, $client->get("/api/cvs/$id")->data()['cv'], 'aucune écriture partielle');
    }

    public function testCvCapIsEnforced(): void
    {
        [$client] = $this->registeredClient();
        for ($i = 0; $i < CvRepository::MAX_CVS_PER_USER; $i++) {
            $this->assertSame(201, $client->post('/api/cvs', ['title' => "CV $i"])->status);
        }
        $over = $client->post('/api/cvs', ['title' => 'trop']);
        $this->assertSame(409, $over->status);
        $this->assertSame('conflict', $over->data()['error']['code']);
    }

    public function testDeleteRemovesCvAndItsVersions(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $client->post("/api/cvs/$id/versions", ['label' => 'v1']);

        $this->assertSame(204, $client->delete("/api/cvs/$id")->status);
        $this->assertSame(404, $client->get("/api/cvs/$id")->status);
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM cv_versions WHERE cv_id = ?');
        $stmt->execute([$id]);
        $this->assertSame(0, (int) $stmt->fetchColumn());
        $this->assertSame(404, $client->delete("/api/cvs/$id")->status, 'deuxième suppression');
    }

    /** Modifie le résumé d'un CV (change donc `data`). */
    private function edit(ApiClient $client, string $id, string $summary): void
    {
        $cv = $client->get("/api/cvs/$id")->data()['cv'];
        $cv['data']['summary'] = $summary;
        $response = $client->put("/api/cvs/$id", ['title' => $cv['title'], 'settings' => $cv['settings'], 'data' => $cv['data']]);
        $this->assertSame(200, $response->status, $response->body());
    }

    /** @return list<array{id: string, label: string, createdAt: string}> */
    private function versions(ApiClient $client, string $id): array
    {
        return $client->get("/api/cvs/$id/versions")->data()['versions'];
    }

    public function testAutoVersionIsCreatedOnFirstChangeThenThrottledToTenMinutes(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $this->assertSame([], $this->versions($client, $id));

        $this->edit($client, $id, 'v1');
        $versions = $this->versions($client, $id);
        $this->assertCount(1, $versions, 'première modification archivée');
        $this->assertSame('auto', $versions[0]['label']);

        $this->clock->advance(CvController::AUTO_VERSION_INTERVAL - 60);
        $this->edit($client, $id, 'v2');
        $this->assertCount(1, $this->versions($client, $id), 'moins de 10 minutes : pas de nouvelle version');

        $this->clock->advance(61);
        $this->edit($client, $id, 'v3');
        $this->assertCount(2, $this->versions($client, $id), 'au-delà de 10 minutes : nouvelle version');
    }

    public function testAutoVersionStoresThePreviousState(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $original = $client->get("/api/cvs/$id")->data()['cv']['data']['summary'];

        $this->edit($client, $id, 'nouveau texte');
        $versionId = $this->versions($client, $id)[0]['id'];
        $restored = $client->post("/api/cvs/$id/versions/$versionId/restore");

        $this->assertSame(200, $restored->status);
        $this->assertSame($original, $restored->data()['cv']['data']['summary']);
    }

    public function testNoVersionWhenNothingChanged(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $cv = $client->get("/api/cvs/$id")->data()['cv'];

        $this->clock->advance(3600);
        $response = $client->put("/api/cvs/$id", ['title' => 'Nouveau titre seul', 'settings' => $cv['settings'], 'data' => $cv['data']]);
        $this->assertSame(200, $response->status);
        $this->assertSame('Nouveau titre seul', $response->data()['cv']['title']);
        $this->assertSame([], $this->versions($client, $id), 'un renommage seul ne crée pas de version');

        // Un changement de réglages, lui, compte.
        $settings = self::settings(['template' => 'compact']);
        $client->put("/api/cvs/$id", ['title' => 'T', 'settings' => $settings, 'data' => $cv['data']]);
        $this->assertCount(1, $this->versions($client, $id));
    }

    public function testKeyOrderDifferencesAreNotTreatedAsChanges(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $cv = $client->get("/api/cvs/$id")->data()['cv'];
        $reordered = array_reverse($cv['settings'], true);

        $client->put("/api/cvs/$id", ['title' => 'Mon CV', 'settings' => $reordered, 'data' => $cv['data']]);
        $this->assertSame([], $this->versions($client, $id));
    }

    public function testManualVersionRestoreAndSafetySnapshot(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);

        $this->edit($client, $id, 'état A');
        $created = $client->post("/api/cvs/$id/versions", ['label' => '  Avant envoi ACME  ']);
        $this->assertSame(201, $created->status, $created->body());
        $versionId = $created->data()['version']['id'];
        $this->assertSame('Avant envoi ACME', $created->data()['version']['label']);

        $this->clock->advance(5);
        $this->edit($client, $id, 'état B');
        $restored = $client->post("/api/cvs/$id/versions/$versionId/restore");
        $this->assertSame(200, $restored->status, $restored->body());
        $this->assertSame('état A', $restored->data()['cv']['data']['summary']);
        $this->assertSame('Mon CV', $restored->data()['cv']['title'], 'le titre n\'est pas restauré');

        $labels = array_column($this->versions($client, $id), 'label');
        $this->assertContains('avant restauration', $labels, 'l\'état courant est archivé avant restauration');
        $this->assertContains('Avant envoi ACME', $labels);

        // L'état B n'est pas perdu : il est dans le snapshot « avant restauration ».
        $safety = array_values(array_filter($this->versions($client, $id), static fn (array $v): bool => $v['label'] === 'avant restauration'))[0];
        $back = $client->post("/api/cvs/$id/versions/{$safety['id']}/restore");
        $this->assertSame('état B', $back->data()['cv']['data']['summary']);
    }

    public function testVersionLabelValidation(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);
        $this->assertSame(422, $client->post("/api/cvs/$id/versions", ['label' => ''])->status);
        $this->assertSame(422, $client->post("/api/cvs/$id/versions", ['label' => str_repeat('a', 121)])->status);
        $this->assertSame(422, $client->post("/api/cvs/$id/versions", [])->status);
    }

    public function testVersionsAreCappedAndAutoOnesArePurgedFirst(): void
    {
        [$client] = $this->registeredClient();
        $id = $this->createCv($client);

        $this->edit($client, $id, 'a');                                   // 1 version auto
        $manual = $client->post("/api/cvs/$id/versions", ['label' => 'à garder'])->data()['version']['id'];

        // 2 versions existent déjà : en ajouter MAX - 1 fait dépasser le plafond d'exactement une unité.
        for ($i = 0; $i < CvRepository::MAX_VERSIONS_PER_CV - 1; $i++) {
            $this->clock->advance(CvController::MANUAL_VERSION_INTERVAL);
            $this->assertSame(201, $client->post("/api/cvs/$id/versions", ['label' => "v$i"])->status);
        }

        $versions = $this->versions($client, $id);
        $this->assertCount(CvRepository::MAX_VERSIONS_PER_CV, $versions);
        $this->assertNotContains('auto', array_column($versions, 'label'), 'la version auto est partie la première');
        $this->assertContains($manual, array_column($versions, 'id'), 'la version nommée est conservée tant qu\'il reste des auto à purger');

        // Plus aucune auto : ce sont désormais les plus anciennes versions nommées qui partent.
        foreach ([1, 2] as $n) {
            $this->clock->advance(CvController::MANUAL_VERSION_INTERVAL);
            $client->post("/api/cvs/$id/versions", ['label' => "extra$n"]);
        }
        $versions = $this->versions($client, $id);
        $this->assertCount(CvRepository::MAX_VERSIONS_PER_CV, $versions);
        $this->assertNotContains($manual, array_column($versions, 'id'));
        $this->assertContains('extra2', array_column($versions, 'label'));
    }

    public function testVersionCapOnlyAppliesPerCv(): void
    {
        [$client] = $this->registeredClient();
        $a = $this->createCv($client, 'A');
        $b = $this->createCv($client, 'B');
        for ($i = 0; $i < CvRepository::MAX_VERSIONS_PER_CV + 3; $i++) {
            $this->clock->advance(CvController::MANUAL_VERSION_INTERVAL);
            $client->post("/api/cvs/$a/versions", ['label' => "v$i"]);
        }
        $client->post("/api/cvs/$b/versions", ['label' => 'seule']);

        $this->assertCount(CvRepository::MAX_VERSIONS_PER_CV, $this->versions($client, $a));
        $this->assertCount(1, $this->versions($client, $b));
    }

    public function testTimestampsAreIso8601Utc(): void
    {
        [$client] = $this->registeredClient();
        $cv = $client->get('/api/cvs/' . $this->createCv($client))->data()['cv'];
        $this->assertSame(gmdate('Y-m-d\TH:i:s\Z', $this->clock->now()), $cv['createdAt']);
    }
}
