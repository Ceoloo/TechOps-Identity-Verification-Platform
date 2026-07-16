import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import DashboardLayout from './components/DashboardLayout';

import IntakePage from './pages/IntakePage';
import StatusPage from './pages/StatusPage';
import LoginPage from './pages/LoginPage';
import BusinessSettings from './pages/BusinessSettings';
import TiersPage from './pages/TiersPage';
import IntegrationsPage from './pages/IntegrationsPage';
import ConsentPage from './pages/ConsentPage';
import RetentionPage from './pages/RetentionPage';
import NotificationsPage from './pages/NotificationsPage';
import UsersPage from './pages/UsersPage';
import ReviewQueuePage from './pages/ReviewQueuePage';
import ReviewDetailPage from './pages/ReviewDetailPage';
import AuditPage from './pages/AuditPage';
import DataSubjectsPage from './pages/DataSubjectsPage';

function RequireAuth({ children, role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role === 'admin' && user.role !== 'admin') return <Navigate to="/app/review" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/verify/:businessId" element={<IntakePage />} />
      <Route path="/verify/:businessId/status/:verificationId" element={<StatusPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Internal */}
      <Route path="/app" element={<RequireAuth><DashboardLayout /></RequireAuth>}>
        <Route index element={<Navigate to="review" replace />} />
        <Route path="review" element={<ReviewQueuePage />} />
        <Route path="review/:id" element={<ReviewDetailPage />} />
        <Route path="business" element={<RequireAuth role="admin"><BusinessSettings /></RequireAuth>} />
        <Route path="tiers" element={<RequireAuth role="admin"><TiersPage /></RequireAuth>} />
        <Route path="integrations" element={<RequireAuth role="admin"><IntegrationsPage /></RequireAuth>} />
        <Route path="consent" element={<RequireAuth role="admin"><ConsentPage /></RequireAuth>} />
        <Route path="retention" element={<RequireAuth role="admin"><RetentionPage /></RequireAuth>} />
        <Route path="notifications" element={<RequireAuth role="admin"><NotificationsPage /></RequireAuth>} />
        <Route path="users" element={<RequireAuth role="admin"><UsersPage /></RequireAuth>} />
        <Route path="audit" element={<RequireAuth role="admin"><AuditPage /></RequireAuth>} />
        <Route path="data-subjects" element={<RequireAuth role="admin"><DataSubjectsPage /></RequireAuth>} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
