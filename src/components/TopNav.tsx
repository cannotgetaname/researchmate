interface ProjectInfo {
  id: string; name: string;
}

interface TopNavProps {
  projects: ProjectInfo[];
  activeProjectId: string;
  onSwitchProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}

export default function TopNav({
  projects, activeProjectId, onSwitchProject,
  onCreateProject, onOpenSettings, onOpenAbout,
}: TopNavProps) {
  return (
    <div className="topnav">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
        <span className="topnav-brand">ResearchMate</span>
        <select
          value={activeProjectId}
          onChange={(e) => onSwitchProject(e.target.value)}
          style={{
            fontFamily: "var(--font-ui)", fontSize: "13px",
            color: "var(--color-muted)", border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-sm)", padding: "2px var(--space-xs)",
            backgroundColor: "var(--color-canvas)", cursor: "pointer",
            maxWidth: "180px",
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          className="topnav-btn"
          onClick={onCreateProject}
          title="新建课题"
          style={{ fontSize: "16px", padding: "0 4px" }}
        >
          +
        </button>
      </div>
      <div className="topnav-right">
        <button className="topnav-btn" onClick={onOpenSettings}>设置</button>
        <button className="topnav-btn" onClick={onOpenAbout}>关于</button>
      </div>
    </div>
  );
}
