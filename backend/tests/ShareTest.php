<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Repository\ShareRepository;
use Cuvylo\Tests\Support\ApiClient;
use Cuvylo\Tests\Support\ApiTestCase;

final class ShareTest extends ApiTestCase
{
    /** @return array{ApiClient, string} */
    private function cvWithProfile(): array
    {
        [$client] = $this->registeredClient();
        $client->put('/api/profile', ['data' => self::sampleProfileV2()]);

        return [$client, $this->createCv($client, 'CV partagé')];
    }

    public function testShareIsAFrozenPublicSnapshotWithViewCounter(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        $created = $client->post("/api/cvs/$cvId/shares", ['expiresInDays' => 30]);
        $this->assertSame(201, $created->status, $created->body());
        $share = $created->data()['share'];
        $this->assertSame(['id', 'slug', 'url', 'createdAt', 'expiresAt', 'views'], array_keys($share));
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{22}$/', $share['slug']);
        $this->assertSame('https://cv.example.test/p/' . $share['slug'], $share['url']);
        $this->assertSame(gmdate('Y-m-d\TH:i:s\Z', $this->clock->now() + 30 * 86400), $share['expiresAt']);

        // Modifier le CV après coup ne change pas l'instantané.
        $cv = $client->get("/api/cvs/$cvId")->data()['cv'];
        $cv['data']['summary'] = 'Modifié après le partage';
        $client->put("/api/cvs/$cvId", ['title' => 'Nouveau titre', 'settings' => $cv['settings'], 'data' => $cv['data']]);

        $visitor = $this->client();
        $public = $visitor->get('/api/public/cv/' . $share['slug']);
        $this->assertSame(200, $public->status);
        $this->assertSame(['title', 'settings', 'data', 'sharedAt'], array_keys($public->data()));
        $this->assertSame('CV partagé', $public->data()['title']);
        $this->assertSame(self::sampleProfileV2(), $public->data()['data']);
        $this->assertSame('noindex, nofollow', $public->header('X-Robots-Tag'));

        $visitor->get('/api/public/cv/' . $share['slug']);
        $list = $client->get("/api/cvs/$cvId/shares")->data()['shares'];
        $this->assertCount(1, $list);
        $this->assertSame(2, $list[0]['views']);
    }

    public function testAnonymizedCvIsSharedWithoutIdentity(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        $cv = $client->get("/api/cvs/$cvId")->data()['cv'];
        $cv['settings']['anonymize'] = true;
        $this->assertSame(200, $client->put("/api/cvs/$cvId", ['title' => $cv['title'], 'settings' => $cv['settings'], 'data' => $cv['data']])->status);

        $slug = $client->post("/api/cvs/$cvId/shares", [])->data()['share']['slug'];
        $public = $this->client()->get("/api/public/cv/$slug");
        $body = $public->body();
        $data = $public->data()['data'];
        $this->assertSame('C.', $data['identity']['firstName']);
        $this->assertSame('E.', $data['identity']['lastName']);
        $this->assertSame('', $data['identity']['email']);
        $this->assertSame([], $data['links']);
        foreach (['Camille', 'camille.exemple@example.test', '+33 6', 'linkedin'] as $needle) {
            $this->assertStringNotContainsString($needle, $body);
        }
        $stored = (string) $this->pdo->query("SELECT data FROM shares WHERE slug = '$slug'")->fetchColumn();
        $this->assertStringStartsWith('gz:', $stored);
        $this->assertStringNotContainsString('camille.exemple', (string) gzuncompress((string) base64_decode(substr($stored, 3))), 'jamais stocké en clair');
    }

    /** Le destinataire reçoit ce que le PDF affiche, rien de plus : rubriques masquées, entrées vides et photo exclues. */
    public function testPublicSnapshotHoldsOnlyWhatThePdfShows(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        $cv = $client->get("/api/cvs/$cvId")->data()['cv'];
        $data = $cv['data'];
        $data['summary'] = 'Résumé confidentiel à ne pas diffuser';
        $data['sections'] = array_map(static fn (array $s): array => $s['key'] === 'summary' ? ['visible' => false] + $s : $s, $data['sections']);
        $data['identity']['photo'] = 'data:image/png;base64,' . base64_encode('photo-test');
        $data['projects'][] = ['id' => 'vide', 'name' => '', 'role' => '', 'startDate' => '', 'endDate' => '', 'url' => 'https://exemple.test/secret', 'description' => 'Projet sans nom, jamais affiché', 'skills' => []];
        $saved = $client->put("/api/cvs/$cvId", ['title' => $cv['title'], 'settings' => $cv['settings'], 'data' => $data]);
        $this->assertSame(200, $saved->status, $saved->body());

        $slug = $client->post("/api/cvs/$cvId/shares")->data()['share']['slug'];
        $public = $this->client()->get("/api/public/cv/$slug");
        $this->assertSame(200, $public->status);
        $body = $public->body();
        foreach (['Résumé confidentiel', 'photo-test', 'exemple.test/secret', 'jamais affiché'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
        $this->assertSame('', $public->data()['data']['summary']);
        $this->assertSame('CV partagé', $public->data()['title'], 'titre conservé hors anonymisation');
        $stored = (string) $this->pdo->query("SELECT data FROM shares WHERE slug = '$slug'")->fetchColumn();
        $this->assertStringNotContainsString('confidentiel', (string) gzuncompress((string) base64_decode(substr($stored, 3))), 'jamais stocké');
    }

    /** Même politique que le navigateur : identifiants retirés partout, y compris dans les textes libres et le titre. */
    public function testAnonymizedShareRemovesEveryIdentifierAndUsesANeutralTitle(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        $cv = $client->get("/api/cvs/$cvId")->data()['cv'];
        $data = $cv['data'];
        $data['identity']['location'] = '12 rue des Lilas, 59000 Lille, France';
        $data['identity']['details'] = 'Permis B, né à Roubaix';
        // Nom, téléphone et e-mail de la personne (ceux de sa fiche) recopiés dans un texte libre.
        $data['summary'] = 'Camille Exemple, joignable au 06 00 00 00 00 ou camille.exemple@example.test.';
        $data['projects'][0]['url'] = 'https://camille.example.test/projet';
        $cv['settings']['anonymize'] = true;
        $this->assertSame(200, $client->put("/api/cvs/$cvId", ['title' => 'CV Camille Exemple', 'settings' => $cv['settings'], 'data' => $data])->status);

        $slug = $client->post("/api/cvs/$cvId/shares")->data()['share']['slug'];
        $public = $this->client()->get("/api/public/cv/$slug");
        $out = $public->data();
        $this->assertSame('Dossier de compétences', $out['title']);
        $this->assertSame('Lille, France', $out['data']['identity']['location']);
        $this->assertSame('', $out['data']['identity']['details']);
        $this->assertSame('', $out['data']['projects'][0]['url']);
        $this->assertStringStartsWith('C. E., joignable au', $out['data']['summary']);
        // « Exemple » reste légitime dans des noms d'entreprises fictives (« Distributeur Exemple ») : seul le nom complet compte.
        foreach (['Camille', 'Camille Exemple', 'Lilas', 'Roubaix', '00 00 00 00', 'camille.example.test', 'camille.exemple@'] as $needle) {
            $this->assertStringNotContainsString($needle, $public->body(), $needle);
        }
        $this->assertStringNotContainsString('Camille', (string) $this->pdo->query("SELECT title FROM shares WHERE slug = '$slug'")->fetchColumn(), 'titre neutre stocké');
    }

    public function testExpiredShareContentIsPurged(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        $share = $client->post("/api/cvs/$cvId/shares", ['expiresInDays' => 1])->data()['share'];
        $this->clock->advance(86400 + 1);
        $client->get('/api/auth/me'); // n'importe quelle requête authentifiée
        $row = $this->pdo->query("SELECT data, settings FROM shares WHERE id = '{$share['id']}'")->fetch();
        $this->assertSame(['data' => '{}', 'settings' => '{}'], $row, 'contenu effacé à l\'expiration');
        $this->assertCount(1, $client->get("/api/cvs/$cvId/shares")->data()['shares'], 'métadonnées conservées (liste, export)');
    }

    public function testExpiredAndRevokedSharesAreGone(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        $short = $client->post("/api/cvs/$cvId/shares", ['expiresInDays' => 1])->data()['share'];
        $forever = $client->post("/api/cvs/$cvId/shares")->data()['share'];
        $this->assertNull($forever['expiresAt']);

        $this->clock->advance(86400 + 1);
        $this->assertSame(404, $this->client()->get('/api/public/cv/' . $short['slug'])->status, 'expiré');
        $this->assertSame(200, $this->client()->get('/api/public/cv/' . $forever['slug'])->status);

        [$intruder] = $this->registeredClient();
        $this->assertSame(404, $intruder->delete('/api/shares/' . $forever['id'])->status, 'partage d\'autrui');
        $this->assertSame(404, $intruder->get("/api/cvs/$cvId/shares")->status);
        $this->assertSame(404, $intruder->post("/api/cvs/$cvId/shares")->status);

        $this->assertSame(204, $client->delete('/api/shares/' . $forever['id'])->status);
        $this->assertSame(404, $this->client()->get('/api/public/cv/' . $forever['slug'])->status, 'révoqué');
        $this->assertSame(404, $client->delete('/api/shares/' . $forever['id'])->status);
        $this->assertSame('{}', (string) $this->pdo->query("SELECT data FROM shares WHERE id = '{$forever['id']}'")->fetchColumn(), 'instantané effacé à la révocation');

        $this->assertSame(404, $this->client()->get('/api/public/cv/inconnu')->status);
        $this->assertSame(404, $this->client()->get('/api/public/cv/' . str_repeat('A', 22))->status);
    }

    public function testShareValidationAndCap(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        foreach ([0, 366, '7', 1.5] as $bad) {
            $this->assertSame(422, $client->post("/api/cvs/$cvId/shares", ['expiresInDays' => $bad])->status, json_encode($bad));
        }
        $this->assertSame(422, $client->post("/api/cvs/$cvId/shares", ['slug' => 'mine'])->status);

        for ($i = 0; $i < ShareRepository::MAX_ACTIVE_PER_CV; $i++) {
            $this->assertSame(201, $client->post("/api/cvs/$cvId/shares")->status);
        }
        $this->assertSame(409, $client->post("/api/cvs/$cvId/shares")->status);
    }

    public function testDeletingTheCvDeletesItsShares(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        $slug = $client->post("/api/cvs/$cvId/shares")->data()['share']['slug'];
        $this->assertSame(204, $client->delete("/api/cvs/$cvId")->status);
        $this->assertSame(404, $this->client()->get("/api/public/cv/$slug")->status);
        $this->assertSame(0, (int) $this->pdo->query("SELECT COUNT(*) FROM shares WHERE cv_id = '$cvId'")->fetchColumn());
    }

    public function testExportListsShareMetadataWithoutSnapshot(): void
    {
        [$client, $cvId] = $this->cvWithProfile();
        $share = $client->post("/api/cvs/$cvId/shares")->data()['share'];
        $export = $client->get('/api/account/export')->data();
        $this->assertCount(1, $export['shares']);
        $this->assertSame($share['slug'], $export['shares'][0]['slug']);
        $this->assertSame($cvId, $export['shares'][0]['cvId']);
        $this->assertArrayNotHasKey('data', $export['shares'][0]);
    }
}
