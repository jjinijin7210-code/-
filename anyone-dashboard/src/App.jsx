import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ConfirmProvider } from './components/ConfirmDialog'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import EmployeeStatus from './pages/EmployeeStatus'
import ContentDrafts from './pages/ContentDrafts'
import ReviewLog from './pages/ReviewLog'
import BenchmarkReports from './pages/BenchmarkReports'
import CsLinks from './pages/CsLinks'
import AnalyticsData from './pages/AnalyticsData'
import QaPipeline from './pages/QaPipeline'
import LunaStudio from './pages/LunaStudio'
import LunaRequests from './pages/LunaRequests'
import JuneCharacter from './pages/JuneCharacter'
import BrandCenter from './pages/BrandCenter'
import AssetVault from './pages/AssetVault'
import VideoVault from './pages/VideoVault'
import VideoStudio from './pages/VideoStudio'
import MorningBriefing from './pages/MorningBriefing'
import Settings from './pages/Settings'

// 로그인하지 않으면 대시보드 내부로 못 들어가게 막는 래퍼
function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-ink/40">확인 중...</div>
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="employees" element={<EmployeeStatus />} />
        <Route path="drafts" element={<ContentDrafts />} />
        <Route path="reviews" element={<ReviewLog />} />
        <Route path="benchmark" element={<BenchmarkReports />} />
        <Route path="cs-links" element={<CsLinks />} />
        <Route path="analytics" element={<AnalyticsData />} />
        <Route path="qa-pipeline" element={<QaPipeline />} />
        <Route path="luna-studio" element={<LunaStudio />} />
        <Route path="luna-requests" element={<LunaRequests />} />
        <Route path="june-character" element={<JuneCharacter />} />
        <Route path="brand-center" element={<BrandCenter />} />
        <Route path="asset-vault" element={<AssetVault />} />
        <Route path="video-vault" element={<VideoVault />} />
        <Route path="video-studio" element={<VideoStudio />} />
        <Route path="morning-briefing" element={<MorningBriefing />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConfirmProvider>
          <AppRoutes />
        </ConfirmProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
