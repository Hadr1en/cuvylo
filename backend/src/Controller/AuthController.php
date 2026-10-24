<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Auth\Cookies;
use Cuvylo\Auth\Csrf;
use Cuvylo\Auth\LoginHasher;
use Cuvylo\Auth\LoginRateLimiter;
use Cuvylo\Auth\MfaToken;
use Cuvylo\Auth\SessionManager;
use Cuvylo\Auth\TwoFactor;
use Cuvylo\Config;
use Cuvylo\Domain\EmptyProfile;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Mail\Emails;
use Cuvylo\Mail\MailException;
use Cuvylo\Mail\Mailer;
use Cuvylo\Mail\NullMailer;
use Cuvylo\Repository\InvitationRepository;
use Cuvylo\Repository\ProfileRepository;
use Cuvylo\Repository\ResetLinkRepository;
use Cuvylo\Repository\UserRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\DeviceLabel;
use Cuvylo\Support\Logger;
use Cuvylo\Support\Token;
use Cuvylo\Support\Ulid;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\ValidationException;
use PDO;
use PDOException;

final class AuthController
{
    public const PASSWORD_MIN = 12;
    public const PASSWORD_MAX = 200;
    /** Lien reçu par e-mail : valable 1 heure (le lien généré par l'administrateur, lui, vaut 24 h). */
    public const EMAIL_RESET_TTL = 3600;
    /** Au plus 3 e-mails de réinitialisation par compte et par heure : pas de bombardement d'une boîte. */
    public const EMAIL_RESETS_PER_HOUR = 3;

    public function __construct(
        private readonly Config $config,
        private readonly PDO $pdo,
        private readonly UserRepository $users,
        private readonly ProfileRepository $profiles,
        private readonly SessionManager $sessions,
        private readonly LoginRateLimiter $limiter,
        private readonly LoginHasher $hasher,
        private readonly Csrf $csrf,
        private readonly Cookies $cookies,
        private readonly InvitationRepository $invitations,
        private readonly ResetLinkRepository $resets,
        private readonly TwoFactor $twoFactor,
        private readonly MfaToken $mfaTokens,
        private readonly Clock $clock,
        private readonly Mailer $mailer = new NullMailer(),
        private readonly ?Logger $logger = null,
    ) {
    }

    /**
     * Inscription : autorisée si l'inscription libre est ouverte (et le code d'invitation global correct s'il est
     * configuré) OU si une invitation nominative valide est fournie (`inviteToken`, consommée à la création).
     */
    public function register(Request $request): Response
    {
        $raw = $request->json();
        $hasInvite = is_array($raw) && array_key_exists('inviteToken', $raw);
        if (!$this->config->registrationEnabled && !$hasInvite) {
            throw new HttpException(403, 'registration_closed', 'Les inscriptions sont fermées.');
        }

        $f = new Fields();
        $body = $f->assoc($raw, '', ['email', 'password'], ['displayName', 'inviteCode', 'inviteToken']) ?? [];

        $rawEmail = $body['email'] ?? null;
        $email = is_string($rawEmail) ? $f->email(mb_strtolower(trim($rawEmail)), 'email') : $f->email($rawEmail, 'email');
        $plain = $this->newPassword($f, $body, 'password');

        $displayName = null;
        if (isset($body['displayName'])) {
            $name = is_string($body['displayName']) ? trim($body['displayName']) : $body['displayName'];
            $name = $f->string($name, 'displayName', 80);
            $displayName = ($name === null || $name === '') ? null : $name;
        }
        foreach (['inviteCode', 'inviteToken'] as $key) {
            if (isset($body[$key]) && !is_string($body[$key])) {
                $f->error($key, 'invalid_type');
            }
        }
        $f->assertOk();

        /** @var string $email */
        /** @var string $plain */
        $ip = $request->ip();
        $retry = $this->limiter->registrationRetryAfter($ip);
        if ($retry !== null) {
            throw HttpException::rateLimited($retry, 'Trop d\'inscriptions depuis cette adresse. Réessayez plus tard.');
        }
        $this->limiter->assertNotLimited($email, $ip);

        $now = $this->clock->now();
        $inviteToken = is_string($body['inviteToken'] ?? null) ? $body['inviteToken'] : null;
        if ($inviteToken !== null) {
            if ($this->invitations->findUsable($inviteToken, $this->clock->sql($now)) === null) {
                $this->limiter->recordFailure($email, $ip);
                throw new HttpException(403, 'registration_closed', 'Invitation invalide, expirée ou déjà utilisée.');
            }
        } elseif ($this->config->registrationInviteCode !== null) {
            $provided = is_string($body['inviteCode'] ?? null) ? $body['inviteCode'] : '';
            if (!hash_equals($this->config->registrationInviteCode, $provided)) {
                $this->limiter->recordFailure($email, $ip);
                throw new HttpException(403, 'registration_closed', 'Inscription refusée.');
            }
        }

        $this->limiter->recordRegistration($email, $ip);
        if ($this->users->findByEmail($email) !== null) {
            throw new ValidationException(['email' => 'already_registered']);
        }

        $userId = Ulid::generate($now);
        $hash = $this->hasher->hash($plain);
        try {
            $this->pdo->beginTransaction();
            $this->users->insert($userId, $email, $hash, $displayName, $this->clock->sql($now));
            $this->profiles->save($userId, EmptyProfile::create($email), $this->clock->sql($now));
            if ($inviteToken !== null && !$this->invitations->consume($inviteToken, $userId, $this->clock->sql($now))) {
                $this->pdo->rollBack();
                throw new HttpException(403, 'registration_closed', 'Invitation invalide, expirée ou déjà utilisée.');
            }
            $this->users->touchLogin($userId, $this->clock->sql($now));
            $this->pdo->commit();
        } catch (PDOException $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if ($e->getCode() === '23000') {
                throw new ValidationException(['email' => 'already_registered']);
            }
            throw $e;
        }

        $user = $this->users->findById($userId);

        return $this->startSession($request, $user ?? [], 201);
    }

    /**
     * État de l'installation : `needed` tant qu'aucun compte n'existe, `configured` si SETUP_CODE est défini.
     * Ne révèle rien d'autre (et rien du tout une fois l'instance installée, `needed` valant alors false).
     */
    public function setupInfo(Request $request): Response
    {
        $needed = $this->users->count() === 0;

        return Response::json(['needed' => $needed, 'configured' => $needed && $this->config->setupCode !== null]);
    }

    /**
     * Installation : création du PREMIER compte, qui devient administrateur. Possible uniquement tant que la base
     * ne contient aucun compte, et avec le code SETUP_CODE du fichier .env (un inconnu qui découvre l'instance
     * avant son propriétaire ne peut donc pas s'en emparer). Tentatives erronées limitées par adresse IP.
     */
    public function setup(Request $request): Response
    {
        if ($this->users->count() > 0) {
            throw new HttpException(403, 'setup_closed', 'L\'installation est déjà faite.');
        }
        if ($this->config->setupCode === null) {
            throw new HttpException(403, 'setup_not_configured', 'Définissez SETUP_CODE dans le fichier .env pour installer l\'instance.');
        }

        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['setupCode', 'email', 'password'], ['displayName']) ?? [];
        $rawEmail = $body['email'] ?? null;
        $email = is_string($rawEmail) ? $f->email(mb_strtolower(trim($rawEmail)), 'email') : $f->email($rawEmail, 'email');
        $plain = $this->newPassword($f, $body, 'password');
        $code = is_string($body['setupCode'] ?? null) ? trim($body['setupCode']) : null;
        if ($code === null) {
            $f->error('setupCode', 'invalid_type');
        }
        $displayName = null;
        if (isset($body['displayName'])) {
            $name = is_string($body['displayName']) ? trim($body['displayName']) : $body['displayName'];
            $name = $f->string($name, 'displayName', 80);
            $displayName = ($name === null || $name === '') ? null : $name;
        }
        $f->assertOk();

        /** @var string $email */
        /** @var string $plain */
        $ip = $request->ip();
        $this->limiter->assertNotLimited('setup', $ip);
        if (!hash_equals($this->config->setupCode, (string) $code)) {
            $this->limiter->recordFailure('setup', $ip);
            throw new ValidationException(['setupCode' => 'invalid_code']);
        }

        $now = $this->clock->now();
        $userId = Ulid::generate($now);
        $this->pdo->beginTransaction();
        try {
            // Revérifié dans la transaction : deux installations simultanées ne créent pas deux administrateurs.
            if ($this->users->count() > 0) {
                throw new HttpException(403, 'setup_closed', 'L\'installation est déjà faite.');
            }
            $this->users->insert($userId, $email, $this->hasher->hash($plain), $displayName, $this->clock->sql($now), true);
            $this->profiles->save($userId, EmptyProfile::create($email), $this->clock->sql($now));
            $this->users->touchLogin($userId, $this->clock->sql($now));
            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return $this->startSession($request, $this->users->findById($userId) ?? [], 201);
    }

    /**
     * « Mot de passe oublié ». Parcours classique si l'envoi d'e-mails est configuré : un lien (1 h, usage unique)
     * part directement à l'adresse du compte, sans que l'administrateur le voie. Sinon (ou si l'envoi échoue), la
     * demande est enregistrée et l'administrateur peut transmettre un lien. Réponse identique que le compte
     * existe ou non ; limitée par IP, et à 3 e-mails par heure et par compte.
     */
    public function resetRequest(Request $request): Response
    {
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['email']) ?? [];
        $rawEmail = $body['email'] ?? null;
        $email = is_string($rawEmail) ? $f->email(mb_strtolower(trim($rawEmail)), 'email') : $f->email($rawEmail, 'email');
        $f->assertOk();

        // Compteur par IP des actions anonymes (le même que les inscriptions) : pas celui des échecs de connexion,
        // pour qu'un tiers ne puisse pas bloquer la connexion d'autrui en multipliant les demandes.
        $ip = $request->ip();
        $retry = $this->limiter->registrationRetryAfter($ip);
        if ($retry !== null) {
            throw HttpException::rateLimited($retry, 'Trop de demandes depuis cette adresse. Réessayez plus tard.');
        }
        $this->limiter->recordRegistration((string) $email, $ip);

        $user = $this->users->findByEmail((string) $email);
        if ($user === null) {
            return Response::noContent();
        }
        if (!$this->mailer->enabled() || !$this->sendResetLink($user)) {
            $this->users->requestReset($user['id'], $this->clock->sql());
        }

        return Response::noContent();
    }

    /**
     * Envoie un lien de réinitialisation par e-mail. Faux si l'envoi a échoué (la demande bascule alors vers
     * l'administrateur). Le jeton n'est jamais journalisé.
     *
     * @param array<string, mixed> $user
     */
    private function sendResetLink(array $user): bool
    {
        $now = $this->clock->now();
        if ($this->resets->countSince($user['id'], $this->clock->sql($now - 3600)) >= self::EMAIL_RESETS_PER_HOUR) {
            return true; // limite atteinte : on n'envoie rien de plus, sans le signaler (pas d'énumération).
        }
        $token = Token::generate();
        $this->resets->create($token, $user['id'], $this->clock->sql($now), $this->clock->sql($now + self::EMAIL_RESET_TTL));
        try {
            $this->mailer->send(Emails::passwordResetLink(
                $user['email'],
                $this->config->appUrl . '/reinitialisation/' . $token,
                intdiv(self::EMAIL_RESET_TTL, 60),
                $this->config->appUrl,
            ));
            $this->logger?->info('password_reset_mail_sent', ['user_id' => $user['id']]);

            return true;
        } catch (MailException $e) {
            $this->resets->invalidateFor($user['id'], $this->clock->sql($now));
            $this->logger?->warning('mail_failed', ['purpose' => 'password_reset', 'user_id' => $user['id'], 'reason' => $e->getMessage()]);

            return false;
        }
    }

    /** E-mail « votre mot de passe a été modifié » (si l'envoi est configuré) ; un échec n'empêche rien. */
    public function notifyPasswordChanged(string $email, string $userId): void
    {
        if (!$this->mailer->enabled()) {
            return;
        }
        try {
            $this->mailer->send(Emails::passwordChanged($email, $this->config->appUrl));
        } catch (MailException $e) {
            $this->logger?->warning('mail_failed', ['purpose' => 'password_changed', 'user_id' => $userId, 'reason' => $e->getMessage()]);
        }
    }

    public function mailEnabled(): bool
    {
        return $this->mailer->enabled();
    }

    /**
     * Connexion. La tentative est enregistrée avant la vérification. Si la double authentification est active,
     * aucune session n'est ouverte : la réponse porte `mfaRequired` et un `mfaToken` de courte durée.
     */
    public function login(Request $request): Response
    {
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['email', 'password']) ?? [];
        $email = is_string($body['email'] ?? null) ? mb_strtolower(trim($body['email'])) : null;
        $plain = is_string($body['password'] ?? null) ? $body['password'] : null;
        if (array_key_exists('email', $body) && $email === null) {
            $f->error('email', 'invalid_type');
        }
        if (array_key_exists('password', $body) && $plain === null) {
            $f->error('password', 'invalid_type');
        } elseif ($plain !== null && mb_strlen($plain) > self::PASSWORD_MAX) {
            $f->error('password', 'too_long');
        }
        $f->assertOk();

        /** @var string $email */
        /** @var string $plain */
        $ip = $request->ip();
        $attempt = $this->limiter->begin($email, $ip);

        $user = $this->users->findByEmail($email);
        $valid = false;
        if ($user !== null) {
            $valid = $this->hasher->verify($plain, $user['password_hash']);
        } else {
            $this->hasher->dummyVerify($plain);
        }

        if (!$valid || $user === null) {
            throw new HttpException(401, 'unauthenticated', 'Identifiants invalides.');
        }

        $this->limiter->succeeded($attempt);
        if ($this->hasher->needsRehash($user['password_hash'])) {
            $user['password_hash'] = $this->hasher->hash($plain);
            $this->users->updateHash($user['id'], $user['password_hash']);
        }
        $this->sessions->purgeExpired();
        $this->limiter->purge();

        if ($user['totp_secret'] !== null) {
            return Response::json(['mfaRequired' => true, 'mfaToken' => $this->mfaTokens->issue($user['id'], $user['password_hash'])]);
        }

        $this->users->touchLogin($user['id'], $this->clock->sql());
        // Mot de passe retrouvé : une demande de réinitialisation en cours n'a plus lieu d'être.
        $this->users->clearResetRequest($user['id']);

        return $this->startSession($request, $user, 200);
    }

    /** Second facteur : code TOTP à 6 chiffres ou code de secours (consommé). */
    public function mfa(Request $request): Response
    {
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['mfaToken', 'code']) ?? [];
        $token = $f->string($body['mfaToken'] ?? null, 'mfaToken', 200);
        $code = $f->string($body['code'] ?? null, 'code', 40);
        $f->assertOk();

        $userId = MfaToken::userId((string) $token);
        $user = $userId === null ? null : $this->users->findById($userId);
        if ($user === null || $user['totp_secret'] === null || !$this->mfaTokens->isValid((string) $token, $user['id'], $user['password_hash'])) {
            throw new ValidationException(['mfaToken' => 'invalid_token']);
        }

        $attempt = $this->limiter->begin($user['email'], $request->ip());
        $code = (string) $code;
        if (preg_match('/^\d{6}$/D', (string) preg_replace('/\s+/', '', $code)) === 1) {
            $sealed = $this->twoFactor->verifyTotp($user['totp_secret'], $code);
            if ($sealed !== null) {
                $this->users->updateTotp($user['id'], $sealed, (string) $user['totp_recovery']);
            }
            $ok = $sealed !== null;
        } else {
            $remaining = $this->twoFactor->consumeRecovery($user['totp_recovery'], $code);
            if ($remaining !== null) {
                $this->users->updateTotp($user['id'], $user['totp_secret'], $remaining);
            }
            $ok = $remaining !== null;
        }
        if (!$ok) {
            throw new ValidationException(['code' => 'invalid_code']);
        }

        $this->limiter->succeeded($attempt);
        $this->users->touchLogin($user['id'], $this->clock->sql());
        $this->users->clearResetRequest($user['id']);

        return $this->startSession($request, $user, 200);
    }

    public function logout(Request $request): Response
    {
        $token = $this->cookies->sessionToken($request);
        if ($token !== null) {
            $this->sessions->destroy($token);
        }

        return $this->cookies->clearSession(Response::noContent());
    }

    public function me(Request $request): Response
    {
        $user = $this->userJson($request->attribute('user'));

        return Response::json(['user' => $user, 'isAdmin' => $user['isAdmin'], 'mfaEnabled' => $user['mfaEnabled']]);
    }

    /** Validité d'une invitation (sans la consommer). La note n'est rendue que pour une invitation valide. */
    public function invitation(Request $request, array $params): Response
    {
        $found = $this->invitations->findUsable((string) ($params['token'] ?? ''), $this->clock->sql());

        return Response::json($found === null ? ['valid' => false] : ['valid' => true, 'note' => $found['note']]);
    }

    public function resetInfo(Request $request, array $params): Response
    {
        return Response::json(['valid' => $this->resets->findUser((string) ($params['token'] ?? ''), $this->clock->sql()) !== null]);
    }

    /** Réinitialisation par lien (généré par l'administrateur) : nouveau mot de passe, toutes les sessions révoquées. */
    public function reset(Request $request): Response
    {
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['token', 'password']) ?? [];
        $token = $f->string($body['token'] ?? null, 'token', 100);
        $plain = $this->newPassword($f, $body, 'password');
        $f->assertOk();

        $now = $this->clock->sql();
        $userId = $this->resets->findUser((string) $token, $now);
        if ($userId === null || !$this->resets->consume((string) $token, $now)) {
            throw new ValidationException(['token' => 'invalid_token']);
        }
        $this->users->updateHash($userId, $this->hasher->hash((string) $plain));
        $this->users->clearResetRequest($userId);
        $this->resets->invalidateFor($userId, $now);
        $this->sessions->revokeAll($userId);
        $user = $this->users->findById($userId);
        if ($user !== null) {
            $this->notifyPasswordChanged($user['email'], $userId);
        }

        return $this->cookies->clearSession(Response::noContent());
    }

    /**
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    public function userJson(array $user): array
    {
        return [
            'id' => $user['id'],
            'email' => $user['email'],
            'displayName' => $user['display_name'],
            'createdAt' => Clock::sqlToIso($user['created_at']),
            'isAdmin' => $this->config->isAdminUser($user),
            'mfaEnabled' => ($user['totp_secret'] ?? null) !== null,
        ];
    }

    /** @param array<string, mixed> $body */
    public function newPassword(Fields $f, array $body, string $key): ?string
    {
        if (!array_key_exists($key, $body)) {
            return null;
        }
        $plain = $body[$key];
        if (!is_string($plain)) {
            $f->error($key, 'invalid_type');

            return null;
        }
        if (mb_strlen($plain) < self::PASSWORD_MIN) {
            $f->error($key, 'too_short');

            return null;
        }
        if (mb_strlen($plain) > self::PASSWORD_MAX) {
            $f->error($key, 'too_long');

            return null;
        }

        return $plain;
    }

    /**
     * Nouvelle session (jeton neuf : pas de fixation) + nouveau jeton CSRF lié à cette session.
     *
     * @param array<string, mixed> $user
     */
    private function startSession(Request $request, array $user, int $status): Response
    {
        $previous = $this->cookies->sessionToken($request);
        if ($previous !== null) {
            $this->sessions->destroy($previous);
        }

        $now = $this->clock->now();
        $csrf = $this->csrf->issue();
        $token = $this->sessions->create($user['id'], $this->csrf->hash($csrf), DeviceLabel::fromUserAgent($request->header('user-agent')));
        $sessionExpires = $now + min($this->config->sessionLifetimeMinutes * 60, $this->config->sessionAbsoluteLifetimeDays * 86400);

        $response = Response::json(['user' => $this->userJson($user), 'csrfToken' => $csrf], $status);
        $this->cookies->setSession($response, $token, $sessionExpires);
        $this->cookies->setCsrf($response, $csrf, $now + $this->config->sessionAbsoluteLifetimeDays * 86400);

        return $response;
    }
}
