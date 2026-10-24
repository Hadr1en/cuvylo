<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Auth\LoginRateLimiter;
use Cuvylo\Tests\Support\ApiClient;
use Cuvylo\Tests\Support\ApiTestCase;

final class RateLimitTest extends ApiTestCase
{
    private function failLogin(ApiClient $client, string $email): int
    {
        return $client->post('/api/auth/login', ['email' => $email, 'password' => 'wrong wrong wrong'])->status;
    }

    public function testPairIsBlockedAfterFiveFailuresEvenWithCorrectPassword(): void
    {
        [, $email] = $this->registeredClient();
        $attacker = $this->client();

        for ($i = 0; $i < LoginRateLimiter::MAX_PER_PAIR; $i++) {
            $this->assertSame(401, $this->failLogin($attacker, $email), "tentative $i");
        }

        $blocked = $attacker->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $this->assertSame(429, $blocked->status);
        $this->assertSame('rate_limited', $blocked->data()['error']['code']);
        $this->assertGreaterThan(0, (int) $blocked->header('Retry-After'));
        $this->assertLessThanOrEqual(LoginRateLimiter::WINDOW_SECONDS, (int) $blocked->header('Retry-After'));
    }

    public function testBlockLiftsAfterTheWindow(): void
    {
        [, $email] = $this->registeredClient();
        $attacker = $this->client();
        for ($i = 0; $i < LoginRateLimiter::MAX_PER_PAIR; $i++) {
            $this->failLogin($attacker, $email);
        }
        $this->assertSame(429, $attacker->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);

        $this->clock->advance(LoginRateLimiter::WINDOW_SECONDS + 1);
        $this->assertSame(200, $attacker->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);
    }

    public function testRetryAfterReflectsOldestFailureLeavingTheWindow(): void
    {
        [, $email] = $this->registeredClient();
        $attacker = $this->client();
        $this->failLogin($attacker, $email);
        $this->clock->advance(600);
        for ($i = 1; $i < LoginRateLimiter::MAX_PER_PAIR; $i++) {
            $this->failLogin($attacker, $email);
        }

        $blocked = $attacker->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
        $this->assertSame(429, $blocked->status);
        // Le plus ancien échec (il y a 600 s) sort de la fenêtre dans 300 s : la limite retombe alors à 4.
        $this->assertSame(LoginRateLimiter::WINDOW_SECONDS - 600, (int) $blocked->header('Retry-After'));
    }

    public function testOtherIpIsNotBlockedForTheSameAccount(): void
    {
        [, $email] = $this->registeredClient();
        $attacker = $this->client();
        for ($i = 0; $i < LoginRateLimiter::MAX_PER_PAIR; $i++) {
            $this->failLogin($attacker, $email);
        }

        $legitimate = $this->client();
        $this->assertSame(200, $legitimate->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);
    }

    public function testIpIsBlockedAfterTwentyFailuresAcrossAccounts(): void
    {
        $attacker = $this->client();
        for ($i = 0; $i < LoginRateLimiter::MAX_PER_IP; $i++) {
            $this->assertSame(401, $this->failLogin($attacker, self::uniqueEmail('spray')), "tentative $i");
        }
        $this->assertSame(429, $this->failLogin($attacker, self::uniqueEmail('spray')));

        [, $email] = $this->registeredClient();
        $this->assertSame(429, $attacker->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status, 'toute l\'IP est bloquée');
    }

    public function testUnknownAccountsAreThrottledToo(): void
    {
        $attacker = $this->client();
        $ghost = self::uniqueEmail('ghost');
        for ($i = 0; $i < LoginRateLimiter::MAX_PER_PAIR; $i++) {
            $this->failLogin($attacker, $ghost);
        }
        $this->assertSame(429, $this->failLogin($attacker, $ghost), 'le comportement ne trahit pas l\'existence du compte');
    }

    public function testWrongInviteCodesCountAsFailures(): void
    {
        $this->boot(['REGISTRATION_INVITE_CODE' => 'invite-for-tests']);
        $attacker = $this->client();
        $email = self::uniqueEmail();
        for ($i = 0; $i < LoginRateLimiter::MAX_PER_PAIR; $i++) {
            $this->assertSame(403, $attacker->post('/api/auth/register', ['email' => $email, 'password' => self::PASSWORD, 'inviteCode' => "guess-$i"])->status);
        }
        $blocked = $attacker->post('/api/auth/register', ['email' => $email, 'password' => self::PASSWORD, 'inviteCode' => 'invite-for-tests']);
        $this->assertSame(429, $blocked->status);
    }

    public function testAttemptsStoreOnlyHashes(): void
    {
        [, $email] = $this->registeredClient();
        $attacker = $this->client();
        $this->failLogin($attacker, $email);

        $rows = $this->pdo->query('SELECT email_hash, ip_hash FROM login_attempts')->fetchAll();
        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $row['email_hash']);
            $this->assertStringNotContainsString($attacker->ip, $row['ip_hash']);
            $this->assertNotSame(hash('sha256', $email), $row['email_hash'], 'HMAC avec clé applicative, pas un simple SHA-256');
        }
    }

    public function testOldAttemptsArePurgedOpportunistically(): void
    {
        [, $email] = $this->registeredClient();
        $attacker = $this->client();
        $this->failLogin($attacker, $email);
        $before = (int) $this->pdo->query('SELECT COUNT(*) FROM login_attempts')->fetchColumn();

        $this->clock->advance(2 * 86400);
        $this->assertSame(200, $attacker->post('/api/auth/login', ['email' => $email, 'password' => self::PASSWORD])->status);

        $remaining = (int) $this->pdo->query("SELECT COUNT(*) FROM login_attempts WHERE success = 0 AND attempted_at < '" . $this->clock->sql($this->clock->now() - 86400) . "'")->fetchColumn();
        $this->assertSame(0, $remaining);
        $this->assertGreaterThanOrEqual(1, $before);
    }
}
