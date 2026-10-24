<?php

declare(strict_types=1);

namespace Cuvylo\Mail;

/** Textes des e-mails envoyés par l'application (texte brut, en français). */
final class Emails
{
    public static function passwordResetLink(string $to, string $url, int $minutes, string $appUrl): Message
    {
        return new Message($to, 'Réinitialisation de votre mot de passe Cuvylo', implode("\n", [
            'Bonjour,',
            '',
            'Une réinitialisation du mot de passe de votre compte Cuvylo a été demandée.',
            'Pour choisir un nouveau mot de passe, ouvrez ce lien :',
            '',
            $url,
            '',
            'Il est valable ' . $minutes . ' minutes et ne fonctionne qu\'une fois.',
            '',
            'Si vous n\'êtes pas à l\'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.',
            '',
            '—',
            'Cuvylo · ' . $appUrl,
            'Message automatique, merci de ne pas y répondre.',
        ]));
    }

    public static function passwordChanged(string $to, string $appUrl): Message
    {
        return new Message($to, 'Votre mot de passe Cuvylo a été modifié', implode("\n", [
            'Bonjour,',
            '',
            'Le mot de passe de votre compte Cuvylo vient d\'être modifié. Par sécurité, les autres sessions ouvertes ont été fermées.',
            '',
            'Si vous n\'êtes pas à l\'origine de ce changement, utilisez sans attendre « Mot de passe oublié » sur la page de connexion',
            'et prévenez la personne qui gère ce site :',
            '',
            $appUrl . '/mot-de-passe-oublie',
            '',
            '—',
            'Cuvylo · ' . $appUrl,
            'Message automatique, merci de ne pas y répondre.',
        ]));
    }
}
