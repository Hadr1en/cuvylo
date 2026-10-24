<?php

declare(strict_types=1);

namespace Cuvylo;

use Cuvylo\Auth\Cookies;
use Cuvylo\Auth\Csrf;
use Cuvylo\Auth\LoginHasher;
use Cuvylo\Auth\LoginRateLimiter;
use Cuvylo\Auth\MfaToken;
use Cuvylo\Auth\SessionManager;
use Cuvylo\Auth\TwoFactor;
use Cuvylo\Controller\AccountController;
use Cuvylo\Controller\AdminController;
use Cuvylo\Controller\ApplicationController;
use Cuvylo\Controller\AuthController;
use Cuvylo\Controller\CvController;
use Cuvylo\Controller\HealthController;
use Cuvylo\Controller\InstanceController;
use Cuvylo\Controller\LetterController;
use Cuvylo\Controller\ProfileController;
use Cuvylo\Controller\ShareController;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Http\Router;
use Cuvylo\Mail\Mailer;
use Cuvylo\Repository\ApplicationRepository;
use Cuvylo\Repository\CvRepository;
use Cuvylo\Repository\InvitationRepository;
use Cuvylo\Repository\LetterRepository;
use Cuvylo\Repository\ProfileRepository;
use Cuvylo\Repository\ResetLinkRepository;
use Cuvylo\Repository\SettingsRepository;
use Cuvylo\Repository\ShareRepository;
use Cuvylo\Repository\UsageRepository;
use Cuvylo\Repository\UserRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Logger;
use Cuvylo\Validation\ApplicationValidator;
use Cuvylo\Validation\CvSettingsValidator;
use Cuvylo\Validation\LetterValidator;
use Cuvylo\Validation\ProfileValidator;
use PDO;
use Throwable;

/** Point d'entrée applicatif : `handle(Request): Response`. Aucun accès aux superglobales ici (testable en processus). */
final class Kernel
{
    /** Routes servies même en mode maintenance. */
    public const MAINTENANCE_EXEMPT = ['/api/health', '/api/instance'];

    private readonly Router $router;
    private readonly SessionManager $sessions;
    private readonly UserRepository $users;
    private readonly Csrf $csrf;
    private readonly Cookies $cookies;
    /** Configuration .env, complétée des réglages faits dans l'administration (table settings). */
    private readonly Config $config;
    private readonly ShareRepository $shares;

    public function __construct(
        Config $config,
        PDO $pdo,
        private readonly Logger $logger,
        private readonly Clock $clock = new Clock(),
        /** Envoi d'e-mails ; par défaut, celui décrit par la configuration (MAIL_TRANSPORT). */
        ?Mailer $mailer = null,
    ) {
        $settings = new SettingsRepository($pdo);
        $registrationOpen = $settings->get(SettingsRepository::REGISTRATION_OPEN);
        if ($registrationOpen !== null) {
            $config = $config->withRegistrationEnabled($registrationOpen === '1');
        }
        $this->config = $config;
        $mailer ??= Mailer::fromConfig($config->mail, $clock);
        $this->users = new UserRepository($pdo);
        $profiles = new ProfileRepository($pdo);
        $cvs = new CvRepository($pdo);
        $this->shares = $shares = new ShareRepository($pdo);
        $letters = new LetterRepository($pdo);
        $applications = new ApplicationRepository($pdo);
        $invitations = new InvitationRepository($pdo);
        $resets = new ResetLinkRepository($pdo);
        $usage = new UsageRepository($pdo, $config->storageLimitBytes());
        $this->sessions = new SessionManager($pdo, $config, $clock);
        $this->csrf = new Csrf($config);
        $this->cookies = new Cookies($config);
        $limiter = new LoginRateLimiter($pdo, $config, $clock);
        $hasher = new LoginHasher();
        $twoFactor = new TwoFactor($config, $clock);

        $health = new HealthController($config, $this->csrf, $this->cookies, $this->sessions, $clock);
        $auth = new AuthController(
            $config, $pdo, $this->users, $profiles, $this->sessions, $limiter, $hasher, $this->csrf, $this->cookies,
            $invitations, $resets, $twoFactor, new MfaToken($config, $clock), $clock, $mailer, $logger,
        );
        $profile = new ProfileController($profiles, new ProfileValidator(), $usage, $clock);
        $cv = new CvController($cvs, $profiles, new ProfileValidator(), new CvSettingsValidator(), $usage, $clock);
        $share = new ShareController($config, $cvs, $shares, $usage, $clock);
        $application = new ApplicationController($applications, $cvs, new ApplicationValidator(), $usage, $clock);
        $letter = new LetterController($letters, $cvs, new LetterValidator(), $usage, $clock);
        $instance = new InstanceController($config, $this->sessions, $limiter, $clock, $mailer->enabled());
        $account = new AccountController(
            $this->users, $profiles, $cvs, $letters, $applications, $shares, $usage, $resets, $this->sessions,
            $limiter, $hasher, $twoFactor, $auth, $this->cookies, $clock,
        );
        $admin = new AdminController($config, $pdo, $this->users, $usage, $invitations, $resets, $this->sessions, $limiter, $hasher, $logger, $clock, $settings);

        $this->router = new Router();
        $r = $this->router;
        // Public
        $r->add('GET', '/api/health', [$health, 'health'], false);
        $r->add('GET', '/api/csrf', [$health, 'csrf'], false);
        $r->add('GET', '/api/instance', [$instance, 'info'], false);
        $r->add('GET', '/api/security-txt', [$instance, 'securityTxt'], false);
        $r->add('POST', '/api/auth/register', [$auth, 'register'], false);
        $r->add('POST', '/api/auth/login', [$auth, 'login'], false);
        $r->add('POST', '/api/auth/mfa', [$auth, 'mfa'], false);
        $r->add('GET', '/api/auth/invitation/{token}', [$auth, 'invitation'], false);
        $r->add('GET', '/api/auth/reset/{token}', [$auth, 'resetInfo'], false);
        $r->add('POST', '/api/auth/reset', [$auth, 'reset'], false);
        $r->add('POST', '/api/auth/reset-request', [$auth, 'resetRequest'], false);
        $r->add('GET', '/api/setup', [$auth, 'setupInfo'], false);
        $r->add('POST', '/api/setup', [$auth, 'setup'], false);
        $r->add('GET', '/api/public/cv/{slug}', [$share, 'show'], false);
        // Session
        $r->add('POST', '/api/auth/logout', [$auth, 'logout']);
        $r->add('GET', '/api/auth/me', [$auth, 'me']);
        // Compte
        $r->add('GET', '/api/account/export', [$account, 'export']);
        $r->add('DELETE', '/api/account', [$account, 'delete']);
        $r->add('POST', '/api/account/password', [$account, 'changePassword']);
        $r->add('GET', '/api/account/sessions', [$account, 'sessionsList']);
        $r->add('POST', '/api/account/sessions/revoke-others', [$account, 'revokeOtherSessions']);
        $r->add('DELETE', '/api/account/sessions/{id}', [$account, 'revokeSession']);
        $r->add('POST', '/api/account/totp/setup', [$account, 'totpSetup']);
        $r->add('POST', '/api/account/totp/enable', [$account, 'totpEnable']);
        $r->add('POST', '/api/account/totp/disable', [$account, 'totpDisable']);
        $r->add('GET', '/api/account/usage', [$account, 'usage']);
        // Profil et CV
        $r->add('GET', '/api/profile', [$profile, 'show']);
        $r->add('PUT', '/api/profile', [$profile, 'update']);
        $r->add('GET', '/api/cvs', [$cv, 'index']);
        $r->add('POST', '/api/cvs', [$cv, 'create']);
        $r->add('GET', '/api/cvs/{id}', [$cv, 'show']);
        $r->add('PUT', '/api/cvs/{id}', [$cv, 'update']);
        $r->add('DELETE', '/api/cvs/{id}', [$cv, 'destroy']);
        $r->add('GET', '/api/cvs/{id}/versions', [$cv, 'versions']);
        $r->add('POST', '/api/cvs/{id}/versions', [$cv, 'createVersion']);
        $r->add('GET', '/api/cvs/{id}/versions/{vid}', [$cv, 'showVersion']);
        $r->add('POST', '/api/cvs/{id}/versions/{vid}/restore', [$cv, 'restore']);
        // Partage
        $r->add('GET', '/api/cvs/{id}/shares', [$share, 'index']);
        $r->add('POST', '/api/cvs/{id}/shares', [$share, 'create']);
        $r->add('DELETE', '/api/shares/{id}', [$share, 'destroy']);
        // Candidatures et lettres
        $r->add('GET', '/api/applications', [$application, 'index']);
        $r->add('POST', '/api/applications', [$application, 'create']);
        $r->add('GET', '/api/applications/{id}', [$application, 'show']);
        $r->add('PUT', '/api/applications/{id}', [$application, 'update']);
        $r->add('DELETE', '/api/applications/{id}', [$application, 'destroy']);
        $r->add('GET', '/api/letters', [$letter, 'index']);
        $r->add('POST', '/api/letters', [$letter, 'create']);
        $r->add('GET', '/api/letters/{id}', [$letter, 'show']);
        $r->add('PUT', '/api/letters/{id}', [$letter, 'update']);
        $r->add('DELETE', '/api/letters/{id}', [$letter, 'destroy']);
        // Administration (compte d'installation et ADMIN_EMAILS ; 404 pour les autres comptes). Pas de
        // téléchargement de la base : la sauvegarde se fait chez l'hébergeur ou avec bin/backup.php.
        $r->add('GET', '/api/admin/overview', [$admin, 'overview']);
        $r->add('GET', '/api/admin/settings', [$admin, 'settings']);
        $r->add('PUT', '/api/admin/settings', [$admin, 'updateSettings']);
        $r->add('GET', '/api/admin/invitations', [$admin, 'invitations']);
        $r->add('POST', '/api/admin/invitations', [$admin, 'createInvitation']);
        $r->add('DELETE', '/api/admin/invitations/{id}', [$admin, 'deleteInvitation']);
        $r->add('POST', '/api/admin/users/{id}/reset-link', [$admin, 'resetLink']);
        $r->add('POST', '/api/admin/users/{id}/revoke-sessions', [$admin, 'revokeSessions']);
        $r->add('DELETE', '/api/admin/users/{id}', [$admin, 'deleteUser']);
    }

    /** Réponse 503 du mode maintenance (aussi utilisée par l'amorçage, avant toute connexion à la base). */
    public static function maintenanceResponse(): Response
    {
        return self::secure(Response::error(503, 'maintenance', 'Service en maintenance. Réessayez dans quelques minutes.', [], ['Retry-After' => '120']));
    }

    public function handle(Request $request): Response
    {
        $started = microtime(true);
        $requestId = bin2hex(random_bytes(8));
        $refreshedExpiry = null;

        try {
            if ($this->config->maintenance() && !in_array($request->path(), self::MAINTENANCE_EXEMPT, true)) {
                throw new HttpException(503, 'maintenance', 'Service en maintenance. Réessayez dans quelques minutes.', [], ['Retry-After' => '120']);
            }

            $route = $this->router->match($request->method(), $request->path());

            $session = $this->resolveSession($request);
            if ($session !== null) {
                $refreshedExpiry = $this->sessions->touch($session);
                // Partages expirés : contenu effacé dès la première requête authentifiée qui suit l'expiration.
                $this->shares->purgeExpired($this->clock->sql());
            }

            if ($route['auth'] && $request->attribute('user') === null) {
                throw HttpException::unauthenticated();
            }
            if (!in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
                $this->assertSameOrigin($request);
                $this->assertCsrf($request, $route['auth'] ? $session : null);
            }

            $response = ($route['handler'])($request, $route['params']);

            if ($refreshedExpiry !== null && !$response->hasCookie($this->cookies->sessionName())) {
                $this->cookies->setSession($response, (string) $this->cookies->sessionToken($request), $refreshedExpiry);
            }
        } catch (HttpException $e) {
            $response = Response::error($e->status, $e->errorCode, $e->getMessage(), $e->fields, $e->headers, $e->extra);
        } catch (Throwable $e) {
            // Jamais le message : une PDOException peut y inclure des valeurs de requête.
            $this->logger->error('unhandled_exception', [
                'request_id' => $requestId,
                'class' => get_class($e),
                'where' => basename($e->getFile()) . ':' . $e->getLine(),
            ]);
            $response = Response::error(500, 'server_error', 'Erreur interne.');
        }

        $this->logger->info('request', [
            'request_id' => $requestId,
            'method' => $request->method(),
            'path' => self::loggablePath($request->path()),
            'status' => $response->status,
            'ms' => (int) round((microtime(true) - $started) * 1000),
            'user_id' => $request->attribute('user')['id'] ?? null,
        ]);

        return self::secure($response->withHeader('X-Request-Id', $requestId));
    }

    /** Les jetons portés dans le chemin (invitation, réinitialisation, partage) ne sont jamais journalisés. */
    public static function loggablePath(string $path): string
    {
        return (string) preg_replace('#^(/api/(?:auth/invitation|auth/reset|public/cv))/[^/]+$#', '$1/[redacted]', $path);
    }

    /** En-têtes de sécurité de toute réponse de l'API (aussi ceux de l'assistant d'installation). */
    public static function secure(Response $response): Response
    {
        return $response
            ->withHeader('X-Content-Type-Options', 'nosniff')
            ->withHeader('X-Frame-Options', 'DENY')
            ->withHeader('Referrer-Policy', 'no-referrer')
            ->withHeader('Cache-Control', 'no-store')
            ->withHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }

    /** @return array<string, string>|null */
    private function resolveSession(Request $request): ?array
    {
        $token = $this->cookies->sessionToken($request);
        if ($token === null || $token === '') {
            return null;
        }
        $session = $this->sessions->find($token);
        if ($session === null) {
            return null;
        }
        $user = $this->users->findById($session['user_id']);
        if ($user === null) {
            $this->sessions->destroy($token);

            return null;
        }
        $request->setAttribute('session', $session);
        $request->setAttribute('user', $user);

        return $session;
    }

    private function assertSameOrigin(Request $request): void
    {
        $origin = $request->header('origin');
        if ($origin !== null && $origin !== '' && $origin !== $this->config->origin()) {
            throw new HttpException(403, 'forbidden', 'Origine refusée.');
        }
        if ($request->header('sec-fetch-site') === 'cross-site') {
            throw new HttpException(403, 'forbidden', 'Requête inter-sites refusée.');
        }
    }

    /** @param array<string, string>|null $session */
    private function assertCsrf(Request $request, ?array $session): void
    {
        $header = $request->header(Csrf::HEADER);
        $cookie = $this->cookies->csrfToken($request);

        $valid = $header !== null && $header !== '' && $cookie !== null
            && hash_equals($cookie, $header)
            && $this->csrf->isGenuine($cookie)
            && ($session === null || hash_equals($session['csrf_hash'], $this->csrf->hash($header)));

        if (!$valid) {
            throw new HttpException(403, 'forbidden', 'Jeton CSRF invalide ou absent.');
        }
    }
}
