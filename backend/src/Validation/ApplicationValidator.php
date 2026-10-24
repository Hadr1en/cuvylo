<?php

declare(strict_types=1);

namespace Cuvylo\Validation;

use Cuvylo\Support\Ulid;

/**
 * Candidature : `{ company, position, url, posting, cvId, status, appliedAt, nextActionAt, notes }`.
 * Dates au format `AAAA-MM-JJ` ou null (une chaîne vide vaut null).
 */
final class ApplicationValidator
{
    public const STATUSES = ['draft', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'];
    public const MAX_POSTING = 20000;
    public const FIELDS = ['company', 'position', 'url', 'posting', 'cvId', 'status', 'appliedAt', 'nextActionAt', 'notes'];

    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            'company' => '',
            'position' => '',
            'url' => '',
            'posting' => '',
            'cvId' => null,
            'status' => 'draft',
            'appliedAt' => null,
            'nextActionAt' => null,
            'notes' => '',
        ];
    }

    /**
     * Valide un corps d'écriture. Création : `company` et `position` obligatoires, le reste par défaut.
     * Remplacement (PUT) : tous les champs obligatoires. `revision` facultative dans les deux cas.
     *
     * @return array<string, mixed> Candidature normalisée (sans `revision`).
     * @throws ValidationException
     */
    public function validate(mixed $body, bool $replace): array
    {
        $f = new Fields();
        $required = $replace ? self::FIELDS : ['company', 'position'];
        $optional = array_values(array_diff([...self::FIELDS, 'revision'], $required));
        $obj = $f->assoc($body, '', $required, $optional);
        if ($obj === null) {
            $f->assertOk();
        }
        $obj ??= [];
        $value = [];
        foreach (self::defaults() as $key => $default) {
            $value[$key] = array_key_exists($key, $obj) ? $obj[$key] : $default;
        }

        $f->string(is_string($value['company']) ? trim($value['company']) : $value['company'], 'company');
        $f->string(is_string($value['position']) ? trim($value['position']) : $value['position'], 'position');
        $f->url($value['url'], 'url');
        $f->string($value['posting'], 'posting', self::MAX_POSTING, true);
        $f->string($value['notes'], 'notes', Fields::MAX_LONG, true);
        $f->enum($value['status'], 'status', self::STATUSES);
        foreach (['appliedAt', 'nextActionAt'] as $key) {
            if ($value[$key] === '') {
                $value[$key] = null;
            }
            $f->day($value[$key], $key);
        }
        if ($value['cvId'] !== null && (!is_string($value['cvId']) || !Ulid::isValid($value['cvId']))) {
            $f->error('cvId', is_string($value['cvId']) ? 'invalid_id' : 'invalid_type');
        }
        $f->assertOk();

        $value['company'] = trim($value['company']);
        $value['position'] = trim($value['position']);

        return $value;
    }
}
