<?php

declare(strict_types=1);

namespace Cuvylo\Install;

use Closure;
use Cuvylo\Auth\LoginHasher;
use Cuvylo\Config;
use Cuvylo\Controller\AuthController;
use Cuvylo\Database\AutoMigrator;
use Cuvylo\Database\Connection;
use Cuvylo\Domain\EmptyProfile;
use Cuvylo\EnvFile;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Kernel;
use Cuvylo\Repository\ProfileRepository;
use Cuvylo\Repository\UserRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Logger;
use Cuvylo\Support\Ulid;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\ValidationException;
use PDO;
use PDOException;
use RuntimeException;
use Throwable;

/**
 * Assistant d'installation, à la manière de WordPress : tant que `CUVYLO_HOME/.env` n'existe pas (et qu'aucune
 * configuration ne vient des variables d'environnement), l'API ne sert que ces routes. L'assistant vérifie
 * l'hébergement, teste la base, crée les tables et le compte administrateur, puis écrit lui-même `.env`
 * (clé applicative générée ici). Dès que le fichier existe, c'est le noyau habituel qui répond.
 *
 * Risque assumé, comme pour WordPress : entre l'envoi des fichiers et l'installation, la première personne qui
 * ouvre le site peut l'installer (sur une base dont elle connaît les accès). Les tentatives sont limitées, les
 * écritures exigent la même origine, et l'écran disparaît dès l'installation faite.
 */
final class InstallKernel
{
    public const MIN_PHP = '8.1.0';
    /** Extensions PHP dont l'application a besoin. */
    public const EXTENSIONS = ['pdo_mysql', 'mbstring', 'openssl', 'ctype', 'json'];
    /** Tests de connexion et installations acceptés par heure, toutes adresses confondues. */
    public const ATTEMPTS_PER_HOUR = 30;
    /** Délai de connexion à la base : une adresse de serveur erronée doit répondre vite. */
    public const DB_TIMEOUT_SECONDS = 8;

    /**
     * @param Closure(string, string): string|null $dsnFor DSN de la base décrite (hôte, nom) ; MySQL par défaut,
     *                                                     SQLite dans les tests.
     */
    public function __construct(
        private readonly string $home,
        private readonly Clock $clock = new Clock(),
        private readonly ?Closure $dsnFor = null,
    ) {
    }

    /** Mode installation : aucun fichier `.env` et aucune base fournie par les variables d'environnement. */
    public static function needed(string $home): bool
    {
        $dsn = getenv('DB_DSN');

        return !is_file($home . '/.env') && ($dsn === false || $dsn === '');
    }

    public function handle(Request $request): Response
    {
        try {
            $response = match ($request->method() . ' ' . $request->path()) {
                // L'écran de connexion interroge cette route : elle le renvoie vers l'assistant.
                'GET /api/setup' => Response::json(['needed' => true, 'configured' => false, 'installer' => true]),
                'GET /api/install' => $this->status(),
                'POST /api/install/database' => $this->testDatabase($request),
                'POST /api/install' => $this->install($request),
                default => throw new HttpException(503, 'not_installed', 'Cuvylo n\'est pas encore installé : ouvrez la page /installation du site.'),
            };
        } catch (HttpException $e) {
            $response = Response::error($e->status, $e->errorCode, $e->getMessage(), $e->fields, $e->headers, $e->extra);
        } catch (Throwable $e) {
            error_log('cuvylo install failure: ' . get_class($e) . ' ' . basename($e->getFile()) . ':' . $e->getLine());
            $response = Response::error(500, 'server_error', 'Erreur interne pendant l\'installation.');
        }

        return Kernel::secure($response);
    }

    /** Vérifications de l'hébergement, affichées en première étape. */
    private function status(): Response
    {
        $checks = [['id' => 'php', 'ok' => version_compare(PHP_VERSION, self::MIN_PHP, '>='), 'detail' => PHP_VERSION]];
        foreach (self::EXTENSIONS as $extension) {
            $checks[] = ['id' => $extension, 'ok' => extension_loaded($extension)];
        }
        $checks[] = ['id' => 'writable', 'ok' => is_writable($this->home)];

        return Response::json(['checks' => $checks]);
    }

    private function testDatabase(Request $request): Response
    {
        $this->assertSameSite($request);
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['database']) ?? [];
        $db = $this->databaseInput($f, $body['database'] ?? null);
        $f->assertOk();
        /** @var array{host: string, name: string, user: string, password: string} $db */
        $this->throttle();
        $this->connect($this->dsn($db), $db);

        return Response::noContent();
    }

    private function install(Request $request): Response
    {
        $this->assertSameSite($request);
        if (is_file($this->envPath())) {
            throw new HttpException(409, 'already_installed', 'Cuvylo est déjà installé : rechargez la page.');
        }

        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['appUrl', 'database', 'admin'], ['legal', 'mail']) ?? [];
        $app = $this->appUrl($f, $body['appUrl'] ?? null);
        $db = $this->databaseInput($f, $body['database'] ?? null);
        $admin = $this->adminInput($f, $body['admin'] ?? null);
        $legal = isset($body['legal']) ? $this->legalInput($f, $body['legal']) : [];
        $mail = isset($body['mail']) ? $this->mailInput($f, $body['mail']) : [];
        $f->assertOk();
        /** @var array{0: string, 1: string} $app */
        /** @var array{host: string, name: string, user: string, password: string} $db */
        /** @var array{email: string, password: string, displayName: ?string} $admin */

        $this->throttle();
        $dsn = $this->dsn($db);
        $logPath = $this->ensureVar('log') ? $this->home . '/var/log/cuvylo-{month}.log' : '';
        $env = [
            'APP_ENV' => $app[1],
            'APP_URL' => $app[0],
            'APP_KEY' => base64_encode(random_bytes(32)),
            'DB_DSN' => $dsn,
            'DB_USER' => $db['user'],
            'DB_PASSWORD' => $db['password'],
            'REGISTRATION_ENABLED' => 'false',
            'LOG_PATH' => $logPath,
        ] + $legal + $mail;
        try {
            Config::fromEnv($env, $this->home);
        } catch (RuntimeException $e) {
            // Messages rédigés par Config : ils nomment le réglage fautif, jamais sa valeur.
            throw new HttpException(422, 'invalid_config', $e->getMessage());
        }

        $pdo = $this->connect($dsn, $db);
        if (!AutoMigrator::ensure($pdo, $this->home, Logger::toFile($logPath === '' ? null : $logPath), $dsn)) {
            throw new HttpException(500, 'migration_failed', 'Les tables n\'ont pas pu être créées : vérifiez que cet utilisateur a tous les droits sur la base.');
        }

        // Base déjà installée (fichier .env perdu ou réinstallation) : on la reconnecte sans créer de compte.
        $users = new UserRepository($pdo);
        $existing = $users->count() > 0;
        if (!$existing) {
            $this->createAdmin($pdo, $users, $admin);
        }

        $content = EnvFile::render($env, [
            'Configuration de Cuvylo, écrite par l\'assistant d\'installation le ' . gmdate('Y-m-d H:i', $this->clock->now()) . ' UTC.',
            'Elle contient les accès à la base et la clé de l\'application : ne la partagez pas, gardez-en une copie hors ligne.',
            'Les autres réglages possibles sont décrits dans env.example.',
        ]);
        $written = $this->writeEnv($content);

        return Response::json(
            ['written' => $written, 'existingAccounts' => $existing] + ($written ? [] : ['envFile' => $content]),
            $written ? 201 : 200,
        );
    }

    /** @param array{email: string, password: string, displayName: ?string} $admin */
    private function createAdmin(PDO $pdo, UserRepository $users, array $admin): void
    {
        $now = $this->clock->now();
        $userId = Ulid::generate($now);
        $pdo->beginTransaction();
        try {
            // Revérifié dans la transaction : deux installations simultanées ne créent pas deux administrateurs.
            if ($users->count() > 0) {
                throw new HttpException(409, 'already_installed', 'Cuvylo est déjà installé : rechargez la page.');
            }
            $users->insert($userId, $admin['email'], (new LoginHasher())->hash($admin['password']), $admin['displayName'], $this->clock->sql($now), true);
            (new ProfileRepository($pdo))->save($userId, EmptyProfile::create($admin['email']), $this->clock->sql($now));
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Création exclusive (`x`) : jamais d'écrasement d'une configuration existante. Droits 0600 : seul le compte
     * qui exécute PHP (celui qui a créé le fichier) le lit. Faux si le dossier n'est pas inscriptible.
     */
    private function writeEnv(string $content): bool
    {
        $path = $this->envPath();
        $handle = @fopen($path, 'x');
        if ($handle === false) {
            if (is_file($path)) {
                throw new HttpException(409, 'already_installed', 'Cuvylo est déjà installé : rechargez la page.');
            }

            return false;
        }
        @chmod($path, 0600);
        $ok = fwrite($handle, $content) === strlen($content);
        fclose($handle);
        if (!$ok) {
            @unlink($path);

            return false;
        }
        // Repli « tout sous www/ » : le dossier de l'application ne doit jamais être servi.
        if (!is_file($this->home . '/.htaccess')) {
            @file_put_contents($this->home . '/.htaccess', "Require all denied\n");
        }

        return true;
    }

    /**
     * Écritures : même origine uniquement. Le corps JSON impose déjà une requête préliminaire CORS (refusée),
     * ceci ferme les cas restants (navigateurs anciens, en-têtes Fetch Metadata).
     */
    private function assertSameSite(Request $request): void
    {
        if ($request->header('sec-fetch-site') === 'cross-site') {
            throw new HttpException(403, 'forbidden', 'Requête inter-sites refusée.');
        }
        $origin = $request->header('origin');
        if ($origin === null || $origin === '') {
            return;
        }
        $parts = parse_url($origin);
        $originHost = ($parts['host'] ?? '') . (isset($parts['port']) ? ':' . $parts['port'] : '');
        if (strcasecmp($originHost, (string) $request->header('host')) !== 0) {
            throw new HttpException(403, 'forbidden', 'Origine refusée.');
        }
    }

    /** Limite globale, gardée dans var/ (pas encore de base) : l'assistant ne sert pas à deviner des mots de passe. */
    private function throttle(): void
    {
        if (!$this->ensureVar()) {
            return;
        }
        $file = $this->home . '/var/install-attempts';
        $now = $this->clock->now();
        $recent = [];
        foreach (explode("\n", is_file($file) ? (string) @file_get_contents($file) : '') as $line) {
            if (ctype_digit($line) && (int) $line > $now - 3600) {
                $recent[] = (int) $line;
            }
        }
        if (count($recent) >= self::ATTEMPTS_PER_HOUR) {
            throw HttpException::rateLimited(max(60, min($recent) + 3600 - $now), 'Trop de tentatives. Réessayez dans une heure.');
        }
        $recent[] = $now;
        @file_put_contents($file, implode("\n", $recent), LOCK_EX);
    }

    /** Crée `var/` (et un sous-dossier) protégé par un .htaccess, comme le fait la migration automatique. */
    private function ensureVar(string $sub = ''): bool
    {
        $var = $this->home . '/var';
        if (!is_dir($var)) {
            if (!@mkdir($var, 0750, true) && !is_dir($var)) {
                return false;
            }
            @file_put_contents($var . '/.htaccess', "Require all denied\n");
        }
        $dir = $sub === '' ? $var : $var . '/' . $sub;

        return is_dir($dir) || @mkdir($dir, 0750, true) || is_dir($dir);
    }

    /** @param array{host: string, name: string, user: string, password: string} $db */
    private function dsn(array $db): string
    {
        return $this->dsnFor !== null ? ($this->dsnFor)($db['host'], $db['name']) : self::mysqlDsn($db['host'], $db['name']);
    }

    /** Hôte (`serveur` ou `serveur:port`) et nom déjà validés : ni `;` ni `=` ne peuvent s'y glisser. */
    public static function mysqlDsn(string $host, string $name): string
    {
        [$hostname, $port] = array_pad(explode(':', $host, 2), 2, null);

        return 'mysql:host=' . $hostname . ($port !== null ? ';port=' . $port : '') . ';dbname=' . $name . ';charset=utf8mb4';
    }

    /** @param array{host: string, name: string, user: string, password: string} $db */
    private function connect(string $dsn, array $db): PDO
    {
        try {
            return Connection::open($dsn, $db['user'], $db['password'], self::DB_TIMEOUT_SECONDS);
        } catch (PDOException $e) {
            throw new ValidationException(['database' => self::databaseError($e)]);
        }
    }

    /** Cause d'un échec de connexion. Jamais le message du pilote : il peut citer l'utilisateur ou l'hôte. */
    public static function databaseError(PDOException $e): string
    {
        $message = $e->getMessage();
        $code = preg_match('/\[(\d{4})\]/', $message, $m) === 1 ? (int) $m[1] : (int) $e->getCode();

        return match (true) {
            str_contains($message, 'could not find driver') => 'driver_missing',
            in_array($code, [1044, 1045, 1698], true) => 'access_denied',
            $code === 1049 => 'unknown_database',
            in_array($code, [2002, 2003, 2005, 2006], true) => 'host_unreachable',
            default => 'connection_failed',
        };
    }

    /** @return array{0: string, 1: string}|null [APP_URL, APP_ENV] — https obligatoire, sauf sur un poste local. */
    private function appUrl(Fields $f, mixed $value): ?array
    {
        $url = $f->string(is_string($value) ? rtrim(trim($value), '/') : $value, 'appUrl', 200, false, 1);
        if ($url === null) {
            return null;
        }
        $parts = parse_url($url);
        if ($parts === false || !isset($parts['scheme'], $parts['host']) || isset($parts['path']) || isset($parts['query'])
            || isset($parts['fragment']) || isset($parts['user']) || !in_array($parts['scheme'], ['http', 'https'], true)) {
            $f->error('appUrl', 'invalid_url');

            return null;
        }
        if ($parts['scheme'] === 'https') {
            return [$url, 'production'];
        }
        $host = $parts['host'];
        $local = in_array($host, ['localhost', '127.0.0.1', '[::1]'], true) || str_ends_with($host, '.localhost') || str_ends_with($host, '.test');
        if (!$local) {
            $f->error('appUrl', 'https_required');

            return null;
        }

        return [$url, 'development'];
    }

    /** @return array{host: string, name: string, user: string, password: string}|null */
    private function databaseInput(Fields $f, mixed $value): ?array
    {
        $db = $f->assoc($value, 'database', ['host', 'name', 'user', 'password']);
        if ($db === null) {
            return null;
        }
        $host = $f->string(self::trimmed($db['host'] ?? null), 'database.host', 255, false, 1);
        if ($host !== null && preg_match('/^[A-Za-z0-9.-]+(:\d{1,5})?$/', $host) !== 1) {
            $f->error('database.host', 'invalid_host');
        }
        $name = $f->string(self::trimmed($db['name'] ?? null), 'database.name', 64, false, 1);
        if ($name !== null && preg_match('/^[A-Za-z0-9_$-]+$/', $name) !== 1) {
            $f->error('database.name', 'invalid_name');
        }
        $user = $f->string(self::trimmed($db['user'] ?? null), 'database.user', 80, false, 1);
        // Mot de passe tel quel (pas de trim : une espace peut en faire partie).
        $password = $f->string($db['password'] ?? null, 'database.password', 200);

        return ($host === null || $name === null || $user === null || $password === null)
            ? null
            : ['host' => $host, 'name' => $name, 'user' => $user, 'password' => $password];
    }

    /** @return array{email: string, password: string, displayName: ?string}|null */
    private function adminInput(Fields $f, mixed $value): ?array
    {
        $admin = $f->assoc($value, 'admin', ['email', 'password'], ['displayName']);
        if ($admin === null) {
            return null;
        }
        $raw = $admin['email'] ?? null;
        $email = $f->email(is_string($raw) ? mb_strtolower(trim($raw)) : $raw, 'admin.email');
        $password = $admin['password'] ?? null;
        $passwordError = match (true) {
            !is_string($password) => 'invalid_type',
            mb_strlen($password) < AuthController::PASSWORD_MIN => 'too_short',
            mb_strlen($password) > AuthController::PASSWORD_MAX => 'too_long',
            default => null,
        };
        if ($passwordError !== null) {
            $f->error('admin.password', $passwordError);
        }
        $displayName = null;
        if (isset($admin['displayName'])) {
            $name = $f->string(self::trimmed($admin['displayName']), 'admin.displayName', 80);
            $displayName = ($name === null || $name === '') ? null : $name;
        }

        return ($email === null || $passwordError !== null || !is_string($password))
            ? null
            : ['email' => $email, 'password' => $password, 'displayName' => $displayName];
    }

    /** @return array<string, string> réglages LEGAL_* renseignés */
    private function legalInput(Fields $f, mixed $value): array
    {
        $legal = $f->assoc($value, 'legal', [], ['publisher', 'contactEmail', 'host']) ?? [];
        $env = [];
        foreach (['publisher' => 'LEGAL_PUBLISHER', 'host' => 'LEGAL_HOST'] as $key => $name) {
            $text = isset($legal[$key]) ? $f->string(self::trimmed($legal[$key]), 'legal.' . $key, 300) : null;
            if ($text !== null && $text !== '') {
                $env[$name] = $text;
            }
        }
        $contact = self::trimmed($legal['contactEmail'] ?? '');
        if ($contact !== '' && $contact !== null) {
            $email = $f->email($contact, 'legal.contactEmail');
            if ($email !== null) {
                $env['LEGAL_CONTACT_EMAIL'] = $email;
            }
        }

        return $env;
    }

    /** @return array<string, string> réglages d'envoi par SMTP (« Mot de passe oublié ») */
    private function mailInput(Fields $f, mixed $value): array
    {
        $mail = $f->assoc($value, 'mail', ['host', 'port', 'secure', 'user', 'password', 'from']);
        if ($mail === null) {
            return [];
        }
        $host = $f->string(self::trimmed($mail['host'] ?? null), 'mail.host', 255, false, 1);
        if ($host !== null && preg_match('/^[A-Za-z0-9.-]+$/', $host) !== 1) {
            $f->error('mail.host', 'invalid_host');
        }
        $port = $f->int($mail['port'] ?? null, 'mail.port', 1, 65535);
        $secure = $f->enum($mail['secure'] ?? null, 'mail.secure', ['ssl', 'starttls']);
        $user = $f->string(self::trimmed($mail['user'] ?? null), 'mail.user', 190, false, 1);
        $password = $f->string($mail['password'] ?? null, 'mail.password', 200, false, 1);
        $from = $f->email(self::trimmed($mail['from'] ?? null), 'mail.from');

        return ($host === null || $port === null || $secure === null || $user === null || $password === null || $from === null)
            ? []
            : [
                'MAIL_TRANSPORT' => 'smtp',
                'MAIL_FROM' => $from,
                'SMTP_HOST' => $host,
                'SMTP_PORT' => (string) $port,
                'SMTP_SECURE' => $secure,
                'SMTP_USER' => $user,
                'SMTP_PASSWORD' => $password,
            ];
    }

    private static function trimmed(mixed $value): mixed
    {
        return is_string($value) ? trim($value) : $value;
    }

    private function envPath(): string
    {
        return $this->home . '/.env';
    }
}
