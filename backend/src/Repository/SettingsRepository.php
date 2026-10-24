<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use PDO;
use PDOException;

/** Réglages de l'instance modifiés depuis l'administration (table `settings`) : ils l'emportent sur .env. */
final class SettingsRepository
{
    /** « 1 » : tout le monde peut créer un compte ; « 0 » : sur invitation seulement. */
    public const REGISTRATION_OPEN = 'registration_open';

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** Valeur enregistrée, ou null si jamais réglée (ou table pas encore créée : la configuration .env s'applique). */
    public function get(string $name): ?string
    {
        try {
            $stmt = $this->pdo->prepare('SELECT value FROM settings WHERE name = ?');
            $stmt->execute([$name]);
            $value = $stmt->fetchColumn();
        } catch (PDOException) {
            return null;
        }

        return $value === false ? null : (string) $value;
    }

    public function set(string $name, string $value, string $now): void
    {
        $exists = $this->pdo->prepare('SELECT 1 FROM settings WHERE name = ?');
        $exists->execute([$name]);
        $stmt = $exists->fetchColumn() === false
            ? $this->pdo->prepare('INSERT INTO settings (value, updated_at, name) VALUES (?, ?, ?)')
            : $this->pdo->prepare('UPDATE settings SET value = ?, updated_at = ? WHERE name = ?');
        $stmt->execute([$value, $now, $name]);
    }
}
