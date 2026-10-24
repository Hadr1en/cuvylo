<?php

declare(strict_types=1);

namespace Cuvylo\Database;

use PDO;

final class Connection
{
    /** @param int|null $timeoutSeconds délai de connexion (assistant d'installation : une adresse erronée répond vite) */
    public static function open(string $dsn, ?string $user = null, ?string $password = null, ?int $timeoutSeconds = null): PDO
    {
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        if ($timeoutSeconds !== null) {
            $options[PDO::ATTR_TIMEOUT] = $timeoutSeconds;
        }
        if (str_starts_with($dsn, 'mysql:')) {
            // PHP 8.4+ : constante déplacée dans Pdo\Mysql (l'ancienne est dépréciée en 8.5).
            $initCommand = class_exists(\Pdo\Mysql::class)
                ? constant('Pdo\Mysql::ATTR_INIT_COMMAND')
                : (defined('PDO::MYSQL_ATTR_INIT_COMMAND') ? constant('PDO::MYSQL_ATTR_INIT_COMMAND') : null);
            if ($initCommand !== null) {
                $options[$initCommand] = "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'";
            }
        }

        $pdo = new PDO($dsn, $user, $password, $options);
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            $pdo->exec('PRAGMA foreign_keys = ON');
        }

        return $pdo;
    }

    public static function isSqlite(PDO $pdo): bool
    {
        return $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    }
}
