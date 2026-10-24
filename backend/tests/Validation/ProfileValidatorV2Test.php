<?php

declare(strict_types=1);

namespace Cuvylo\Tests\Validation;

use Cuvylo\Support\Json;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\ProfileValidator;
use Cuvylo\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Règles propres à ProfileData v2. */
final class ProfileValidatorV2Test extends TestCase
{
    /** @return array<string, mixed> */
    private static function sample(): array
    {
        return Json::decode((string) file_get_contents(dirname(__DIR__, 3) . '/shared/fixtures/sample-profile-v2.json'));
    }

    /** @return array<string, string> */
    private static function errorsFor(array $profile): array
    {
        try {
            (new ProfileValidator())->validate($profile, 'data');
        } catch (ValidationException $e) {
            return $e->fields;
        }

        return [];
    }

    public function testYearOnlyDatesUseJanuaryAtStartAndDecemberAtEnd(): void
    {
        $p = self::sample();
        $p['experiences'][1]['startDate'] = '2020-05';
        $p['experiences'][1]['endDate'] = '2020';              // décembre 2020 ≥ mai 2020
        $p['education'][0]['startDate'] = '2014';
        $p['education'][0]['endDate'] = '2014-01';             // janvier 2014 ≥ janvier 2014
        $this->assertSame([], self::errorsFor($p));

        $p['experiences'][1]['startDate'] = '2021';
        $p['experiences'][1]['endDate'] = '2020-12';
        $this->assertSame('end_before_start', self::errorsFor($p)['data.experiences.1.endDate'] ?? null);
    }

    public function testMissionsAreValidatedLikeExperiences(): void
    {
        $p = self::sample();
        $p['experiences'][1]['missions'][0]['endDate'] = '2021-01';      // avant le début (2022-05)
        $p['experiences'][1]['missions'][1]['skills'] = [str_repeat('x', 81)];
        $p['experiences'][1]['missions'][1]['client'] = "Client\u{202E}inversé";
        $errors = self::errorsFor($p);
        $this->assertSame('end_before_start', $errors['data.experiences.1.missions.0.endDate'] ?? null);
        $this->assertSame('too_long', $errors['data.experiences.1.missions.1.skills.0'] ?? null);
        $this->assertSame('invalid_characters', $errors['data.experiences.1.missions.1.client'] ?? null);
    }

    public function testMissionEndDateMayBeNull(): void
    {
        $p = self::sample();
        $p['experiences'][1]['missions'][0]['endDate'] = null;
        $this->assertSame([], self::errorsFor($p));
    }

    public function testPhotoMustBeAJpegOrPngDataUrl(): void
    {
        $p = self::sample();
        $p['identity']['photo'] = 'data:image/png;base64,' . base64_encode('fake-png-bytes');
        $this->assertSame([], self::errorsFor($p));

        $p['identity']['photo'] = 'data:image/gif;base64,R0lGOD==';
        $this->assertSame('invalid_image', self::errorsFor($p)['data.identity.photo'] ?? null);

        $p['identity']['photo'] = 'https://example.test/photo.jpg';
        $this->assertSame('invalid_image', self::errorsFor($p)['data.identity.photo'] ?? null);

        $p['identity']['photo'] = 'data:image/jpeg;base64,' . str_repeat('A', ProfileValidator::MAX_PHOTO_LENGTH);
        $this->assertSame('too_long', self::errorsFor($p)['data.identity.photo'] ?? null);
    }

    /** @return array<string, array{callable(array<string, mixed>): array<string, mixed>, string, string}> */
    public static function invalidSections(): array
    {
        return [
            'rubrique libre absente de sections' => [function (array $p): array { array_pop($p['sections']); return $p; }, 'data.sections', 'section_missing'],
            'rubrique libre inexistante' => [function (array $p): array { $p['sections'][10]['customId'] = 'nope'; return $p; }, 'data.sections.10.customId', 'invalid_reference'],
            'rubrique libre en double' => [function (array $p): array { $p['sections'][] = ['key' => 'custom', 'customId' => 'cus1', 'visible' => false]; return $p; }, 'data.sections.11.customId', 'duplicate_section'],
            'custom sans customId' => [function (array $p): array { unset($p['sections'][10]['customId']); return $p; }, 'data.sections.10.customId', 'required'],
            'customId sur une rubrique fixe' => [function (array $p): array { $p['sections'][0]['customId'] = 'cus1'; return $p; }, 'data.sections.0.customId', 'unknown_field'],
            'rubrique fixe v2 manquante' => [function (array $p): array { array_splice($p['sections'], 6, 1); return $p; }, 'data.sections', 'section_missing'],
            'trop de rubriques libres' => [function (array $p): array {
                $p['customSections'] = array_map(static fn (int $i): array => ['id' => 'c' . $i, 'title' => 'T', 'entries' => []], range(0, 10));
                return $p;
            }, 'data.customSections', 'too_many_items'],
            'titre de rubrique libre trop long' => [function (array $p): array { $p['customSections'][0]['title'] = str_repeat('t', 81); return $p; }, 'data.customSections.0.title', 'too_long'],
            'type de publication inconnu' => [function (array $p): array { $p['publications'][0]['kind'] = 'podcast'; return $p; }, 'data.publications.0.kind', 'invalid_enum'],
            'centre d\'intérêt trop long' => [function (array $p): array { $p['interests'][0]['text'] = str_repeat('i', 201); return $p; }, 'data.interests.0.text', 'too_long'],
            'parallel non booléen' => [function (array $p): array { $p['experiences'][0]['parallel'] = 'oui'; return $p; }, 'data.experiences.0.parallel', 'invalid_type'],
            'champ inconnu dans une mission' => [function (array $p): array { $p['experiences'][1]['missions'][0]['tjm'] = 600; return $p; }, 'data.experiences.1.missions.0.tjm', 'unknown_field'],
            'URL de projet invalide' => [function (array $p): array { $p['projects'][0]['url'] = 'javascript:alert(1)'; return $p; }, 'data.projects.0.url', 'invalid_url'],
            'date d\'entrée libre invalide' => [function (array $p): array { $p['customSections'][0]['entries'][0]['date'] = '2019-13'; return $p; }, 'data.customSections.0.entries.0.date', 'invalid_date'],
            'date avec saut de ligne final' => [function (array $p): array { $p['awards'][0]['date'] = "2015\n"; return $p; }, 'data.awards.0.date', 'invalid_date'],
            'details trop long' => [function (array $p): array { $p['identity']['details'] = str_repeat('d', 201); return $p; }, 'data.identity.details', 'too_long'],
            'contrôle C1 dans un texte long' => [function (array $p): array { $p['summary'] = "Texte\u{0085}suite"; return $p; }, 'data.summary', 'invalid_characters'],
            'contrôle bidi dans un nom' => [function (array $p): array { $p['identity']['lastName'] = "Exe\u{2066}mple"; return $p; }, 'data.identity.lastName', 'invalid_characters'],
            'marque de direction dans une compétence' => [function (array $p): array { $p['skills'][0]['items'][0] = "EBIOS\u{200F}"; return $p; }, 'data.skills.0.items.0', 'invalid_characters'],
        ];
    }

    #[DataProvider('invalidSections')]
    public function testInvalidV2Documents(callable $mutate, string $path, string $code): void
    {
        $errors = self::errorsFor($mutate(self::sample()));
        $this->assertSame($code, $errors[$path] ?? null, Json::encode($errors));
    }

    public function testValidationErrorsAreCappedAtFifty(): void
    {
        $p = self::sample();
        $p['links'] = array_map(static fn (int $i): array => ['id' => 'l' . $i, 'label' => 'x', 'url' => 'ftp://bad/' . $i], range(0, 49));
        $p['languages'] = array_map(static fn (int $i): array => ['id' => 'g' . $i, 'name' => 42, 'level' => 42], range(0, 49));
        $errors = self::errorsFor($p);
        $this->assertCount(Fields::MAX_ERRORS, $errors);
    }

    public function testNewlinesAreStillAllowedInLongTexts(): void
    {
        $p = self::sample();
        $p['summary'] = "Ligne 1\nLigne 2\r\n\tLigne 3";
        $p['customSections'][0]['entries'][0]['description'] = "a\nb";
        $this->assertSame([], self::errorsFor($p));
    }
}
