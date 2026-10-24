<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Mail\FileMailer;
use Cuvylo\Mail\MailConfig;
use Cuvylo\Mail\MailException;
use Cuvylo\Mail\Message;
use Cuvylo\Mail\SmtpConnection;
use Cuvylo\Mail\SmtpMailer;
use Cuvylo\Tests\Support\FakeClock;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/** Serveur SMTP simulé : réponses préparées, commandes envoyées enregistrées. */
final class ScriptedSmtp implements SmtpConnection
{
    /** @var list<string> */
    public array $written = [];
    public bool $tls = false;
    public bool $closed = false;

    /** @param list<array{int, list<string>}> $replies */
    public function __construct(private array $replies)
    {
    }

    public function read(): array
    {
        if ($this->replies === []) {
            throw new MailException('Le serveur SMTP a fermé la connexion ou ne répond pas.');
        }

        return array_shift($this->replies);
    }

    public function write(string $data): void
    {
        $this->written[] = $data;
    }

    public function startTls(): void
    {
        $this->tls = true;
    }

    public function close(): void
    {
        $this->closed = true;
    }
}

final class MailTest extends TestCase
{
    private const PASSWORD = 'mot-de-passe-smtp-fictif';

    private static function smtpConfig(string $secure = 'ssl'): MailConfig
    {
        return MailConfig::fromEnv([
            'MAIL_TRANSPORT' => 'smtp', 'MAIL_FROM' => 'noreply@example.test', 'MAIL_FROM_NAME' => 'Cuvylo Équipe',
            'SMTP_HOST' => 'smtp.example.test', 'SMTP_SECURE' => $secure, 'SMTP_USER' => 'noreply@example.test', 'SMTP_PASSWORD' => self::PASSWORD,
        ], 'production');
    }

    private static function message(): Message
    {
        return new Message('ami@example.test', 'Réinitialisation de votre mot de passe', "Bonjour,\n.\nUne ligne commençant par un point.");
    }

    public function testSmtpSslWithAuthPlain(): void
    {
        $server = new ScriptedSmtp([
            [220, ['smtp.example.test ESMTP']],
            [250, ['smtp.example.test', 'AUTH PLAIN LOGIN', '8BITMIME']],
            [235, ['ok']], [250, ['ok']], [250, ['ok']], [354, ['go']], [250, ['queued']], [221, ['bye']],
        ]);
        (new SmtpMailer(self::smtpConfig(), new FakeClock(1_790_000_000), static fn () => $server))->send(self::message());

        $this->assertSame('EHLO example.test' . "\r\n", $server->written[0]);
        $this->assertSame('AUTH PLAIN ' . base64_encode("\0noreply@example.test\0" . self::PASSWORD) . "\r\n", $server->written[1]);
        $this->assertSame("MAIL FROM:<noreply@example.test>\r\n", $server->written[2]);
        $this->assertSame("RCPT TO:<ami@example.test>\r\n", $server->written[3]);
        $data = $server->written[5];
        $this->assertStringContainsString("To: ami@example.test\r\n", $data);
        $this->assertStringContainsString('Subject: =?UTF-8?B?' . base64_encode('Réinitialisation de votre mot de passe') . '?=', $data);
        $this->assertStringContainsString('From: =?UTF-8?B?' . base64_encode('Cuvylo Équipe') . '?= <noreply@example.test>', $data);
        $this->assertStringContainsString('Content-Type: text/plain; charset=UTF-8', $data);
        $this->assertStringEndsWith("\r\n.\r\n", $data);
        $body = substr($data, strpos($data, "\r\n\r\n") + 4, -5);
        $this->assertSame("Bonjour,\r\n.\r\nUne ligne commençant par un point.", base64_decode(str_replace("\r\n", '', $body)));
        $this->assertFalse($server->tls);
        $this->assertTrue($server->closed);
    }

    public function testSmtpStartTlsWithAuthLogin(): void
    {
        $server = new ScriptedSmtp([
            [220, ['ready']], [250, ['host', 'STARTTLS']], [220, ['go tls']], [250, ['host', 'AUTH LOGIN']],
            [334, ['VXNlcm5hbWU6']], [334, ['UGFzc3dvcmQ6']], [235, ['ok']], [250, ['ok']], [250, ['ok']], [354, ['go']], [250, ['queued']], [221, ['bye']],
        ]);
        (new SmtpMailer(self::smtpConfig('starttls'), new FakeClock(1_790_000_000), static fn () => $server))->send(self::message());

        $this->assertTrue($server->tls, 'chiffrement négocié avant toute authentification');
        $this->assertSame(['EHLO example.test', 'STARTTLS', 'EHLO example.test', 'AUTH LOGIN', base64_encode('noreply@example.test'), base64_encode(self::PASSWORD)], array_map('trim', array_slice($server->written, 0, 6)));
        $this->assertSame(587, self::smtpConfig('starttls')->smtpPort);
    }

    public function testSmtpRefusalNeverExposesCredentials(): void
    {
        $server = new ScriptedSmtp([[220, ['ready']], [250, ['host', 'AUTH PLAIN']], [535, ['5.7.8 Authentication failed for noreply@example.test']]]);
        try {
            (new SmtpMailer(self::smtpConfig(), new FakeClock(1_790_000_000), static fn () => $server))->send(self::message());
            $this->fail('refus attendu');
        } catch (MailException $e) {
            $this->assertSame('Refus du serveur SMTP à l\'étape AUTH PLAIN (code 535).', $e->getMessage());
            $this->assertStringNotContainsString(self::PASSWORD, $e->getMessage());
            $this->assertTrue($server->closed);
        }
    }

    public function testHeaderInjectionIsImpossible(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new Message("ami@example.test\r\nBcc: victime@example.test", 'Objet', 'Corps');
    }

    public function testFileTransportWritesAnEml(): void
    {
        $dir = sys_get_temp_dir() . '/cuvylo-mail-' . bin2hex(random_bytes(4));
        $config = MailConfig::fromEnv(['MAIL_TRANSPORT' => 'file', 'MAIL_FROM' => 'noreply@example.test', 'MAIL_FILE_DIR' => $dir], 'development');
        (new FileMailer($config, new FakeClock(1_790_000_000)))->send(self::message());
        $files = glob($dir . '/*.eml') ?: [];
        $this->assertCount(1, $files);
        $this->assertStringContainsString('To: ami@example.test', (string) file_get_contents($files[0]));
        unlink($files[0]);
        rmdir($dir);
    }

    /** @return array<string, array{array<string, string>, string}> */
    public static function invalidConfigs(): array
    {
        return [
            'transport inconnu' => [['MAIL_TRANSPORT' => 'sendgrid'], 'production'],
            'expéditeur manquant' => [['MAIL_TRANSPORT' => 'mail'], 'production'],
            'smtp sans serveur' => [['MAIL_TRANSPORT' => 'smtp', 'MAIL_FROM' => 'a@example.test', 'SMTP_USER' => 'a', 'SMTP_PASSWORD' => 'b'], 'production'],
            'smtp sans identifiants' => [['MAIL_TRANSPORT' => 'smtp', 'MAIL_FROM' => 'a@example.test', 'SMTP_HOST' => 'smtp.example.test'], 'production'],
            'smtp en clair' => [['MAIL_TRANSPORT' => 'smtp', 'MAIL_FROM' => 'a@example.test', 'SMTP_HOST' => 'h.example.test', 'SMTP_USER' => 'a', 'SMTP_PASSWORD' => 'b', 'SMTP_SECURE' => 'none'], 'production'],
            'fichier en production' => [['MAIL_TRANSPORT' => 'file', 'MAIL_FROM' => 'a@example.test', 'MAIL_FILE_DIR' => '/tmp/x'], 'production'],
        ];
    }

    /** @param array<string, string> $env */
    #[\PHPUnit\Framework\Attributes\DataProvider('invalidConfigs')]
    public function testInvalidMailConfigurationIsRejected(array $env, string $appEnv): void
    {
        $this->expectException(RuntimeException::class);
        MailConfig::fromEnv($env, $appEnv);
    }

    public function testMailIsDisabledByDefault(): void
    {
        $this->assertFalse(MailConfig::fromEnv([], 'production')->enabled());
    }
}
