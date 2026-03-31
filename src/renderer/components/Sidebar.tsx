import { NavLink } from "react-router-dom";

const routes = [
  { path: "/overview", label: "Overview" },
  { path: "/prompts", label: "Prompts" },
  { path: "/prompt-improver", label: "Improver" },
  { path: "/history", label: "History" },
  { path: "/dictionary", label: "Dictionary" },
  { path: "/shortcuts", label: "Shortcuts" },
  { path: "/settings", label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div>
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-title">CraftVoice</div>
        </div>

        <nav className="sidebar-nav">
          {routes.map((route) => (
            <NavLink
              key={route.path}
              to={route.path}
              className={({ isActive }) => (isActive ? "nav-item nav-item-active" : "nav-item")}
            >
              {route.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="profile-card profile-card-compact sidebar-build-badge">
        <div className="profile-avatar">CV</div>
        <div className="profile-title">Local build</div>
      </div>
    </aside>
  );
}
