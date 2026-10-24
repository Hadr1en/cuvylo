<?php

declare(strict_types=1);

namespace Cuvylo\Validation;

/**
 * Validation de `CvSettings` v2. Les cinq champs v1 restent obligatoires ; les champs ajoutés
 * en v2 sont facultatifs et complétés par leur valeur par défaut (documents v1, anciens clients).
 */
final class CvSettingsValidator
{
    /** Doit rester aligné avec TEMPLATES de frontend/src/domain/cv.ts. */
    public const TEMPLATES = [
        'classic', 'modern', 'compact', 'editorial', 'margin', 'dossier', 'banner', 'timeline',
        'consultant', 'executive', 'media', 'tech', 'academic', 'european', 'swiss', 'ink', 'sidebar', 'skills-dossier',
    ];
    public const DENSITIES = ['comfortable', 'compact'];
    public const LOCALES = ['fr', 'en'];
    public const FONT_PAIRS = ['template', 'inter', 'plex', 'source', 'serif'];
    public const TARGET_PAGES = [0, 1, 2];

    private const REQUIRED = ['template', 'accent', 'density', 'pageBreakBefore', 'keepEntriesTogether'];

    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            'template' => 'classic',
            'accent' => '#1f3a5f',
            'density' => 'comfortable',
            'pageBreakBefore' => [],
            'keepEntriesTogether' => true,
            'locale' => 'fr',
            'fontPair' => 'template',
            'showPhoto' => false,
            'targetPages' => 0,
            'anonymize' => false,
        ];
    }

    /**
     * Réglages complétés par les valeurs par défaut des champs absents (ordre des clés reçues conservé).
     * Sans effet sur une valeur qui n'est pas un objet.
     */
    public static function normalize(mixed $settings): mixed
    {
        if (!is_array($settings) || ($settings !== [] && array_is_list($settings))) {
            return $settings;
        }
        foreach (self::defaults() as $key => $value) {
            if (!array_key_exists($key, $settings)) {
                $settings[$key] = $value;
            }
        }

        return $settings;
    }

    /**
     * @return array<string, mixed> Réglages validés et complétés.
     * @throws ValidationException
     */
    public function validate(mixed $settings, string $path = 'settings'): array
    {
        $f = new Fields();
        $this->check($f, $settings, $path);
        $f->assertOk();

        /** @var array<string, mixed> */
        return self::normalize($settings);
    }

    public function check(Fields $f, mixed $settings, string $path): void
    {
        $optional = array_values(array_diff(array_keys(self::defaults()), self::REQUIRED));
        $obj = $f->assoc($settings, $path, self::REQUIRED, $optional);
        if ($obj === null) {
            return;
        }
        $at = static fn (string $key): string => Fields::path($path, $key);

        if (array_key_exists('template', $obj)) {
            $f->enum($obj['template'], $at('template'), self::TEMPLATES);
        }
        if (array_key_exists('density', $obj)) {
            $f->enum($obj['density'], $at('density'), self::DENSITIES);
        }
        if (array_key_exists('accent', $obj)) {
            self::color($f, $obj['accent'], $at('accent'));
        }
        foreach (['keepEntriesTogether', 'showPhoto', 'anonymize'] as $flag) {
            if (array_key_exists($flag, $obj)) {
                $f->bool($obj[$flag], $at($flag));
            }
        }
        if (array_key_exists('locale', $obj)) {
            $f->enum($obj['locale'], $at('locale'), self::LOCALES);
        }
        if (array_key_exists('fontPair', $obj)) {
            $f->enum($obj['fontPair'], $at('fontPair'), self::FONT_PAIRS);
        }
        if (array_key_exists('targetPages', $obj)) {
            if (!is_int($obj['targetPages'])) {
                $f->error($at('targetPages'), 'invalid_type');
            } elseif (!in_array($obj['targetPages'], self::TARGET_PAGES, true)) {
                $f->error($at('targetPages'), 'invalid_enum');
            }
        }
        if (array_key_exists('pageBreakBefore', $obj)) {
            $listPath = $at('pageBreakBefore');
            $list = $f->listOf($obj['pageBreakBefore'], $listPath, count(ProfileValidator::SECTION_KEYS) + ProfileValidator::MAX_CUSTOM_SECTIONS);
            $seen = [];
            foreach ($list ?? [] as $i => $key) {
                $itemPath = Fields::path($listPath, $i);
                if (!is_string($key)) {
                    $f->error($itemPath, 'invalid_type');
                    continue;
                }
                $valid = in_array($key, ProfileValidator::SECTION_KEYS, true)
                    || preg_match('/^custom:[A-Za-z0-9_-]{1,36}$/D', $key) === 1;
                if (!$valid) {
                    $f->error($itemPath, 'invalid_enum');
                    continue;
                }
                if (isset($seen[$key])) {
                    $f->error($itemPath, 'duplicate_section');
                }
                $seen[$key] = true;
            }
        }
    }

    public static function color(Fields $f, mixed $value, string $path): void
    {
        if (!is_string($value)) {
            $f->error($path, 'invalid_type');
        } elseif (preg_match('/^#[0-9a-fA-F]{6}$/D', $value) !== 1) {
            $f->error($path, 'invalid_color');
        }
    }
}
