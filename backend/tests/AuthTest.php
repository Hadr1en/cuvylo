<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Auth\Cookies;
use Cuvylo\Auth\Csrf;
use Cuvylo\Tests\Support\ApiTestCase;

final class AuthTest extends ApiTestCase
{
    public function testHealth(): void
    {
        $response = $this->client()->get('/api/health');
        $this->assertSame(200, $response->status);
        $this->assertSame(['status' => 'ok'], $response->data());
        $this->assertSame('nosniff', $response->header('X-Content-Type-Options'));
        $this->assertNotNull($response->header('X-Request-Id'));
    }

    public function testRegisterCreatesAccountSessionAndEmptyProfile(): void
    {
        $client = $this->client();
        $email = self::uniqueEmail();
        $response = $client->post('/api/auth/register', ['email' => '  ' . strtoupper($email) . ' ', 'password' => self::PASSWORD, 'displayName' => ' Camille ']);

        $this->assertSame(201, $response->status);
        $user = $response->data()['user'];
        $this->assertSame($email, $user['email'], 'e-mail normalisé en minuscules');
        $this->assertSame('Camille', $user['displayName']);
        $this->assertArrayNotHasKey('password_hash', $user);
        $this->assertArrayNotHasKey('passwordHash', $user);
        $this->assertNotEmpty($response->data()['csrfToken']);

        $cookies = $response->cookies();
        $session = '__Host-' . Cookies::SESSION;
        $csrf = '__Host-' . Csrf::COOKIE;
        $this->assertArrayHasKey($session, $cookies, 'préfixe __Host- en HTTPS');
        $this->assertArrayNotHasKey(Cookies::SESSION, $cookies);
        $this->assertTrue($cookies[$session]['options']['httponly']);
        $this->assertTrue($cookies[$session]['options']['secure']);
        $this->assertSame('/', $cookies[$session]['options']['path'], '__Host- exige Path=/');
        $this->assertArrayNotHasKey('domain', $cookies[$session]['options'], '__Host- interdit Domain');
        $this->assertSame('Lax', $cookies[$session]['options']['samesite']);
        $this->assertFalse($cookies[$csrf]['options']['httponly'], 'le cookie CSRF doit rester lisible par le JS');

        $me = $client->get('/api/auth/me');
        $this->assertSame(200, $me->status);
        $this->assertSame($email, $me->data()['user']['email']);

        $profile = $client->get('/api/profile');
        $this->assertSame(200, $profile->status);
        $this->assertSame($email, $profile->data()['data']['identity']['email']);
    }

    public function testPasswordIsStoredHashedNeverInClear(): void
    {
        [, $email] = $this->registeredClient();
        $stmt = $this->pdo->prepare('SELECT password_hash FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $stored = (string) $stmt->fetchColumn();

        $this->assertStringNotContainsString(self::PASSWORD, $stored);
        $this->assertNotEmpty(password_get_info($stored)['algo']);
    }

    public function testSessionTokenIsStoredHashedOnly(): void
    {
        [$client] = $this->registeredClient();
        $token = (string) $client->sessionToken();

        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM sessions WHERE id_hash = ?');
        $stmt->execute([$token]);
        $this->assertSame(0, (int) $stmt->fetchColumn(), 'le jeton brut ne doit jamais être en base');
        $stmt->execute([hash('sha256', $token)]);
        $this->assertSame(1, (int) $stmt->fetchColumn());
    }

    public function testRegisterRejectsDuplicateEmailAndWeakInput(): void
    {
        [, $email] = $this->registeredClient();

        $duplicate = $this->client()->post('/api/auth/register', ['email' => strtoupper($email), 'password' => self::PASSWORD]);
        $this->assertSame(422, $duplicate->status);
        $this->assertSame('already_registered', self::errorFields($duplicate)['email']);

        $short = $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => 'short']);
        $this->assertSame(422, $short->status);
        $this->assertSame('too_short', self::errorFields($short)['password']);

        $bad = $this->client()->post('/api/auth/register', ['email' => 'not-an-email', 'password' => self::PASSWORD, 'extra' => 1]);
        $this->assertSame(422, $bad->status);
        $this->assertSame('invalid_email', self::errorFields($bad)['email']);
        $this->assertSame('unknown_field', self::errorFields($bad)['extra']);
    }

    public function testRegistrationCanBeDisabled(): void
    {
        $this->boot(['REGISTRATION_ENABLED' => 'false']);
        $response = $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD]);
        $this->assertSame(403, $response->status);
        $this->assertSame('registration_closed', $response->data()['error']['code']);
    }

    public function testInviteCodeIsEnforcedWhenConfigured(): void
    {
        $this->boot(['REGISTRATION_INVITE_CODE' => 'open-sesame-test']);

        $without = $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD]);
        $this->assertSame(403, $without->status);

        $wrong = $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD, 'inviteCode' => 'nope']);
        $this->assertSame(403, $wrong->status);

        $ok = $this->client()->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD, 'inviteCode' => 'open-sesame-test']);
        $this->assertSame(201, $ok->status);
    }

    public function testLoginSucceedsAndFailuresAreIndistinguishable(): void
    {
        [, $email] = $this->registeredClient();

        $client = $this->client();
        $ok = $client->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $this->assertSame(200, $ok->status);
        $this->assertSame(200, $client->get('/api/auth/me')->status);

        $wrongPassword = $this->client()->post('/api/auth/login', ['email' => $email, 'password' => 'definitely wrong password']);
        $unknownUser = $this->client()->post('/api/auth/login', ['email' => self::uniqueEmail('ghost'), 'password' => 'definitely wrong password']);
        $this->assertSame(401, $wrongPassword->status);
        $this->assertSame(401, $unknownUser->status);
        $this->assertSame($wrongPassword->data(), $unknownUser->data(), 'même réponse que le compte existe ou non');
        $this->assertArrayNotHasKey($this->cookies->sessionName(), $wrongPassword->cookies());
    }

    public function testMeRequiresAuthentication(): void
    {
        $response = $this->client()->get('/api/auth/me');
        $this->assertSame(401, $response->status);
        $this->assertSame('unauthenticated', $response->data()['error']['code']);
    }

    public function testLogoutInvalidatesSessionServerSide(): void
    {
        [$client] = $this->registeredClient();
        $stolenToken = (string) $client->sessionToken();

        $logout = $client->post('/api/auth/logout');
        $this->assertSame(204, $logout->status);
        $this->assertSame(401, $client->get('/api/auth/me')->status);

        // Même en rejouant le cookie volé : la session n'existe plus en base.
        $attacker = $this->client();
        $attacker->jar[Cookies::SESSION] = $stolenToken;
        $this->assertSame(401, $attacker->get('/api/auth/me')->status);
    }

    public function testLoginReplacesPreviousSession(): void
    {
        [$client, $email] = $this->registeredClient();
        $first = (string) $client->sessionToken();

        $this->assertSame(200, $client->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);
        $second = (string) $client->sessionToken();
        $this->assertNotSame($first, $second, 'jeton régénéré à la connexion (anti-fixation)');

        $replay = $this->client();
        $replay->jar[Cookies::SESSION] = $first;
        $this->assertSame(401, $replay->get('/api/auth/me')->status, 'l\'ancien jeton est invalidé');
    }

    public function testForgedSessionCookieIsRejected(): void
    {
        $client = $this->client();
        $client->jar[Cookies::SESSION] = bin2hex(random_bytes(32));
        $this->assertSame(401, $client->get('/api/auth/me')->status);

        $client->jar[Cookies::SESSION] = "' OR 1=1 --";
        $this->assertSame(401, $client->get('/api/auth/me')->status);
    }

    public function testSessionExpiresAfterInactivity(): void
    {
        [$client] = $this->registeredClient();
        $this->assertSame(200, $client->get('/api/auth/me')->status);

        $this->clock->advance($this->config->sessionLifetimeMinutes * 60 + 1);
        $this->assertSame(401, $client->get('/api/auth/me')->status);
    }

    public function testSlidingExpirationKeepsActiveSessionAlive(): void
    {
        [$client] = $this->registeredClient();
        $step = intdiv($this->config->sessionLifetimeMinutes * 60, 2);

        for ($i = 0; $i < 4; $i++) {
            $this->clock->advance($step);
            $response = $client->get('/api/auth/me');
            $this->assertSame(200, $response->status, "itération $i");
        }
    }

    public function testSessionHasAbsoluteLifetime(): void
    {
        [$client] = $this->registeredClient();
        $step = intdiv($this->config->sessionLifetimeMinutes * 60, 2);
        $absolute = $this->config->sessionAbsoluteLifetimeDays * 86400;

        $elapsed = 0;
        while ($elapsed + $step < $absolute) {
            $this->clock->advance($step);
            $elapsed += $step;
            $this->assertSame(200, $client->get('/api/auth/me')->status);
        }
        $this->clock->advance($absolute - $elapsed + 1);
        $this->assertSame(401, $client->get('/api/auth/me')->status, 'plafond absolu atteint malgré l\'activité');
    }

    public function testSlidingRefreshReissuesSessionCookie(): void
    {
        [$client] = $this->registeredClient();
        $this->clock->advance(600);
        $response = $client->get('/api/auth/me');
        $this->assertArrayHasKey($this->cookies->sessionName(), $response->cookies(), 'cookie prolongé après l\'intervalle de touch');
        $this->assertSame($client->sessionToken(), $response->cookies()[$this->cookies->sessionName()]['value']);
    }

    public function testUnknownRouteAndWrongMethod(): void
    {
        $client = $this->client();
        $this->assertSame(404, $client->get('/api/nope')->status);
        $wrong = $client->send('PATCH', '/api/health');
        $this->assertSame(405, $wrong->status);
        $this->assertSame('GET', $wrong->header('Allow'));
    }

    public function testMalformedJsonAndWrongContentType(): void
    {
        $client = $this->client();
        $this->assertSame(400, $client->post('/api/auth/login', '{not json')->status);
        $this->assertSame(400, $client->send('POST', '/api/auth/login', '{"email":"a"}', ['content-type' => 'text/plain'])->status);
        $this->assertSame(400, $client->send('POST', '/api/auth/login')->status, 'corps absent');
    }

    public function testOversizedBodyIsRejected(): void
    {
        $client = $this->client();
        $response = $client->post('/api/auth/login', str_repeat('a', 600 * 1024 + 1));
        $this->assertSame(413, $response->status);
    }

    /** Corps écarté par PHP (post_max_size) : Content-Length annoncé mais corps vide → 413, pas 400. */
    public function testTruncatedBodyIsReportedAsTooLarge(): void
    {
        $client = $this->client();
        $response = $client->send('POST', '/api/auth/login', null, ['content-type' => 'application/json', 'content-length' => '9000000']);
        $this->assertSame(413, $response->status);
        $this->assertSame('payload_too_large', $response->data()['error']['code']);
    }

    public function testCookiesAreNotPrefixedOverPlainHttp(): void
    {
        $this->boot(['APP_ENV' => 'development', 'APP_URL' => 'http://localhost:5173']);
        $client = $this->client();
        $response = $client->post('/api/auth/register', ['email' => self::uniqueEmail(), 'password' => self::PASSWORD]);
        $this->assertSame(201, $response->status, $response->body());
        $this->assertArrayHasKey(Cookies::SESSION, $response->cookies(), '__Host- exige Secure : pas de préfixe en HTTP');
        $this->assertSame(200, $client->get('/api/auth/me')->status);
    }

    public function testUnprefixedSessionCookieIsIgnoredOverHttps(): void
    {
        [$client] = $this->registeredClient();
        $token = (string) $client->sessionToken();
        // Cookie posé sans préfixe (ex. par un sous-domaine compromis) : jamais lu en HTTPS.
        $response = $this->kernel->handle(new \Cuvylo\Http\Request('GET', '/api/auth/me', ['origin' => $this->config->origin()], [Cookies::SESSION => $token]));
        $this->assertSame(401, $response->status);
    }
}
