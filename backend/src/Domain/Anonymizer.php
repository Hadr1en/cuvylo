<?php

declare(strict_types=1);

namespace Cuvylo\Domain;

/**
 * Anonymisation d'un profil v2 (réglage `anonymize`), même politique que le navigateur
 * (`frontend/src/domain/anonymize.ts`), appliquée côté serveur pour que le lien public ne transporte
 * jamais ces données, quel que soit le rendu du client :
 * - nom et prénom réduits aux initiales (« Jean-Pierre » → « J.-P. ») ;
 * - e-mail, téléphone, photo, mentions personnelles (`details`) et tous les liens supprimés
 *   (liens de profil, mais aussi adresses de projets, publications et certifications) ;
 * - localisation ramenée à la ville (rue, numéro et code postal retirés) ;
 * - nom, prénom, e-mail et téléphone retirés aussi des textes libres où ils seraient recopiés.
 * Le parcours (postes, entreprises, clients, dates) est conservé : c'est l'objet du dossier.
 */
final class Anonymizer
{
    private const PARTICLES = ['de', 'du', 'des', 'la', 'le', 'van', 'von', 'der', 'den', 'da', 'di', 'del', 'dos', 'das', 'y', 'e', 'af', 'zu', 'ten', 'ter'];
    private const STREET = '/\b(rue|avenue|av\.|bd|boulevard|chemin|all[ée]e|place|impasse|quai|route|cours|square|r[ée]sidence|lieu-dit|lotissement|b[âa]t(iment)?|appt?|appartement|cedex|bp)\b/iu';

    /**
     * @param array<string, mixed> $data profil v2
     * @return array<string, mixed>
     */
    public static function apply(array $data): array
    {
        $identity = is_array($data['identity'] ?? null) ? $data['identity'] : [];
        $first = self::str($identity['firstName'] ?? '');
        $last = self::str($identity['lastName'] ?? '');
        $email = self::str($identity['email'] ?? '');
        $phone = self::str($identity['phone'] ?? '');
        // Textes rédigés : nom complet, prénom ou nom seuls, e-mail, téléphone.
        $scrub = self::scrubber($first, $last, $email, $phone, true);
        // Intitulés (où un nom seul peut être un mot ordinaire, « Livre Blanc ») : nom complet seulement.
        $scrubFull = self::scrubber($first, $last, $email, $phone, false);

        $data['identity'] = [
            'firstName' => self::initials($first),
            'lastName' => self::initials($last),
            'headline' => $scrub(self::str($identity['headline'] ?? '')),
            'email' => '',
            'phone' => '',
            'location' => self::cityOnly(self::str($identity['location'] ?? '')),
            'details' => '',
            'photo' => '',
        ];
        $data['links'] = [];
        $data['summary'] = $scrub(self::str($data['summary'] ?? ''));

        $data['experiences'] = self::each($data['experiences'] ?? [], static function (array $e) use ($scrub): array {
            $e['description'] = $scrub(self::str($e['description'] ?? ''));
            $e['achievements'] = self::texts($e['achievements'] ?? [], $scrub);
            $e['missions'] = self::each($e['missions'] ?? [], static function (array $m) use ($scrub): array {
                $m['description'] = $scrub(self::str($m['description'] ?? ''));
                $m['achievements'] = self::texts($m['achievements'] ?? [], $scrub);

                return $m;
            });

            return $e;
        });
        // array_replace : champs remplacés sur place, l'ordre des clés est conservé.
        $data['education'] = self::each($data['education'] ?? [], static fn (array $e): array => array_replace($e, ['description' => $scrub(self::str($e['description'] ?? ''))]));
        $data['certifications'] = self::each($data['certifications'] ?? [], static fn (array $c): array => array_replace($c, ['url' => '']));
        foreach (['projects', 'publications'] as $list) {
            $data[$list] = self::each($data[$list] ?? [], static fn (array $p): array => array_replace($p, ['url' => '', 'description' => $scrub(self::str($p['description'] ?? ''))]));
        }
        $data['awards'] = self::each($data['awards'] ?? [], static fn (array $a): array => array_replace($a, ['description' => $scrub(self::str($a['description'] ?? ''))]));
        $data['interests'] = self::texts($data['interests'] ?? [], $scrub);
        $data['customSections'] = self::each($data['customSections'] ?? [], static function (array $c) use ($scrub, $scrubFull): array {
            $c['entries'] = self::each($c['entries'] ?? [], static fn (array $e): array => array_replace($e, [
                'title' => $scrubFull(self::str($e['title'] ?? '')),
                'subtitle' => $scrubFull(self::str($e['subtitle'] ?? '')),
                'description' => $scrub(self::str($e['description'] ?? '')),
            ]));

            return $c;
        });

        return $data;
    }

    /** « Jean-Pierre » → « J.-P. » ; « de La Fontaine » → « L. F. » ; « O’Neil » → « O. ». */
    public static function initials(string $name): string
    {
        $words = preg_split('/\s+/u', trim($name)) ?: [];
        $out = [];
        foreach ($words as $w) {
            // Les particules ne comptent qu'en minuscules : « de La Fontaine » → « L. F. ».
            if ($w === '' || in_array(preg_replace("/['’]$/u", '', $w), self::PARTICLES, true) || preg_match("/^d['’]$/u", $w) === 1) {
                continue;
            }
            $parts = [];
            foreach (explode('-', $w) as $part) {
                $part = (string) preg_replace("/^(?:d|l)['’](?=\\p{L})/iu", '', $part);
                if (preg_match('/\p{L}/u', $part, $m) === 1) {
                    $parts[] = mb_strtoupper($m[0]) . '.';
                }
            }
            if ($parts !== []) {
                $out[] = implode('-', $parts);
            }
        }

        return implode(' ', $out);
    }

    /** « 12 rue des Lilas, 59000 Lille, France » → « Lille, France ». */
    public static function cityOnly(string $location): string
    {
        $kept = [];
        foreach (explode(',', $location) as $segment) {
            $s = trim($segment);
            if ($s === '' || preg_match(self::STREET, $s) === 1) {
                continue;
            }
            $s = (string) preg_replace(['/^\d{4,5}\s+/u', '/\s+\d{4,5}$/u', '/\s*\(\d{2,3}\)\s*$/u'], '', $s);
            $s = trim($s);
            if ($s !== '' && preg_match('/\d/', $s) !== 1) {
                $kept[] = $s;
            }
        }

        return implode(', ', $kept);
    }

    /** @return \Closure(string): string retire nom, prénom, e-mail et téléphone recopiés dans un texte libre */
    private static function scrubber(string $first, string $last, string $email, string $phone, bool $singleNames): \Closure
    {
        $replacements = [];
        if (trim($email) !== '') {
            $replacements[] = ['/' . preg_quote(trim($email), '/') . '/iu', ''];
        }
        $digits = (string) preg_replace('/\D/', '', $phone);
        if (strlen($digits) >= 8) {
            // Même numéro quel que soit le séparateur (« 06 12 34 56 78 », « +33 6 12… », « 06.12… »).
            $tail = substr($digits, -9);
            $replacements[] = ['/(?:\+\d{1,3}[\s.-]?)?(?:\(0\)[\s.-]?)?0?' . implode('[\s.-]?', str_split($tail)) . '/u', ''];
        }
        $full = array_values(array_filter([trim($first), trim($last)], static fn (string $s): bool => $s !== ''));
        if (count($full) === 2) {
            $replacements[] = ['/(?<![\p{L}])' . preg_quote(implode(' ', $full), '/') . '(?![\p{L}])/iu', self::initials($first) . ' ' . self::initials($last)];
        }
        if ($singleNames) {
            foreach ($full as $n) {
                if (mb_strlen($n) >= 3) {
                    $replacements[] = ['/(?<![\p{L}])' . preg_quote($n, '/') . '(?![\p{L}])/u', self::initials($n)];
                }
            }
        }

        return static function (string $text) use ($replacements): string {
            foreach ($replacements as [$pattern, $by]) {
                $text = (string) preg_replace($pattern, $by, $text);
            }

            return (string) preg_replace('/[ \t]{2,}/', ' ', $text);
        };
    }

    /**
     * @param \Closure(array<string, mixed>): array<string, mixed> $fn
     * @return list<array<string, mixed>>
     */
    private static function each(mixed $items, \Closure $fn): array
    {
        return is_array($items) ? array_values(array_map($fn, array_filter($items, 'is_array'))) : [];
    }

    /** Listes de `{ text }` (réalisations, centres d'intérêt). @return list<array<string, mixed>> */
    private static function texts(mixed $items, \Closure $scrub): array
    {
        return self::each($items, static fn (array $a): array => array_replace($a, ['text' => $scrub(self::str($a['text'] ?? ''))]));
    }

    private static function str(mixed $value): string
    {
        return is_string($value) ? $value : '';
    }
}
