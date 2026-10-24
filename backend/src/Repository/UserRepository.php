<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use PDO;

final class UserRepository
{
    private const COLUMNS = 'id, email, password_hash, display_name, created_at, last_login_at, totp_secret, totp_pending, totp_recovery, is_admin, reset_requested_at';

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return array<string, mixed>|null */
    public function findByEmail(string $email): ?array
    {
        $stmt = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM users WHERE email = ?');
        $stmt->execute([$email]);

        return $stmt->fetch() ?: null;
    }

    /** @return array<string, mixed>|null */
    public function findById(string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM users WHERE id = ?');
        $stmt->execute([$id]);

        return $stmt->fetch() ?: null;
    }

    /** @return list<array<string, mixed>> Tous les comptes (administration), sans hash ni secret. */
    public function all(): array
    {
        return $this->pdo->query(
            'SELECT id, email, display_name, created_at, last_login_at, is_admin, reset_requested_at,
                    CASE WHEN totp_secret IS NULL THEN 0 ELSE 1 END AS mfa
             FROM users ORDER BY created_at ASC, id ASC'
        )->fetchAll();
    }

    public function count(): int
    {
        return (int) $this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    }

    public function insert(string $id, string $email, string $hash, ?string $displayName, string $createdAt, bool $isAdmin = false): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO users (id, email, password_hash, display_name, created_at, is_admin) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $email, $hash, $displayName, $createdAt, $isAdmin ? 1 : 0]);
    }

    /** « Mot de passe oublié » : la demande autorise l'administrateur à générer un lien pour ce compte. */
    public function requestReset(string $id, string $now): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET reset_requested_at = ? WHERE id = ?');
        $stmt->execute([$now, $id]);
    }

    public function clearResetRequest(string $id): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET reset_requested_at = NULL WHERE id = ? AND reset_requested_at IS NOT NULL');
        $stmt->execute([$id]);
    }

    public function updateHash(string $id, string $hash): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $stmt->execute([$hash, $id]);
    }

    public function touchLogin(string $id, string $now): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET last_login_at = ? WHERE id = ?');
        $stmt->execute([$now, $id]);
    }

    public function setTotpPending(string $id, ?string $sealed): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET totp_pending = ? WHERE id = ?');
        $stmt->execute([$sealed, $id]);
    }

    /** Active la double authentification : secret confirmé + codes de secours (empreintes), secret en attente effacé. */
    public function enableTotp(string $id, string $sealedSecret, string $recovery): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_recovery = ? WHERE id = ?');
        $stmt->execute([$sealedSecret, $recovery, $id]);
    }

    public function updateTotp(string $id, string $sealedSecret, string $recovery): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET totp_secret = ?, totp_recovery = ? WHERE id = ? AND totp_secret IS NOT NULL');
        $stmt->execute([$sealedSecret, $recovery, $id]);
    }

    public function disableTotp(string $id): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_recovery = NULL WHERE id = ?');
        $stmt->execute([$id]);
    }

    /**
     * Suppression du compte et de toutes ses données (droit à l'effacement), dans une transaction.
     * Les clés étrangères sont en ON DELETE CASCADE, mais l'ordre explicite rend l'effacement
     * indépendant de leur prise en charge. Chaque requête est bornée à CET utilisateur.
     */
    public function deleteAccount(string $id): void
    {
        $this->pdo->beginTransaction();
        try {
            foreach ([
                'DELETE FROM shares WHERE user_id = ?',
                'DELETE FROM letters WHERE user_id = ?',
                'DELETE FROM applications WHERE user_id = ?',
                'DELETE FROM cv_versions WHERE user_id = ?',
                'DELETE FROM cvs WHERE user_id = ?',
                'DELETE FROM profiles WHERE user_id = ?',
                'DELETE FROM sessions WHERE user_id = ?',
                'DELETE FROM password_resets WHERE user_id = ?',
                'DELETE FROM invitations WHERE created_by = ?',
                'UPDATE invitations SET used_by = NULL WHERE used_by = ?',
                'DELETE FROM users WHERE id = ?',
            ] as $sql) {
                $this->pdo->prepare($sql)->execute([$id]);
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }
}
