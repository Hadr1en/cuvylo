<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use Cuvylo\Support\Clock;
use Cuvylo\Support\Json;
use Cuvylo\Support\StoredJson;
use PDO;

/**
 * Liens de partage : instantané figé (titre, réglages, données) d'un CV au moment du partage.
 * La révocation efface l'instantané (seules les métadonnées restent, pour l'export et le compteur).
 */
final class ShareRepository
{
    public const MAX_ACTIVE_PER_CV = 20;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $data
     */
    public function create(string $id, string $userId, string $cvId, string $slug, string $title, array $settings, array $data, string $now, ?string $expiresAt): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO shares (id, user_id, cv_id, slug, title, settings, data, created_at, expires_at, revoked_at, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)');
        $stmt->execute([$id, $userId, $cvId, $slug, $title, Json::encode($settings), StoredJson::encode($data, true), $now, $expiresAt]);
    }

    /** @return list<array<string, mixed>> Partages non révoqués d'un CV (expirés compris, signalés par expiresAt). */
    public function listFor(string $userId, string $cvId): array
    {
        $stmt = $this->pdo->prepare('SELECT id, slug, created_at, expires_at, views FROM shares WHERE user_id = ? AND cv_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC');
        $stmt->execute([$userId, $cvId]);

        return $stmt->fetchAll();
    }

    public function find(string $userId, string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, slug, created_at, expires_at, views FROM shares WHERE id = ? AND user_id = ? AND revoked_at IS NULL');
        $stmt->execute([$id, $userId]);

        return $stmt->fetch() ?: null;
    }

    public function countActive(string $userId, string $cvId, string $now): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM shares WHERE user_id = ? AND cv_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)');
        $stmt->execute([$userId, $cvId, $now]);

        return (int) $stmt->fetchColumn();
    }

    /** Révoque (et efface l'instantané). @return bool false si le partage n'existe pas, est déjà révoqué ou appartient à un autre. */
    public function revoke(string $userId, string $id, string $now): bool
    {
        $stmt = $this->pdo->prepare("UPDATE shares SET revoked_at = ?, settings = '{}', data = '{}' WHERE id = ? AND user_id = ? AND revoked_at IS NULL");
        $stmt->execute([$now, $id, $userId]);

        return $stmt->rowCount() === 1;
    }

    /**
     * Efface l'instantané des partages expirés, comme une révocation (les métadonnées restent pour l'export et le
     * compteur). Requête légère appelée à chaque requête authentifiée et à chaque lecture publique : pas besoin de
     * tâche planifiée, souvent absente des mutualisés. @return int nombre d'instantanés effacés
     */
    public function purgeExpired(string $now): int
    {
        $stmt = $this->pdo->prepare("UPDATE shares SET settings = '{}', data = '{}' WHERE expires_at IS NOT NULL AND expires_at <= ? AND data <> '{}'");
        $stmt->execute([$now]);

        return $stmt->rowCount();
    }

    /** @return array{id: string, title: string, settings: array<string, mixed>, data: array<string, mixed>, created_at: string}|null Partage public lisible. */
    public function findPublic(string $slug, string $now): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, title, settings, data, created_at FROM shares WHERE slug = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)');
        $stmt->execute([$slug, $now]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        return [
            'id' => $row['id'],
            'title' => $row['title'],
            'settings' => CvRepository::settings($row['settings']),
            'data' => CvRepository::data($row['data']),
            'created_at' => $row['created_at'],
        ];
    }

    public function incrementViews(string $id): void
    {
        $stmt = $this->pdo->prepare('UPDATE shares SET views = views + 1 WHERE id = ?');
        $stmt->execute([$id]);
    }

    /** @return list<array<string, mixed>> Métadonnées de tous les partages (export RGPD), sans instantané. */
    public function metadataFor(string $userId): array
    {
        $stmt = $this->pdo->prepare('SELECT id, cv_id, slug, title, created_at, expires_at, revoked_at, views FROM shares WHERE user_id = ? ORDER BY created_at ASC, id ASC');
        $stmt->execute([$userId]);

        return array_map(static fn (array $r): array => [
            'id' => $r['id'],
            'cvId' => $r['cv_id'],
            'slug' => $r['slug'],
            'title' => $r['title'],
            'createdAt' => Clock::sqlToIso($r['created_at']),
            'expiresAt' => $r['expires_at'] === null ? null : Clock::sqlToIso($r['expires_at']),
            'revokedAt' => $r['revoked_at'] === null ? null : Clock::sqlToIso($r['revoked_at']),
            'views' => (int) $r['views'],
        ], $stmt->fetchAll());
    }
}
