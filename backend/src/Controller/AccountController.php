<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Auth\Cookies;
use Cuvylo\Auth\LoginHasher;
use Cuvylo\Auth\LoginRateLimiter;
use Cuvylo\Auth\SessionManager;
use Cuvylo\Auth\Totp;
use Cuvylo\Auth\TwoFactor;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Repository\ApplicationRepository;
use Cuvylo\Repository\CvRepository;
use Cuvylo\Repository\LetterRepository;
use Cuvylo\Repository\ProfileRepository;
use Cuvylo\Repository\ResetLinkRepository;
use Cuvylo\Repository\ShareRepository;
use Cuvylo\Repository\UsageRepository;
use Cuvylo\Repository\UserRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\ValidationException;

/**
 * Compte de l'utilisateur : droits RGPD (export complet, effacement), mot de passe, sessions actives,
 * double authentification et espace utilisé.
 */
final class AccountController
{
    public function __construct(
        private readonly UserRepository $users,
        private readonly ProfileRepository $profiles,
        private readonly CvRepository $cvs,
        private readonly LetterRepository $letters,
        private readonly ApplicationRepository $applications,
        private readonly ShareRepository $shares,
        private readonly UsageRepository $usage,
        private readonly ResetLinkRepository $resets,
        private readonly SessionManager $sessions,
        private readonly LoginRateLimiter $limiter,
        private readonly LoginHasher $hasher,
        private readonly TwoFactor $twoFactor,
        private readonly AuthController $auth,
        private readonly Cookies $cookies,
        private readonly Clock $clock,
    ) {
    }

    /** Export complet et lisible (JSON) : compte, profil, CV et versions, lettres, candidatures, métadonnées des partages. */
    public function export(Request $request): Response
    {
        $user = $this->user($request);
        $profile = $this->profiles->find($user['id']);

        $payload = [
            'format' => 'cuvylo-account',
            'version' => 2,
            'exportedAt' => gmdate('Y-m-d\TH:i:s\Z', $this->clock->now()),
            'account' => [
                'email' => $user['email'],
                'displayName' => $user['display_name'],
                'createdAt' => Clock::sqlToIso($user['created_at']),
                'lastLoginAt' => $user['last_login_at'] === null ? null : Clock::sqlToIso($user['last_login_at']),
                'mfaEnabled' => $user['totp_secret'] !== null,
            ],
            'profile' => $profile === null ? null : ['data' => $profile['data'], 'updatedAt' => Clock::sqlToIso($profile['updated_at'])],
            'cvs' => $this->cvs->exportAll($user['id']),
            'letters' => $this->letters->all($user['id'], true),
            'applications' => $this->applications->all($user['id'], true),
            'shares' => $this->shares->metadataFor($user['id']),
        ];

        return Response::json($payload, 200, [
            'Content-Disposition' => 'attachment; filename="cuvylo-export-' . gmdate('Ymd', $this->clock->now()) . '.json"',
        ]);
    }

    /**
     * Suppression définitive du compte. Le mot de passe est redemandé (une session volée ne suffit pas),
     * et les échecs comptent dans la limitation des tentatives de connexion.
     */
    public function delete(Request $request): Response
    {
        $user = $this->user($request);
        $plain = $this->passwordField($request, 'password');
        $this->verifyPassword($request, $user, $plain, 'password');

        $this->users->deleteAccount($user['id']);

        return $this->cookies->clearSession(Response::noContent());
    }

    /** Changement de mot de passe : l'actuel est exigé ; toutes les AUTRES sessions sont révoquées. */
    public function changePassword(Request $request): Response
    {
        $user = $this->user($request);
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['currentPassword', 'newPassword']) ?? [];
        if (array_key_exists('currentPassword', $body) && !is_string($body['currentPassword'])) {
            $f->error('currentPassword', 'invalid_type');
        }
        $new = $this->auth->newPassword($f, $body, 'newPassword');
        $f->assertOk();

        $this->verifyPassword($request, $user, (string) $body['currentPassword'], 'currentPassword');
        $this->users->updateHash($user['id'], $this->hasher->hash((string) $new));
        $this->sessions->revokeOthers($user['id'], $this->session($request)['id_hash']);
        $this->resets->invalidateFor($user['id'], $this->clock->sql());
        $this->users->clearResetRequest($user['id']);
        $this->auth->notifyPasswordChanged($user['email'], $user['id']);

        return Response::noContent();
    }

    public function sessionsList(Request $request): Response
    {
        $user = $this->user($request);

        return Response::json(['sessions' => $this->sessions->listFor($user['id'], $this->session($request)['id_hash'])]);
    }

    public function revokeSession(Request $request, array $params): Response
    {
        $user = $this->user($request);
        $publicId = (string) ($params['id'] ?? '');
        $isCurrent = str_starts_with($this->session($request)['id_hash'], $publicId) && strlen($publicId) === SessionManager::PUBLIC_ID_LENGTH;
        if ($this->sessions->revokeByPublicId($user['id'], $publicId) === 0) {
            throw HttpException::notFound();
        }

        $response = Response::noContent();

        return $isCurrent ? $this->cookies->clearSession($response) : $response;
    }

    public function revokeOtherSessions(Request $request): Response
    {
        $this->sessions->revokeOthers($this->user($request)['id'], $this->session($request)['id_hash']);

        return Response::noContent();
    }

    /** Prépare l'activation : nouveau secret en attente, à confirmer par un code (`totp/enable`). */
    public function totpSetup(Request $request): Response
    {
        $user = $this->user($request);
        $this->assertTwoFactorAvailable();
        if ($user['totp_secret'] !== null) {
            throw HttpException::conflict('La double authentification est déjà active.');
        }
        $pending = $this->twoFactor->newPending();
        $this->users->setTotpPending($user['id'], $pending['sealed']);

        return Response::json(['secret' => $pending['secret'], 'otpauthUri' => Totp::uri($pending['secret'], $user['email'])]);
    }

    public function totpEnable(Request $request): Response
    {
        $user = $this->user($request);
        $this->assertTwoFactorAvailable();
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['code']) ?? [];
        $code = $f->string($body['code'] ?? null, 'code', 20);
        $f->assertOk();

        if ($user['totp_secret'] !== null) {
            throw HttpException::conflict('La double authentification est déjà active.');
        }
        if ($user['totp_pending'] === null) {
            throw new ValidationException(['code' => 'setup_required']);
        }
        $this->limiter->assertNotLimited($user['email'], $request->ip());
        $sealed = $this->twoFactor->verifyTotp($user['totp_pending'], (string) $code);
        if ($sealed === null) {
            $this->limiter->recordFailure($user['email'], $request->ip());
            throw new ValidationException(['code' => 'invalid_code']);
        }

        $recovery = $this->twoFactor->newRecoveryCodes();
        $this->users->enableTotp($user['id'], $sealed, $recovery['stored']);

        return Response::json(['recoveryCodes' => $recovery['codes']]);
    }

    public function totpDisable(Request $request): Response
    {
        $user = $this->user($request);
        $plain = $this->passwordField($request, 'password');
        $this->verifyPassword($request, $user, $plain, 'password');
        $this->users->disableTotp($user['id']);

        return Response::noContent();
    }

    public function usage(Request $request): Response
    {
        $userId = $this->user($request)['id'];
        $counts = $this->usage->counts($userId);

        return Response::json([
            'bytes' => $this->usage->bytes($userId),
            'limitBytes' => $this->usage->limitBytes(),
            'cvs' => $counts['cvs'],
            'versions' => $counts['versions'],
            'letters' => $counts['letters'],
            'applications' => $counts['applications'],
            'shares' => $counts['shares'],
        ]);
    }

    /** @return array<string, mixed> Compte relu en base (hash et état 2FA à jour). */
    private function user(Request $request): array
    {
        $user = $this->users->findById($request->attribute('user')['id']);
        if ($user === null) {
            throw HttpException::unauthenticated();
        }

        return $user;
    }

    /** @return array<string, string> */
    private function session(Request $request): array
    {
        return $request->attribute('session');
    }

    private function passwordField(Request $request, string $key): string
    {
        $f = new Fields();
        $body = $f->assoc($request->json(), '', [$key]) ?? [];
        if (array_key_exists($key, $body) && !is_string($body[$key])) {
            $f->error($key, 'invalid_type');
        }
        $f->assertOk();

        return (string) $body[$key];
    }

    /**
     * Vérifie le mot de passe actuel, avec la limitation des tentatives de connexion.
     * 422 (et non 403) : le client rejoue automatiquement une requête refusée en 403 « forbidden » (CSRF).
     *
     * @param array<string, mixed> $user
     */
    private function verifyPassword(Request $request, array $user, string $plain, string $field): void
    {
        $ip = $request->ip();
        $this->limiter->assertNotLimited($user['email'], $ip);
        if (!$this->hasher->verify($plain, $user['password_hash'])) {
            $this->limiter->recordFailure($user['email'], $ip);
            throw new ValidationException([$field => 'invalid_password']);
        }
    }

    private function assertTwoFactorAvailable(): void
    {
        if (!TwoFactor::available()) {
            throw new HttpException(503, 'unavailable', 'Double authentification indisponible sur ce serveur (extension openssl).');
        }
    }
}
