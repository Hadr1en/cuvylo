import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { InstanceInfo } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { useInstance } from '@/hooks/useInstance'
import { LegalFooter } from '@/ui/LegalFooter'
import { ThemeToggle, Wordmark } from '@/ui/Shell'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

/**
 * Pages légales d'une INSTANCE de Cuvylo. Le texte est générique ; les informations propres à
 * l'exploitant (éditeur, contact, hébergeur) viennent de sa configuration via GET /api/instance.
 * Repères généraux (LCEN, RGPD), pas un conseil juridique.
 */

function Missing({ what }: { what: string }) {
  return <span className="rounded-sm bg-warn-soft px-1 text-warn">à renseigner par l’exploitant ({what})</span>
}

function Mail({ address, fallback }: { address: string | null; fallback: string }) {
  return address ? (
    <a href={`mailto:${address}`} className="link">
      {address}
    </a>
  ) : (
    <Missing what={fallback} />
  )
}

function LegalLayout({ title, eyebrow, children }: { title: string; eyebrow: string; children: (info: InstanceInfo) => ReactNode }) {
  const instance = useInstance()
  const { status } = useAuth()
  useDocumentTitle(title)

  return (
    <div className="min-h-dvh">
      <header className="bg-nav text-nav-strong">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <Link to={status === 'authenticated' ? '/' : '/connexion'} aria-label="Cuvylo — retour">
            <Wordmark inverse />
          </Link>
          <ThemeToggle className="btn btn-icon border-transparent bg-transparent text-nav-text hover:!bg-nav-hover hover:!text-nav-strong" />
        </div>
      </header>

      <main id="contenu" className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <p className="overline mb-2">{eyebrow}</p>
        <h1 className="mb-8 text-[2rem]">{title}</h1>

        {instance.status === 'loading' ? (
          <p role="status" className="text-muted">
            Chargement…
          </p>
        ) : instance.status === 'error' ? (
          <p role="alert" className="notice notice-danger text-sm">
            Impossible de charger les informations de cette instance. Réessayez plus tard.
          </p>
        ) : (
          <>
            {!instance.info.legal.contactEmail || !instance.info.legal.host ? (
              <p role="note" className="notice notice-warn mb-8 text-sm">
                Configuration incomplète : l’exploitant de cette instance doit renseigner <code>LEGAL_CONTACT_EMAIL</code> et{' '}
                <code>LEGAL_HOST</code> dans sa configuration.
              </p>
            ) : null}
            <div className="legal grid gap-8 text-[0.98rem] leading-relaxed [&_h2]:mb-2 [&_h2]:text-xl [&_li]:ml-5 [&_li]:list-disc [&_p+p]:mt-2 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:mt-2 [&_ul]:grid [&_ul]:gap-1">
              {children(instance.info)}
            </div>
            <p className="mt-12 border-t border-line pt-4 text-sm text-faint">
              Version du {new Date(`${instance.info.legal.policyVersion}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </p>
          </>
        )}
        <LegalFooter className="mt-6" />
      </main>
    </div>
  )
}

export function LegalNoticePage() {
  return (
    <LegalLayout eyebrow="Informations légales" title="Mentions légales">
      {({ legal, registration }) => (
        <>
          <section>
            <h2>Éditeur</h2>
            {legal.publisher ? (
              <p>
                Ce site est édité par <strong>{legal.publisher}</strong>, qui en est également directeur ou directrice de la publication.
              </p>
            ) : (
              <p>
                Ce site est édité par un particulier, à titre non professionnel. Conformément à l’article 6-III-2 de la loi
                n° 2004-575 du 21 juin 2004 (LCEN), ses coordonnées ont été communiquées à l’hébergeur, qui les tient à
                disposition des autorités.
              </p>
            )}
            <p>
              Contact : <Mail address={legal.contactEmail} fallback="LEGAL_CONTACT_EMAIL" />
            </p>
          </section>

          <section>
            <h2>Hébergeur</h2>
            <p>{legal.host ?? <Missing what="LEGAL_HOST" />}</p>
          </section>

          <section>
            <h2>Nature du service</h2>
            <p>
              Cuvylo est un outil de rédaction de CV.{' '}
              {!registration.open
                ? 'Les inscriptions sont fermées : seules les personnes disposant déjà d’un compte y ont accès.'
                : registration.inviteRequired
                  ? 'Cette instance est privée : l’inscription nécessite un code remis par l’exploitant.'
                  : 'Les inscriptions sont ouvertes.'}{' '}
              Il est fourni gracieusement, sans garantie de disponibilité ni de résultat. En particulier, l’analyse « ATS » et la
              comparaison à une offre signalent des risques connus mais ne garantissent la compatibilité avec aucun logiciel de
              recrutement.
            </p>
          </section>

          <section>
            <h2>Contenus et propriété intellectuelle</h2>
            <p>
              Les CV et profils restent la propriété de leurs auteurs, qui sont seuls responsables de leur exactitude. L’outil ne
              rédige ni n’invente aucun contenu à leur place.
            </p>
            <p>
              Polices de caractères : Bricolage Grotesque, IBM Plex Sans, JetBrains Mono, Inter et Newsreader, sous licence SIL Open
              Font License 1.1, servies depuis ce site (aucun appel à un service tiers).
            </p>
          </section>

          <section>
            <h2>Données personnelles</h2>
            <p>
              Voir la <Link to="/confidentialite" className="link">politique de confidentialité</Link>.
            </p>
          </section>
        </>
      )}
    </LegalLayout>
  )
}

export function PrivacyPage() {
  return (
    <LegalLayout eyebrow="RGPD" title="Confidentialité">
      {({ legal, retention }) => {
        const idleDays = Math.round(retention.sessionIdleMinutes / 1440)
        return (
          <>
            <section>
              <h2>En bref</h2>
              <ul>
                <li>Le service est gratuit.</li>
                <li>
                  L’analyse d’un CV sans compte se fait entièrement dans votre navigateur : le fichier et l’éventuelle offre comparée ne sont ni envoyés
                  ni conservés.
                </li>
                <li>
                  Avec un compte, vos données servent uniquement à rédiger, conserver et exporter vos CV et à suivre vos candidatures. Votre adresse e-mail
                  sert uniquement à vous connecter et à réinitialiser votre mot de passe.
                </li>
                <li>Aucune publicité, aucune newsletter, aucun traceur, aucune mesure d’audience, aucune IA, aucune revente ni transmission à des tiers.</li>
                <li>Vous pouvez à tout moment exporter toutes vos données et supprimer votre compte, depuis la page « Compte ».</li>
              </ul>
            </section>

            <section>
              <h2>Responsable du traitement</h2>
              <p>
                L’exploitant de cette instance{legal.publisher ? ` (${legal.publisher})` : ''}, joignable à{' '}
                <Mail address={legal.contactEmail} fallback="LEGAL_CONTACT_EMAIL" />. Les données sont stockées chez l’hébergeur indiqué
                dans les <Link to="/mentions-legales" className="link">mentions légales</Link>,
                qui agit comme sous-traitant.
              </p>
              <p>
                L’interface d’administration de l’exploitant ne donne accès qu’aux informations de compte (adresse e-mail, dates de création et de dernière
                connexion, espace utilisé, nombre de CV) : ni au contenu de vos CV, lettres et candidatures, ni à un téléchargement de la base. Un lien de
                réinitialisation de mot de passe ne peut être créé qu’après votre demande (« Mot de passe oublié »).
              </p>
              <p>
                Si l’instance envoie des e-mails (lien de réinitialisation du mot de passe, confirmation de changement), votre adresse et le contenu du
                message sont transmis au service d’envoi choisi par l’exploitant, qui agit comme sous-traitant. Aucun autre e-mail ne vous est envoyé.
              </p>
            </section>

            <section>
              <h2>Données traitées</h2>
              <ul>
                <li>
                  <strong>Compte</strong> : adresse e-mail, nom affiché (facultatif), mot de passe sous forme hachée — il n’est jamais stocké en clair.
                </li>
                <li>
                  <strong>Contenu</strong> : votre profil et vos CV, tels que vous les saisissez (coordonnées, parcours, compétences, photo si vous en
                  ajoutez une), leurs versions enregistrées, vos lettres de motivation et le suivi de vos candidatures (y compris le texte d’annonce si vous
                  choisissez de l’y conserver). Ne saisissez que ce que vous souhaitez voir figurer sur un CV.
                </li>
                <li>
                  <strong>Liens de partage</strong> : si vous en créez, une copie figée de ce que montre le PDF du CV concerné (rubriques masquées
                  exclues ; en mode anonyme, sans nom, coordonnées, adresse ni liens), consultable par toute personne disposant du lien jusqu’à sa
                  révocation ou son expiration, et un compteur de consultations (sans adresse IP).
                </li>
                <li>
                  <strong>Sécurité</strong> : une empreinte du jeton de session, ses dates et un libellé grossier de l’appareil (navigateur et système,
                  pour la liste de vos sessions) ; la date de dernière connexion ; si vous l’activez, le secret de double authentification (chiffré) et
                  les empreintes de vos codes de secours ; pour la limitation des tentatives de connexion, une empreinte non réversible (HMAC) de
                  l’e-mail saisi et de l’adresse IP.
                </li>
                <li>
                  <strong>Journaux techniques</strong> : date, adresse appelée, code de réponse, durée et identifiant interne du compte. Ils ne
                  contiennent ni adresse IP, ni e-mail, ni contenu de CV. L’hébergeur tient par ailleurs ses propres journaux d’accès.
                </li>
                <li>
                  <strong>Dans votre navigateur uniquement</strong> : le thème choisi, les fiches de poste collées dans l’onglet « Offre » et,
                  en cas de coupure, un brouillon des modifications pas encore enregistrées. Ces éléments ne sont pas envoyés au serveur et sont
                  effacés à la déconnexion.
                </li>
              </ul>
            </section>

            <section>
              <h2>Finalités et bases légales</h2>
              <ul>
                <li>Fournir le service que vous avez demandé en créant un compte (exécution de ce service).</li>
                <li>Protéger les comptes et le service contre les abus (intérêt légitime : sécurité).</li>
              </ul>
            </section>

            <section>
              <h2>Durées de conservation</h2>
              <ul>
                <li>Compte, profil, CV, lettres et candidatures : jusqu’à la suppression du compte.</li>
                <li>Versions d’un CV : 50 au plus par CV, les plus anciennes sauvegardes automatiques sont remplacées en premier.</li>
                <li>
                  Liens de partage : jusqu’à leur révocation (copie effacée aussitôt) ou leur expiration (copie effacée dès la première utilisation
                  du site qui suit) ; seuls la date et le compteur de consultations restent, pour votre export.
                </li>
                <li>
                  Sessions : expirent après {idleDays > 0 ? `${idleDays} jour${idleDays > 1 ? 's' : ''}` : `${retention.sessionIdleMinutes} minutes`} sans
                  activité et au plus tard après {retention.sessionMaxDays} jours ; supprimées à la déconnexion.
                </li>
                <li>Tentatives de connexion : effacées au-delà de {retention.loginAttemptsHours} heures.</li>
                <li>Journaux techniques : 12 mois au plus.</li>
              </ul>
            </section>

            <section>
              <h2>Cookies</h2>
              <p>
                Deux cookies strictement nécessaires, sans consentement requis : <code>cuvylo_session</code> (maintenir votre connexion,
                inaccessible au JavaScript) et <code>cuvylo_csrf</code> (protéger vos actions contre les requêtes forgées), préfixés par{' '}
                <code>__Host-</code> en HTTPS. Aucun autre
                cookie, aucun traceur.
              </p>
            </section>

            <section>
              <h2>Vos droits</h2>
              <ul>
                <li>Accès et rectification : directement dans l’application.</li>
                <li>Portabilité : « Compte » → « Exporter toutes mes données » (fichier JSON complet).</li>
                <li>Effacement : « Compte » → « Supprimer mon compte » ; l’effacement est immédiat et définitif.</li>
                <li>
                  Opposition, limitation, toute autre question : <Mail address={legal.contactEmail} fallback="LEGAL_CONTACT_EMAIL" />.
                </li>
                <li>
                  Réclamation : auprès de la CNIL (<a href="https://www.cnil.fr" className="link" rel="noreferrer noopener" target="_blank">cnil.fr</a>).
                </li>
              </ul>
            </section>

            <section>
              <h2>Sécurité</h2>
              <p>
                Mots de passe hachés, sessions révocables, protection contre les requêtes forgées, cloisonnement strict entre comptes,
                connexion chiffrée (HTTPS). Détail sur la page <Link to="/securite" className="link">sécurité</Link>.
              </p>
            </section>
          </>
        )
      }}
    </LegalLayout>
  )
}

export function SecurityPage() {
  return (
    <LegalLayout eyebrow="Politique de sécurité" title="Sécurité">
      {({ legal }) => (
        <>
          <section>
            <h2>Signaler une vulnérabilité</h2>
            <p>
              Écrivez à <Mail address={legal.securityEmail} fallback="SECURITY_CONTACT_EMAIL ou LEGAL_CONTACT_EMAIL" /> en décrivant le
              problème, les étapes pour le reproduire et son impact. Une réponse vous sera apportée dans les meilleurs délais ; merci de
              laisser le temps de corriger avant toute publication.
            </p>
            <p>
              {/* Lien direct vers l'API : certains hébergeurs réservent le dossier /.well-known et y répondent 403. */}
              Le contact figure aussi au format standard (RFC 9116) dans{' '}
              <a href="/api/security-txt" className="link">
                security.txt
              </a>
              , également servi à l’adresse habituelle <code>/.well-known/security.txt</code> quand l’hébergeur le permet.
            </p>
          </section>

          <section>
            <h2>Règles de bonne conduite</h2>
            <ul>
              <li>N’accédez qu’à votre propre compte ; n’essayez jamais de lire ou modifier les données d’autrui.</li>
              <li>Pas de test de déni de service, d’ingénierie sociale ni d’attaque de l’hébergeur.</li>
              <li>Ne conservez pas de données personnelles obtenues par erreur et signalez-le.</li>
            </ul>
          </section>

          <section>
            <h2>Mesures en place</h2>
            <ul>
              <li>Mots de passe hachés (algorithme natif de PHP), 12 caractères minimum.</li>
              <li>Sessions stockées sous forme d’empreinte, expiration glissante et plafond absolu, révocation à la déconnexion.</li>
              <li>Jeton anti-CSRF signé et lié à la session, contrôle de l’origine des requêtes.</li>
              <li>Limitation des tentatives de connexion ; mot de passe redemandé pour supprimer le compte.</li>
              <li>Chaque requête est cloisonnée au compte connecté : la ressource d’un autre compte est introuvable.</li>
              <li>Validation stricte côté serveur ; requêtes SQL préparées ; aucun HTML interprété.</li>
              <li>Aucun secret côté navigateur ; aucune donnée personnelle dans les journaux techniques.</li>
            </ul>
          </section>
        </>
      )}
    </LegalLayout>
  )
}
