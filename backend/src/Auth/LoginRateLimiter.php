<?php

declare(strict_types=1);

namespace Cuvylo\Auth;

use Cuvylo\Config;
use Cuvylo\Http\HttpException;
use Cuvylo\Support\Clock;
use Cuvylo\Support\Ip;
use Cuvylo\Support\Ulid;
use PDO;

/**
 * Limitation des tentatives d'authentification :
 * - 5 échecs / 15 min par couple (e-mail, IP) et 20 échecs / 15 min par IP (IPv6 regroupée par /64) ;
 * - délai progressif par e-mail, toutes IP confondues, à partir de 10 échecs dans l'heure
 *   (30 s, puis doublé à chaque échec, plafonné à 15 min : ralentit sans verrouiller durablement le compte) ;
 * - inscriptions comptées par IP (10 / heure).
 * La tentative est enregistrée AVANT la vérification du mot de passe (pas de course entre requêtes parallèles).
 * E-mail et IP ne sont stockés que sous forme de HMAC. `success` : 0 échec (ou en cours), 1 succès, 2 inscription.
 */
final class LoginRateLimiter
{
    public const WINDOW_SECONDS = 900;
    public const MAX_PER_PAIR = 5;
    public const MAX_PER_IP = 20;

    public const EMAIL_WINDOW_SECONDS = 3600;
    public const EMAIL_THRESHOLD = 10;
    public const EMAIL_BASE_DELAY = 30;
    public const EMAIL_MAX_DELAY = 900;

    public const REGISTRATION_WINDOW_SECONDS = 3600;
    /** Valeur par défaut ; réglable par REGISTRATION_MAX_PER_IP_HOUR (Config::$registrationsPerIpHour). */
    public const MAX_REGISTRATIONS_PER_IP = 10;

    /** Les tentatives (e-mail et IP sous forme de HMAC) sont effacées au-delà de ce délai. */
    public const PURGE_AFTER_SECONDS = 86400;

    private const FAILURE = 0;
    private const SUCCESS = 1;
    private const REGISTRATION = 2;

    public function __construct(
        private readonly PDO $pdo,
        private readonly Config $config,
        private readonly Clock $clock,
    ) {
    }

    /** @return int|null Secondes à attendre si une limite est atteinte, null sinon. */
    public function retryAfter(string $email, string $ip): ?int
    {
        $emailHash = $this->hash($email);
        $ipHash = $this->hashIp($ip);
        $now = $this->clock->now();

        $pair = $this->times('SELECT attempted_at FROM login_attempts WHERE email_hash = ? AND ip_hash = ? AND success = 0 AND attempted_at > ? ORDER BY attempted_at ASC', [$emailHash, $ipHash], self::WINDOW_SECONDS);
        $perIp = $this->times('SELECT attempted_at FROM login_attempts WHERE ip_hash = ? AND success = 0 AND attempted_at > ? ORDER BY attempted_at ASC', [$ipHash], self::WINDOW_SECONDS);

        $waits = [];
        foreach ([[$pair, self::MAX_PER_PAIR], [$perIp, self::MAX_PER_IP]] as [$times, $max]) {
            if (count($times) >= $max) {
                // La limite retombe quand l'échec de rang (n - max) sort de la fenêtre.
                $waits[] = max(1, $times[count($times) - $max] + self::WINDOW_SECONDS - $now);
            }
        }

        $perEmail = $this->times('SELECT attempted_at FROM login_attempts WHERE email_hash = ? AND success = 0 AND attempted_at > ? ORDER BY attempted_at ASC', [$emailHash], self::EMAIL_WINDOW_SECONDS);
        $count = count($perEmail);
        if ($count >= self::EMAIL_THRESHOLD) {
            $delay = (int) min(self::EMAIL_MAX_DELAY, self::EMAIL_BASE_DELAY * (2 ** min(10, $count - self::EMAIL_THRESHOLD)));
            $wait = $perEmail[$count - 1] + $delay - $now;
            if ($wait > 0) {
                $waits[] = $wait;
            }
        }

        return $waits === [] ? null : max($waits);
    }

    /**
     * Enregistre la tentative (comme un échec) AVANT toute vérification et renvoie son identifiant ;
     * `succeeded()` la requalifie ensuite. Deux requêtes parallèles se voient donc mutuellement.
     *
     * @throws HttpException 429
     */
    public function begin(string $email, string $ip): string
    {
        $retry = $this->retryAfter($email, $ip);
        if ($retry !== null) {
            throw HttpException::rateLimited($retry);
        }
        $id = $this->record($email, $ip, self::FAILURE);

        // Course : des tentatives concurrentes ont pu passer le contrôle en même temps que celle-ci.
        $since = $this->clock->sql($this->clock->now() - self::WINDOW_SECONDS);
        $pair = $this->pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE email_hash = ? AND ip_hash = ? AND success = 0 AND attempted_at > ?');
        $pair->execute([$this->hash($email), $this->hashIp($ip), $since]);
        $perIp = $this->pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND success = 0 AND attempted_at > ?');
        $perIp->execute([$this->hashIp($ip), $since]);
        if ((int) $pair->fetchColumn() > self::MAX_PER_PAIR || (int) $perIp->fetchColumn() > self::MAX_PER_IP) {
            $this->forget($id);
            throw HttpException::rateLimited(self::WINDOW_SECONDS);
        }

        return $id;
    }

    public function succeeded(string $attemptId): void
    {
        $stmt = $this->pdo->prepare('UPDATE login_attempts SET success = 1 WHERE id = ?');
        $stmt->execute([$attemptId]);
    }

    /** @throws HttpException 429 */
    public function assertNotLimited(string $email, string $ip): void
    {
        $retry = $this->retryAfter($email, $ip);
        if ($retry !== null) {
            throw HttpException::rateLimited($retry);
        }
    }

    public function recordFailure(string $email, string $ip): void
    {
        $this->record($email, $ip, self::FAILURE);
    }

    public function recordSuccess(string $email, string $ip): void
    {
        $this->record($email, $ip, self::SUCCESS);
    }

    /** @return int|null Secondes à attendre si l'IP a atteint le plafond d'inscriptions, null sinon. */
    public function registrationRetryAfter(string $ip): ?int
    {
        $times = $this->times(
            'SELECT attempted_at FROM login_attempts WHERE ip_hash = ? AND success = ' . self::REGISTRATION . ' AND attempted_at > ? ORDER BY attempted_at ASC',
            [$this->hashIp($ip)],
            self::REGISTRATION_WINDOW_SECONDS,
        );
        $max = $this->config->registrationsPerIpHour;
        if (count($times) < $max) {
            return null;
        }

        return max(1, $times[count($times) - $max] + self::REGISTRATION_WINDOW_SECONDS - $this->clock->now());
    }

    public function recordRegistration(string $email, string $ip): void
    {
        $this->record($email, $ip, self::REGISTRATION);
    }

    /** Purge opportuniste des tentatives de plus de 24 h. */
    public function purge(): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM login_attempts WHERE attempted_at <= ?');
        $stmt->execute([$this->clock->sql($this->clock->now() - self::PURGE_AFTER_SECONDS)]);
    }

    /**
     * @param list<string> $params
     * @return list<int> Horodatages dans la fenêtre, du plus ancien au plus récent.
     */
    private function times(string $sql, array $params, int $window): array
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([...$params, $this->clock->sql($this->clock->now() - $window)]);

        return array_map(
            static fn (string $at): int => Clock::sqlToTimestamp($at),
            $stmt->fetchAll(PDO::FETCH_COLUMN),
        );
    }

    private function record(string $email, string $ip, int $success): string
    {
        $id = Ulid::generate($this->clock->now());
        $stmt = $this->pdo->prepare('INSERT INTO login_attempts (id, email_hash, ip_hash, attempted_at, success) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$id, $this->hash($email), $this->hashIp($ip), $this->clock->sql(), $success]);

        return $id;
    }

    private function forget(string $id): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM login_attempts WHERE id = ?');
        $stmt->execute([$id]);
    }

    private function hashIp(string $ip): string
    {
        return $this->hash(Ip::rateLimitKey($ip));
    }

    private function hash(string $value): string
    {
        return hash_hmac('sha256', strtolower($value), $this->config->appKey);
    }
}
