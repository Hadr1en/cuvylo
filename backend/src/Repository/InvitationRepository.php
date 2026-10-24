<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use Cuvylo\Support\Clock;
use Cuvylo\Support\Token;
use PDO;

/** Invitations nominatives à usage unique. Seule l'empreinte SHA-256 du jeton est stockée. */
final class InvitationRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function create(string $id, string $token, string $note, string $createdBy, string $createdAt, string $expiresAt): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO invitations (id, token_hash, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, Token::hash($token), $note, $createdBy, $createdAt, $expiresAt]);
    }

    /** @return array<string, mixed>|null Invitation utilisable (non consommée, non expirée). */
    public function findUsable(string $token, string $now): ?array
    {
        if (!Token::looksValid($token)) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT id, note, expires_at FROM invitations WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?');
        $stmt->execute([Token::hash($token), $now]);

        return $stmt->fetch() ?: null;
    }

    /** Consomme l'invitation de façon atomique : false si elle a déjà servi, expiré ou n'existe pas. */
    public function consume(string $token, string $userId, string $now): bool
    {
        if (!Token::looksValid($token)) {
            return false;
        }
        $stmt = $this->pdo->prepare('UPDATE invitations SET used_at = ?, used_by = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?');
        $stmt->execute([$now, $userId, Token::hash($token), $now]);

        return $stmt->rowCount() === 1;
    }

    /** @return list<array<string, mixed>> */
    public function all(string $now): array
    {
        $stmt = $this->pdo->query('SELECT i.id, i.note, i.created_at, i.expires_at, i.used_at, u.email AS used_by_email
            FROM invitations i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC, i.id DESC');

        return array_map(static function (array $row) use ($now): array {
            $status = $row['used_at'] !== null ? 'used' : ($row['expires_at'] <= $now ? 'expired' : 'pending');

            return [
                'id' => $row['id'],
                'note' => $row['note'],
                'createdAt' => Clock::sqlToIso($row['created_at']),
                'expiresAt' => Clock::sqlToIso($row['expires_at']),
                'usedAt' => $row['used_at'] === null ? null : Clock::sqlToIso($row['used_at']),
                'usedBy' => $row['used_by_email'],
                'status' => $status,
            ];
        }, $stmt->fetchAll());
    }

    public function delete(string $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM invitations WHERE id = ?');
        $stmt->execute([$id]);

        return $stmt->rowCount() === 1;
    }
}
