<?php

declare(strict_types=1);

namespace Cuvylo\Domain;

/**
 * Ce que reçoit le destinataire d'un lien de partage : uniquement ce que le PDF affiche, comme le plan de
 * mise en page du navigateur (`frontend/src/pdf/layout.ts`) :
 * - rubriques masquées vidées (leur contenu n'est pas transmis) ;
 * - entrées non affichées retirées (expérience sans intitulé ni entreprise, etc.) ;
 * - photo seulement si elle est affichée (`showPhoto`, jamais en mode anonyme) ;
 * - en mode anonyme, anonymisation complète (Anonymizer) et titre neutre.
 * Appliqué à la création ET à chaque lecture publique (partages créés avant cette règle compris).
 */
final class PublicSnapshot
{
    /** Listes de rubriques fixes et condition pour qu'une entrée soit affichée. */
    private const SHOWN = [
        'experiences' => ['title', 'company'],
        'education' => ['degree', 'school'],
        'certifications' => ['name'],
        'projects' => ['name'],
        'awards' => ['title'],
        'publications' => ['title'],
    ];

    /**
     * @param array<string, mixed> $data profil d'un CV (v1 ou v2)
     * @param array<string, mixed> $settings réglages du CV
     * @return array<string, mixed>
     */
    public static function build(array $data, array $settings): array
    {
        $migrated = ProfileMigrator::migrate($data);
        $data = is_array($migrated) ? $migrated : $data;

        foreach (is_array($data['sections'] ?? null) ? $data['sections'] : [] as $ref) {
            if (!is_array($ref) || ($ref['visible'] ?? true) !== false) {
                continue;
            }
            $key = $ref['key'] ?? null;
            if ($key === 'custom') {
                $data['customSections'] = array_map(
                    static fn (mixed $c): mixed => is_array($c) && ($c['id'] ?? null) === ($ref['customId'] ?? null) ? array_replace($c, ['title' => '', 'entries' => []]) : $c,
                    is_array($data['customSections'] ?? null) ? $data['customSections'] : [],
                );
            } elseif ($key === 'summary') {
                $data['summary'] = '';
            } elseif (is_string($key) && array_key_exists($key, $data)) {
                $data[$key] = [];
            }
        }

        foreach (self::SHOWN as $list => $fields) {
            $data[$list] = self::shown($data[$list] ?? [], $fields);
        }
        $data['skills'] = array_values(array_filter(
            is_array($data['skills'] ?? null) ? $data['skills'] : [],
            static fn (mixed $s): bool => is_array($s) && is_array($s['items'] ?? null) && $s['items'] !== [],
        ));
        $data['customSections'] = array_map(
            static fn (mixed $c): mixed => is_array($c) ? array_replace($c, ['entries' => self::shown($c['entries'] ?? [], ['title', 'description'])]) : $c,
            is_array($data['customSections'] ?? null) ? $data['customSections'] : [],
        );

        $anonymize = ($settings['anonymize'] ?? false) === true;
        if (is_array($data['identity'] ?? null) && (($settings['showPhoto'] ?? false) !== true || $anonymize)) {
            $data['identity']['photo'] = '';
        }

        return $anonymize ? Anonymizer::apply($data) : $data;
    }

    /** Titre montré au destinataire : le nom interne du CV (« CV Alice Martin ») ne sort pas en mode anonyme. */
    public static function title(string $title, array $settings): string
    {
        if (($settings['anonymize'] ?? false) !== true) {
            return $title;
        }

        return ($settings['locale'] ?? 'fr') === 'en' ? 'Skills profile' : 'Dossier de compétences';
    }

    /**
     * @param list<string> $fields au moins un de ces champs doit être renseigné
     * @return list<array<string, mixed>>
     */
    private static function shown(mixed $items, array $fields): array
    {
        return array_values(array_filter(is_array($items) ? $items : [], static function (mixed $item) use ($fields): bool {
            if (!is_array($item)) {
                return false;
            }
            foreach ($fields as $field) {
                if (is_string($item[$field] ?? null) && trim($item[$field]) !== '') {
                    return true;
                }
            }

            return false;
        }));
    }
}
