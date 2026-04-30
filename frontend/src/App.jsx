import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';
import FarmerLayout from './components/FarmerLayout';

// Admin Pages
import SystemOverview from './pages/admin/SystemOverview';
import ScanManagement from './pages/admin/ScanManagement';
import ModelPerformance from './pages/admin/ModelPerformance';
import FarmerManagement from './pages/admin/FarmerManagement';
import SystemSettings from './pages/admin/SystemSettings';
import AdminMap from './pages/admin/AdminMap';
import AdvisoryManagement from './pages/admin/AdvisoryManagement';

// Farmer Pages
import FarmerMap from './pages/farmer/FarmerMap';
import FarmerNotifications from './pages/farmer/FarmerNotifications';

import FarmerOverview from './pages/farmer/FarmerOverview';
import FarmerAlerts from './pages/farmer/FarmerAlerts';

// Public Pages
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Registration from './pages/Registration';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Registration />} />
          
          {/* Admin Routes (protected, requires admin role) */}
          <Route path="/admin" element={
            <ProtectedRoute requireAdmin>
              <AdminLayout />
            </ProtectedRoute>
          }>
            <Route path="overview" element={<SystemOverview />} />
            <Route path="scans" element={<ScanManagement />} />
            <Route path="performance" element={<ModelPerformance />} />
            <Route path="farmers" element={<FarmerManagement />} />
            <Route path="settings" element={<SystemSettings />} />
            <Route path="map" element={<AdminMap />} />
            <Route path="advisories" element={<AdvisoryManagement />} />
          </Route>

          {/* Farmer Routes (protected, any authenticated user) */}
          <Route path="/farmer" element={
            <ProtectedRoute>
              <FarmerLayout />
            </ProtectedRoute>
          }>
            <Route path="home" element={<FarmerOverview />} />
            <Route path="map" element={<FarmerMap />} />
            <Route path="notifications" element={<FarmerNotifications />} />
            <Route path="advisories" element={<Navigate to="/farmer/notifications" />} />
            <Route path="alerts" element={<FarmerAlerts />} />
            <Route path="dashboard" element={<Navigate to="/farmer/home" />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
