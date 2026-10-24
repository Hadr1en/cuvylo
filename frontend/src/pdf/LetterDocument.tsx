import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { LetterData, LetterSettings } from '@/api/client'
import { defaultSettings } from '@/domain/cv'
import type { ProfileData } from '@/domain/profile'
import { themeFor } from './themes'

const INK = '#1a1a1a'
const MUTED = '#4d4d4d'

export interface LetterDocumentProps {
  letter: LetterData
  settings: LetterSettings
  /** Expéditeur : l'identité du CV associé (ou du profil). */
  sender: ProfileData['identity']
  title?: string | undefined
}

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)

/**
 * Lettre de motivation au format français usuel : expéditeur en haut à gauche, destinataire
 * à droite, lieu et date, objet, corps, formule de politesse, signature. Typographie et couleur
 * reprises du modèle de CV choisi, pour un ensemble cohérent.
 */
export function LetterDocument({ letter, settings, sender, title }: LetterDocumentProps) {
  const theme = themeFor({ ...defaultSettings(), template: settings.template, accent: settings.accent, locale: settings.locale })
  const accent = theme.monochrome ? INK : settings.accent
  const name = [sender.firstName, sender.lastName].filter(Boolean).join(' ')
  const body = { fontSize: theme.body + 0.8, lineHeight: 1.5 }
  const objectLabel = settings.locale === 'en' ? 'Subject: ' : 'Objet : '
  const placeDate = [letter.place, letter.date].filter(Boolean).join(settings.locale === 'en' ? ', ' : ', le ')

  return (
    <Document title={title ?? letter.subject ?? 'Lettre'} author={name || undefined} creator="Cuvylo" producer="Cuvylo" language={settings.locale === 'en' ? 'en-US' : 'fr-FR'}>
      <Page size="A4" style={{ fontFamily: theme.bodyFont, color: INK, paddingTop: 54, paddingBottom: 54, paddingHorizontal: 62, ...body }}>
        <View style={{ marginBottom: 26 }}>
          {name ? <Text style={{ fontFamily: theme.headingFont, fontWeight: theme.headingWeight, fontSize: 15, color: theme.accentName || theme.accentTitles ? accent : INK }}>{name}</Text> : null}
          {sender.headline ? <Text style={{ fontSize: theme.small + 0.5, color: MUTED, marginTop: 2 }}>{sender.headline}</Text> : null}
          {[sender.email, sender.phone, sender.location].filter(Boolean).map((l) => (
            <Text key={l} style={{ fontSize: theme.small + 0.5, color: MUTED }}>
              {l}
            </Text>
          ))}
        </View>

        <View style={{ marginLeft: '52%', marginBottom: 26 }}>
          {[letter.recipient.name, letter.recipient.company, ...lines(letter.recipient.address)].filter(Boolean).map((l, i) => (
            <Text key={i} style={{ fontWeight: i === 0 ? 600 : 400 }}>
              {l}
            </Text>
          ))}
          {placeDate ? <Text style={{ marginTop: 14 }}>{placeDate}</Text> : null}
        </View>

        {letter.subject ? (
          <Text style={{ fontWeight: 600, marginBottom: 18 }}>
            {objectLabel}
            {letter.subject}
          </Text>
        ) : null}

        {letter.opening ? <Text style={{ marginBottom: 12 }}>{letter.opening}</Text> : null}
        {letter.paragraphs
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, i) => (
            <Text key={i} style={{ marginBottom: 10, textAlign: 'justify' }}>
              {p}
            </Text>
          ))}
        {letter.closing ? <Text style={{ marginTop: 4 }}>{letter.closing}</Text> : null}
        <View style={{ marginTop: 26, marginLeft: '52%' }}>
          <Text style={{ fontWeight: 600 }}>{letter.signature || name}</Text>
        </View>
      </Page>
    </Document>
  )
}
