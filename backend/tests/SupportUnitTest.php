<?php

declare(strict_types=1);

namespace Cuvylo\Tests;

use Cuvylo\Auth\Totp;
use Cuvylo\Domain\Anonymizer;
use Cuvylo\Support\Base32;
use Cuvylo\Support\DeviceLabel;
use Cuvylo\Support\Ip;
use Cuvylo\Support\Logger;
use Cuvylo\Support\Sealer;
use Cuvylo\Support\StoredJson;
use PHPUnit\Framework\TestCase;

/** Briques sans base : TOTP, base32, chiffrement, compression, IP, appareil, journal mensuel, anonymisation. */
final class SupportUnitTest extends TestCase
{
    private const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // « 12345678901234567890 » (RFC 6238, SHA-1)

    public function testBase32RoundTripAndRfcVector(): void
    {
        $this->assertSame(self::RFC_SECRET, Base32::encode('12345678901234567890'));
        $this->assertSame('12345678901234567890', Base32::decode(strtolower(self::RFC_SECRET)));
        $bytes = random_bytes(20);
        $this->assertSame($bytes, Base32::decode(Base32::encode($bytes)));
        $this->assertNull(Base32::decode('ABC1'), '1 n\'est pas dans l\'alphabet');
    }

    public function testTotpMatchesRfc6238Vectors(): void
    {
        // Annexe B de la RFC 6238 (8 chiffres) : on compare les 6 derniers.
        $this->assertSame('287082', Totp::code(self::RFC_SECRET, Totp::step(59)));
        $this->assertSame('081804', Totp::code(self::RFC_SECRET, Totp::step(1111111109)));
        $this->assertSame('050471', Totp::code(self::RFC_SECRET, Totp::step(1111111111)));
        $this->assertSame('005924', Totp::code(self::RFC_SECRET, Totp::step(1234567890)));
        $this->assertSame('279037', Totp::code(self::RFC_SECRET, Totp::step(2000000000)));
    }

    public function testTotpWindowAndReplayProtection(): void
    {
        $secret = Totp::generateSecret();
        $now = 1_800_000_000;
        $step = Totp::step($now);

        $this->assertSame($step, Totp::verify($secret, Totp::code($secret, $step), $now));
        $this->assertSame($step - 1, Totp::verify($secret, Totp::code($secret, $step - 1), $now), '±1 pas toléré');
        $this->assertSame($step + 1, Totp::verify($secret, Totp::code($secret, $step + 1), $now));
        $this->assertNull(Totp::verify($secret, Totp::code($secret, $step - 2), $now), 'au-delà : refusé');
        $this->assertNull(Totp::verify($secret, Totp::code($secret, $step), $now, $step), 'code déjà utilisé : refusé');
        $this->assertNull(Totp::verify($secret, "123456\n", $now));
        $this->assertNull(Totp::verify($secret, 'abcdef', $now));
        $this->assertStringStartsWith('otpauth://totp/Cuvylo:a%40example.test?secret=' . $secret, Totp::uri($secret, 'a@example.test'));
    }

    public function testSealerIsAuthenticatedEncryption(): void
    {
        $sealer = new Sealer(str_repeat('k', 32));
        $sealed = $sealer->seal('JBSWY3DPEHPK3PXP');
        $this->assertStringStartsWith('v1:', $sealed);
        $this->assertStringNotContainsString('JBSWY3DPEHPK3PXP', $sealed);
        $this->assertNotSame($sealed, $sealer->seal('JBSWY3DPEHPK3PXP'), 'IV aléatoire');
        $this->assertSame('JBSWY3DPEHPK3PXP', $sealer->open($sealed));

        $raw = base64_decode(substr($sealed, 3));
        $tampered = 'v1:' . base64_encode(substr($raw, 0, -1) . chr(ord($raw[strlen($raw) - 1]) ^ 1));
        $this->assertNull($sealer->open($tampered), 'altération détectée');
        $this->assertNull((new Sealer(str_repeat('z', 32)))->open($sealed), 'autre APP_KEY : illisible');
        $this->assertNull((new Sealer(str_repeat('k', 32), 'autre-contexte'))->open($sealed), 'clé dérivée par contexte');
    }

    public function testStoredJsonCompressionIsTransparent(): void
    {
        $doc = ['summary' => str_repeat('Texte répétitif. ', 500), 'n' => 1];
        $packed = StoredJson::encode($doc, true);
        $this->assertStringStartsWith('gz:', $packed);
        $this->assertLessThan(strlen(json_encode($doc)), strlen($packed));
        $this->assertSame($doc, StoredJson::decode($packed));
        $this->assertSame($doc, StoredJson::decode(StoredJson::encode($doc)), 'les lignes non compressées restent lisibles');
    }

    public function testIpv6IsGroupedBySlash64(): void
    {
        $this->assertSame('203.0.113.7', Ip::rateLimitKey('203.0.113.7'));
        $this->assertSame('2001:db8:1:2::/64', Ip::rateLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'));
        $this->assertSame(Ip::rateLimitKey('2001:db8:1:2::1'), Ip::rateLimitKey('2001:0db8:0001:0002:ffff::9'));
        $this->assertNotSame(Ip::rateLimitKey('2001:db8:1:2::1'), Ip::rateLimitKey('2001:db8:1:3::1'));
        $this->assertSame('192.0.2.1', Ip::rateLimitKey('::ffff:192.0.2.1'), 'IPv4 encapsulée');
        $this->assertSame('pas-une-ip', Ip::rateLimitKey('pas-une-ip'));
    }

    public function testDeviceLabelIsCoarse(): void
    {
        $this->assertSame('Firefox · Windows', DeviceLabel::fromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'));
        $this->assertSame('Chrome · macOS', DeviceLabel::fromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'));
        $this->assertSame('Safari · iOS', DeviceLabel::fromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'));
        $this->assertSame('Edge · Windows', DeviceLabel::fromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'));
        $this->assertSame('Chrome · Android', DeviceLabel::fromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'));
        $this->assertSame('Appareil inconnu', DeviceLabel::fromUserAgent(''));
        $this->assertSame('Appareil inconnu', DeviceLabel::fromUserAgent('curl/8.0'));
        $this->assertStringNotContainsString('131', DeviceLabel::fromUserAgent('Firefox/131.0 (Windows)'), 'aucune version conservée');
    }

    public function testMonthlyLogPath(): void
    {
        $this->assertSame('/logs/cv-2026-10.log', Logger::resolvePath('/logs/cv-{month}.log', gmmktime(12, 0, 0, 10, 24, 2026)));
        $this->assertSame('/logs/cv.log', Logger::resolvePath('/logs/cv.log', time()));

        $dir = sys_get_temp_dir() . '/cuvylo-log-' . bin2hex(random_bytes(4));
        mkdir($dir);
        $logger = Logger::toFile($dir . '/app-{month}.log', static fn (): int => gmmktime(0, 0, 0, 1, 15, 2027));
        $logger->info('probe', ['status' => 200]);
        $file = $dir . '/app-2027-01.log';
        $this->assertFileExists($file);
        $this->assertStringContainsString('"event":"probe"', (string) file_get_contents($file));
        unlink($file);
        rmdir($dir);
    }

    public function testAnonymizerKeepsInitialsOnly(): void
    {
        $data = [
            'identity' => ['firstName' => 'Émilie', 'lastName' => 'dupont', 'headline' => 'Consultante', 'email' => 'e@example.test', 'phone' => '06', 'location' => 'Lille', 'details' => '', 'photo' => 'data:image/png;base64,AAAA'],
            'links' => [['id' => 'l', 'label' => 'LinkedIn', 'url' => 'https://example.test']],
            'summary' => 'Résumé',
        ];
        $anon = Anonymizer::apply($data);
        $this->assertSame('É.', $anon['identity']['firstName']);
        $this->assertSame('D.', $anon['identity']['lastName']);
        $this->assertSame('', $anon['identity']['email']);
        $this->assertSame('', $anon['identity']['phone']);
        $this->assertSame('', $anon['identity']['photo']);
        $this->assertSame([], $anon['links']);
        $this->assertSame('Consultante', $anon['identity']['headline']);
        $this->assertSame('Résumé', $anon['summary']);
    }

    /** Même entrée piégée que le test TypeScript (domain/anonymize.parity.test.ts) : sorties identiques. */
    public function testAnonymizerMatchesTheBrowserPolicy(): void
    {
        $dir = dirname(__DIR__, 2) . '/shared/fixtures';
        $input = json_decode((string) file_get_contents($dir . '/anonymize-input.json'), true, 64, JSON_THROW_ON_ERROR);
        $expected = json_decode((string) file_get_contents($dir . '/anonymize-expected.json'), true, 64, JSON_THROW_ON_ERROR);
        $this->assertSame($expected, Anonymizer::apply($input));
        $this->assertSame('L. F.', Anonymizer::initials('de La Fontaine'));
        $this->assertSame('O.', Anonymizer::initials('O’Neil'));
        $this->assertSame('Lille, France', Anonymizer::cityOnly('12 rue des Lilas, 59000 Lille, France'));
    }
}
