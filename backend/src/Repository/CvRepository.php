<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use Cuvylo\Domain\ProfileMigrator;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Json;
use Cuvylo\Support\StoredJson;
use Cuvylo\Validation\CvSettingsValidator;
use PDO;

/**
 * Accès aux CV et à leurs versions. TOUTES les méthodes exigent `$userId` et le placent dans la clause WHERE :
 * une ressource d'un autre utilisateur est indiscernable d'une ressource absente.
 * À la lecture, `data` est migré en ProfileData v2 et `settings` complété (CvSettings v2).
 * Les versions sont stockées compressées (`gz:` + base64), décompressées de façon transparente.
 */
final class CvRepository
{
    public const MAX_CVS_PER_USER = 100;
    public const MAX_VERSIONS_PER_CV = 50;

    public const KIND_AUTO = 'auto';
    public const KIND_MANUAL = 'manual';
    public const KIND_RESTORE = 'restore';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function transaction(callable $work): mixed
    {
        if ($this->pdo->inTransaction()) {
            return $work();
        }
        $this->pdo->beginTransaction();
        try {
            $result = $work();
            $this->pdo->commit();

            return $result;
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    public function count(string $userId): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM cvs WHERE user_id = ?');
        $stmt->execute([$userId]);

        return (int) $stmt->fetchColumn();
    }

    /** @return list<array<string, mixed>> */
    public function summaries(string $userId): array
    {
        $stmt = $this->pdo->prepare('SELECT id, title, kind, settings, created_at, updated_at FROM cvs WHERE user_id = ? ORDER BY updated_at DESC, id DESC');
        $stmt->execute([$userId]);

        return array_map(fn (array $row): array => $this->summary($row), $stmt->fetchAll());
    }

    /** @return array<string, mixed>|null */
    public function find(string $userId, string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, title, kind, settings, data, created_at, updated_at, revision FROM cvs WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $userId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        return $this->summary($row) + [
            'settings' => self::settings($row['settings']),
            'data' => self::data($row['data']),
            'revision' => (int) $row['revision'],
        ];
    }

    /** Taille stockée (octets) d'un CV, pour le calcul du quota. */
    public function storedBytes(string $userId, string $id): int
    {
        $stmt = $this->pdo->prepare('SELECT settings, data FROM cvs WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $userId]);
        $row = $stmt->fetch();

        return $row === false ? 0 : strlen($row['settings']) + strlen($row['data']);
    }

    /**
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $data
     */
    public function insert(string $userId, string $id, string $title, string $kind, array $settings, array $data, string $now): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO cvs (id, user_id, title, kind, settings, data, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)');
        $stmt->execute([$id, $userId, $title, $kind, Json::encode($settings), Json::encode($data), $now, $now]);
    }

    /**
     * Met à jour le CV et incrémente sa révision.
     *
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $data
     * @return bool false si `$expectedRevision` n'est plus la révision courante (conflit).
     */
    public function update(string $userId, string $id, string $title, array $settings, array $data, string $now, ?int $expectedRevision = null): bool
    {
        $sql = 'UPDATE cvs SET title = ?, settings = ?, data = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND user_id = ?';
        $params = [$title, Json::encode($settings), Json::encode($data), $now, $id, $userId];
        if ($expectedRevision !== null) {
            $sql .= ' AND revision = ?';
            $params[] = $expectedRevision;
        }
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        return $stmt->rowCount() === 1;
    }

    /** Supprime le CV, ses versions et ses liens de partage ; détache candidatures et lettres. */
    public function delete(string $userId, string $id): void
    {
        $this->transaction(function () use ($userId, $id): void {
            foreach ([
                'DELETE FROM shares WHERE cv_id = ? AND user_id = ?',
                'DELETE FROM cv_versions WHERE cv_id = ? AND user_id = ?',
                'UPDATE applications SET cv_id = NULL WHERE cv_id = ? AND user_id = ?',
                'UPDATE letters SET cv_id = NULL WHERE cv_id = ? AND user_id = ?',
                'DELETE FROM cvs WHERE id = ? AND user_id = ?',
            ] as $sql) {
                $this->pdo->prepare($sql)->execute([$id, $userId]);
            }
        });
    }

    /** @return list<array{id: string, label: string, kind: string, createdAt: string}> */
    public function versions(string $userId, string $cvId): array
    {
        $stmt = $this->pdo->prepare('SELECT id, label, kind, created_at FROM cv_versions WHERE cv_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC');
        $stmt->execute([$cvId, $userId]);

        return array_map(
            static fn (array $r): array => ['id' => $r['id'], 'label' => $r['label'], 'kind' => $r['kind'], 'createdAt' => Clock::sqlToIso($r['created_at'])],
            $stmt->fetchAll(),
        );
    }

    public function versionCount(string $userId): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM cv_versions WHERE user_id = ?');
        $stmt->execute([$userId]);

        return (int) $stmt->fetchColumn();
    }

    /** @return array{id: string, label: string, kind: string, settings: array<string, mixed>, data: array<string, mixed>, created_at: string}|null */
    public function findVersion(string $userId, string $cvId, string $versionId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, label, kind, settings, data, created_at FROM cv_versions WHERE id = ? AND cv_id = ? AND user_id = ?');
        $stmt->execute([$versionId, $cvId, $userId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        return [
            'id' => $row['id'],
            'label' => $row['label'],
            'kind' => $row['kind'],
            'created_at' => $row['created_at'],
            'settings' => self::settings($row['settings']),
            'data' => self::data($row['data']),
        ];
    }

    /** Horodatage SQL de la version la plus récente (d'un type donné, ou de tout type), null s'il n'y en a pas. */
    public function latestVersionAt(string $userId, string $cvId, ?string $kind = null): ?string
    {
        $sql = 'SELECT MAX(created_at) FROM cv_versions WHERE cv_id = ? AND user_id = ?';
        $params = [$cvId, $userId];
        if ($kind !== null) {
            $sql .= ' AND kind = ?';
            $params[] = $kind;
        }
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $value = $stmt->fetchColumn();

        return ($value === false || $value === null) ? null : (string) $value;
    }

    /**
     * Archive un état (données compressées) puis applique le plafond (les versions `auto` les plus anciennes partent en premier).
     *
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $data
     * @return int Taille stockée de la version (octets).
     */
    public function addVersion(string $userId, string $cvId, string $versionId, string $label, string $kind, array $settings, array $data, string $now): int
    {
        $settingsJson = Json::encode($settings);
        $dataStored = StoredJson::encode($data, true);

        $this->transaction(function () use ($userId, $cvId, $versionId, $label, $kind, $settingsJson, $dataStored, $now): void {
            $stmt = $this->pdo->prepare('INSERT INTO cv_versions (id, cv_id, user_id, label, kind, settings, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$versionId, $cvId, $userId, $label, $kind, $settingsJson, $dataStored, $now]);

            $count = $this->pdo->prepare('SELECT COUNT(*) FROM cv_versions WHERE cv_id = ? AND user_id = ?');
            $count->execute([$cvId, $userId]);
            $excess = (int) $count->fetchColumn() - self::MAX_VERSIONS_PER_CV;
            if ($excess <= 0) {
                return;
            }

            $oldest = $this->pdo->prepare(
                "SELECT id FROM cv_versions WHERE cv_id = ? AND user_id = ? AND id <> ?
                 ORDER BY CASE WHEN kind = 'auto' THEN 0 ELSE 1 END ASC, created_at ASC, id ASC LIMIT " . $excess
            );
            $oldest->execute([$cvId, $userId, $versionId]);
            $delete = $this->pdo->prepare('DELETE FROM cv_versions WHERE id = ? AND cv_id = ? AND user_id = ?');
            foreach ($oldest->fetchAll(PDO::FETCH_COLUMN) as $oldId) {
                $delete->execute([$oldId, $cvId, $userId]);
            }
        });

        return strlen($settingsJson) + strlen($dataStored);
    }

    /** Taille approximative d'une future version (compressée), pour le contrôle du quota. */
    public static function versionBytes(array $settings, array $data): int
    {
        return strlen(Json::encode($settings)) + strlen(StoredJson::encode($data, true));
    }

    /**
     * Tous les CV de l'utilisateur, avec leurs versions complètes (export RGPD).
     *
     * @return list<array<string, mixed>>
     */
    public function exportAll(string $userId): array
    {
        $cvs = $this->pdo->prepare('SELECT id, title, kind, settings, data, created_at, updated_at, revision FROM cvs WHERE user_id = ? ORDER BY created_at ASC, id ASC');
        $cvs->execute([$userId]);
        $versions = $this->pdo->prepare('SELECT id, label, kind, settings, data, created_at FROM cv_versions WHERE cv_id = ? AND user_id = ? ORDER BY created_at ASC, id ASC');

        $out = [];
        foreach ($cvs->fetchAll() as $row) {
            $versions->execute([$row['id'], $userId]);
            $out[] = $this->summary($row) + [
                'settings' => self::settings($row['settings']),
                'data' => self::data($row['data']),
                'revision' => (int) $row['revision'],
                'versions' => array_map(
                    static fn (array $v): array => [
                        'id' => $v['id'],
                        'label' => $v['label'],
                        'kind' => $v['kind'],
                        'createdAt' => Clock::sqlToIso($v['created_at']),
                        'settings' => self::settings($v['settings']),
                        'data' => self::data($v['data']),
                    ],
                    $versions->fetchAll(),
                ),
            ];
        }

        return $out;
    }

    /** @return array<string, mixed> */
    public static function settings(string $stored): array
    {
        $settings = CvSettingsValidator::normalize(StoredJson::decode($stored));

        return is_array($settings) ? $settings : CvSettingsValidator::defaults();
    }

    /** @return array<string, mixed> */
    public static function data(string $stored): array
    {
        $data = ProfileMigrator::migrate(StoredJson::decode($stored));

        return is_array($data) ? $data : [];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function summary(array $row): array
    {
        $settings = StoredJson::decode($row['settings']);

        return [
            'id' => $row['id'],
            'title' => $row['title'],
            'kind' => $row['kind'],
            'template' => $settings['template'] ?? 'classic',
            'createdAt' => Clock::sqlToIso($row['created_at']),
            'updatedAt' => Clock::sqlToIso($row['updated_at']),
        ];
    }
}
