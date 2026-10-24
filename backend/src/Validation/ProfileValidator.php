<?php

declare(strict_types=1);

namespace Cuvylo\Validation;

use Cuvylo\Domain\ProfileMigrator;
use Cuvylo\Http\HttpException;
use Cuvylo\Support\Json;

/**
 * Validation stricte de `ProfileData` v2. Un document v1 est d'abord migré ;
 * le document renvoyé est donc toujours en v2. Aucune autre transformation : valide ou rejette.
 */
final class ProfileValidator
{
    /** Rubriques fixes, chacune exactement une fois dans `sections` (ordre par défaut). */
    public const SECTION_KEYS = [
        'summary', 'experiences', 'skills', 'education', 'certifications', 'languages',
        'projects', 'awards', 'publications', 'interests',
    ];
    public const CUSTOM_SECTION_KEY = 'custom';
    public const PUBLICATION_KINDS = ['article', 'talk', 'interview', 'book', 'other'];

    public const MAX_BYTES = 450 * 1024;
    public const MAX_ITEMS = 50;
    public const MAX_ACHIEVEMENTS = 30;
    public const MAX_MISSIONS = 30;
    public const MAX_SKILL_ITEMS = 40;
    public const MAX_SKILL_ITEM_LENGTH = 80;
    public const MAX_CUSTOM_SECTIONS = 10;
    public const MAX_CUSTOM_ENTRIES = 30;
    public const MAX_CUSTOM_TITLE = 80;
    public const MAX_PHOTO_LENGTH = 200000;

    private const ROOT_KEYS = [
        'schemaVersion', 'identity', 'links', 'summary', 'experiences', 'skills', 'education',
        'certifications', 'languages', 'projects', 'awards', 'publications', 'interests', 'customSections', 'sections',
    ];
    private const IDENTITY_KEYS = ['firstName', 'lastName', 'headline', 'email', 'phone', 'location', 'details', 'photo'];

    /**
     * @return array<string, mixed> Le document validé, en v2.
     * @throws ValidationException 422
     * @throws HttpException 413 si le document dépasse 450 Ko
     */
    public function validate(mixed $data, string $path = ''): array
    {
        $data = ProfileMigrator::migrate($data);
        if (is_array($data) && strlen(Json::encode($data)) > self::MAX_BYTES) {
            throw new HttpException(413, 'payload_too_large', 'Le profil dépasse la taille maximale autorisée (450 Ko).');
        }

        $f = new Fields();
        $this->check($f, $data, $path);
        $f->assertOk();

        /** @var array<string, mixed> $data */
        return $data;
    }

    private function check(Fields $f, mixed $data, string $root): void
    {
        $p = static fn (string $key): string => Fields::path($root, $key);

        $doc = $f->assoc($data, $root, self::ROOT_KEYS);
        if ($doc === null) {
            return;
        }

        if (array_key_exists('schemaVersion', $doc) && $doc['schemaVersion'] !== ProfileMigrator::CURRENT_VERSION) {
            $f->error($p('schemaVersion'), 'unsupported_version');
        }

        if (array_key_exists('identity', $doc)) {
            $identity = $f->assoc($doc['identity'], $p('identity'), self::IDENTITY_KEYS);
            foreach ($identity ?? [] as $key => $value) {
                $at = Fields::path($p('identity'), $key);
                if ($key === 'photo') {
                    $this->photo($f, $value, $at);
                } elseif (in_array($key, self::IDENTITY_KEYS, true)) {
                    $f->string($value, $at);
                }
            }
        }

        if (array_key_exists('summary', $doc)) {
            $f->string($doc['summary'], $p('summary'), Fields::MAX_LONG, true);
        }

        $this->items($f, $doc, 'links', $root, self::MAX_ITEMS, function (array $link, string $at) use ($f): void {
            $f->string($link['label'], Fields::path($at, 'label'));
            $f->url($link['url'], Fields::path($at, 'url'));
        }, ['id', 'label', 'url']);

        $this->items($f, $doc, 'experiences', $root, self::MAX_ITEMS, function (array $e, string $at) use ($f): void {
            $f->string($e['title'], Fields::path($at, 'title'));
            $f->string($e['company'], Fields::path($at, 'company'));
            $f->string($e['location'], Fields::path($at, 'location'));
            $f->string($e['description'], Fields::path($at, 'description'), Fields::MAX_LONG, true);
            $current = $f->bool($e['current'], Fields::path($at, 'current'));
            $f->bool($e['parallel'], Fields::path($at, 'parallel'));
            $end = $this->period($f, $e, $at, true);
            if ($current === true && $end !== null && $end !== '') {
                $f->error(Fields::path($at, 'endDate'), 'end_date_must_be_empty');
            }
            $this->achievements($f, $e, $at);
            $this->skillList($f, $e['skills'], Fields::path($at, 'skills'));

            $this->nested($f, $e, 'missions', $at, self::MAX_MISSIONS, function (array $m, string $mp) use ($f): void {
                $f->string($m['client'], Fields::path($mp, 'client'));
                $f->string($m['role'], Fields::path($mp, 'role'));
                $f->string($m['location'], Fields::path($mp, 'location'));
                $f->string($m['description'], Fields::path($mp, 'description'), Fields::MAX_LONG, true);
                $this->period($f, $m, $mp, true);
                $this->achievements($f, $m, $mp);
                $this->skillList($f, $m['skills'], Fields::path($mp, 'skills'));
            }, ['id', 'client', 'role', 'location', 'startDate', 'endDate', 'description', 'achievements', 'skills']);
        }, ['id', 'title', 'company', 'location', 'startDate', 'endDate', 'current', 'description', 'achievements', 'parallel', 'skills', 'missions']);

        $this->items($f, $doc, 'skills', $root, self::MAX_ITEMS, function (array $s, string $at) use ($f): void {
            $f->string($s['category'], Fields::path($at, 'category'));
            $f->enum($s['kind'], Fields::path($at, 'kind'), ['technical', 'soft']);
            $this->skillList($f, $s['items'], Fields::path($at, 'items'));
        }, ['id', 'category', 'kind', 'items']);

        $this->items($f, $doc, 'education', $root, self::MAX_ITEMS, function (array $e, string $at) use ($f): void {
            $f->string($e['degree'], Fields::path($at, 'degree'));
            $f->string($e['school'], Fields::path($at, 'school'));
            $f->string($e['location'], Fields::path($at, 'location'));
            $f->string($e['description'], Fields::path($at, 'description'), Fields::MAX_LONG, true);
            $this->period($f, $e, $at, true);
        }, ['id', 'degree', 'school', 'location', 'startDate', 'endDate', 'description']);

        $this->items($f, $doc, 'certifications', $root, self::MAX_ITEMS, function (array $c, string $at) use ($f): void {
            $f->string($c['name'], Fields::path($at, 'name'));
            $f->string($c['issuer'], Fields::path($at, 'issuer'));
            $f->partialDate($c['date'], Fields::path($at, 'date'));
            $f->url($c['url'], Fields::path($at, 'url'));
        }, ['id', 'name', 'issuer', 'date', 'url']);

        $this->items($f, $doc, 'languages', $root, self::MAX_ITEMS, function (array $l, string $at) use ($f): void {
            $f->string($l['name'], Fields::path($at, 'name'));
            $f->string($l['level'], Fields::path($at, 'level'));
        }, ['id', 'name', 'level']);

        $this->items($f, $doc, 'projects', $root, self::MAX_ITEMS, function (array $pr, string $at) use ($f): void {
            $f->string($pr['name'], Fields::path($at, 'name'));
            $f->string($pr['role'], Fields::path($at, 'role'));
            $f->url($pr['url'], Fields::path($at, 'url'));
            $f->string($pr['description'], Fields::path($at, 'description'), Fields::MAX_LONG, true);
            $this->period($f, $pr, $at, true);
            $this->skillList($f, $pr['skills'], Fields::path($at, 'skills'));
        }, ['id', 'name', 'role', 'startDate', 'endDate', 'url', 'description', 'skills']);

        $this->items($f, $doc, 'awards', $root, self::MAX_ITEMS, function (array $a, string $at) use ($f): void {
            $f->string($a['title'], Fields::path($at, 'title'));
            $f->string($a['issuer'], Fields::path($at, 'issuer'));
            $f->partialDate($a['date'], Fields::path($at, 'date'));
            $f->string($a['description'], Fields::path($at, 'description'), Fields::MAX_LONG, true);
        }, ['id', 'title', 'issuer', 'date', 'description']);

        $this->items($f, $doc, 'publications', $root, self::MAX_ITEMS, function (array $pu, string $at) use ($f): void {
            $f->string($pu['title'], Fields::path($at, 'title'));
            $f->string($pu['outlet'], Fields::path($at, 'outlet'));
            $f->partialDate($pu['date'], Fields::path($at, 'date'));
            $f->url($pu['url'], Fields::path($at, 'url'));
            $f->enum($pu['kind'], Fields::path($at, 'kind'), self::PUBLICATION_KINDS);
            $f->string($pu['description'], Fields::path($at, 'description'), Fields::MAX_LONG, true);
        }, ['id', 'title', 'outlet', 'date', 'url', 'kind', 'description']);

        $this->items($f, $doc, 'interests', $root, self::MAX_ITEMS, function (array $i, string $at) use ($f): void {
            $f->string($i['text'], Fields::path($at, 'text'));
        }, ['id', 'text']);

        $customIds = [];
        $this->items($f, $doc, 'customSections', $root, self::MAX_CUSTOM_SECTIONS, function (array $c, string $at) use ($f, &$customIds): void {
            if (is_string($c['id'])) {
                $customIds[] = $c['id'];
            }
            $f->string($c['title'], Fields::path($at, 'title'), self::MAX_CUSTOM_TITLE);
            $this->nested($f, $c, 'entries', $at, self::MAX_CUSTOM_ENTRIES, function (array $e, string $ep) use ($f): void {
                $f->string($e['title'], Fields::path($ep, 'title'));
                $f->string($e['subtitle'], Fields::path($ep, 'subtitle'));
                $f->partialDate($e['date'], Fields::path($ep, 'date'));
                $f->string($e['description'], Fields::path($ep, 'description'), Fields::MAX_LONG, true);
            }, ['id', 'title', 'subtitle', 'date', 'description']);
        }, ['id', 'title', 'entries']);

        if (array_key_exists('sections', $doc)) {
            $this->sections($f, $doc['sections'], $p('sections'), $customIds);
        }
    }

    private function photo(Fields $f, mixed $value, string $path): void
    {
        if (!is_string($value)) {
            $f->error($path, 'invalid_type');

            return;
        }
        if ($value === '') {
            return;
        }
        if (strlen($value) > self::MAX_PHOTO_LENGTH) {
            $f->error($path, 'too_long');

            return;
        }
        if (preg_match('#^data:image/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$#', $value) !== 1) {
            $f->error($path, 'invalid_image');
        }
    }

    /**
     * Dates `startDate` / `endDate` d'une entrée (année seule ou mois) et leur ordre.
     *
     * @param array<string, mixed> $entry
     * @return string|null La date de fin validée ("" si vide), null si absente ou invalide.
     */
    private function period(Fields $f, array $entry, string $at, bool $endNullable): ?string
    {
        $start = $f->partialDate($entry['startDate'], Fields::path($at, 'startDate'));
        $endPath = Fields::path($at, 'endDate');
        $end = null;
        if ($entry['endDate'] === null && $endNullable) {
            $end = null;
        } else {
            $end = $f->partialDate($entry['endDate'], $endPath);
        }
        if ($start !== null && $end !== null && $start !== '' && $end !== ''
            && self::comparable($end, false) < self::comparable($start, true)) {
            $f->error($endPath, 'end_before_start');
        }

        return $end;
    }

    /** Une année seule vaut janvier en début de période et décembre en fin. */
    private static function comparable(string $date, bool $isStart): string
    {
        return strlen($date) === 4 ? $date . ($isStart ? '-01' : '-12') : $date;
    }

    /** @param array<string, mixed> $parent */
    private function achievements(Fields $f, array $parent, string $at): void
    {
        $this->nested($f, $parent, 'achievements', $at, self::MAX_ACHIEVEMENTS, function (array $a, string $ap) use ($f): void {
            $f->string($a['text'], Fields::path($ap, 'text'), Fields::MAX_LONG, true);
        }, ['id', 'text']);
    }

    private function skillList(Fields $f, mixed $value, string $path): void
    {
        $items = $f->listOf($value, $path, self::MAX_SKILL_ITEMS);
        foreach ($items ?? [] as $i => $item) {
            $f->string($item, Fields::path($path, $i), self::MAX_SKILL_ITEM_LENGTH);
        }
    }

    /**
     * Valide un tableau d'objets à `id` unique, puis applique `$each` aux éléments structurellement corrects.
     *
     * @param array<string, mixed> $doc
     * @param list<string> $keys
     */
    private function items(Fields $f, array $doc, string $name, string $root, int $max, callable $each, array $keys): void
    {
        if (!array_key_exists($name, $doc)) {
            return;
        }
        $this->collection($f, $doc[$name], Fields::path($root, $name), $max, $each, $keys);
    }

    /**
     * @param array<string, mixed> $parent
     * @param list<string> $keys
     */
    private function nested(Fields $f, array $parent, string $name, string $parentPath, int $max, callable $each, array $keys): void
    {
        if (!array_key_exists($name, $parent)) {
            return;
        }
        $this->collection($f, $parent[$name], Fields::path($parentPath, $name), $max, $each, $keys);
    }

    /** @param list<string> $keys */
    private function collection(Fields $f, mixed $value, string $path, int $max, callable $each, array $keys): void
    {
        $list = $f->listOf($value, $path, $max);
        $seen = [];
        foreach ($list ?? [] as $i => $item) {
            $at = Fields::path($path, $i);
            $obj = $f->assoc($item, $at, $keys);
            if ($obj === null) {
                continue;
            }
            $id = array_key_exists('id', $obj) ? $f->id($obj['id'], Fields::path($at, 'id')) : null;
            if ($id !== null) {
                if (isset($seen[$id])) {
                    $f->error(Fields::path($at, 'id'), 'duplicate_id');
                }
                $seen[$id] = true;
            }
            // Un élément auquel il manque des clés a déjà été signalé : on ne l'inspecte pas plus loin.
            if (array_diff($keys, array_keys($obj)) === []) {
                $each($obj, $at);
            }
        }
    }

    /**
     * Clés fixes exactement une fois chacune, plus une entrée `custom` par rubrique libre (exactement une fois,
     * pointant vers un `customSections[].id` existant).
     *
     * @param list<string> $customIds
     */
    private function sections(Fields $f, mixed $value, string $path, array $customIds): void
    {
        $list = $f->listOf($value, $path, count(self::SECTION_KEYS) + self::MAX_CUSTOM_SECTIONS);
        if ($list === null) {
            return;
        }
        $seen = [];
        $seenCustom = [];
        $allowed = [...self::SECTION_KEYS, self::CUSTOM_SECTION_KEY];
        foreach ($list as $i => $item) {
            $at = Fields::path($path, $i);
            $obj = $f->assoc($item, $at, ['key', 'visible'], ['customId']);
            if ($obj === null) {
                continue;
            }
            if (array_key_exists('visible', $obj)) {
                $f->bool($obj['visible'], Fields::path($at, 'visible'));
            }
            if (!array_key_exists('key', $obj)) {
                continue;
            }
            $key = $f->enum($obj['key'], Fields::path($at, 'key'), $allowed);
            if ($key === self::CUSTOM_SECTION_KEY) {
                $customPath = Fields::path($at, 'customId');
                if (!array_key_exists('customId', $obj)) {
                    $f->error($customPath, 'required');
                } elseif (($customId = $f->id($obj['customId'], $customPath)) !== null) {
                    if (!in_array($customId, $customIds, true)) {
                        $f->error($customPath, 'invalid_reference');
                    } elseif (isset($seenCustom[$customId])) {
                        $f->error($customPath, 'duplicate_section');
                    }
                    $seenCustom[$customId] = true;
                }
            } elseif ($key !== null) {
                if (array_key_exists('customId', $obj)) {
                    $f->error(Fields::path($at, 'customId'), 'unknown_field');
                }
                if (isset($seen[$key])) {
                    $f->error(Fields::path($at, 'key'), 'duplicate_section');
                }
                $seen[$key] = true;
            }
        }
        $missingCustom = array_diff(array_unique($customIds), array_keys($seenCustom));
        if (count($seen) !== count(self::SECTION_KEYS) || $missingCustom !== []) {
            $f->error($path, 'section_missing');
        }
    }
}
