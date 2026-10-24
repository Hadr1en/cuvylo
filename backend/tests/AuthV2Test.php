<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Auth\LoginHasher;
use Cuvylo\Auth\LoginRateLimiter;
use Cuvylo\Auth\MfaToken;
use Cuvylo\Auth\Totp;
use Cuvylo\Support\Ulid;
use Cuvylo\Tests\Support\ApiClient;
use Cuvylo\Tests\Support\ApiTestCase;

/** Authentification v2 : invitations, réinitialisation, mot de passe, sessions, TOTP, limitations renforcées. */
final class AuthV2Test extends ApiTestCase
{
    /** Administrateur créé directement en base (l'instance peut avoir l'inscription libre fermée). */
    private function adminClient(string $registration = 'true'): array
    {
        $email = self::uniqueEmail('admin');
        $this->boot(['ADMIN_EMAILS' => $email, 'REGISTRATION_ENABLED' => $registration]);
        $stmt = $this->pdo->prepare('INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, NULL, ?)');
        $stmt->execute([Ulid::generate(), $email, (new LoginHasher())->hash(self::PASSWORD), $this->clock->sql()]);
        $admin = $this->client();
        $this->assertSame(200, $admin->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);

        return [$admin, $email];
    }

    private function inviteToken(ApiClient $admin, string $note = 'Pour Bob', ?int $days = null): string
    {
        $body = ['note' => $note] + ($days === null ? [] : ['expiresInDays' => $days]);
        $response = $admin->post('/api/admin/invitations', $body);
        $this->assertSame(201, $response->status, $response->body());
        $url = $response->data()['invitation']['url'];
        $this->assertStringStartsWith('https://cv.example.test/invitation/', $url);

        return substr($url, strrpos($url, '/') + 1);
    }

    public function testInvitationOpensRegistrationOnceEvenWhenClosed(): void
    {
        // Inscription libre fermée : seule l'invitation ouvre la porte.
        [$admin] = $this->adminClient('false');
        $token = $this->inviteToken($admin);

        $this->assertSame(['valid' => true, 'note' => 'Pour Bob'], $this->client()->get("/api/auth/invitation/$token")->data());
        $this->assertSame(403, $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD])->status);

        $bob = $this->client();
        $registered = $bob->post('/api/auth/register', ['email' => self::uniqueEmail('bob'), 'password' => self::PASSWORD, 'inviteToken' => $token]);
        $this->assertSame(201, $registered->status, $registered->body());

        $again = $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail('eve'), 'password' => self::PASSWORD, 'inviteToken' => $token]);
        $this->assertSame(403, $again->status, 'usage unique');
        $this->assertSame(['valid' => false], $this->client()->get("/api/auth/invitation/$token")->data());

        $stored = $this->pdo->query('SELECT token_hash FROM invitations')->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertNotContains($token, $stored, 'seule l\'empreinte est stockée');
        $this->assertContains(hash('sha256', $token), $stored);
    }

    public function testExpiredOrForgedInvitationsAreRefused(): void
    {
        [$admin] = $this->adminClient();
        $token = $this->inviteToken($admin, 'Court', 1);
        $this->clock->advance(86400 + 1);
        $this->assertSame(['valid' => false], $this->client()->get("/api/auth/invitation/$token")->data());
        $this->assertSame(403, $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD, 'inviteToken' => $token])->status);
        $this->assertSame(403, $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD, 'inviteToken' => 'forged'])->status);
        $this->assertSame(['valid' => false], $this->client()->get('/api/auth/invitation/' . str_repeat('A', 43))->data());
        $this->assertSame(422, $admin->post('/api/admin/invitations', ['note' => 'x', 'expiresInDays' => 61])->status);
    }

    public function testRegistrationsAreLimitedPerIp(): void
    {
        $ip = '198.51.100.' . random_int(1, 254);
        for ($i = 0; $i < LoginRateLimiter::MAX_REGISTRATIONS_PER_IP; $i++) {
            $this->assertSame(201, $this->client($ip)->post('/api/auth/register', ['email' => self::uniqueEmail('n'), 'password' => self::PASSWORD])->status);
        }
        $blocked = $this->client($ip)->post('/api/auth/register', ['email' => self::uniqueEmail('n'), 'password' => self::PASSWORD]);
        $this->assertSame(429, $blocked->status);
        $this->assertGreaterThan(0, (int) $blocked->header('Retry-After'));
        $this->assertSame(201, $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail('n'), 'password' => self::PASSWORD])->status, 'autre IP');

        $this->clock->advance(LoginRateLimiter::REGISTRATION_WINDOW_SECONDS + 1);
        $this->assertSame(201, $this->client($ip)->post('/api/auth/register', ['email' => self::uniqueEmail('n'), 'password' => self::PASSWORD])->status);
    }

    public function testAdminResetLinkSetsNewPasswordAndRevokesSessions(): void
    {
        [$admin] = $this->adminClient();
        [$bob, $bobEmail] = $this->registeredClient();
        $bobId = $this->userIdOf($bobEmail);

        // Sans demande de l'utilisateur, l'administrateur ne peut pas générer de lien.
        $refused = $admin->post("/api/admin/users/$bobId/reset-link");
        $this->assertSame(409, $refused->status);
        $this->assertSame('no_reset_request', $refused->data()['error']['code']);

        $this->assertSame(204, $this->client()->post('/api/auth/reset-request', ['email' => strtoupper($bobEmail)])->status);
        $requested = array_column($admin->get('/api/admin/overview')->data()['users'], null, 'email')[$bobEmail];
        $this->assertNotNull($requested['resetRequestedAt']);

        $link = $admin->post("/api/admin/users/$bobId/reset-link");
        $this->assertSame(201, $link->status, $link->body());
        $url = $link->data()['url'];
        $this->assertStringStartsWith('https://cv.example.test/reinitialisation/', $url);
        $this->assertSame(gmdate('Y-m-d\TH:i:s\Z', $this->clock->now() + 86400), $link->data()['expiresAt']);
        $token = substr($url, strrpos($url, '/') + 1);

        $this->assertSame(['valid' => true], $this->client()->get("/api/auth/reset/$token")->data());
        $this->assertSame(422, $this->client()->post('/api/auth/reset', ['token' => $token, 'password' => 'court'])->status);

        $reset = $this->client()->post('/api/auth/reset', ['token' => $token, 'password' => 'un tout nouveau mot de passe']);
        $this->assertSame(204, $reset->status, $reset->body());
        $this->assertSame(401, $bob->get('/api/auth/me')->status, 'toutes les sessions révoquées');
        $this->assertSame(['valid' => false], $this->client()->get("/api/auth/reset/$token")->data(), 'usage unique');
        $this->assertSame(422, $this->client()->post('/api/auth/reset', ['token' => $token, 'password' => 'encore un autre mot de passe'])->status);

        $this->assertSame(401, $this->client()->post('/api/auth/login', ['email' => $bobEmail, 'password' => self::PASSWORD])->status);
        $this->assertSame(200, $this->client()->post('/api/auth/login', ['email' => $bobEmail, 'password' => 'un tout nouveau mot de passe'])->status);
        $this->assertSame(409, $admin->post("/api/admin/users/$bobId/reset-link")->status, 'demande consommée');
    }

    public function testResetRequestRevealsNothingExpiresAndIsClearedByALogin(): void
    {
        [$admin, $adminEmail] = $this->adminClient();
        [, $bobEmail] = $this->registeredClient();
        $bobId = $this->userIdOf($bobEmail);

        // Même réponse pour une adresse inconnue : pas d'énumération des comptes.
        $unknown = $this->client()->post('/api/auth/reset-request', ['email' => self::uniqueEmail('inconnu')]);
        $this->assertSame(204, $unknown->status);
        $this->assertSame(422, $this->client()->post('/api/auth/reset-request', ['email' => 'pas-une-adresse'])->status);

        $this->client()->post('/api/auth/reset-request', ['email' => $bobEmail]);
        $this->clock->advance(7 * 86400 + 1);
        // La session de l'administrateur a expiré entre-temps (7 jours d'inactivité) : il se reconnecte.
        $this->assertSame(200, $admin->post('/api/auth/login', ['email' => $adminEmail, 'password' => self::PASSWORD])->status);
        $this->assertSame(409, $admin->post("/api/admin/users/$bobId/reset-link")->status, 'demande expirée après 7 jours');

        $this->client()->post('/api/auth/reset-request', ['email' => $bobEmail]);
        $this->assertSame(200, $this->client()->post('/api/auth/login', ['email' => $bobEmail, 'password' => self::PASSWORD])->status);
        $this->assertSame(409, $admin->post("/api/admin/users/$bobId/reset-link")->status, 'mot de passe retrouvé : demande annulée');
    }

    public function testResetLinkExpiresAfter24HoursAndOnlyLatestIsValid(): void
    {
        [$admin] = $this->adminClient();
        [, $bobEmail] = $this->registeredClient();
        $bobId = $this->userIdOf($bobEmail);
        $this->client()->post('/api/auth/reset-request', ['email' => $bobEmail]);

        $first = basename($admin->post("/api/admin/users/$bobId/reset-link")->data()['url']);
        $second = basename($admin->post("/api/admin/users/$bobId/reset-link")->data()['url']);
        $this->assertSame(['valid' => false], $this->client()->get("/api/auth/reset/$first")->data(), 'un seul lien actif');
        $this->assertSame(['valid' => true], $this->client()->get("/api/auth/reset/$second")->data());

        $this->clock->advance(86400 + 1);
        $this->assertSame(['valid' => false], $this->client()->get("/api/auth/reset/$second")->data());
        $this->assertSame(404, $admin->post('/api/admin/users/01HZZZZZZZZZZZZZZZZZZZZZZZ/reset-link')->status);
    }

    public function testChangePasswordRevokesOtherSessionsOnly(): void
    {
        [$client, $email] = $this->registeredClient();
        $other = $this->client();
        $this->assertSame(200, $other->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);

        $wrong = $client->post('/api/account/password', ['currentPassword' => 'pas le bon du tout', 'newPassword' => 'nouveau mot de passe solide']);
        $this->assertSame(422, $wrong->status);
        $this->assertSame(['currentPassword' => 'invalid_password'], self::errorFields($wrong));
        $this->assertSame(422, $client->post('/api/account/password', ['currentPassword' => self::PASSWORD, 'newPassword' => 'court'])->status);

        $this->assertSame(204, $client->post('/api/account/password', ['currentPassword' => self::PASSWORD, 'newPassword' => 'nouveau mot de passe solide'])->status);
        $this->assertSame(200, $client->get('/api/auth/me')->status, 'la session courante reste ouverte');
        $this->assertSame(401, $other->get('/api/auth/me')->status, 'les autres sont révoquées');
        $this->assertSame(200, $this->client()->post('/api/auth/login', ['email' => $email, 'password' => 'nouveau mot de passe solide'])->status);
    }

    public function testSessionsListAndRevocation(): void
    {
        [$client, $email] = $this->registeredClient();
        $phone = $this->client();
        $phone->extraHeaders['user-agent'] = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
        $this->assertSame(200, $phone->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);
        $third = $this->client();
        $this->assertSame(200, $third->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);

        $sessions = $client->get('/api/account/sessions')->data()['sessions'];
        $this->assertCount(3, $sessions);
        $this->assertSame(['id', 'device', 'createdAt', 'lastSeenAt', 'current'], array_keys($sessions[0]));
        $this->assertSame(1, count(array_filter($sessions, static fn (array $s): bool => $s['current'])));
        $this->assertContains('Chrome · Android', array_column($sessions, 'device'));
        foreach ($sessions as $s) {
            $this->assertMatchesRegularExpression('/^[a-f0-9]{12}$/', $s['id']);
            $this->assertStringNotContainsString($s['id'], (string) $client->sessionToken(), 'l\'identifiant public n\'est pas un morceau du jeton');
        }

        $phoneId = array_values(array_filter($sessions, static fn (array $s): bool => $s['device'] === 'Chrome · Android'))[0]['id'];
        [$intruder] = $this->registeredClient();
        $this->assertSame(404, $intruder->delete("/api/account/sessions/$phoneId")->status, 'session d\'autrui');
        $this->assertSame(204, $client->delete("/api/account/sessions/$phoneId")->status);
        $this->assertSame(401, $phone->get('/api/auth/me')->status);
        $this->assertSame(404, $client->delete("/api/account/sessions/$phoneId")->status);

        $this->assertSame(204, $client->post('/api/account/sessions/revoke-others')->status);
        $this->assertSame(401, $third->get('/api/auth/me')->status);
        $this->assertCount(1, $client->get('/api/account/sessions')->data()['sessions']);
    }

    public function testMeExposesAdminAndMfaFlagsAndLastLogin(): void
    {
        [$admin, $adminEmail] = $this->adminClient();
        $me = $admin->get('/api/auth/me')->data();
        $this->assertTrue($me['isAdmin']);
        $this->assertFalse($me['mfaEnabled']);
        $this->assertTrue($me['user']['isAdmin']);

        [$bob, $bobEmail] = $this->registeredClient();
        $this->assertFalse($bob->get('/api/auth/me')->data()['isAdmin']);

        $this->clock->advance(3600);
        $this->client()->post('/api/auth/login', ['email' => $bobEmail, 'password' => self::PASSWORD]);
        $stmt = $this->pdo->prepare('SELECT last_login_at FROM users WHERE email = ?');
        $stmt->execute([$bobEmail]);
        $this->assertSame($this->clock->sql(), $stmt->fetchColumn());
        $this->assertNotSame($adminEmail, $bobEmail);
    }

    /** @return array{ApiClient, string, string, list<string>} client, e-mail, secret, codes de secours */
    private function clientWithTotp(): array
    {
        [$client, $email] = $this->registeredClient();
        $setup = $client->post('/api/account/totp/setup');
        $this->assertSame(200, $setup->status, $setup->body());
        $secret = $setup->data()['secret'];
        $this->assertStringContainsString('secret=' . $secret, $setup->data()['otpauthUri']);

        $this->assertSame(['code' => 'invalid_code'], self::errorFields($client->post('/api/account/totp/enable', ['code' => '000000' === Totp::code($secret, Totp::step($this->clock->now())) ? '111111' : '000000'])));
        $enable = $client->post('/api/account/totp/enable', ['code' => Totp::code($secret, Totp::step($this->clock->now()))]);
        $this->assertSame(200, $enable->status, $enable->body());
        $codes = $enable->data()['recoveryCodes'];
        $this->assertCount(10, $codes);
        $this->assertCount(10, array_unique($codes));

        return [$client, $email, $secret, $codes];
    }

    public function testTotpEnrollmentStoresOnlyEncryptedSecretAndHashedRecoveryCodes(): void
    {
        [$client, $email, $secret, $codes] = $this->clientWithTotp();
        $this->assertTrue($client->get('/api/auth/me')->data()['mfaEnabled']);

        $stmt = $this->pdo->prepare('SELECT totp_secret, totp_pending, totp_recovery FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        $this->assertStringStartsWith('v1:', $row['totp_secret']);
        $this->assertStringNotContainsString($secret, $row['totp_secret']);
        $this->assertNull($row['totp_pending']);
        foreach ($codes as $code) {
            $this->assertStringNotContainsString($code, $row['totp_recovery']);
        }
        $this->assertSame(409, $client->post('/api/account/totp/setup')->status, 'déjà active');
    }

    public function testLoginWithTotpRequiresSecondFactor(): void
    {
        [, $email, $secret] = $this->clientWithTotp();
        $this->clock->advance(Totp::PERIOD * 3);

        $browser = $this->client();
        $login = $browser->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $this->assertSame(200, $login->status);
        $this->assertTrue($login->data()['mfaRequired']);
        $this->assertArrayNotHasKey('user', $login->data());
        $this->assertSame([], array_intersect_key($login->cookies(), [$this->cookies->sessionName() => 1]), 'aucune session avant le second facteur');
        $this->assertSame(401, $browser->get('/api/auth/me')->status);
        $mfaToken = $login->data()['mfaToken'];

        $this->assertSame(['code' => 'invalid_code'], self::errorFields($browser->post('/api/auth/mfa', ['mfaToken' => $mfaToken, 'code' => '12345'])));
        $this->assertSame(['mfaToken' => 'invalid_token'], self::errorFields($browser->post('/api/auth/mfa', ['mfaToken' => $mfaToken . 'x', 'code' => '123456'])));

        $code = Totp::code($secret, Totp::step($this->clock->now()));
        $ok = $browser->post('/api/auth/mfa', ['mfaToken' => $mfaToken, 'code' => $code]);
        $this->assertSame(200, $ok->status, $ok->body());
        $this->assertSame($email, $ok->data()['user']['email']);
        $this->assertNotEmpty($ok->data()['csrfToken']);
        $this->assertSame(200, $browser->get('/api/auth/me')->status);

        // Rejeu du même code (même pas de 30 s) : refusé.
        $replay = $this->client();
        $token2 = $replay->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->data()['mfaToken'];
        $this->assertSame(422, $replay->post('/api/auth/mfa', ['mfaToken' => $token2, 'code' => $code])->status);
    }

    public function testRecoveryCodeWorksOnceAndMfaTokenExpires(): void
    {
        [, $email, , $codes] = $this->clientWithTotp();

        $browser = $this->client();
        $token = $browser->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->data()['mfaToken'];
        $this->assertSame(200, $browser->post('/api/auth/mfa', ['mfaToken' => $token, 'code' => strtoupper($codes[0])])->status, 'code de secours, casse indifférente');

        $again = $this->client();
        $token = $again->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->data()['mfaToken'];
        $this->assertSame(422, $again->post('/api/auth/mfa', ['mfaToken' => $token, 'code' => $codes[0]])->status, 'consommé');
        $this->assertSame(200, $again->post('/api/auth/mfa', ['mfaToken' => $token, 'code' => $codes[1]])->status);

        $late = $this->client();
        $token = $late->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->data()['mfaToken'];
        $this->clock->advance(MfaToken::TTL_SECONDS + 1);
        $this->assertSame(['mfaToken' => 'invalid_token'], self::errorFields($late->post('/api/auth/mfa', ['mfaToken' => $token, 'code' => $codes[2]])));
    }

    public function testMfaCodeGuessesAreRateLimited(): void
    {
        [, $email] = $this->clientWithTotp();
        $browser = $this->client();
        $token = $browser->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->data()['mfaToken'];
        for ($i = 0; $i < LoginRateLimiter::MAX_PER_PAIR; $i++) {
            $this->assertSame(422, $browser->post('/api/auth/mfa', ['mfaToken' => $token, 'code' => sprintf('zz%04d', $i)])->status);
        }
        $this->assertSame(429, $browser->post('/api/auth/mfa', ['mfaToken' => $token, 'code' => 'zz9999'])->status);
    }

    public function testDisableTotpRequiresPassword(): void
    {
        [$client, $email] = $this->clientWithTotp();
        $this->assertSame(['password' => 'invalid_password'], self::errorFields($client->post('/api/account/totp/disable', ['password' => 'mauvais mot de passe'])));
        $this->assertSame(204, $client->post('/api/account/totp/disable', ['password' => self::PASSWORD])->status);
        $this->assertFalse($client->get('/api/auth/me')->data()['mfaEnabled']);

        $login = $this->client()->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $this->assertArrayHasKey('user', $login->data(), 'connexion directe une fois désactivée');
    }

    public function testAttemptIsRecordedBeforePasswordVerification(): void
    {
        [, $email] = $this->registeredClient();
        $stmt = $this->pdo->prepare('SELECT success FROM login_attempts WHERE email_hash = ? AND success <> 2');
        $emailHash = hash_hmac('sha256', strtolower($email), $this->config->appKey);
        $stmt->execute([$emailHash]);
        $this->assertSame([], $stmt->fetchAll(\PDO::FETCH_COLUMN));

        $this->client()->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $stmt->execute([$emailHash]);
        $rows = array_map('intval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
        $this->assertCount(1, $rows, 'une seule ligne par tentative');
        $this->assertNotContains(0, $rows, 'la ligne enregistrée avant vérification a été requalifiée');
        $this->assertContains(1, $rows, 'en succès');
    }

    public function testIpv6AddressesInTheSameSlash64ShareTheLimit(): void
    {
        [, $email] = $this->registeredClient();
        $prefix = sprintf('2001:db8:%x:%x', random_int(1, 0xfff), random_int(1, 0xfff));
        for ($i = 0; $i < LoginRateLimiter::MAX_PER_PAIR; $i++) {
            $this->assertSame(401, $this->client("$prefix::" . dechex($i + 1))->post('/api/auth/login', ['email' => $email, 'password' => 'wrong wrong wrong'])->status);
        }
        $this->assertSame(429, $this->client("$prefix:ffff::1")->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status, 'même /64');
        $this->assertSame(200, $this->client('2001:db8:ffff:1::1')->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status, 'autre /64');
    }

    public function testProgressiveDelayPerEmailAcrossIps(): void
    {
        [, $email] = $this->registeredClient();
        for ($i = 0; $i < LoginRateLimiter::EMAIL_THRESHOLD; $i++) {
            $this->assertSame(401, $this->client()->post('/api/auth/login', ['email' => $email, 'password' => 'wrong wrong wrong'])->status, "échec $i");
        }
        $blocked = $this->client()->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $this->assertSame(429, $blocked->status, 'nouvelle IP, bon mot de passe : ralenti quand même');
        $this->assertSame((string) LoginRateLimiter::EMAIL_BASE_DELAY, $blocked->header('Retry-After'));

        $this->clock->advance(LoginRateLimiter::EMAIL_BASE_DELAY);
        $this->assertSame(200, $this->client()->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status, 'délai, pas verrouillage');
    }
}
