import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/auth/AuthContext'
import { RequireAuth } from '@/auth/RequireAuth'
import { AuthPage, ForgotPasswordPage, ResetPasswordPage, SetupPage } from '@/features/auth/AuthPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { LegalNoticePage, PrivacyPage, SecurityPage } from '@/features/legal/LegalPages'
import { ErrorBoundary } from '@/ui/ErrorBoundary'
import { Shell } from '@/ui/Shell'
import { ThemeProvider } from '@/ui/theme'
import { ToastProvider } from '@/ui/Toast'

// Pages lourdes (formulaire complet, react-pdf, pdf.js) : chargées à la demande.
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage'))
const CvEditorPage = lazy(() => import('@/features/editor/CvEditorPage'))
const AccountPage = lazy(() => import('@/features/account/AccountPage'))
const ApplicationsPage = lazy(() => import('@/features/applications/ApplicationsPage'))
const LettersPage = lazy(() => import('@/features/letters/LettersPage'))
const LetterEditorPage = lazy(() => import('@/features/letters/LetterEditorPage'))
const AdminPage = lazy(() => import('@/features/admin/AdminPage'))
const AnalysePage = lazy(() => import('@/features/analyse/AnalysePage'))
const PublicCvPage = lazy(() => import('@/features/share/PublicCvPage'))
const PublicAnalysePage = lazy(() => import('@/features/analyse/PublicAnalysePage'))

function Loading() {
  return (
    <p role="status" className="p-10 text-center text-muted">
      Chargement…
    </p>
  )
}

const lazyPage = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <Routes>
                <Route path="/connexion" element={<AuthPage mode="login" />} />
                <Route path="/inscription" element={<AuthPage mode="register" />} />
                <Route path="/invitation/:token" element={<AuthPage mode="register" />} />
                <Route path="/reinitialisation/:token" element={<ResetPasswordPage />} />
                <Route path="/installation" element={<SetupPage />} />
                <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
                {/* Analyse d'un CV, pages légales et CV partagés : publics, accessibles sans compte. */}
                <Route path="/analyser" element={lazyPage(<PublicAnalysePage />)} />
                <Route path="/mentions-legales" element={<LegalNoticePage />} />
                <Route path="/confidentialite" element={<PrivacyPage />} />
                <Route path="/securite" element={<SecurityPage />} />
                <Route path="/p/:slug" element={lazyPage(<PublicCvPage />)} />
                <Route
                  element={
                    <RequireAuth>
                      <Shell />
                    </RequireAuth>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="profil" element={lazyPage(<ProfilePage />)} />
                  <Route path="cv/:id" element={lazyPage(<CvEditorPage />)} />
                  <Route path="candidatures" element={lazyPage(<ApplicationsPage />)} />
                  <Route path="lettres" element={lazyPage(<LettersPage />)} />
                  <Route path="lettres/:id" element={lazyPage(<LetterEditorPage />)} />
                  <Route path="analyse" element={lazyPage(<AnalysePage />)} />
                  <Route path="compte" element={lazyPage(<AccountPage />)} />
                  <Route path="admin" element={lazyPage(<AdminPage />)} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
