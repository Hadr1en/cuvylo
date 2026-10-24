<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use Cuvylo\Support\Clock;
use Cuvylo\Support\Json;
use Cuvylo\Support\StoredJson;
use PDO;

/** Lettres de motivation. Toutes les requêtes sont bornées par `user_id`. */
final class LetterRepository
{
    public const MAX_PER_USER = 100;

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function count(string $userId): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM letters WHERE user_id = ?');
        $stmt->execute([$userId]);

        return (int) $stmt->fetchColumn();
    }

    /**
     * @param bool $full Inclure réglages et contenu (export) ; la liste se limite au résumé.
     * @return list<array<string, mixed>>
     */
    public function all(string $userId, bool $full = false): array
    {
        $stmt = $this->pdo->prepare('SELECT id, title, cv_id, settings, data, created_at, updated_at, revision FROM letters WHERE user_id = ? ORDER BY updated_at DESC, id DESC');
        $stmt->execute([$userId]);

        return array_map(static function (array $row) use ($full): array {
            $json = self::json($row);
            if (!$full) {
                unset($json['data']);
                $json['template'] = $json['settings']['template'] ?? 'classic';
                unset($json['settings']);
            }

            return $json;
        }, $stmt->fetchAll());
    }

    /** @return array<string, mixed>|null */
    public function find(string $userId, string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, title, cv_id, settings, data, created_at, updated_at, revision FROM letters WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $userId]);
        $row = $stmt->fetch();

        return $row === false ? null : self::json($row);
    }

    /** @param array{title: string, cvId: ?string, settings: array<string, mixed>, data: array<string, mixed>} $v */
    public static function bytes(array $v): int
    {
        return strlen(Json::encode($v['settings'])) + strlen(Json::encode($v['data']));
    }

    /** @param array{title: string, cvId: ?string, settings: array<string, mixed>, data: array<string, mixed>} $v */
    public function insert(string $userId, string $id, array $v, string $now): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO letters (id, user_id, title, cv_id, settings, data, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)');
        $stmt->execute([$id, $userId, $v['title'], $v['cvId'], Json::encode($v['settings']), Json::encode($v['data']), $now, $now]);
    }

    /** @param array{title: string, cvId: ?string, settings: array<string, mixed>, data: array<string, mixed>} $v */
    public function update(string $userId, string $id, array $v, string $now, ?int $expectedRevision): bool
    {
        $sql = 'UPDATE letters SET title = ?, cv_id = ?, settings = ?, data = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ?';
        $params = [$v['title'], $v['cvId'], Json::encode($v['settings']), Json::encode($v['data']), $now, $id, $userId];
        if ($expectedRevision !== null) {
            $sql .= ' AND revision = ?';
            $params[] = $expectedRevision;
        }
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        return $stmt->rowCount() === 1;
    }

    public function delete(string $userId, string $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM letters WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $userId]);

        return $stmt->rowCount() === 1;
    }

    /** @param array<string, mixed> $row */
    private static function json(array $row): array
    {
        return [
            'id' => $row['id'],
            'title' => $row['title'],
            'cvId' => $row['cv_id'],
            'settings' => StoredJson::decode($row['settings']),
            'data' => StoredJson::decode($row['data']),
            'createdAt' => Clock::sqlToIso($row['created_at']),
            'updatedAt' => Clock::sqlToIso($row['updated_at']),
            'revision' => (int) $row['revision'],
        ];
    }
}
