<?php

declare(strict_types=1);

namespace Cuvylo\Tests\Validation;

use Cuvylo\Validation\CvSettingsValidator;
use Cuvylo\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CvSettingsValidatorTest extends TestCase
{
    public function testDefaultsAreValid(): void
    {
        $defaults = CvSettingsValidator::defaults();
        $this->assertSame($defaults, (new CvSettingsValidator())->validate($defaults));
        $this->assertSame([
            'template' => 'classic', 'accent' => '#1f3a5f', 'density' => 'comfortable', 'pageBreakBefore' => [],
            'keepEntriesTogether' => true, 'locale' => 'fr', 'fontPair' => 'template', 'showPhoto' => false,
            'targetPages' => 0, 'anonymize' => false,
        ], $defaults, 'réglages par défaut v2');
    }

    /** La liste doit rester alignée avec TEMPLATES de frontend/src/domain/cv.ts. */
    public function testAcceptsEveryCatalogTemplate(): void
    {
        $catalog = [
            'classic', 'modern', 'compact', 'editorial', 'margin', 'dossier', 'banner', 'timeline',
            'consultant', 'executive', 'media', 'tech', 'academic', 'european', 'swiss', 'ink', 'sidebar', 'skills-dossier',
        ];
        $this->assertCount(18, $catalog);
        $this->assertSame($catalog, CvSettingsValidator::TEMPLATES);
        foreach ($catalog as $template) {
            $settings = ['template' => $template] + CvSettingsValidator::defaults();
            $this->assertSame($template, (new CvSettingsValidator())->validate($settings)['template']);
        }
    }

    public function testAcceptsPageBreaksIncludingCustomSections(): void
    {
        $settings = ['pageBreakBefore' => ['education', 'skills', 'projects', 'custom:cus1']] + CvSettingsValidator::defaults();
        $this->assertSame($settings, (new CvSettingsValidator())->validate($settings));
    }

    public function testV1SettingsAreCompletedWithDefaults(): void
    {
        $v1 = ['template' => 'modern', 'accent' => '#aa3300', 'density' => 'compact', 'pageBreakBefore' => ['education'], 'keepEntriesTogether' => false];
        $validated = (new CvSettingsValidator())->validate($v1);
        $this->assertSame($v1 + ['locale' => 'fr', 'fontPair' => 'template', 'showPhoto' => false, 'targetPages' => 0, 'anonymize' => false], $validated);
        $this->assertSame($validated, CvSettingsValidator::normalize($v1));
    }

    public function testNewV2FieldsAreAccepted(): void
    {
        $settings = ['locale' => 'en', 'fontPair' => 'plex', 'showPhoto' => true, 'targetPages' => 2, 'anonymize' => true] + CvSettingsValidator::defaults();
        $this->assertSame($settings, (new CvSettingsValidator())->validate($settings));
    }

    /** @return array<string, array{array<string, mixed>, string, string}> */
    public static function invalid(): array
    {
        $base = CvSettingsValidator::defaults();

        return [
            'template inconnu' => [['template' => 'fancy'] + $base, 'settings.template', 'invalid_enum'],
            'densité inconnue' => [['density' => 'tiny'] + $base, 'settings.density', 'invalid_enum'],
            'couleur courte' => [['accent' => '#fff'] + $base, 'settings.accent', 'invalid_color'],
            'couleur nommée' => [['accent' => 'red'] + $base, 'settings.accent', 'invalid_color'],
            'couleur injectée' => [['accent' => '#000000;background:url(x)'] + $base, 'settings.accent', 'invalid_color'],
            'couleur suivie d\'un saut de ligne' => [['accent' => "#000000\n"] + $base, 'settings.accent', 'invalid_color'],
            'keepEntriesTogether non booléen' => [['keepEntriesTogether' => 'yes'] + $base, 'settings.keepEntriesTogether', 'invalid_type'],
            'saut sur rubrique inconnue' => [['pageBreakBefore' => ['hobbies']] + $base, 'settings.pageBreakBefore.0', 'invalid_enum'],
            'saut sur rubrique libre mal formée' => [['pageBreakBefore' => ['custom:a b']] + $base, 'settings.pageBreakBefore.0', 'invalid_enum'],
            'saut dupliqué' => [['pageBreakBefore' => ['skills', 'skills']] + $base, 'settings.pageBreakBefore.1', 'duplicate_section'],
            'champ inconnu' => [['font' => 'Comic Sans'] + $base, 'settings.font', 'unknown_field'],
            'champ manquant' => [array_diff_key($base, ['template' => 1]), 'settings.template', 'required'],
            'langue inconnue' => [['locale' => 'de'] + $base, 'settings.locale', 'invalid_enum'],
            'paire de polices inconnue' => [['fontPair' => 'comic'] + $base, 'settings.fontPair', 'invalid_enum'],
            'showPhoto non booléen' => [['showPhoto' => 1] + $base, 'settings.showPhoto', 'invalid_type'],
            'targetPages hors liste' => [['targetPages' => 3] + $base, 'settings.targetPages', 'invalid_enum'],
            'targetPages chaîne' => [['targetPages' => '1'] + $base, 'settings.targetPages', 'invalid_type'],
            'anonymize non booléen' => [['anonymize' => 'oui'] + $base, 'settings.anonymize', 'invalid_type'],
        ];
    }

    /** @param array<string, mixed> $settings */
    #[DataProvider('invalid')]
    public function testInvalidSettingsAreRejected(array $settings, string $path, string $code): void
    {
        try {
            (new CvSettingsValidator())->validate($settings);
            $this->fail('ValidationException attendue');
        } catch (ValidationException $e) {
            $this->assertSame($code, $e->fields[$path] ?? null, json_encode($e->fields));
        }
    }
}
