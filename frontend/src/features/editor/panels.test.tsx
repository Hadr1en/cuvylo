import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@/domain/cv'
import { newExperience, emptyProfile, type ProfileData } from '@/domain/profile'
import { AtsPanel } from './AtsPanel'
import { JobPanel } from './JobPanel'

function cv(): ProfileData {
  const p = emptyProfile()
  p.identity = { firstName: 'Camille', lastName: 'Exemple', headline: 'Cheffe de projet', email: 'camille@example.test', phone: '+33 6 00 00 00 00', location: 'Lille', details: '', photo: '' }
  p.experiences = [
    {
      ...newExperience(),
      id: 'e1',
      title: 'Cheffe de projet',
      company: 'ACME',
      startDate: '2020-01',
      current: true,
      description: 'Pilotage de projets Scrum.',
      achievements: [{ id: 'a1', text: 'Réduction des délais de 30 %.' }],
    },
  ]
  p.skills = [{ id: 's1', category: 'Outils', kind: 'technical', items: ['Jira', 'SQL', 'Figma', 'Scrum', 'Excel', 'Power BI'] }]
  return p
}

const POSTING = `Cheffe de projet digital
Profil recherché :
- Maîtrise de Jira et de Salesforce
- Pilotage Scrum
Un plus : certification PSM.`

function JobHarness({ onCreate }: { onCreate?: (t: string | null) => Promise<void> }) {
  const [posting, setPosting] = useState('')
  return <JobPanel posting={posting} onPostingChange={setPosting} data={cv()} {...(onCreate ? { onCreateTailored: onCreate } : {})} />
}

describe('JobPanel', () => {
  it('attend une fiche de poste, puis affiche présent / absent sans rien inventer', async () => {
    const user = userEvent.setup()
    render(<JobHarness />)
    expect(screen.getByText('En attente d’une fiche de poste.')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Fiche de poste'))
    await user.paste(POSTING)

    const required = await screen.findByRole('region', { name: 'Exigé' })
    const chip = (term: string) => within(required).getByText(term).closest('li')
    expect(chip('Salesforce')).toHaveTextContent(/Absent/)
    expect(chip('Jira')).toHaveTextContent(/Seulement dans les compétences/)

    const suggestions = screen.getByRole('region', { name: 'Pistes de reformulation' })
    expect(within(suggestions).getByText(/Salesforce.*Sinon, ne l’ajoutez pas/)).toBeInTheDocument()
    expect(screen.getByText(/ne prédit ni un score ATS/)).toBeInTheDocument()
  })

  it('crée une version adaptée avec le titre de l’offre', async () => {
    const user = userEvent.setup()
    const create = vi.fn().mockResolvedValue(undefined)
    render(<JobHarness onCreate={create} />)
    await user.click(screen.getByLabelText('Fiche de poste'))
    await user.paste(POSTING)
    await user.click(await screen.findByRole('button', { name: /Créer une version adaptée/ }))
    expect(create).toHaveBeenCalledWith('Cheffe de projet digital')
  })
})

describe('AtsPanel', () => {
  it('affiche des constats et rappelle qu’aucune compatibilité n’est garantie', () => {
    const data = cv()
    data.identity.email = ''
    render(<AtsPanel data={data} settings={defaultSettings()} extracted={null} rendering={false} />)
    expect(screen.getByText(/Aucune adresse e-mail/)).toBeInTheDocument()
    expect(screen.getByText(/ne garantissent la compatibilité avec/)).toBeInTheDocument()
    expect(screen.getByText(/en attente du PDF/)).toBeInTheDocument()
  })

  it('n’annonce aucun score global', () => {
    render(<AtsPanel data={cv()} settings={defaultSettings()} extracted={null} rendering={false} />)
    expect(screen.queryByText(/\d+\s*\/\s*100/)).toBeNull()
    expect(screen.queryByText(/score/i)).toBeNull()
  })
})
