/**
 * Configuration partagée des tests de bout en bout (config Playwright + préparation de la base).
 * La base se règle avec E2E_DB_DSN / E2E_DB_USER / E2E_DB_PASSWORD ; défaut : MySQL local, port 3307,
 * utilisateur root sans mot de passe, base `cuvylo_e2e`.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const API_PORT = Number(process.env.E2E_API_PORT ?? 8081)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174)
export const ORIGIN = `http://127.0.0.1:${WEB_PORT}`

/** Compte administrateur des tests (créé par l'installation sur une base neuve). Adresse fictive. */
export const ADMIN_EMAIL = 'admin-e2e@example.test'

/** Dossier où l'API écrit les e-mails des tests (transport « file ») : la « boîte de réception » des tests. */
export const MAIL_DIR = join(tmpdir(), 'cuvylo-e2e-mail')

export const apiEnv: Record<string, string> = {
  APP_ENV: 'development',
  APP_URL: ORIGIN,
  // Clé factice de test (non secrète) : 38 octets, jamais utilisée hors e2e.
  APP_KEY: 'ZTJlLW9ubHktbm90LWEtc2VjcmV0LWtleS0wMDAwMDAwMDAwMDA=',
  DB_DSN: process.env.E2E_DB_DSN ?? 'mysql:host=127.0.0.1;port=3307;dbname=cuvylo_e2e;charset=utf8mb4',
  DB_USER: process.env.E2E_DB_USER ?? 'root',
  DB_PASSWORD: process.env.E2E_DB_PASSWORD ?? '',
  REGISTRATION_ENABLED: 'true',
  REGISTRATION_INVITE_CODE: '',
  // Chaque test crée son propre compte depuis 127.0.0.1 : la limite anti-abus est relevée ici seulement.
  REGISTRATION_MAX_PER_IP_HOUR: '1000',
  // Code d'installation FICTIF (base de test neuve) et administrateur des tests.
  SETUP_CODE: 'e2e-code-installation-fictif',
  ADMIN_EMAILS: ADMIN_EMAIL,
  // E-mails écrits dans un dossier (jamais envoyés) : le parcours « Mot de passe oublié » est testé de bout en bout.
  MAIL_TRANSPORT: 'file',
  MAIL_FROM: 'noreply@example.test',
  MAIL_FILE_DIR: MAIL_DIR,
  LOG_PATH: '',
  // Informations légales FICTIVES de l'instance de test.
  LEGAL_PUBLISHER: '',
  LEGAL_CONTACT_EMAIL: 'contact@example.test',
  LEGAL_HOST: 'Hébergeur Exemple SAS, 1 rue du Test, 59000 Lille',
  SECURITY_CONTACT_EMAIL: 'securite@example.test',
}
