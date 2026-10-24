<?php

declare(strict_types=1);

namespace Cuvylo\Domain;

use Cuvylo\Validation\ProfileValidator;

final class EmptyProfile
{
    /** @return array<string, mixed> Profil v2 vide (toutes les rubriques fixes, visibles, dans l'ordre par défaut). */
    public static function create(string $email = ''): array
    {
        return [
            'schemaVersion' => ProfileMigrator::CURRENT_VERSION,
            'identity' => [
                'firstName' => '',
                'lastName' => '',
                'headline' => '',
                'email' => $email,
                'phone' => '',
                'location' => '',
                'details' => '',
                'photo' => '',
            ],
            'links' => [],
            'summary' => '',
            'experiences' => [],
            'skills' => [],
            'education' => [],
            'certifications' => [],
            'languages' => [],
            'projects' => [],
            'awards' => [],
            'publications' => [],
            'interests' => [],
            'customSections' => [],
            'sections' => array_map(
                static fn (string $key): array => ['key' => $key, 'visible' => true],
                ProfileValidator::SECTION_KEYS,
            ),
        ];
    }
}
