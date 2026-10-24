<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Auth\Cookies;
use Cuvylo\Config;
use Cuvylo\Database\Connection;
use Cuvylo\EnvFile;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Install\InstallKernel;
use Cuvylo\Kernel;
use Cuvylo\Support\Json;
use Cuvylo\Support\Logger;
use Cuvylo\Tests\Support\ApiClient;
use Cuvylo\Tests\Support\FakeClock;
use PDOException;
use PHPUnit\Framework\TestCase;

/**
 * Assistant d'installation (sans fichier .env) : vérifications, test de la base, création des tables et du
 * compte administrateur, écriture de .env, puis relais au noyau habituel. Base SQLite dans un dossier temporaire.
 */
final class InstallTest extends TestCase
{
    private const PASSWORD = 'une phrase de passe solide';
    private const HOST = 'cv.example.test';

    /** @var list<string> */
    private array $tempDirs = [];

    protected function tearDown(): void
    {
        foreach (array_reverse($this->tempDirs) as $dir) {
            $this->removeTree($dir);
        }
    }

    private function tempDir(): string
    {
        $dir = sys_get_temp_dir() . '/cuvylo-install-' . bin2hex(random_bytes(5));
        mkdir($dir);
        $this->tempDirs[] = $dir;

        return $dir;
    }

    /** Dossier d'application neuf : migrations, pas de .env. */
    private function home(): string
    {
        $home = $this->tempDir();
        mkdir($home . '/migrations');
        foreach (glob(dirname(__DIR__) . '/migrations/*.sql') ?: [] as $file) {
            copy($file, $home . '/migrations/' . basename($file));
        }

        return $home;
    }

    /** Suppression bornée aux dossiers temporaires de ce test (fichiers connus, sans récursion aveugle). */
    private function removeTree(string $dir): void
    {
        if (!str_starts_with($dir, sys_get_temp_dir() . '/cuvylo-install-')) {
            return;
        }
        @chmod($dir, 0755);
        foreach (['var/log', 'var', 'migrations', ''] as $sub) {
            $path = $sub === '' ? $dir : $dir . '/' . $sub;
            if (!is_dir($path)) {
                continue;
            }
            foreach (scandir($path) ?: [] as $name) {
                if (is_file($path . '/' . $name)) {
                    unlink($path . '/' . $name);
                }
            }
            rmdir($path);
        }
    }

    private function installer(string $home, ?string $dbFile = null, ?FakeClock $clock = null): InstallKernel
    {
        $dbFile ??= $home . '/cuvylo.sqlite';

        return new InstallKernel($home, $clock ?? new FakeClock(time()), static fn (string $host, string $name): string => 'sqlite:' . $dbFile);
    }

    /** @param array<string, string> $headers */
    private static function send(InstallKernel $kernel, string $method, string $path, mixed $body = null, array $headers = []): Response
    {
        $headers += ['host' => self::HOST, 'origin' => 'https://' . self::HOST, 'sec-fetch-site' => 'same-origin'];
        $raw = '';
        if ($body !== null) {
            $raw = Json::encode($body);
            $headers['content-type'] = 'application/json';
        }

        return $kernel->handle(new Request($method, $path, $headers, [], $raw, '10.9.8.7'));
    }

    /** @return array<string, mixed> */
    private static function form(array $override = []): array
    {
        return array_replace_recursive([
            'appUrl' => 'https://' . self::HOST,
            'database' => ['host' => 'sql.example.test', 'name' => 'cuvylo', 'user' => 'cuvylo', 'password' => 'mot "de" passe # base'],
            'admin' => ['email' => 'Proprio@Example.test', 'password' => self::PASSWORD, 'displayName' => 'Propriétaire'],
            'legal' => ['publisher' => '', 'contactEmail' => 'contact@example.test', 'host' => 'Hébergeur Exemple, 1 rue Test, 00000 Ville'],
        ], $override);
    }

    public function testBeforeInstallationOnlyTheWizardAnswers(): void
    {
        $home = $this->home();
        $this->assertTrue(InstallKernel::needed($home));
        $kernel = $this->installer($home);

        $this->assertSame(['needed' => true, 'configured' => false, 'installer' => true], self::send($kernel, 'GET', '/api/setup')->data());
        $me = self::send($kernel, 'GET', '/api/auth/me');
        $this->assertSame(503, $me->status);
        $this->assertSame('not_installed', $me->data()['error']['code']);
        $this->assertSame('nosniff', $me->header('X-Content-Type-Options'), 'mêmes en-têtes de sécurité que l\'API');

        $checks = array_column(self::send($kernel, 'GET', '/api/install')->data()['checks'], null, 'id');
        $this->assertSame(['php', 'pdo_mysql', 'mbstring', 'openssl', 'ctype', 'json', 'writable'], array_keys($checks));
        $this->assertTrue($checks['php']['ok']);
        $this->assertSame(PHP_VERSION, $checks['php']['detail']);
        $this->assertTrue($checks['writable']['ok']);
    }

    public function testInstallWritesConfigCreatesAdminAndHandsOverToTheApplication(): void
    {
        $home = $this->home();
        $kernel = $this->installer($home);

        $this->assertSame(204, self::send($kernel, 'POST', '/api/install/database', ['database' => self::form()['database']])->status);
        $response = self::send($kernel, 'POST', '/api/install', self::form());
        $this->assertSame(201, $response->status, $response->body());
        $this->assertSame(['written' => true, 'existingAccounts' => false], $response->data(), 'le contenu de .env ne repart pas vers le navigateur');

        $this->assertFalse(InstallKernel::needed($home), 'installation terminée : le noyau habituel prend le relais');
        $this->assertSame('0600', substr(sprintf('%o', fileperms($home . '/.env')), -4));
        $this->assertSame("Require all denied\n", file_get_contents($home . '/.htaccess'));
        $env = EnvFile::load($home . '/.env');
        $this->assertSame('production', $env['APP_ENV']);
        $this->assertSame('https://' . self::HOST, $env['APP_URL']);
        $this->assertSame(32, strlen((string) base64_decode($env['APP_KEY'], true)), 'clé générée par l\'assistant');
        $this->assertSame('mot "de" passe # base', $env['DB_PASSWORD'], 'guillemets et # relus à l\'identique');
        $this->assertSame('false', $env['REGISTRATION_ENABLED']);
        $this->assertSame('contact@example.test', $env['LEGAL_CONTACT_EMAIL']);
        $this->assertArrayNotHasKey('LEGAL_PUBLISHER', $env, 'champ vide : particulier anonyme');
        $this->assertArrayNotHasKey('SETUP_CODE', $env);
        $this->assertDirectoryExists($home . '/var/log');

        // Le noyau habituel démarre avec ce fichier, et le compte créé est administrateur.
        $config = Config::fromEnv($env, $home);
        $app = new Kernel($config, Connection::open($config->dbDsn, $config->dbUser, $config->dbPassword), Logger::null(), new FakeClock(time()));
        $client = new ApiClient($app, $config->origin(), null, new Cookies($config));
        $login = $client->post('/api/auth/login', ['email' => 'proprio@example.test', 'password' => self::PASSWORD]);
        $this->assertSame(200, $login->status, $login->body());
        $this->assertTrue($login->data()['user']['isAdmin']);
        $this->assertSame('Propriétaire', $login->data()['user']['displayName']);
        $this->assertSame(200, $client->get('/api/profile')->status, 'profil créé');
        $this->assertSame(['needed' => false, 'configured' => false], $client->get('/api/setup')->data());

        $again = self::send($kernel, 'POST', '/api/install', self::form());
        $this->assertSame(409, $again->status);
        $this->assertSame('already_installed', $again->data()['error']['code']);
    }

    public function testDatabaseFailuresAreExplainedWithoutDriverMessages(): void
    {
        $home = $this->home();
        $kernel = $this->installer($home, $home . '/dossier-absent/base.sqlite');
        $response = self::send($kernel, 'POST', '/api/install/database', ['database' => self::form()['database']]);
        $this->assertSame(422, $response->status);
        $this->assertSame(['database' => 'connection_failed'], $response->data()['error']['fields']);
        $this->assertStringNotContainsString('dossier-absent', $response->body());

        $error = static fn (string $message): string => InstallKernel::databaseError(new PDOException($message));
        $this->assertSame('access_denied', $error("SQLSTATE[HY000] [1045] Access denied for user 'x'@'h' (using password: YES)"));
        $this->assertSame('unknown_database', $error("SQLSTATE[HY000] [1049] Unknown database 'x'"));
        $this->assertSame('host_unreachable', $error('SQLSTATE[HY000] [2002] php_network_getaddresses: getaddrinfo failed'));
        $this->assertSame('driver_missing', $error('could not find driver'));
    }

    public function testInvalidInputIsRejectedAndNothingIsWritten(): void
    {
        $home = $this->home();
        $kernel = $this->installer($home);
        $response = self::send($kernel, 'POST', '/api/install', self::form([
            'appUrl' => 'http://cv.example.fr',
            'database' => ['host' => 'serveur;dbname=autre', 'name' => 'base; DROP'],
            'admin' => ['email' => 'pas-une-adresse', 'password' => 'court'],
            'legal' => ['contactEmail' => 'non'],
        ]));
        $this->assertSame(422, $response->status);
        $this->assertSame([
            'appUrl' => 'https_required',
            'database.host' => 'invalid_host',
            'database.name' => 'invalid_name',
            'admin.email' => 'invalid_email',
            'admin.password' => 'too_short',
            'legal.contactEmail' => 'invalid_email',
        ], $response->data()['error']['fields']);
        $this->assertFileDoesNotExist($home . '/.env');
        $this->assertFileDoesNotExist($home . '/cuvylo.sqlite');

        $local = self::send($kernel, 'POST', '/api/install', self::form(['appUrl' => 'http://localhost:5173']));
        $this->assertSame(201, $local->status, 'http accepté sur un poste local');
        $this->assertSame('development', EnvFile::load($home . '/.env')['APP_ENV']);
    }

    public function testCrossSiteWritesAreRefused(): void
    {
        $home = $this->home();
        $kernel = $this->installer($home);
        $this->assertSame(403, self::send($kernel, 'POST', '/api/install', self::form(), ['origin' => 'https://attaquant.example'])->status);
        $this->assertSame(403, self::send($kernel, 'POST', '/api/install', self::form(), ['sec-fetch-site' => 'cross-site'])->status);
        $this->assertFileDoesNotExist($home . '/.env');
    }

    public function testExistingDatabaseIsReconnectedWithoutCreatingAnotherAccount(): void
    {
        $home = $this->home();
        $db = $this->tempDir() . '/base.sqlite';
        $this->assertSame(201, self::send($this->installer($home, $db), 'POST', '/api/install', self::form())->status);

        // Fichier .env perdu : l'assistant revient et reconnecte la base sans toucher aux comptes.
        unlink($home . '/.env');
        $response = self::send($this->installer($home, $db), 'POST', '/api/install', self::form(['admin' => ['email' => 'autre@example.test']]));
        $this->assertSame(201, $response->status, $response->body());
        $this->assertTrue($response->data()['existingAccounts']);
        $users = Connection::open('sqlite:' . $db)->query('SELECT email FROM users')->fetchAll();
        $this->assertSame([['email' => 'proprio@example.test']], $users);
    }

    public function testConfigIsHandedToThePersonWhenTheFolderIsReadOnly(): void
    {
        $home = $this->home();
        $db = $this->tempDir() . '/base.sqlite';
        chmod($home, 0555);
        if (is_writable($home)) {
            $this->markTestSkipped('Droits non appliqués (exécution en root).');
        }
        $response = self::send($this->installer($home, $db), 'POST', '/api/install', self::form());
        chmod($home, 0755);
        $this->assertSame(200, $response->status, $response->body());
        $this->assertFalse($response->data()['written']);
        $env = EnvFile::parse($response->data()['envFile']);
        $this->assertSame('https://' . self::HOST, $env['APP_URL']);
        $this->assertSame('', $env['LOG_PATH'], 'var/ impossible à créer : journal de PHP');
        $this->assertFileDoesNotExist($home . '/.env');
    }

    public function testAttemptsAreLimited(): void
    {
        $home = $this->home();
        $kernel = $this->installer($home, $home . '/dossier-absent/base.sqlite');
        $statuses = [];
        for ($i = 0; $i <= InstallKernel::ATTEMPTS_PER_HOUR; $i++) {
            $statuses[] = self::send($kernel, 'POST', '/api/install/database', ['database' => self::form()['database']])->status;
        }
        $this->assertSame(array_fill(0, InstallKernel::ATTEMPTS_PER_HOUR, 422), array_slice($statuses, 0, -1));
        $this->assertSame(429, end($statuses));
    }

    public function testEnvFileRenderingRoundTrips(): void
    {
        $values = ['A' => 'simple', 'B' => 'avec "guillemets"', 'C' => "fin d'apostrophe'", 'D' => 'dièse # et $DOLLAR', 'E' => '', 'F' => ' espaces '];
        $this->assertSame($values, EnvFile::parse(EnvFile::render($values, ['commentaire'])));
        $this->expectException(\InvalidArgumentException::class);
        EnvFile::render(['A' => "deux\nlignes"]);
    }

    public function testMysqlDsnIsBuiltFromHostAndPort(): void
    {
        $this->assertSame('mysql:host=sql.example.test;dbname=base;charset=utf8mb4', InstallKernel::mysqlDsn('sql.example.test', 'base'));
        $this->assertSame('mysql:host=127.0.0.1;port=3307;dbname=base;charset=utf8mb4', InstallKernel::mysqlDsn('127.0.0.1:3307', 'base'));
    }
}
