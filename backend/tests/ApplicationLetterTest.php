<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Tests\Support\ApiTestCase;
use Cuvylo\Validation\LetterValidator;

/** Candidatures et lettres de motivation : CRUD, validation, isolation, révisions. */
final class ApplicationLetterTest extends ApiTestCase
{
    /** @return array<string, mixed> */
    private static function application(array $override = []): array
    {
        return $override + [
            'company' => 'ACME',
            'position' => 'Cheffe de projet cybersécurité',
            'url' => 'https://jobs.example.test/123',
            'posting' => "Missions :\n- piloter les homologations\n- animer les comités",
            'cvId' => null,
            'status' => 'applied',
            'appliedAt' => '2026-10-20',
            'nextActionAt' => '2026-10-27',
            'notes' => 'Relancer la RH.',
        ];
    }

    public function testApplicationCrudWithRevision(): void
    {
        [$client] = $this->registeredClient();
        $cvId = $this->createCv($client);

        $minimal = $client->post('/api/applications', ['company' => '  Initech ', 'position' => 'PO']);
        $this->assertSame(201, $minimal->status, $minimal->body());
        $app = $minimal->data()['application'];
        $this->assertSame('Initech', $app['company']);
        $this->assertSame('draft', $app['status']);
        $this->assertNull($app['appliedAt']);
        $this->assertSame(1, $app['revision']);

        $put = $client->put('/api/applications/' . $app['id'], self::application(['cvId' => $cvId, 'revision' => 1]));
        $this->assertSame(200, $put->status, $put->body());
        $updated = $put->data()['application'];
        $this->assertSame($cvId, $updated['cvId']);
        $this->assertSame('2026-10-20', $updated['appliedAt']);
        $this->assertSame(2, $updated['revision']);
        $this->assertStringContainsString('homologations', $updated['posting']);

        $conflict = $client->put('/api/applications/' . $app['id'], self::application(['status' => 'offer', 'revision' => 1]));
        $this->assertSame(409, $conflict->status);
        $this->assertSame('applied', $conflict->data()['error']['current']['status']);

        $list = $client->get('/api/applications')->data()['applications'];
        $this->assertCount(1, $list);
        $this->assertArrayNotHasKey('posting', $list[0], 'la liste reste légère');
        $this->assertTrue($list[0]['hasPosting']);
        $this->assertSame(200, $client->get('/api/applications/' . $app['id'])->status);

        // Supprimer le CV détache la candidature sans la supprimer.
        $client->delete("/api/cvs/$cvId");
        $this->assertNull($client->get('/api/applications/' . $app['id'])->data()['application']['cvId']);

        $this->assertSame(204, $client->delete('/api/applications/' . $app['id'])->status);
        $this->assertSame(404, $client->get('/api/applications/' . $app['id'])->status);
    }

    public function testApplicationValidation(): void
    {
        [$client] = $this->registeredClient();
        [$other] = $this->registeredClient();
        $foreignCv = $this->createCv($other);

        foreach ([
            [['position' => 'x'], 'company', 'required'],
            [self::application(['status' => 'ghosted']), 'status', 'invalid_enum'],
            [self::application(['appliedAt' => '2026-02-30']), 'appliedAt', 'invalid_date'],
            [self::application(['nextActionAt' => '27/10/2026']), 'nextActionAt', 'invalid_date'],
            [self::application(['url' => 'javascript:alert(1)']), 'url', 'invalid_url'],
            [self::application(['posting' => str_repeat('a', 20001)]), 'posting', 'too_long'],
            [self::application(['company' => "ACME\u{202E}"]), 'company', 'invalid_characters'],
            [self::application(['cvId' => 'nope']), 'cvId', 'invalid_id'],
            [self::application(['cvId' => $foreignCv]), 'cvId', 'invalid_reference'],
            [self::application(['extra' => 1]), 'extra', 'unknown_field'],
        ] as [$body, $field, $code]) {
            $response = $client->post('/api/applications', $body);
            $this->assertSame(422, $response->status, json_encode($body));
            $this->assertSame($code, self::errorFields($response)[$field] ?? null, $field);
        }

        $created = $client->post('/api/applications', self::application(['appliedAt' => '']))->data()['application'];
        $this->assertNull($created['appliedAt'], 'chaîne vide = pas de date');
        $this->assertSame(422, $client->put('/api/applications/' . $created['id'], ['company' => 'x', 'position' => 'y'])->status, 'PUT = document complet');
    }

    public function testApplicationsAndLettersAreIsolated(): void
    {
        [$alice] = $this->registeredClient();
        [$bob] = $this->registeredClient();
        $app = $alice->post('/api/applications', self::application())->data()['application']['id'];
        $letter = $alice->post('/api/letters', ['title' => 'Lettre ACME'])->data()['letter']['id'];

        foreach ([
            $bob->get("/api/applications/$app"),
            $bob->put("/api/applications/$app", self::application()),
            $bob->delete("/api/applications/$app"),
            $bob->get("/api/letters/$letter"),
            $bob->put("/api/letters/$letter", ['title' => 'x', 'cvId' => null, 'settings' => LetterValidator::defaultSettings(), 'data' => LetterValidator::emptyData()]),
            $bob->delete("/api/letters/$letter"),
        ] as $i => $response) {
            $this->assertSame(404, $response->status, "tentative $i");
        }
        $this->assertSame([], $bob->get('/api/applications')->data()['applications']);
        $this->assertSame([], $bob->get('/api/letters')->data()['letters']);
        $this->assertSame(200, $alice->get("/api/applications/$app")->status);
    }

    public function testLetterCrud(): void
    {
        [$client] = $this->registeredClient();
        $cvId = $this->createCv($client);

        $created = $client->post('/api/letters', ['title' => 'Lettre ACME', 'cvId' => $cvId]);
        $this->assertSame(201, $created->status, $created->body());
        $letter = $created->data()['letter'];
        $this->assertSame(LetterValidator::defaultSettings(), $letter['settings']);
        $this->assertSame(LetterValidator::emptyData(), $letter['data']);

        $data = [
            'recipient' => ['name' => 'Mme Martin', 'company' => 'ACME', 'address' => "1 rue de l'Exemple\n59000 Lille"],
            'subject' => 'Candidature au poste de cheffe de projet',
            'opening' => 'Madame,',
            'paragraphs' => ['Premier paragraphe.', "Deuxième\nparagraphe."],
            'closing' => 'Je vous prie d\'agréer, Madame, mes salutations distinguées.',
            'signature' => 'Camille Exemple',
            'place' => 'Lille',
            'date' => '24 octobre 2026',
        ];
        $settings = ['template' => 'consultant', 'accent' => '#aa3300', 'locale' => 'fr'];
        $put = $client->put('/api/letters/' . $letter['id'], ['title' => 'Lettre ACME v2', 'cvId' => $cvId, 'settings' => $settings, 'data' => $data, 'revision' => 1]);
        $this->assertSame(200, $put->status, $put->body());
        $this->assertSame($data, $put->data()['letter']['data']);
        $this->assertSame(2, $put->data()['letter']['revision']);

        $this->assertSame(409, $client->put('/api/letters/' . $letter['id'], ['title' => 'x', 'cvId' => null, 'settings' => $settings, 'data' => $data, 'revision' => 1])->status);

        $list = $client->get('/api/letters')->data()['letters'];
        $this->assertSame('consultant', $list[0]['template']);
        $this->assertArrayNotHasKey('data', $list[0]);

        $export = $client->get('/api/account/export')->data();
        $this->assertSame($data, $export['letters'][0]['data']);
        $this->assertSame('ACME', $client->get('/api/account/export')->data()['letters'][0]['data']['recipient']['company']);

        $this->assertSame(204, $client->delete('/api/letters/' . $letter['id'])->status);
        $this->assertSame([], $client->get('/api/letters')->data()['letters']);
    }

    public function testLetterValidation(): void
    {
        [$client] = $this->registeredClient();
        $data = LetterValidator::emptyData();
        foreach ([
            [['title' => ''], 'title', 'too_short'],
            [['title' => 'x', 'settings' => ['template' => 'nope', 'accent' => '#000000', 'locale' => 'fr']], 'settings.template', 'invalid_enum'],
            [['title' => 'x', 'settings' => ['template' => 'classic', 'accent' => 'red', 'locale' => 'fr']], 'settings.accent', 'invalid_color'],
            [['title' => 'x', 'settings' => ['template' => 'classic', 'accent' => '#000000', 'locale' => 'de']], 'settings.locale', 'invalid_enum'],
            [['title' => 'x', 'data' => ['paragraphs' => array_fill(0, 11, 'p')] + $data], 'data.paragraphs', 'too_many_items'],
            [['title' => 'x', 'data' => ['paragraphs' => [str_repeat('p', 4001)]] + $data], 'data.paragraphs.0', 'too_long'],
            [['title' => 'x', 'data' => ['subject' => "a\nb"] + $data], 'data.subject', 'invalid_characters'],
            [['title' => 'x', 'data' => ['recipient' => ['name' => 'a']] + $data], 'data.recipient.company', 'required'],
            [['title' => 'x', 'data' => ['ps' => 'x'] + $data], 'data.ps', 'unknown_field'],
        ] as [$body, $field, $code]) {
            $response = $client->post('/api/letters', $body);
            $this->assertSame(422, $response->status, json_encode($body));
            $this->assertSame($code, self::errorFields($response)[$field] ?? null, $field . ' ' . json_encode(self::errorFields($response)));
        }
    }
}
