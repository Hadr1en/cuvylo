<?php

declare(strict_types=1);

namespace Cuvylo\Tests\Support;

use Cuvylo\Auth\Cookies;
use Cuvylo\Config;
use Cuvylo\Database\Connection;
use Cuvylo\Database\Migrator;
use Cuvylo\Domain\ProfileMigrator;
use Cuvylo\Http\Response;
use Cuvylo\Kernel;
use Cuvylo\Mail\Mailer;
use Cuvylo\Support\Json;
use Cuvylo\Support\Logger;
use Cuvylo\Validation\CvSettingsValidator;
use PDO;
use PHPUnit\Framework\TestCase;

/**
 * Base des tests d'API : noyau applicatif en processus, base SQLite en mémoire par défaut.
 * `TEST_DB_DSN` (+ `TEST_DB_USER`, `TEST_DB_PASSWORD`) permet de rejouer la suite sur MySQL : chaque test
 * utilise alors des e-mails et des IP uniques, aucune table n'est vidée.
 */
abstract class ApiTestCase extends TestCase
{
    public const PASSWORD = 'correct horse battery staple';

    protected PDO $pdo;
    protected Config $config;
    protected FakeClock $clock;
    protected Kernel $kernel;
    protected Cookies $cookies;

    /** @var list<string> */
    protected array $logLines = [];

    /** @var array<string, string> */
    protected array $envOverrides = [];

    protected function setUp(): void
    {
        $this->boot();
    }

    /**
     * @param array<string, string> $env
     * @param Mailer|null $mailer envoi d'e-mails simulé (null : celui de la configuration, désactivé par défaut)
     */
    protected function boot(array $env = [], ?string $home = null, ?Mailer $mailer = null): void
    {
        $dsn = getenv('TEST_DB_DSN') ?: 'sqlite::memory:';
        $this->pdo = Connection::open($dsn, getenv('TEST_DB_USER') ?: null, getenv('TEST_DB_PASSWORD') ?: null);
        Migrator::run($this->pdo, dirname(__DIR__, 2) . '/migrations');

        // L'inscription libre est fermée par défaut depuis la v2 : les tests l'ouvrent explicitement.
        $this->config = Config::fromEnv($env + [
            'APP_ENV' => 'testing',
            'APP_URL' => 'https://cv.example.test',
            'APP_KEY' => base64_encode(str_repeat('k', 32)),
            'DB_DSN' => $dsn,
            'REGISTRATION_ENABLED' => 'true',
        ], $home);
        $this->cookies = new Cookies($this->config);
        $this->clock = new FakeClock(time());
        $this->logLines = [];
        $this->kernel = new Kernel(
            $this->config,
            $this->pdo,
            new Logger(function (string $line): void {
                $this->logLines[] = $line;
            }),
            $this->clock,
            $mailer,
        );
    }

    protected function client(?string $ip = null): ApiClient
    {
        return new ApiClient($this->kernel, $this->config->origin(), $ip, $this->cookies);
    }

    protected static function uniqueEmail(string $prefix = 'user'): string
    {
        return $prefix . '-' . bin2hex(random_bytes(6)) . '@example.test';
    }

    /** Crée un compte et renvoie [client connecté, email]. */
    protected function registeredClient(?string $email = null, ?string $ip = null): array
    {
        $email ??= self::uniqueEmail();
        $client = $this->client($ip);
        $response = $client->post('/api/auth/register', ['email' => $email, 'password' => self::PASSWORD]);
        $this->assertSame(201, $response->status, $response->body());

        return [$client, $email];
    }

    /** Fixture v1 brute (`shared/fixtures/sample-profile.json`). @return array<string, mixed> */
    protected static function sampleProfileV1(): array
    {
        return Json::decode((string) file_get_contents(dirname(__DIR__, 3) . '/shared/fixtures/sample-profile.json'));
    }

    /** Fixture v1 migrée en v2 (forme renvoyée par l'API). @return array<string, mixed> */
    protected static function sampleProfile(): array
    {
        return ProfileMigrator::migrate(self::sampleProfileV1());
    }

    /** Fixture v2 (`shared/fixtures/sample-profile-v2.json` : missions, activité parallèle, rubrique libre). @return array<string, mixed> */
    protected static function sampleProfileV2(): array
    {
        return Json::decode((string) file_get_contents(dirname(__DIR__, 3) . '/shared/fixtures/sample-profile-v2.json'));
    }

    /** @return array<string, mixed> */
    protected static function settings(array $override = []): array
    {
        return $override + CvSettingsValidator::defaults();
    }

    /** Crée un CV depuis le profil et renvoie son identifiant. */
    protected function createCv(ApiClient $client, string $title = 'Mon CV'): string
    {
        $response = $client->post('/api/cvs', ['title' => $title]);
        $this->assertSame(201, $response->status, $response->body());

        return $response->data()['cv']['id'];
    }

    /** @return array<string, string> */
    protected static function errorFields(Response $response): array
    {
        return $response->data()['error']['fields'] ?? [];
    }

    protected function userIdOf(string $email): string
    {
        $stmt = $this->pdo->prepare('SELECT id FROM users WHERE email = ?');
        $stmt->execute([$email]);

        return (string) $stmt->fetchColumn();
    }
}
