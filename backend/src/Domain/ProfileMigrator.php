<?php

declare(strict_types=1);

namespace Cuvylo\Domain;

/**
 * Migration des documents `ProfileData` vers la version courante (même algorithme côté TypeScript).
 * Appliquée à la lecture de tout document stocké et aux documents v1 reçus en écriture.
 * Défensive : un document qui n'est pas un objet v1 est rendu tel quel (le validateur le refusera).
 */
final class ProfileMigrator
{
    public const CURRENT_VERSION = 2;

    /** Rubriques ajoutées par la v2, dans l'ordre où elles sont ajoutées à `sections`. */
    public const V2_SECTIONS = ['projects', 'awards', 'publications', 'interests'];

    public static function migrate(mixed $doc): mixed
    {
        if (!is_array($doc) || ($doc !== [] && array_is_list($doc))) {
            return $doc;
        }
        if (($doc['schemaVersion'] ?? null) === 1) {
            $doc = self::v1ToV2($doc);
        }

        return $doc;
    }

    /**
     * @param array<string, mixed> $doc
     * @return array<string, mixed>
     */
    public static function v1ToV2(array $doc): array
    {
        $doc['schemaVersion'] = 2;

        if (is_array($doc['identity'] ?? null) && !array_is_list($doc['identity'])) {
            $doc['identity']['details'] ??= '';
            $doc['identity']['photo'] ??= '';
        }

        if (is_array($doc['experiences'] ?? null)) {
            foreach ($doc['experiences'] as $i => $experience) {
                if (is_array($experience) && !array_is_list($experience)) {
                    $experience['parallel'] ??= false;
                    $experience['skills'] ??= [];
                    $experience['missions'] ??= [];
                    $doc['experiences'][$i] = $experience;
                }
            }
        }

        foreach (['projects', 'awards', 'publications', 'interests', 'customSections'] as $key) {
            $doc[$key] ??= [];
        }

        if (is_array($doc['sections'] ?? null) && array_is_list($doc['sections'])) {
            $present = [];
            foreach ($doc['sections'] as $section) {
                if (is_array($section) && is_string($section['key'] ?? null)) {
                    $present[$section['key']] = true;
                }
            }
            foreach (self::V2_SECTIONS as $key) {
                if (!isset($present[$key])) {
                    $doc['sections'][] = ['key' => $key, 'visible' => true];
                }
            }
        }

        return $doc;
    }
}
