<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use Cuvylo\Support\Token;
use PDO;

/** Liens de réinitialisation du mot de passe (table `password_resets`) : empreinte SHA-256 du jeton, usage unique. */
final class ResetLinkRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** Crée un lien ; les liens encore valides du même compte sont invalidés (un seul lien actif). */
    public function create(string $token, string $userId, string $now, string $expiresAt): void
    {
        $this->invalidateFor($userId, $now);
        $stmt = $this->pdo->prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
        $stmt->execute([Token::hash($token), $userId, $now, $expiresAt]);
    }

    /** @return string|null user_id si le jeton est valide (non utilisé, non expiré). */
    public function findUser(string $token, string $now): ?string
    {
        if (!Token::looksValid($token)) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?');
        $stmt->execute([Token::hash($token), $now]);
        $userId = $stmt->fetchColumn();

        return $userId === false ? null : (string) $userId;
    }

    /** Consomme le jeton de façon atomique. */
    public function consume(string $token, string $now): bool
    {
        if (!Token::looksValid($token)) {
            return false;
        }
        $stmt = $this->pdo->prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?');
        $stmt->execute([$now, Token::hash($token), $now]);

        return $stmt->rowCount() === 1;
    }

    /** Liens créés pour ce compte depuis `$since` (limite d'envoi d'e-mails par compte). */
    public function countSince(string $userId, string $since): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM password_resets WHERE user_id = ? AND created_at > ?');
        $stmt->execute([$userId, $since]);

        return (int) $stmt->fetchColumn();
    }

    public function invalidateFor(string $userId, string $now): void
    {
        $stmt = $this->pdo->prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL');
        $stmt->execute([$now, $userId]);
    }
}
