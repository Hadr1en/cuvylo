<?php

declare(strict_types=1);

namespace Cuvylo\Auth;

use Cuvylo\Config;
use Cuvylo\Support\Clock;
use PDO;

/** Sessions en base : le cookie porte un jeton opaque (256 bits), seul son SHA-256 est stocké. */
final class SessionManager
{
    /** Au plus une écriture de `last_seen_at` / prolongation par intervalle. */
    public const TOUCH_INTERVAL = 300;

    public function __construct(
        private readonly PDO $pdo,
        private readonly Config $config,
        private readonly Clock $clock,
    ) {
    }

    /**
     * @return string Jeton à placer dans le cookie.
     *
     * Minimisation (RGPD) : ni l'IP ni l'empreinte du navigateur ne sont conservées avec la session ; seul un
     * libellé grossier (`device` : « Firefox · Windows ») sert à la liste des sessions actives.
     * Les colonnes ip_hash / ua_hash restent dans le schéma (migrations à sens unique) et sont laissées vides.
     */
    public function create(string $userId, string $csrfHash, string $device = ''): string
    {
        $token = bin2hex(random_bytes(32));
        $now = $this->clock->now();

        $stmt = $this->pdo->prepare(
            'INSERT INTO sessions (id_hash, user_id, csrf_hash, created_at, last_seen_at, expires_at, ip_hash, ua_hash, device)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            self::hashToken($token),
            $userId,
            $csrfHash,
            $this->clock->sql($now),
            $this->clock->sql($now),
            $this->clock->sql($this->expiry($now, $now)),
            '',
            '',
            mb_substr($device, 0, 60),
        ]);

        return $token;
    }

    /**
     * Sessions actives d'un utilisateur. `id` public = 12 premiers caractères du hash stocké (jamais le jeton).
     *
     * @return list<array{id: string, device: string, createdAt: string, lastSeenAt: string, current: bool}>
     */
    public function listFor(string $userId, ?string $currentIdHash): array
    {
        $stmt = $this->pdo->prepare('SELECT id_hash, device, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC, id_hash ASC');
        $stmt->execute([$userId, $this->clock->sql()]);
        $absoluteLimit = $this->clock->now() - $this->absoluteSeconds();

        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            if (Clock::sqlToTimestamp($row['created_at']) <= $absoluteLimit) {
                continue;
            }
            $out[] = [
                'id' => substr($row['id_hash'], 0, self::PUBLIC_ID_LENGTH),
                'device' => $row['device'] === '' ? 'Appareil inconnu' : $row['device'],
                'createdAt' => Clock::sqlToIso($row['created_at']),
                'lastSeenAt' => Clock::sqlToIso($row['last_seen_at']),
                'current' => $currentIdHash !== null && hash_equals($row['id_hash'], $currentIdHash),
            ];
        }

        return $out;
    }

    public const PUBLIC_ID_LENGTH = 12;

    /** @return int Nombre de sessions supprimées (0 si l'identifiant ne désigne aucune session de CET utilisateur). */
    public function revokeByPublicId(string $userId, string $publicId): int
    {
        if (preg_match('/^[a-f0-9]{' . self::PUBLIC_ID_LENGTH . '}$/D', $publicId) !== 1) {
            return 0;
        }
        $stmt = $this->pdo->prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash LIKE ?');
        $stmt->execute([$userId, $publicId . '%']);

        return $stmt->rowCount();
    }

    public function revokeOthers(string $userId, string $currentIdHash): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?');
        $stmt->execute([$userId, $currentIdHash]);
    }

    public function revokeAll(string $userId): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM sessions WHERE user_id = ?');
        $stmt->execute([$userId]);
    }

    /**
     * @return array{id_hash: string, user_id: string, csrf_hash: string, created_at: string, last_seen_at: string, expires_at: string}|null
     */
    public function find(string $token): ?array
    {
        if (preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) {
            return null;
        }
        $stmt = $this->pdo->prepare(
            'SELECT id_hash, user_id, csrf_hash, created_at, last_seen_at, expires_at FROM sessions WHERE id_hash = ?'
        );
        $stmt->execute([self::hashToken($token)]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        $now = $this->clock->now();
        $created = Clock::sqlToTimestamp($row['created_at']);
        if (Clock::sqlToTimestamp($row['expires_at']) <= $now || $created + $this->absoluteSeconds() <= $now) {
            $this->destroy($token);

            return null;
        }

        return $row;
    }

    /**
     * Prolonge la session (expiration glissante, plafonnée par la durée absolue).
     *
     * @param array{id_hash: string, created_at: string, last_seen_at: string} $session
     * @return int|null Nouvelle expiration (pour rafraîchir le cookie), null si rien n'a changé.
     */
    public function touch(array $session): ?int
    {
        $now = $this->clock->now();
        if (Clock::sqlToTimestamp($session['last_seen_at']) + self::TOUCH_INTERVAL > $now) {
            return null;
        }
        $expires = $this->expiry(Clock::sqlToTimestamp($session['created_at']), $now);
        $stmt = $this->pdo->prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?');
        $stmt->execute([$this->clock->sql($now), $this->clock->sql($expires), $session['id_hash']]);

        return $expires;
    }

    public function rebindCsrf(string $idHash, string $csrfHash): void
    {
        $stmt = $this->pdo->prepare('UPDATE sessions SET csrf_hash = ? WHERE id_hash = ?');
        $stmt->execute([$csrfHash, $idHash]);
    }

    public function destroy(string $token): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM sessions WHERE id_hash = ?');
        $stmt->execute([self::hashToken($token)]);
    }

    /** Purge opportuniste (pas de CRON garanti sur mutualisé). */
    public function purgeExpired(): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM sessions WHERE expires_at <= ?');
        $stmt->execute([$this->clock->sql()]);
    }

    private function expiry(int $createdAt, int $now): int
    {
        return min($now + $this->config->sessionLifetimeMinutes * 60, $createdAt + $this->absoluteSeconds());
    }

    private function absoluteSeconds(): int
    {
        return $this->config->sessionAbsoluteLifetimeDays * 86400;
    }

    private static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }
}
