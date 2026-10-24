<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Config;
use Cuvylo\Database\Connection;
use Cuvylo\Database\Migrator;
use Cuvylo\EnvFile;
use Cuvylo\Support\Ulid;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class MigrationAndConfigTest extends TestCase
{
    private static function migrationsDir(): string
    {
        return dirname(__DIR__) . '/migrations';
    }

    public function testMigrationsApplyOnceAndAreIdempotent(): void
    {
        $pdo = Connection::open('sqlite::memory:');

        $first = Migrator::run($pdo, self::migrationsDir());
        $this->assertContains('001_init', $first);
        $this->assertSame([], Migrator::run($pdo, self::migrationsDir()), 'deuxième exécution : rien à faire');

        $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table'")->fetchAll(\PDO::FETCH_COLUMN);
        foreach (['users', 'sessions', 'login_attempts', 'profiles', 'cvs', 'cv_versions', 'schema_migrations'] as $table) {
            $this->assertContains($table, $tables);
        }
    }

    public function testForeignKeysCascadeFromUsers(): void
    {
        $pdo = Connection::open('sqlite::memory:');
        Migrator::run($pdo, self::migrationsDir());

        $this->assertSame(1, (int) $pdo->query('PRAGMA foreign_keys')->fetchColumn());
        $this->expectException(\PDOException::class);
        $pdo->exec("INSERT INTO profiles (user_id, data, updated_at) VALUES ('NOSUCHUSER000000000000000', '{}', '2026-01-01 00:00:00')");
    }

    public function testMigrationsAreForwardOnlyAndNonDestructive(): void
    {
        // Politique : aucune instruction destructrice dans les migrations (les motifs sont assemblés pour ne pas s'auto-détecter).
        $forbidden = [
            '/\bDR' . 'OP\s+(TABLE|DATABASE|INDEX|COLUMN)\b/i',
            '/\bTRUN' . 'CATE\b/i',
            '/\bDELETE\s+FROM\b(?!.*\bWHERE\b)/is',
        ];
        foreach (glob(self::migrationsDir() . '/*.sql') ?: [] as $file) {
            $sql = (string) file_get_contents($file);
            foreach ($forbidden as $pattern) {
                $this->assertSame(0, preg_match($pattern, $sql), basename($file) . ' contient une instruction destructrice');
            }
        }
        $this->assertNotEmpty(glob(self::migrationsDir() . '/*.sql'));
    }

    public function testEngineClauseIsStrippedOnlyForSqlite(): void
    {
        $sql = 'CREATE TABLE t (id CHAR(26) NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;';
        $this->assertSame(['CREATE TABLE t (id CHAR(26) NOT NULL PRIMARY KEY)'], Migrator::statements($sql, true));
        $this->assertStringContainsString('ENGINE=InnoDB', Migrator::statements($sql, false)[0]);
    }

    public function testMigrationRunsInOrder(): void
    {
        $dir = sys_get_temp_dir() . '/cuvylo-migr-' . bin2hex(random_bytes(4));
        mkdir($dir);
        file_put_contents($dir . '/002_b.sql', "CREATE TABLE b (id INTEGER PRIMARY KEY);\n");
        file_put_contents($dir . '/001_a.sql', "-- commentaire ; avec point-virgule\nCREATE TABLE a (id INTEGER PRIMARY KEY);\n");
        $pdo = Connection::open('sqlite::memory:');

        $this->assertSame(['001_a', '002_b'], Migrator::run($pdo, $dir));
        unlink($dir . '/001_a.sql');
        unlink($dir . '/002_b.sql');
        rmdir($dir);
    }

    /** @return array<string, string> */
    private static function validEnv(): array
    {
        return [
            'APP_ENV' => 'production',
            'APP_URL' => 'https://cv.example.fr/',
            'APP_KEY' => base64_encode(random_bytes(32)),
            'DB_DSN' => 'mysql:host=localhost;dbname=cv;charset=utf8mb4',
        ];
    }

    public function testConfigDefaultsAndOrigin(): void
    {
        $config = Config::fromEnv(self::validEnv());
        $this->assertSame('https://cv.example.fr', $config->appUrl);
        $this->assertSame('https://cv.example.fr', $config->origin());
        $this->assertTrue($config->secureCookies());
        $this->assertSame(10080, $config->sessionLifetimeMinutes);
        $this->assertSame(30, $config->sessionAbsoluteLifetimeDays);
        $this->assertFalse($config->registrationEnabled, 'inscription libre fermée par défaut (v2)');
        $this->assertNull($config->registrationInviteCode);
        $this->assertSame(32, strlen($config->appKey));
        $this->assertSame([], $config->adminEmails);
        $this->assertSame(25 * 1024 * 1024, $config->storageLimitBytes());
        $this->assertFalse($config->maintenance());
    }

    public function testAdminEmailsAndStorageLimit(): void
    {
        $config = Config::fromEnv(['ADMIN_EMAILS' => ' Admin@Example.test , second@example.test,', 'USER_STORAGE_LIMIT_MB' => '5', 'REGISTRATION_ENABLED' => 'true'] + self::validEnv());
        $this->assertSame(['admin@example.test', 'second@example.test'], $config->adminEmails);
        $this->assertTrue($config->isAdmin('ADMIN@example.test'));
        $this->assertFalse($config->isAdmin('other@example.test'));
        $this->assertSame(5 * 1024 * 1024, $config->storageLimitBytes());
        $this->assertTrue($config->registrationEnabled);

        $this->expectException(RuntimeException::class);
        Config::fromEnv(['ADMIN_EMAILS' => 'pas-un-email'] + self::validEnv());
    }

    public function testRegistrationRateLimitIsConfigurable(): void
    {
        $this->assertSame(10, Config::fromEnv(self::validEnv())->registrationsPerIpHour, 'défaut prudent');
        $this->assertSame(1000, Config::fromEnv(['REGISTRATION_MAX_PER_IP_HOUR' => '1000'] + self::validEnv())->registrationsPerIpHour);

        $this->expectException(RuntimeException::class);
        Config::fromEnv(['REGISTRATION_MAX_PER_IP_HOUR' => '0'] + self::validEnv());
    }

    public function testConfigRejectsUnsafeProductionSetups(): void
    {
        $cases = [
            'http en production' => ['APP_URL' => 'http://cv.example.fr'],
            'clé trop courte' => ['APP_KEY' => 'short'],
            'clé absente' => ['APP_KEY' => ''],
            'DSN absent' => ['DB_DSN' => ''],
            'APP_ENV inconnu' => ['APP_ENV' => 'staging'],
            'durée invalide' => ['SESSION_LIFETIME_MINUTES' => '-5'],
        ];
        foreach ($cases as $name => $override) {
            try {
                Config::fromEnv($override + self::validEnv());
                $this->fail("$name devrait être refusé");
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function testHttpIsAllowedOutsideProduction(): void
    {
        $config = Config::fromEnv(['APP_ENV' => 'development', 'APP_URL' => 'http://localhost:5173'] + self::validEnv());
        $this->assertFalse($config->secureCookies());
        $this->assertSame('http://localhost:5173', $config->origin());
    }

    public function testEnvFileParsing(): void
    {
        $parsed = EnvFile::parse(<<<'ENV'
        # commentaire
        APP_ENV=production
        APP_URL="https://cv.example.fr"
        export LOG_PATH='/home/user/logs/app.log'
        EMPTY=
        INLINE=value # commentaire de fin
        QUOTED_HASH="a # b"
        not a valid line
        ENV);

        $this->assertSame('production', $parsed['APP_ENV']);
        $this->assertSame('https://cv.example.fr', $parsed['APP_URL']);
        $this->assertSame('/home/user/logs/app.log', $parsed['LOG_PATH']);
        $this->assertSame('', $parsed['EMPTY']);
        $this->assertSame('value', $parsed['INLINE']);
        $this->assertSame('a # b', $parsed['QUOTED_HASH']);
        $this->assertCount(6, $parsed);
        $this->assertSame([], EnvFile::load('/nonexistent/.env'));
    }

    public function testEnvExampleContainsNoRealLookingValues(): void
    {
        $files = array_filter([dirname(__DIR__) . '/env.example', dirname(__DIR__, 2) . '/.env.example'], 'is_file');
        $this->assertNotEmpty($files, 'un modèle de configuration est requis');
        foreach ($files as $file) {
            $this->assertExampleIsSafe($file);
        }

        // Le modèle du backend documente toutes les clés (la copie racine est tenue hors de backend/).
        $values = EnvFile::parse((string) file_get_contents(dirname(__DIR__) . '/env.example'));
        foreach (EnvFile::KEYS as $key) {
            $this->assertArrayHasKey($key, $values, "$key doit être documenté dans backend/env.example");
        }
        $this->assertSame('false', $values['REGISTRATION_ENABLED'], 'le modèle reflète le défaut sûr');
    }

    private function assertExampleIsSafe(string $file): void
    {
        $values = EnvFile::parse((string) file_get_contents($file));
        $this->assertArrayHasKey('APP_KEY', $values, basename($file));
        $this->assertSame('', $values['APP_KEY'], 'aucune clé ne doit être committée');
        $this->assertSame('', $values['DB_PASSWORD'] ?? '');
    }

    public function testUlidFormatAndUniqueness(): void
    {
        $ids = array_map(static fn (): string => Ulid::generate(), range(1, 200));
        $this->assertCount(200, array_unique($ids));
        foreach ($ids as $id) {
            $this->assertTrue(Ulid::isValid($id), $id);
        }
        $earlier = Ulid::generate(1_000_000_000);
        $later = Ulid::generate(1_900_000_000);
        $this->assertLessThan(0, strcmp($earlier, $later), 'les ULID se trient chronologiquement');
        $this->assertFalse(Ulid::isValid('01HZZZZZZZZZZZZZZZZZZZZZZI'));
    }
}
