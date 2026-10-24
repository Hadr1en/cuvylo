<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Auth\LoginHasher;
use Cuvylo\Auth\LoginRateLimiter;
use Cuvylo\Auth\SessionManager;
use Cuvylo\Config;
use Cuvylo\Database\Connection;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Repository\InvitationRepository;
use Cuvylo\Repository\ResetLinkRepository;
use Cuvylo\Repository\SettingsRepository;
use Cuvylo\Repository\UsageRepository;
use Cuvylo\Repository\UserRepository;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Logger;
use Cuvylo\Support\Token;
use Cuvylo\Support\Ulid;
use Cuvylo\Validation\Fields;
use Cuvylo\Validation\ValidationException;
use PDO;

/**
 * Administration de l'instance, réservée au compte créé à l'installation et aux adresses d'ADMIN_EMAILS.
 * Pour tout autre compte, chaque route répond 404 (l'existence de l'administration n'est pas révélée).
 *
 * Volontairement restreinte : l'administrateur voit des métadonnées (comptes, espace utilisé, nombre de CV),
 * jamais le contenu des CV, et ne télécharge pas la base (la sauvegarde se fait chez l'hébergeur ou avec
 * bin/backup.php). Il ne peut générer un lien de réinitialisation que pour un compte qui l'a demandé.
 */
final class AdminController
{
    public const RESET_LINK_TTL = 86400;
    /** Une demande « Mot de passe oublié » autorise un lien pendant 7 jours. */
    public const RESET_REQUEST_TTL = 7 * 86400;

    public function __construct(
        private readonly Config $config,
        private readonly PDO $pdo,
        private readonly UserRepository $users,
        private readonly UsageRepository $usage,
        private readonly InvitationRepository $invitations,
        private readonly ResetLinkRepository $resets,
        private readonly SessionManager $sessions,
        private readonly LoginRateLimiter $limiter,
        private readonly LoginHasher $hasher,
        private readonly Logger $logger,
        private readonly Clock $clock,
        private readonly SettingsRepository $settings,
    ) {
    }

    /** Réglages modifiables sans éditer .env. */
    public function settings(Request $request): Response
    {
        $this->admin($request);

        return Response::json(['registrationOpen' => $this->config->registrationEnabled]);
    }

    /** Inscriptions ouvertes à tous ou sur invitation : enregistré en base, prioritaire sur REGISTRATION_ENABLED. */
    public function updateSettings(Request $request): Response
    {
        $this->admin($request);
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['registrationOpen']) ?? [];
        $open = $f->bool($body['registrationOpen'] ?? null, 'registrationOpen');
        $f->assertOk();

        $this->settings->set(SettingsRepository::REGISTRATION_OPEN, $open ? '1' : '0', $this->clock->sql());
        $this->audit($request, $open ? 'registration_opened' : 'registration_closed');

        return Response::json(['registrationOpen' => (bool) $open]);
    }

    public function overview(Request $request): Response
    {
        $this->admin($request);
        $bytes = $this->usage->bytesPerUser();
        $cvs = $this->usage->countPerUser('cvs');

        $accounts = array_map(fn (array $u): array => [
            'id' => $u['id'],
            'email' => $u['email'],
            'displayName' => $u['display_name'],
            'createdAt' => Clock::sqlToIso($u['created_at']),
            'lastLoginAt' => $u['last_login_at'] === null ? null : Clock::sqlToIso($u['last_login_at']),
            'bytes' => $bytes[$u['id']] ?? 0,
            'cvs' => $cvs[$u['id']] ?? 0,
            'mfaEnabled' => (int) $u['mfa'] === 1,
            'isAdmin' => $this->config->isAdminUser($u),
            'resetRequestedAt' => ($at = $this->pendingRequest($u)) === null ? null : Clock::sqlToIso($at),
        ], $this->users->all());

        $totals = ['users' => count($accounts), 'bytes' => array_sum($bytes)];
        foreach (['cvs' => 'cvs', 'versions' => 'cv_versions', 'letters' => 'letters', 'applications' => 'applications', 'shares' => 'shares'] as $key => $table) {
            $totals[$key] = array_sum($this->usage->countPerUser($table));
        }

        return Response::json([
            'users' => $accounts,
            'totals' => $totals,
            'limitBytes' => $this->usage->limitBytes(),
            'databaseBytes' => $this->databaseBytes(),
        ]);
    }

    public function invitations(Request $request): Response
    {
        $this->admin($request);

        return Response::json(['invitations' => $this->invitations->all($this->clock->sql())]);
    }

    /** Invitation nominative à usage unique : le lien (jeton en clair) n'est renvoyé qu'ici, une seule fois. */
    public function createInvitation(Request $request): Response
    {
        $admin = $this->admin($request);
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['note'], ['expiresInDays']) ?? [];
        $note = $f->string(is_string($body['note'] ?? null) ? trim($body['note']) : ($body['note'] ?? null), 'note', 120);
        $days = array_key_exists('expiresInDays', $body) ? $f->int($body['expiresInDays'], 'expiresInDays', 1, 60) : 7;
        $f->assertOk();

        $now = $this->clock->now();
        $id = Ulid::generate($now);
        $token = Token::generate();
        $expiresAt = $now + (int) $days * 86400;
        $this->invitations->create($id, $token, (string) $note, $admin['id'], $this->clock->sql($now), $this->clock->sql($expiresAt));
        $this->audit($request, 'invitation_created');

        return Response::json(['invitation' => [
            'id' => $id,
            'url' => $this->config->appUrl . '/invitation/' . $token,
            'expiresAt' => Clock::sqlToIso($this->clock->sql($expiresAt)),
        ]], 201);
    }

    public function deleteInvitation(Request $request, array $params): Response
    {
        $this->admin($request);
        $id = (string) ($params['id'] ?? '');
        if (!Ulid::isValid($id) || !$this->invitations->delete($id)) {
            throw HttpException::notFound();
        }
        $this->audit($request, 'invitation_deleted');

        return Response::noContent();
    }

    /**
     * Lien de réinitialisation valable 24 h (un seul lien actif par compte), à transmettre par l'administrateur.
     * Seulement si l'utilisateur l'a demandé (« Mot de passe oublié ») : l'administrateur ne peut pas, de sa propre
     * initiative, prendre la main sur un compte.
     */
    public function resetLink(Request $request, array $params): Response
    {
        $this->admin($request);
        $target = $this->target($params);
        if ($this->pendingRequest($target) === null) {
            throw new HttpException(409, 'no_reset_request', 'Cette personne n\'a pas demandé de réinitialisation : elle doit d\'abord cliquer sur « Mot de passe oublié ».');
        }

        $now = $this->clock->now();
        $token = Token::generate();
        $expiresAt = $now + self::RESET_LINK_TTL;
        $this->resets->create($token, $target['id'], $this->clock->sql($now), $this->clock->sql($expiresAt));
        $this->audit($request, 'reset_link_created', $target['id']);

        return Response::json([
            'url' => $this->config->appUrl . '/reinitialisation/' . $token,
            'expiresAt' => Clock::sqlToIso($this->clock->sql($expiresAt)),
        ], 201);
    }

    public function revokeSessions(Request $request, array $params): Response
    {
        $this->admin($request);
        $target = $this->target($params);
        $this->sessions->revokeAll($target['id']);
        $this->audit($request, 'sessions_revoked', $target['id']);

        return Response::noContent();
    }

    /** Suppression d'un compte : le mot de passe de l'ADMINISTRATEUR est redemandé. */
    public function deleteUser(Request $request, array $params): Response
    {
        $admin = $this->admin($request);
        $f = new Fields();
        $body = $f->assoc($request->json(), '', ['password']) ?? [];
        if (array_key_exists('password', $body) && !is_string($body['password'])) {
            $f->error('password', 'invalid_type');
        }
        $f->assertOk();

        $target = $this->target($params);
        if ($target['id'] === $admin['id']) {
            throw HttpException::conflict('Pour supprimer votre propre compte, passez par la page Compte.');
        }
        $ip = $request->ip();
        $this->limiter->assertNotLimited($admin['email'], $ip);
        if (!$this->hasher->verify((string) $body['password'], $admin['password_hash'])) {
            $this->limiter->recordFailure($admin['email'], $ip);
            throw new ValidationException(['password' => 'invalid_password']);
        }

        $this->users->deleteAccount($target['id']);
        $this->audit($request, 'user_deleted', $target['id']);

        return Response::noContent();
    }

    /** @return array<string, mixed> */
    private function admin(Request $request): array
    {
        $user = $request->attribute('user');
        $fresh = is_array($user) ? $this->users->findById((string) $user['id']) : null;
        if ($fresh === null || !$this->config->isAdminUser($fresh)) {
            throw HttpException::notFound();
        }

        return $fresh;
    }

    /** Demande « Mot de passe oublié » encore valable (faite il y a moins de RESET_REQUEST_TTL), ou null. */
    private function pendingRequest(array $user): ?string
    {
        $at = $user['reset_requested_at'] ?? null;
        if (!is_string($at) || $at < $this->clock->sql($this->clock->now() - self::RESET_REQUEST_TTL)) {
            return null;
        }

        return $at;
    }

    /** @return array<string, mixed> */
    private function target(array $params): array
    {
        $id = (string) ($params['id'] ?? '');
        $user = Ulid::isValid($id) ? $this->users->findById($id) : null;
        if ($user === null) {
            throw HttpException::notFound();
        }

        return $user;
    }

    private function databaseBytes(): ?int
    {
        try {
            if (Connection::isSqlite($this->pdo)) {
                $pages = (int) $this->pdo->query('PRAGMA page_count')->fetchColumn();
                $size = (int) $this->pdo->query('PRAGMA page_size')->fetchColumn();

                return $pages * $size;
            }
            $value = $this->pdo->query('SELECT SUM(data_length + index_length) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn();

            return $value === null || $value === false ? null : (int) $value;
        } catch (\Throwable) {
            return null;
        }
    }

    private function audit(Request $request, string $action, ?string $targetUserId = null): void
    {
        $this->logger->info('admin_action', [
            'action' => $action,
            'user_id' => $request->attribute('user')['id'] ?? null,
            'target_user_id' => $targetUserId,
        ]);
    }
}
