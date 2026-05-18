import { Outlet } from "react-router-dom";

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-stone-50">
      <Outlet />
    </div>
  );
}
