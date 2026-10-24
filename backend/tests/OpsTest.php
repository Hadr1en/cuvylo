<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Database\AutoMigrator;
use Cuvylo\Database\Connection;
use Cuvylo\Database\Migrator;
use Cuvylo\Kernel;
use Cuvylo\Support\Logger;
use Cuvylo\Tests\Support\ApiTestCase;

/** Exploitation sans SSH : migration 002, migration automatique, mode maintenance, informations d'instance, journal. */
final class OpsTest extends ApiTestCase
{
    /** @var list<string> */
    private array $tempDirs = [];

    protected function tearDown(): void
    {
        foreach (array_reverse($this->tempDirs) as $dir) {
            $this->removeTree($dir);
        }
    }

    private function tempHome(bool $withMigrations = true): string
    {
        $home = sys_get_temp_dir() . '/cuvylo-home-' . bin2hex(random_bytes(5));
        mkdir($home);
        $this->tempDirs[] = $home;
        if ($withMigrations) {
            mkdir($home . '/migrations');
            foreach (glob(dirname(__DIR__) . '/migrations/*.sql') ?: [] as $file) {
                copy($file, $home . '/migrations/' . basename($file));
            }
        }

        return $home;
    }

    /** Suppression bornée au dossier temporaire créé par ce test (fichiers connus, sans récursion aveugle). */
    private function removeTree(string $dir): void
    {
        if (!str_starts_with($dir, sys_get_temp_dir() . '/cuvylo-home-')) {
            return;
        }
        foreach (['migrations', 'var'] as $sub) {
            if (!is_dir($dir . '/' . $sub)) {
                continue;
            }
            foreach (scandir($dir . '/' . $sub) ?: [] as $name) {
                if (is_file($dir . '/' . $sub . '/' . $name)) {
                    unlink($dir . '/' . $sub . '/' . $name);
                }
            }
            rmdir($dir . '/' . $sub);
        }
        is_file($dir . '/MAINTENANCE') && unlink($dir . '/MAINTENANCE');
        is_dir($dir) && rmdir($dir);
    }

    public function testMigration002BackfillsVersionKindsByteForByte(): void
    {
        $home = $this->tempHome(false);
        mkdir($home . '/migrations');
        copy(dirname(__DIR__) . '/migrations/001_init.sql', $home . '/migrations/001_init.sql');
        $pdo = Connection::open('sqlite::memory:');
        Migrator::run($pdo, $home . '/migrations');

        $pdo->exec("INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ('U0000000000000000000000001', 'a@example.test', 'x', NULL, '2026-01-01 00:00:00')");
        $pdo->exec("INSERT INTO cvs (id, user_id, title, kind, settings, data, created_at, updated_at) VALUES ('C0000000000000000000000001', 'U0000000000000000000000001', 'CV', 'base', '{}', '{}', '2026-01-01 00:00:00', '2026-01-01 00:00:00')");
        $labels = ['V01' => 'auto', 'V02' => 'Auto', 'V03' => 'avant restauration', 'V04' => 'Avant restauration', 'V05' => 'Envoyée à ACME'];
        foreach ($labels as $suffix => $label) {
            $stmt = $pdo->prepare("INSERT INTO cv_versions (id, cv_id, user_id, label, settings, data, created_at) VALUES (?, 'C0000000000000000000000001', 'U0000000000000000000000001', ?, '{}', '{}', '2026-01-01 00:00:00')");
            $stmt->execute(['V00000000000000000000000' . substr($suffix, 1), $label]);
        }

        copy(dirname(__DIR__) . '/migrations/002_v2.sql', $home . '/migrations/002_v2.sql');
        $this->assertSame(['002_v2'], Migrator::run($pdo, $home . '/migrations'));

        $kinds = $pdo->query('SELECT label, kind FROM cv_versions ORDER BY id')->fetchAll(\PDO::FETCH_KEY_PAIR);
        $this->assertSame([
            'auto' => 'auto',
            'Auto' => 'manual',
            'avant restauration' => 'restore',
            'Avant restauration' => 'manual',
            'Envoyée à ACME' => 'manual',
        ], $kinds, 'une version manuelle nommée « Auto » reste manuelle');

        $this->assertSame(1, (int) $pdo->query("SELECT revision FROM cvs WHERE id = 'C0000000000000000000000001'")->fetchColumn());
        $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table'")->fetchAll(\PDO::FETCH_COLUMN);
        foreach (['invitations', 'password_resets', 'shares', 'applications', 'letters'] as $table) {
            $this->assertContains($table, $tables);
        }
    }

    public function testAutoMigrationCreatesVarAndMarkerThenSkips(): void
    {
        $home = $this->tempHome();
        $pdo = Connection::open('sqlite::memory:');
        $lines = [];
        $logger = new Logger(function (string $line) use (&$lines): void {
            $lines[] = $line;
        });

        $this->assertDirectoryDoesNotExist($home . '/var');
        $this->assertTrue(AutoMigrator::ensure($pdo, $home, $logger, 'sqlite::memory:'));
        $this->assertFileExists($home . '/var/schema.version');
        $marker = trim((string) file_get_contents($home . '/var/schema.version'));
        $this->assertSame(AutoMigrator::markerContent('004_settings', 'sqlite::memory:'), $marker);
        $this->assertStringStartsWith('004_settings ', $marker);
        $this->assertStringNotContainsString('sqlite', $marker, 'le DSN n\'apparaît pas en clair');
        $this->assertFileExists($home . '/var/.htaccess', 'var/ jamais servi, même dans www/');
        $this->assertSame(4, (int) $pdo->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn());
        $this->assertStringContainsString('schema_migrated', implode("\n", $lines));

        // Marqueur à jour : aucune requête de migration (on le prouve en cassant la table de suivi).
        $pdo->exec('ALTER TABLE schema_migrations RENAME TO schema_migrations_hidden');
        $this->assertTrue(AutoMigrator::ensure($pdo, $home, $logger, 'sqlite::memory:'));
        $pdo->exec('ALTER TABLE schema_migrations_hidden RENAME TO schema_migrations');

        // Nouveau fichier déployé : le marqueur est en retard, la migration s'applique.
        file_put_contents($home . '/migrations/009_test.sql', "CREATE TABLE ops_probe (id INTEGER PRIMARY KEY);\n");
        $this->assertTrue(AutoMigrator::ensure($pdo, $home, $logger, 'sqlite::memory:'));
        $this->assertStringStartsWith('009_test ', trim((string) file_get_contents($home . '/var/schema.version')));
        $this->assertContains('ops_probe', $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table'")->fetchAll(\PDO::FETCH_COLUMN));
    }

    /** Un marqueur venu d'une autre base (dossier var/ envoyé par FTP depuis le poste de dev) ne dispense pas de migrer. */
    public function testMarkerFromAnotherDatabaseIsNotTrusted(): void
    {
        $home = $this->tempHome();
        mkdir($home . '/var');
        file_put_contents($home . '/var/schema.version', AutoMigrator::markerContent('002_v2', 'sqlite:/poste/dev.sqlite') . "\n");
        $pdo = Connection::open('sqlite::memory:');

        $this->assertTrue(AutoMigrator::ensure($pdo, $home, Logger::null(), 'mysql:host=prod;dbname=cv'));
        $this->assertSame(4, (int) $pdo->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn(), 'migrations appliquées malgré le marqueur');
        $this->assertSame(AutoMigrator::markerContent('004_settings', 'mysql:host=prod;dbname=cv'), trim((string) file_get_contents($home . '/var/schema.version')));
    }

    public function testFailedAutoMigrationIsLoggedWithoutDetailsAndReported(): void
    {
        $home = $this->tempHome();
        file_put_contents($home . '/migrations/003_broken.sql', "CREATE TABLE users (id INTEGER PRIMARY KEY);\n");
        $pdo = Connection::open('sqlite::memory:');
        $lines = [];
        $logger = new Logger(function (string $line) use (&$lines): void {
            $lines[] = $line;
        });

        $this->assertFalse(AutoMigrator::ensure($pdo, $home, $logger));
        $log = implode("\n", $lines);
        $this->assertStringContainsString('migration_failed', $log);
        $this->assertStringNotContainsString('CREATE TABLE', $log, 'jamais le SQL ni le message');
        $this->assertFileDoesNotExist($home . '/var/schema.version');

        $response = Kernel::maintenanceResponse();
        $this->assertSame(503, $response->status);
        $this->assertSame('maintenance', $response->data()['error']['code']);
    }

    public function testMaintenanceModeBlocksEverythingButHealthAndInstance(): void
    {
        $home = $this->tempHome(false);
        $this->boot([], $home);
        [$client] = $this->registeredClient();
        $this->assertFalse($client->get('/api/instance')->data()['maintenance']);

        touch($home . '/MAINTENANCE');
        $this->assertSame(200, $client->get('/api/health')->status);
        $instance = $client->get('/api/instance');
        $this->assertSame(200, $instance->status);
        $this->assertTrue($instance->data()['maintenance']);

        foreach ([['GET', '/api/auth/me'], ['GET', '/api/profile'], ['POST', '/api/auth/login'], ['GET', '/api/nope']] as [$method, $path]) {
            $response = $client->send($method, $path, $method === 'POST' ? ['email' => 'a@example.test', 'password' => 'x'] : null);
            $this->assertSame(503, $response->status, "$method $path");
            $this->assertSame('maintenance', $response->data()['error']['code']);
            $this->assertNotNull($response->header('Retry-After'));
        }

        unlink($home . '/MAINTENANCE');
        $this->assertSame(200, $client->get('/api/auth/me')->status);
    }

    public function testInstanceAdvertisesV2FeaturesAndClosedRegistrationByDefault(): void
    {
        $this->boot(['REGISTRATION_ENABLED' => '']);
        $data = $this->client()->get('/api/instance')->data();
        $this->assertSame(['open' => false, 'inviteRequired' => false], $data['registration']);
        $this->assertFalse($data['maintenance']);
        $this->assertTrue($data['features']['registrationByInvite']);
        $this->assertTrue($data['features']['shares']);
        $this->assertArrayHasKey('mfa', $data['features']);

        $closed = $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD]);
        $this->assertSame(403, $closed->status);
        $this->assertSame('registration_closed', $closed->data()['error']['code']);
    }

    public function testTokensInPathsAreNotLogged(): void
    {
        $this->assertSame('/api/auth/invitation/[redacted]', Kernel::loggablePath('/api/auth/invitation/abcdef'));
        $this->assertSame('/api/auth/reset/[redacted]', Kernel::loggablePath('/api/auth/reset/abcdef'));
        $this->assertSame('/api/public/cv/[redacted]', Kernel::loggablePath('/api/public/cv/abcdef'));
        $this->assertSame('/api/cvs/01HZ', Kernel::loggablePath('/api/cvs/01HZ'));

        $secretToken = str_repeat('Q', 43);
        $this->client()->get('/api/auth/invitation/' . $secretToken);
        $this->assertStringNotContainsString($secretToken, implode("\n", $this->logLines));
    }

    public function testFrontControllerDisablesDisplayErrors(): void
    {
        $source = (string) file_get_contents(dirname(__DIR__) . '/public/index.php');
        $this->assertMatchesRegularExpression("/ini_set\\('display_errors', '0'\\)/", $source);
        $this->assertLessThan(strpos($source, 'require_once'), strpos($source, "ini_set('display_errors'"), 'désactivé avant tout chargement');
    }
}
