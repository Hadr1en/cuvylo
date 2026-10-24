<?php

declare(strict_types=1);

namespace Cuvylo\Controller;

use Cuvylo\Auth\LoginRateLimiter;
use Cuvylo\Auth\SessionManager;
use Cuvylo\Auth\TwoFactor;
use Cuvylo\Config;
use Cuvylo\Http\HttpException;
use Cuvylo\Http\Request;
use Cuvylo\Http\Response;
use Cuvylo\Support\Clock;

/**
 * Informations publiques de l'instance : inscriptions, mentions légales, durées de conservation réelles,
 * et security.txt (RFC 9116). Aucune donnée secrète ni personnelle d'un utilisateur.
 */
final class InstanceController
{
    /** Date de la version en vigueur des textes (mentions, confidentialité, sécurité). */
    public const POLICY_VERSION = '2026-10-24';

    /** Durée de validité annoncée par security.txt (la RFC impose moins d'un an). */
    private const SECURITY_TXT_TTL = 180 * 86400;

    public function __construct(
        private readonly Config $config,
        private readonly SessionManager $sessions,
        private readonly LoginRateLimiter $limiter,
        private readonly Clock $clock,
        /** Envoi d'e-mails configuré : « Mot de passe oublié » envoie alors le lien directement. */
        private readonly bool $mailEnabled = false,
    ) {
    }

    public function info(Request $request): Response
    {
        // Purge opportuniste : l'application appelle cette route à chaque ouverture, ce qui garantit les
        // durées de conservation annoncées sans tâche planifiée (souvent absente sur un hébergement mutualisé).
        $this->sessions->purgeExpired();
        $this->limiter->purge();

        return Response::json([
            'registration' => [
                'open' => $this->config->registrationEnabled,
                'inviteRequired' => $this->config->registrationInviteCode !== null,
            ],
            'maintenance' => $this->config->maintenance(),
            'features' => [
                'registrationByInvite' => true,
                'shares' => true,
                'mfa' => TwoFactor::available(),
                'passwordResetByEmail' => $this->mailEnabled,
            ],
            'legal' => $this->config->legal->toArray() + ['policyVersion' => self::POLICY_VERSION],
            'retention' => [
                'sessionIdleMinutes' => $this->config->sessionLifetimeMinutes,
                'sessionMaxDays' => $this->config->sessionAbsoluteLifetimeDays,
                'loginAttemptsHours' => (int) (LoginRateLimiter::PURGE_AFTER_SECONDS / 3600),
            ],
        ]);
    }

    public function securityTxt(Request $request): Response
    {
        $contact = $this->config->legal->securityEmail;
        if ($contact === null) {
            throw new HttpException(404, 'not_found', 'Aucun contact sécurité configuré.');
        }

        $base = $this->config->appUrl;
        $lines = [
            'Contact: mailto:' . $contact,
            'Expires: ' . gmdate('Y-m-d\TH:i:s\Z', $this->clock->now() + self::SECURITY_TXT_TTL),
            'Preferred-Languages: fr, en',
            'Canonical: ' . $base . '/.well-known/security.txt',
            'Policy: ' . $base . '/securite',
        ];

        return Response::text(implode("\n", $lines) . "\n");
    }
}
