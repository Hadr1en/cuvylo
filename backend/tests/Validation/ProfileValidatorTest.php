<?php

declare(strict_types=1);

namespace Cuvylo\Tests\Validation;

use Cuvylo\Domain\EmptyProfile;
use Cuvylo\Domain\ProfileMigrator;
use Cuvylo\Http\HttpException;
use Cuvylo\Support\Json;
use Cuvylo\Validation\ProfileValidator;
use Cuvylo\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ProfileValidatorTest extends TestCase
{
    private ProfileValidator $validator;

    protected function setUp(): void
    {
        $this->validator = new ProfileValidator();
    }

    /** @return array<string, mixed> Fixture v1 brute. */
    private static function sampleV1(): array
    {
        return Json::decode((string) file_get_contents(dirname(__DIR__, 3) . '/shared/fixtures/sample-profile.json'));
    }

    /** @return array<string, mixed> Fixture v1 migrée en v2. */
    private static function sample(): array
    {
        return ProfileMigrator::migrate(self::sampleV1());
    }

    /** @return array<string, mixed> Fixture v2 (missions, activité parallèle, rubrique libre). */
    private static function sampleV2(): array
    {
        return Json::decode((string) file_get_contents(dirname(__DIR__, 3) . '/shared/fixtures/sample-profile-v2.json'));
    }

    /** @return array<string, string> */
    private function errorsFor(array $profile): array
    {
        try {
            $this->validator->validate($profile, 'data');
        } catch (ValidationException $e) {
            return $e->fields;
        }
        $this->fail('Une ValidationException était attendue.');
    }

    public function testSharedFixtureIsValid(): void
    {
        $this->assertSame(self::sample(), $this->validator->validate(self::sample()));
    }

    /** Contrat de test commun PHP / TypeScript : les deux fixtures valident après migration. */
    public function testBothSharedFixturesValidateAfterMigration(): void
    {
        $migrated = $this->validator->validate(self::sampleV1());
        $this->assertSame(2, $migrated['schemaVersion']);
        $this->assertSame(self::sample(), $migrated, 'un document v1 est migré puis validé');
        $this->assertSame(self::sampleV2(), $this->validator->validate(self::sampleV2()), 'la fixture v2 est valide telle quelle');
    }

    public function testV1ToV2MigrationFollowsTheContract(): void
    {
        $v2 = ProfileMigrator::migrate(self::sampleV1());
        $this->assertSame(2, $v2['schemaVersion']);
        $this->assertSame('', $v2['identity']['details']);
        $this->assertSame('', $v2['identity']['photo']);
        foreach ($v2['experiences'] as $experience) {
            $this->assertFalse($experience['parallel']);
            $this->assertSame([], $experience['skills']);
            $this->assertSame([], $experience['missions']);
        }
        foreach (['projects', 'awards', 'publications', 'interests', 'customSections'] as $key) {
            $this->assertSame([], $v2[$key], $key);
        }
        $this->assertSame(
            ['summary', 'experiences', 'skills', 'education', 'certifications', 'languages', 'projects', 'awards', 'publications', 'interests'],
            array_column($v2['sections'], 'key'),
            'rubriques v2 ajoutées à la fin, dans l\'ordre, visibles',
        );
        $this->assertSame([true], array_values(array_unique(array_column($v2['sections'], 'visible'))));
        $this->assertSame($v2, ProfileMigrator::migrate($v2), 'migration idempotente');
        $this->assertSame('pas un objet', ProfileMigrator::migrate('pas un objet'));
    }

    public function testEmptyProfileIsValid(): void
    {
        $profile = EmptyProfile::create('someone@example.test');
        $this->assertSame($profile, $this->validator->validate($profile));
    }

    public function testHalfFilledProfileIsAccepted(): void
    {
        // Autosauvegarde : une expérience, une formation et une certification à peine commencées doivent passer.
        $profile = self::sample();
        $profile['experiences'] = [[
            'id' => 'e1', 'title' => '', 'company' => '', 'location' => '', 'startDate' => '', 'endDate' => '',
            'current' => false, 'description' => '', 'achievements' => [['id' => 'a1', 'text' => '']],
            'parallel' => false, 'skills' => [], 'missions' => [[
                'id' => 'm1', 'client' => '', 'role' => '', 'location' => '', 'startDate' => '', 'endDate' => null,
                'description' => '', 'achievements' => [], 'skills' => [],
            ]],
        ]];
        $profile['education'] = [['id' => 'd1', 'degree' => '', 'school' => '', 'location' => '', 'startDate' => '', 'endDate' => '', 'description' => '']];
        $profile['certifications'] = [['id' => 'c1', 'name' => '', 'issuer' => '', 'date' => '', 'url' => '']];
        $profile['links'] = [['id' => 'l1', 'label' => '', 'url' => '']];
        $profile['identity']['email'] = 'jean.du'; // pas de contrôle de format à l'enregistrement

        $this->assertSame($profile, $this->validator->validate($profile));
    }

    public function testCurrentExperienceAcceptsNullOrEmptyEndDate(): void
    {
        foreach ([null, ''] as $end) {
            $profile = self::sample();
            $profile['experiences'][0]['current'] = true;
            $profile['experiences'][0]['endDate'] = $end;
            $this->assertSame($profile, $this->validator->validate($profile));
        }
    }

    public function testNotCurrentExperienceAcceptsNullEndDate(): void
    {
        $profile = self::sample();
        $profile['experiences'][1]['endDate'] = null;
        $this->assertSame($profile, $this->validator->validate($profile));
    }

    public function testEndDateOrderOnlyCheckedWhenBothFilled(): void
    {
        $profile = self::sample();
        $profile['experiences'][1]['startDate'] = '';
        $profile['experiences'][1]['endDate'] = '2010-01';
        $this->assertSame($profile, $this->validator->validate($profile));

        $profile['experiences'][1]['startDate'] = '2020-05';
        $profile['experiences'][1]['endDate'] = '2020-05'; // égalité autorisée
        $this->assertSame($profile, $this->validator->validate($profile));
    }

    /** @return array<string, array{callable(array<string, mixed>): array<string, mixed>, string, string}> */
    public static function invalidProfiles(): array
    {
        $mutate = static fn (callable $fn): callable => $fn;

        return [
            'champ inconnu à la racine' => [$mutate(function (array $p): array { $p['admin'] = true; return $p; }), 'data.admin', 'unknown_field'],
            'champ inconnu dans une expérience' => [$mutate(function (array $p): array { $p['experiences'][0]['salary'] = 1; return $p; }), 'data.experiences.0.salary', 'unknown_field'],
            'rubrique racine manquante' => [$mutate(function (array $p): array { unset($p['skills']); return $p; }), 'data.skills', 'required'],
            'schemaVersion 3' => [$mutate(function (array $p): array { $p['schemaVersion'] = 3; return $p; }), 'data.schemaVersion', 'unsupported_version'],
            'schemaVersion flottant' => [$mutate(function (array $p): array { $p['schemaVersion'] = 1.0; return $p; }), 'data.schemaVersion', 'unsupported_version'],
            'identité de mauvais type' => [$mutate(function (array $p): array { $p['identity']['firstName'] = 42; return $p; }), 'data.identity.firstName', 'invalid_type'],
            'prénom trop long' => [$mutate(function (array $p): array { $p['identity']['firstName'] = str_repeat('a', 201); return $p; }), 'data.identity.firstName', 'too_long'],
            'saut de ligne dans un champ court' => [$mutate(function (array $p): array { $p['identity']['headline'] = "a\nb"; return $p; }), 'data.identity.headline', 'invalid_characters'],
            'octet nul dans un texte long' => [$mutate(function (array $p): array { $p['summary'] = "a\0b"; return $p; }), 'data.summary', 'invalid_characters'],
            'résumé trop long' => [$mutate(function (array $p): array { $p['summary'] = str_repeat('é', 4001); return $p; }), 'data.summary', 'too_long'],
            'date mal formée' => [$mutate(function (array $p): array { $p['experiences'][0]['startDate'] = '2021-13'; return $p; }), 'data.experiences.0.startDate', 'invalid_date'],
            'date au format complet' => [$mutate(function (array $p): array { $p['education'][0]['endDate'] = '2017-06-30'; return $p; }), 'data.education.0.endDate', 'invalid_date'],
            'date de certification invalide' => [$mutate(function (array $p): array { $p['certifications'][0]['date'] = 'mai 2022'; return $p; }), 'data.certifications.0.date', 'invalid_date'],
            'poste actuel avec date de fin' => [$mutate(function (array $p): array { $p['experiences'][0]['endDate'] = '2023-01'; return $p; }), 'data.experiences.0.endDate', 'end_date_must_be_empty'],
            'fin avant début (expérience)' => [$mutate(function (array $p): array { $p['experiences'][1]['endDate'] = '2016-01'; return $p; }), 'data.experiences.1.endDate', 'end_before_start'],
            'fin avant début (formation)' => [$mutate(function (array $p): array { $p['education'][0]['endDate'] = '2014-06'; return $p; }), 'data.education.0.endDate', 'end_before_start'],
            'current non booléen' => [$mutate(function (array $p): array { $p['experiences'][0]['current'] = 'true'; return $p; }), 'data.experiences.0.current', 'invalid_type'],
            'identifiants dupliqués' => [$mutate(function (array $p): array { $p['experiences'][1]['id'] = $p['experiences'][0]['id']; return $p; }), 'data.experiences.1.id', 'duplicate_id'],
            'réalisations dupliquées' => [$mutate(function (array $p): array { $p['experiences'][0]['achievements'][1]['id'] = 'ach1'; return $p; }), 'data.experiences.0.achievements.1.id', 'duplicate_id'],
            'identifiant invalide' => [$mutate(function (array $p): array { $p['languages'][0]['id'] = 'a b'; return $p; }), 'data.languages.0.id', 'invalid_id'],
            'url javascript' => [$mutate(function (array $p): array { $p['links'][0]['url'] = 'javascript:alert(1)'; return $p; }), 'data.links.0.url', 'invalid_url'],
            'url ftp' => [$mutate(function (array $p): array { $p['links'][0]['url'] = 'ftp://example.test/x'; return $p; }), 'data.links.0.url', 'invalid_url'],
            'url sans schéma' => [$mutate(function (array $p): array { $p['certifications'][0]['url'] = 'example.test'; return $p; }), 'data.certifications.0.url', 'invalid_url'],
            'url avec espace' => [$mutate(function (array $p): array { $p['links'][0]['url'] = 'https://example.test/a b'; return $p; }), 'data.links.0.url', 'invalid_url'],
            'url trop longue' => [$mutate(function (array $p): array { $p['links'][0]['url'] = 'https://example.test/' . str_repeat('a', 500); return $p; }), 'data.links.0.url', 'too_long'],
            'trop d\'expériences' => [$mutate(function (array $p): array {
                $p['experiences'] = [];
                for ($i = 0; $i < 51; $i++) {
                    $p['experiences'][] = ['id' => 'e' . $i, 'title' => '', 'company' => '', 'location' => '', 'startDate' => '', 'endDate' => null, 'current' => false, 'description' => '', 'achievements' => []];
                }
                return $p;
            }), 'data.experiences', 'too_many_items'],
            'trop de réalisations' => [$mutate(function (array $p): array {
                $p['experiences'][0]['achievements'] = [];
                for ($i = 0; $i < 31; $i++) {
                    $p['experiences'][0]['achievements'][] = ['id' => 'a' . $i, 'text' => ''];
                }
                return $p;
            }), 'data.experiences.0.achievements', 'too_many_items'],
            'trop de compétences dans un groupe' => [$mutate(function (array $p): array { $p['skills'][0]['items'] = array_fill(0, 41, 'x'); return $p; }), 'data.skills.0.items', 'too_many_items'],
            'compétence trop longue' => [$mutate(function (array $p): array { $p['skills'][0]['items'][0] = str_repeat('x', 81); return $p; }), 'data.skills.0.items.0', 'too_long'],
            'kind de compétence inconnu' => [$mutate(function (array $p): array { $p['skills'][0]['kind'] = 'magic'; return $p; }), 'data.skills.0.kind', 'invalid_enum'],
            'tableau là où un objet est attendu' => [$mutate(function (array $p): array { $p['identity'] = []; $p['identity'][] = 'x'; return $p; }), 'data.identity', 'invalid_type'],
            'objet là où une liste est attendue' => [$mutate(function (array $p): array { $p['links'] = ['a' => 1]; return $p; }), 'data.links', 'invalid_type'],
            'rubrique dupliquée' => [$mutate(function (array $p): array { $p['sections'][1]['key'] = 'summary'; return $p; }), 'data.sections.1.key', 'duplicate_section'],
            'rubrique manquante' => [$mutate(function (array $p): array { array_pop($p['sections']); return $p; }), 'data.sections', 'section_missing'],
            'rubrique inconnue' => [$mutate(function (array $p): array { $p['sections'][0]['key'] = 'hobbies'; return $p; }), 'data.sections.0.key', 'invalid_enum'],
            'visible non booléen' => [$mutate(function (array $p): array { $p['sections'][0]['visible'] = 1; return $p; }), 'data.sections.0.visible', 'invalid_type'],
        ];
    }

    #[DataProvider('invalidProfiles')]
    public function testInvalidProfilesAreRejectedWithDottedPaths(callable $mutate, string $path, string $code): void
    {
        $errors = $this->errorsFor($mutate(self::sample()));
        $this->assertArrayHasKey($path, $errors, 'Erreurs : ' . Json::encode($errors));
        $this->assertSame($code, $errors[$path]);
    }

    public function testNonObjectRootIsRejected(): void
    {
        $this->expectException(ValidationException::class);
        $this->validator->validate('hello', 'data');
    }

    public function testOversizedDocumentIsRejectedWith413(): void
    {
        $profile = self::sample();
        // 4 × 30 × 4 000 octets ≈ 480 Ko : chaque champ reste valide, c'est le total qui dépasse 450 Ko.
        $template = $profile['experiences'][1];
        $profile['experiences'] = [];
        for ($e = 0; $e < 4; $e++) {
            $experience = ['id' => 'e' . $e] + $template;
            $experience['achievements'] = [];
            for ($i = 0; $i < 30; $i++) {
                $experience['achievements'][] = ['id' => 'a' . $i, 'text' => str_repeat('a', 4000)];
            }
            $profile['experiences'][] = $experience;
        }

        try {
            $this->validator->validate($profile, 'data');
            $this->fail('413 attendu');
        } catch (HttpException $e) {
            $this->assertSame(413, $e->status);
            $this->assertSame('payload_too_large', $e->errorCode);
        }
    }

    public function testValidatorDoesNotMutateInput(): void
    {
        $profile = self::sample();
        $copy = $profile;
        $this->validator->validate($profile);
        $this->assertSame($copy, $profile);
    }
}
