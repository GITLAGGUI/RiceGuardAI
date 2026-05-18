import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/guards/ProtectedRoute";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { FarmerLayout } from "@/components/layout/FarmerLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";

import { Landing } from "@/pages/public/Landing";
import { Login } from "@/pages/public/Login";
import { Register } from "@/pages/public/Register";

import { FarmerHome } from "@/pages/farmer/Home";
import { FarmerMap } from "@/pages/farmer/Map";
import { FarmerAlerts } from "@/pages/farmer/Alerts";
import { FarmerNotifications } from "@/pages/farmer/Notifications";
import { FarmerProfile } from "@/pages/farmer/Profile";

import { AdminOverview } from "@/pages/admin/Overview";
import { AdminScans } from "@/pages/admin/Scans";
import { ScanUpload } from "@/pages/admin/ScanUpload";
import { AdminAdvisories } from "@/pages/admin/Advisories";
import { AdvisoryCompose } from "@/pages/admin/AdvisoryCompose";
import { AdminFarmers } from "@/pages/admin/Farmers";
import { AdminMap } from "@/pages/admin/Map";
import { ModelStatus } from "@/pages/admin/ModelStatus";
import { AdminSettings } from "@/pages/admin/Settings";

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/login", element: <Login /> },
      { path: "/register", element: <Register /> },
    ],
  },
  {
    element: <ProtectedRoute role="farmer" />,
    children: [
      {
        path: "/farmer",
        element: <FarmerLayout />,
        children: [
          { index: true, element: <Navigate to="/farmer/home" replace /> },
          { path: "home", element: <FarmerHome /> },
          { path: "map", element: <FarmerMap /> },
          { path: "alerts", element: <FarmerAlerts /> },
          { path: "notifications", element: <FarmerNotifications /> },
          { path: "profile", element: <FarmerProfile /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute role="admin" />,
    children: [
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="/admin/overview" replace /> },
          { path: "overview", element: <AdminOverview /> },
          { path: "scans", element: <AdminScans /> },
          { path: "scans/new", element: <ScanUpload /> },
          { path: "advisories", element: <AdminAdvisories /> },
          { path: "advisories/:id", element: <AdvisoryCompose /> },
          { path: "farmers", element: <AdminFarmers /> },
          { path: "map", element: <AdminMap /> },
          { path: "model", element: <ModelStatus /> },
          { path: "settings", element: <AdminSettings /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
