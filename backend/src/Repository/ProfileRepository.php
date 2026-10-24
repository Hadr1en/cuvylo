<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use Cuvylo\Domain\ProfileMigrator;
use Cuvylo\Support\StoredJson;
use PDO;

final class ProfileRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return array{data: array<string, mixed>, updated_at: string, revision: int, bytes: int}|null Document migré en v2 à la lecture. */
    public function find(string $userId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT data, updated_at, revision FROM profiles WHERE user_id = ?');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        return [
            'data' => ProfileMigrator::migrate(StoredJson::decode($row['data'])),
            'updated_at' => $row['updated_at'],
            'revision' => (int) $row['revision'],
            'bytes' => strlen($row['data']),
        ];
    }

    /**
     * Enregistre le profil (révision incrémentée).
     *
     * @param array<string, mixed> $data
     * @param int|null $expectedRevision Révision connue du client : l'écriture n'a lieu que si elle est toujours courante.
     * @return bool false si la révision attendue n'est plus la révision courante (conflit).
     */
    public function save(string $userId, array $data, string $now, ?int $expectedRevision = null): bool
    {
        $json = StoredJson::encode($data);
        $exists = $this->pdo->prepare('SELECT 1 FROM profiles WHERE user_id = ?');
        $exists->execute([$userId]);

        if ($exists->fetchColumn() === false) {
            $stmt = $this->pdo->prepare('INSERT INTO profiles (user_id, data, updated_at, revision) VALUES (?, ?, ?, 1)');
            $stmt->execute([$userId, $json, $now]);

            return true;
        }
        if ($expectedRevision === null) {
            $stmt = $this->pdo->prepare('UPDATE profiles SET data = ?, updated_at = ?, revision = revision + 1 WHERE user_id = ?');
            $stmt->execute([$json, $now, $userId]);

            return true;
        }
        $stmt = $this->pdo->prepare('UPDATE profiles SET data = ?, updated_at = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?');
        $stmt->execute([$json, $now, $userId, $expectedRevision]);

        return $stmt->rowCount() === 1;
    }
}
