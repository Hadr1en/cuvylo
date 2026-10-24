<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Controller\AuthController;
use Cuvylo\Tests\Support\ApiTestCase;
use Cuvylo\Tests\Support\RecordingMailer;

/** Parcours classique « Mot de passe oublié » : lien reçu par e-mail, nouveau mot de passe, confirmation. */
final class ResetByEmailTest extends ApiTestCase
{
    private RecordingMailer $mailer;

    protected function setUp(): void
    {
        $this->mailer = new RecordingMailer();
        $this->boot([], null, $this->mailer);
    }

    private function resetRequestedAt(string $email): ?string
    {
        $stmt = $this->pdo->prepare('SELECT reset_requested_at FROM users WHERE email = ?');
        $stmt->execute([$email]);

        return $stmt->fetchColumn() ?: null;
    }

    public function testForgottenPasswordSendsALinkThatSetsANewPassword(): void
    {
        [$bob, $email] = $this->registeredClient();
        $this->assertTrue($this->client()->get('/api/instance')->data()['features']['passwordResetByEmail']);

        $this->assertSame(204, $this->client()->post('/api/auth/reset-request', ['email' => strtoupper($email)])->status);
        $this->assertCount(1, $this->mailer->sent);
        $mail = $this->mailer->sent[0];
        $this->assertSame($email, $mail->to);
        $this->assertSame('Réinitialisation de votre mot de passe Cuvylo', $mail->subject);
        $this->assertStringContainsString('https://cv.example.test/reinitialisation/', $mail->body);
        $this->assertStringContainsString('60 minutes', $mail->body);
        $token = (string) $this->mailer->lastResetToken($email);
        $this->assertStringNotContainsString($token, implode("\n", $this->logLines), 'jeton jamais journalisé');
        $this->assertNull($this->resetRequestedAt($email), 'pas de passage par l\'administrateur quand l\'e-mail est parti');

        $this->assertSame(['valid' => true], $this->client()->get("/api/auth/reset/$token")->data());
        $this->assertSame(204, $this->client()->post('/api/auth/reset', ['token' => $token, 'password' => 'mon nouveau mot de passe'])->status);
        $this->assertSame(401, $bob->get('/api/auth/me')->status, 'sessions fermées');
        $this->assertSame(200, $this->client()->post('/api/auth/login', ['email' => $email, 'password' => 'mon nouveau mot de passe'])->status);

        $confirmation = end($this->mailer->sent);
        $this->assertSame('Votre mot de passe Cuvylo a été modifié', $confirmation->subject);
        $this->assertSame(['valid' => false], $this->client()->get("/api/auth/reset/$token")->data(), 'usage unique');
    }

    public function testLinkExpiresAfterOneHourAndOnlyTheLatestWorks(): void
    {
        [, $email] = $this->registeredClient();
        $this->client()->post('/api/auth/reset-request', ['email' => $email]);
        $first = (string) $this->mailer->lastResetToken($email);
        $this->client()->post('/api/auth/reset-request', ['email' => $email]);
        $second = (string) $this->mailer->lastResetToken($email);
        $this->assertNotSame($first, $second);
        $this->assertSame(['valid' => false], $this->client()->get("/api/auth/reset/$first")->data(), 'un seul lien actif');

        $this->clock->advance(AuthController::EMAIL_RESET_TTL + 1);
        $this->assertSame(['valid' => false], $this->client()->get("/api/auth/reset/$second")->data());
    }

    public function testUnknownAddressAndMailboxFloodingRevealNothing(): void
    {
        $this->assertSame(204, $this->client()->post('/api/auth/reset-request', ['email' => self::uniqueEmail('inconnu')])->status);
        $this->assertCount(0, $this->mailer->sent, 'aucun e-mail pour une adresse sans compte');

        [, $email] = $this->registeredClient();
        for ($i = 0; $i < 5; $i++) {
            $this->assertSame(204, $this->client()->post('/api/auth/reset-request', ['email' => $email])->status);
        }
        $this->assertCount(AuthController::EMAIL_RESETS_PER_HOUR, $this->mailer->sent, 'au plus 3 e-mails par heure et par compte');
    }

    public function testFailedSendingFallsBackToTheAdministratorWithoutLeakingAnything(): void
    {
        [, $email] = $this->registeredClient();
        $this->mailer->fail = true;
        $this->assertSame(204, $this->client()->post('/api/auth/reset-request', ['email' => $email])->status, 'même réponse');

        $this->assertNotNull($this->resetRequestedAt($email), 'demande transmise à l\'administrateur');
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.email = ? AND r.used_at IS NULL');
        $stmt->execute([$email]);
        $this->assertSame(0, (int) $stmt->fetchColumn(), 'aucun lien orphelin');
        $log = implode("\n", $this->logLines);
        $this->assertStringContainsString('mail_failed', $log);
        $this->assertStringNotContainsString($email, $log);
    }

    public function testChangingThePasswordSendsAConfirmation(): void
    {
        [$client, $email] = $this->registeredClient();
        $this->assertSame(204, $client->post('/api/account/password', ['currentPassword' => self::PASSWORD, 'newPassword' => 'encore un autre mot de passe'])->status);
        $last = end($this->mailer->sent);
        $this->assertSame('Votre mot de passe Cuvylo a été modifié', $last->subject);
        $this->assertSame($email, $last->to);
    }

    public function testWithoutMailConfiguredTheAdministratorPathRemains(): void
    {
        $this->boot();
        [, $email] = $this->registeredClient();
        $this->assertFalse($this->client()->get('/api/instance')->data()['features']['passwordResetByEmail']);
        $this->assertSame(204, $this->client()->post('/api/auth/reset-request', ['email' => $email])->status);
        $this->assertNotNull($this->resetRequestedAt($email));
    }
}
