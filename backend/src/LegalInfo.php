<?php

declare(strict_types=1);

namespace Cuvylo;

use RuntimeException;

/**
 * Informations légales PUBLIQUES de l'instance (mentions légales, contact RGPD et sécurité).
 * Elles viennent de la configuration : chaque personne qui installe Cuvylo est l'éditeur et le
 * responsable de traitement de SA propre instance, rien n'est codé en dur.
 */
final class LegalInfo
{
    public function __construct(
        /** Nom ou raison sociale de l'éditeur ; null = particulier qui a choisi l'anonymat (LCEN art. 6-III-2). */
        public readonly ?string $publisher,
        /** Adresse de contact (exercice des droits RGPD, signalements). */
        public readonly ?string $contactEmail,
        /** Hébergeur : nom, adresse, téléphone (texte libre, une ligne). */
        public readonly ?string $host,
        /** Contact sécurité (security.txt) ; par défaut, le contact général. */
        public readonly ?string $securityEmail,
    ) {
    }

    /** @param array<string, string> $env */
    public static function fromEnv(array $env): self
    {
        $contact = self::email($env['LEGAL_CONTACT_EMAIL'] ?? null, 'LEGAL_CONTACT_EMAIL');
        $security = self::email($env['SECURITY_CONTACT_EMAIL'] ?? null, 'SECURITY_CONTACT_EMAIL');

        return new self(
            self::text($env['LEGAL_PUBLISHER'] ?? null),
            $contact,
            self::text($env['LEGAL_HOST'] ?? null),
            $security ?? $contact,
        );
    }

    /** @return array<string, string|null> */
    public function toArray(): array
    {
        return [
            'publisher' => $this->publisher,
            'contactEmail' => $this->contactEmail,
            'host' => $this->host,
            'securityEmail' => $this->securityEmail,
        ];
    }

    private static function text(?string $value): ?string
    {
        $value = $value === null ? '' : trim($value);
        if ($value === '') {
            return null;
        }
        if (mb_strlen($value) > 300 || preg_match('/[\x00-\x1F\x7F]/u', $value) === 1) {
            throw new RuntimeException('Valeur légale invalide (300 caractères maximum, une seule ligne).');
        }

        return $value;
    }

    private static function email(?string $value, string $name): ?string
    {
        $value = self::text($value);
        if ($value !== null && filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException($name . ' doit être une adresse e-mail valide.');
        }

        return $value;
    }
}
