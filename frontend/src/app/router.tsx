// GABAY: Listahan ng lahat ng URL ng website at kung aling component ang lumalabas sa bawat isa.
// Hal. "/" = HomePage (landing), "/bulletin" = BulletinPage, "/admin/review" = OperationsPage (VerifyFindings).
// Magdagdag ng bagong page dito: gumawa ng component, tapos idagdag ang { path, element } sa ibaba.
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { ProtectedRoute } from "@/components/guards/ProtectedRoute";
import {
  HomePage,
  BulletinPage,
  AdvisoryPage,
  PublicMapPage,
} from "@/operations/Public";
import { RegistrationPage } from "@/operations/Registration";
const Login = lazy(() =>
  import("@/pages/public/Login").then((m) => ({ default: m.Login })),
);
const OperationsRoot = lazy(() =>
  import("@/operations/Admin").then((m) => ({ default: m.OperationsRoot })),
);
const OperationsPage = lazy(() =>
  import("@/operations/Admin").then((m) => ({ default: m.OperationsPage })),
);
const GeminiConnectionPage = lazy(() =>
  import("@/operations/GeminiConnection").then((m) => ({ default: m.GeminiConnectionPage })),
);
// `npm run dev` only: the workspace with synthetic data at /demo, for layout work without a login.
const DevDemo = lazy(() =>
  Promise.all([import("@/operations/Admin"), import("@/operations/devFixture")]).then(([admin, fixture]) => ({
    default: () => <admin.OperationsRoot demo fixture={fixture.devFixture} />,
  })),
);
const deferred = (children: ReactNode) => (
  <Suspense
    fallback={
      <div role="status" style={{ padding: 30 }}>
        Loading RiceGuardAI…
      </div>
    }
  >
    {children}
  </Suspense>
);
const operations = [
  "overview",
  "surveys",
  "surveys/new",
  "review",
  "map",
  "advisories",
  "farmers",
  "sms",
  "model",
  "settings",
].map((path) => ({ path, element: <OperationsPage /> }));
const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/bulletin", element: <BulletinPage /> },
  { path: "/advisories/:slug", element: <AdvisoryPage /> },
  { path: "/map", element: <PublicMapPage /> },
  { path: "/register", element: <RegistrationPage /> },
  { path: "/preferences", element: <RegistrationPage preferences /> },
  { path: "/login", element: deferred(<Login />) },
  { path: "/system", element: <Navigate to="/" replace /> },
  { path: "/farmer/map", element: <Navigate to="/map" replace /> },
  { path: "/farmer/profile", element: <Navigate to="/preferences" replace /> },
  { path: "/farmer/*", element: <Navigate to="/bulletin" replace /> },
  import.meta.env.DEV
    ? { path: "/demo", element: deferred(<DevDemo />), children: [{ index: true, element: <Navigate to="overview" replace /> }, ...operations] }
    : { path: "/demo/*", element: <Navigate to="/login" replace /> },
  {
    element: <ProtectedRoute role="admin" />,
    children: [
      {
        path: "/admin",
        element: deferred(<OperationsRoot key="live" />),
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          ...operations,
          { path: "connect/gemini", element: deferred(<GeminiConnectionPage />) },
          { path: "scans", element: <Navigate to="/admin/surveys" replace /> },
          {
            path: "scans/new",
            element: <Navigate to="/admin/surveys/new" replace />,
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
export function AppRouter() {
  return <RouterProvider router={router} />;
}
