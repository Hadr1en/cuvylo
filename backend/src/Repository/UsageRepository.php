<?php

declare(strict_types=1);

namespace Cuvylo\Repository;

use Cuvylo\Database\Connection;
use Cuvylo\Http\HttpException;
use PDO;

/**
 * Espace occupé par compte (octets stockés : profil, CV, versions compressées, lettres, candidatures, partages)
 * et quota `USER_STORAGE_LIMIT_MB`. Les suppressions et les écritures qui ne font pas grossir le compte
 * restent toujours possibles, même au-delà du quota.
 */
final class UsageRepository
{
    public function __construct(private readonly PDO $pdo, private readonly int $limitBytes)
    {
    }

    public function limitBytes(): int
    {
        return $this->limitBytes;
    }

    public function bytes(string $userId): int
    {
        $total = 0;
        foreach ($this->queries() as [$table, $userColumn, $columns]) {
            $stmt = $this->pdo->prepare('SELECT COALESCE(SUM(' . $this->sizeOf($columns) . '), 0) FROM ' . $table . ' WHERE ' . $userColumn . ' = ?');
            $stmt->execute([$userId]);
            $total += (int) $stmt->fetchColumn();
        }

        return $total;
    }

    /** @return array<string, int> user_id → octets, pour tous les comptes (administration). */
    public function bytesPerUser(): array
    {
        $out = [];
        foreach ($this->queries() as [$table, $userColumn, $columns]) {
            $rows = $this->pdo->query('SELECT ' . $userColumn . ' AS uid, COALESCE(SUM(' . $this->sizeOf($columns) . '), 0) AS bytes FROM ' . $table . ' GROUP BY ' . $userColumn)->fetchAll();
            foreach ($rows as $row) {
                $out[$row['uid']] = ($out[$row['uid']] ?? 0) + (int) $row['bytes'];
            }
        }

        return $out;
    }

    /** @return array<string, int> user_id → nombre de lignes de `$table`. */
    public function countPerUser(string $table): array
    {
        if (!in_array($table, ['cvs', 'cv_versions', 'letters', 'applications', 'shares'], true)) {
            throw new \InvalidArgumentException('Table non comptable.');
        }
        $out = [];
        foreach ($this->pdo->query('SELECT user_id, COUNT(*) AS n FROM ' . $table . ' GROUP BY user_id')->fetchAll() as $row) {
            $out[$row['user_id']] = (int) $row['n'];
        }

        return $out;
    }

    /** @return array{cvs: int, versions: int, letters: int, applications: int, shares: int} */
    public function counts(string $userId): array
    {
        $out = [];
        foreach (['cvs' => 'cvs', 'versions' => 'cv_versions', 'letters' => 'letters', 'applications' => 'applications', 'shares' => 'shares'] as $key => $table) {
            $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM ' . $table . ' WHERE user_id = ?');
            $stmt->execute([$userId]);
            $out[$key] = (int) $stmt->fetchColumn();
        }

        /** @var array{cvs: int, versions: int, letters: int, applications: int, shares: int} */
        return $out;
    }

    /**
     * Refuse une écriture qui ferait dépasser le quota.
     *
     * @param int $delta Variation de taille prévue (octets) ; ≤ 0 : toujours accepté.
     * @throws HttpException 413 quota_exceeded
     */
    public function assertCanGrow(string $userId, int $delta): void
    {
        if ($delta <= 0) {
            return;
        }
        if ($this->bytes($userId) + $delta > $this->limitBytes) {
            throw HttpException::quotaExceeded();
        }
    }

    /** @return list<array{string, string, list<string>}> table, colonne utilisateur, colonnes mesurées */
    private function queries(): array
    {
        return [
            ['profiles', 'user_id', ['data']],
            ['cvs', 'user_id', ['settings', 'data']],
            ['cv_versions', 'user_id', ['settings', 'data']],
            ['letters', 'user_id', ['settings', 'data']],
            ['applications', 'user_id', ['company', 'position', 'url', 'posting', 'notes']],
            ['shares', 'user_id', ['settings', 'data']],
        ];
    }

    /** Taille en octets, portable : LENGTH compte des octets sous MySQL, des caractères sous SQLite (d'où le CAST). */
    private function sizeOf(array $columns): string
    {
        $sqlite = Connection::isSqlite($this->pdo);

        return implode(' + ', array_map(
            static fn (string $c): string => $sqlite ? 'LENGTH(CAST(' . $c . ' AS BLOB))' : 'LENGTH(' . $c . ')',
            $columns,
        ));
    }
}
