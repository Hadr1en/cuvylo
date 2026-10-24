<?php

declare(strict_types=1);

namespace Cuvylo\Validation;

use Cuvylo\Support\Ulid;

/**
 * Lettre de motivation :
 * `{ title, cvId, settings: { template, accent, locale }, data: { recipient: { name, company, address }, subject,
 *    opening, paragraphs: string[≤10], closing, signature, place, date }, revision }`.
 * `date` est un texte libre court (« 24 octobre 2026 » ou `2026-10-24`) : la mise en forme appartient au client.
 */
final class LetterValidator
{
    public const MAX_PARAGRAPHS = 10;
    public const MAX_ADDRESS = 500;
    public const MAX_CLOSING = 1000;
    public const MAX_DATE = 40;

    private const DATA_KEYS = ['recipient', 'subject', 'opening', 'paragraphs', 'closing', 'signature', 'place', 'date'];
    private const SETTINGS_KEYS = ['template', 'accent', 'locale'];

    /** @return array{template: string, accent: string, locale: string} */
    public static function defaultSettings(): array
    {
        return ['template' => 'classic', 'accent' => '#1f3a5f', 'locale' => 'fr'];
    }

    /** @return array<string, mixed> */
    public static function emptyData(): array
    {
        return [
            'recipient' => ['name' => '', 'company' => '', 'address' => ''],
            'subject' => '',
            'opening' => '',
            'paragraphs' => [],
            'closing' => '',
            'signature' => '',
            'place' => '',
            'date' => '',
        ];
    }

    /**
     * Création : `title` obligatoire, le reste par défaut. Remplacement (PUT) : `title`, `cvId`, `settings`, `data` obligatoires.
     *
     * @return array{title: string, cvId: ?string, settings: array<string, mixed>, data: array<string, mixed>}
     * @throws ValidationException
     */
    public function validate(mixed $body, bool $replace): array
    {
        $f = new Fields();
        $required = $replace ? ['title', 'cvId', 'settings', 'data'] : ['title'];
        $optional = array_values(array_diff(['title', 'cvId', 'settings', 'data', 'revision'], $required));
        $obj = $f->assoc($body, '', $required, $optional);
        if ($obj === null) {
            $f->assertOk();
        }
        $obj ??= [];

        $title = $obj['title'] ?? null;
        $title = $f->string(is_string($title) ? trim($title) : $title, 'title', 120, false, 1);

        $cvId = $obj['cvId'] ?? null;
        if ($cvId !== null && (!is_string($cvId) || !Ulid::isValid($cvId))) {
            $f->error('cvId', is_string($cvId) ? 'invalid_id' : 'invalid_type');
        }

        $settings = $obj['settings'] ?? self::defaultSettings();
        $s = $f->assoc($settings, 'settings', self::SETTINGS_KEYS);
        if ($s !== null) {
            if (array_key_exists('template', $s)) {
                $f->enum($s['template'], 'settings.template', CvSettingsValidator::TEMPLATES);
            }
            if (array_key_exists('accent', $s)) {
                CvSettingsValidator::color($f, $s['accent'], 'settings.accent');
            }
            if (array_key_exists('locale', $s)) {
                $f->enum($s['locale'], 'settings.locale', CvSettingsValidator::LOCALES);
            }
        }

        $data = $obj['data'] ?? self::emptyData();
        $d = $f->assoc($data, 'data', self::DATA_KEYS);
        if ($d !== null) {
            if (array_key_exists('recipient', $d)) {
                $r = $f->assoc($d['recipient'], 'data.recipient', ['name', 'company', 'address']);
                if ($r !== null) {
                    if (array_key_exists('name', $r)) {
                        $f->string($r['name'], 'data.recipient.name');
                    }
                    if (array_key_exists('company', $r)) {
                        $f->string($r['company'], 'data.recipient.company');
                    }
                    if (array_key_exists('address', $r)) {
                        $f->string($r['address'], 'data.recipient.address', self::MAX_ADDRESS, true);
                    }
                }
            }
            foreach (['subject', 'opening', 'signature', 'place'] as $key) {
                if (array_key_exists($key, $d)) {
                    $f->string($d[$key], 'data.' . $key);
                }
            }
            if (array_key_exists('closing', $d)) {
                $f->string($d['closing'], 'data.closing', self::MAX_CLOSING, true);
            }
            if (array_key_exists('date', $d)) {
                $f->string($d['date'], 'data.date', self::MAX_DATE);
            }
            if (array_key_exists('paragraphs', $d)) {
                $list = $f->listOf($d['paragraphs'], 'data.paragraphs', self::MAX_PARAGRAPHS);
                foreach ($list ?? [] as $i => $paragraph) {
                    $f->string($paragraph, 'data.paragraphs.' . $i, Fields::MAX_LONG, true);
                }
            }
        }
        $f->assertOk();

        /** @var array<string, mixed> $settings */
        /** @var array<string, mixed> $data */
        return ['title' => (string) $title, 'cvId' => $cvId, 'settings' => $settings, 'data' => $data];
    }
}
