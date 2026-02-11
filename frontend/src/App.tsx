import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { Toaster } from '@/components/ui/toaster'
import { Home } from '@/pages/Home'
import { Login } from '@/pages/Login'
import { Register } from '@/pages/Register'
import { AuthCallback } from '@/pages/AuthCallback'
import { Settings } from '@/pages/Settings'
import { Surveys } from '@/pages/Surveys'
import { SurveyCreate } from '@/pages/SurveyCreate'
import { SurveyView } from '@/pages/SurveyView'
import { SurveyResults } from '@/pages/SurveyResults'
import { Backstories } from '@/pages/Backstories'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Protected routes */}
          <Route
            path="/surveys"
            element={
              <ProtectedRoute>
                <Surveys />
              </ProtectedRoute>
            }
          />
          <Route
            path="/surveys/new"
            element={
              <ProtectedRoute>
                <SurveyCreate />
              </ProtectedRoute>
            }
          />
          <Route
            path="/surveys/:id"
            element={
              <ProtectedRoute>
                <SurveyView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/surveys/:id/edit"
            element={
              <ProtectedRoute>
                <SurveyCreate />
              </ProtectedRoute>
            }
          />
          <Route
            path="/surveys/:id/results"
            element={
              <ProtectedRoute>
                <SurveyResults />
              </ProtectedRoute>
            }
          />
          <Route
            path="/backstories"
            element={
              <ProtectedRoute>
                <Backstories />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
        </Routes>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
