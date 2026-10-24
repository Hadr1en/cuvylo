<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use Cuvylo\Support\Clock;
use PDO;

/** Candidatures. Toutes les requêtes sont bornées par `user_id`. */
final class ApplicationRepository
{
    public const MAX_PER_USER = 500;

    private const COLUMNS = 'id, company, position, url, posting, cv_id, status, applied_at, next_action_at, notes, created_at, updated_at, revision';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function count(string $userId): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM applications WHERE user_id = ?');
        $stmt->execute([$userId]);

        return (int) $stmt->fetchColumn();
    }

    /**
     * @param bool $withPosting Inclure le texte de l'offre (lecture unitaire, export) ; la liste s'en passe.
     * @return list<array<string, mixed>>
     */
    public function all(string $userId, bool $withPosting = false): array
    {
        $stmt = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM applications WHERE user_id = ? ORDER BY updated_at DESC, id DESC');
        $stmt->execute([$userId]);

        return array_map(static fn (array $row): array => self::json($row, $withPosting), $stmt->fetchAll());
    }

    /** @return array<string, mixed>|null */
    public function find(string $userId, string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM applications WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $userId]);
        $row = $stmt->fetch();

        return $row === false ? null : self::json($row, true);
    }

    public static function bytes(array $value): int
    {
        return strlen($value['company']) + strlen($value['position']) + strlen($value['url']) + strlen($value['posting']) + strlen($value['notes']);
    }

    /** @param array<string, mixed> $v */
    public function insert(string $userId, string $id, array $v, string $now): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO applications (id, user_id, company, position, url, posting, cv_id, status, applied_at, next_action_at, notes, created_at, updated_at, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)');
        $stmt->execute([$id, $userId, $v['company'], $v['position'], $v['url'], $v['posting'], $v['cvId'], $v['status'], $v['appliedAt'], $v['nextActionAt'], $v['notes'], $now, $now]);
    }

    /**
     * @param array<string, mixed> $v
     * @return bool false en cas de conflit de révision (ou si la candidature n'existe plus).
     */
    public function update(string $userId, string $id, array $v, string $now, ?int $expectedRevision): bool
    {
        $sql = 'UPDATE applications SET company = ?, position = ?, url = ?, posting = ?, cv_id = ?, status = ?, applied_at = ?, next_action_at = ?, notes = ?, updated_at = ?, revision = revision + 1
            WHERE id = ? AND user_id = ?';
        $params = [$v['company'], $v['position'], $v['url'], $v['posting'], $v['cvId'], $v['status'], $v['appliedAt'], $v['nextActionAt'], $v['notes'], $now, $id, $userId];
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
        $stmt = $this->pdo->prepare('DELETE FROM applications WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $userId]);

        return $stmt->rowCount() === 1;
    }

    /** @param array<string, mixed> $row */
    private static function json(array $row, bool $withPosting): array
    {
        $out = [
            'id' => $row['id'],
            'company' => $row['company'],
            'position' => $row['position'],
            'url' => $row['url'],
        ];
        if ($withPosting) {
            $out['posting'] = $row['posting'];
        } else {
            $out['hasPosting'] = $row['posting'] !== '';
        }

        return $out + [
            'cvId' => $row['cv_id'],
            'status' => $row['status'],
            'appliedAt' => self::day($row['applied_at']),
            'nextActionAt' => self::day($row['next_action_at']),
            'notes' => $row['notes'],
            'createdAt' => Clock::sqlToIso($row['created_at']),
            'updatedAt' => Clock::sqlToIso($row['updated_at']),
            'revision' => (int) $row['revision'],
        ];
    }

    private static function day(?string $value): ?string
    {
        return $value === null || $value === '' ? null : substr($value, 0, 10);
    }
}
