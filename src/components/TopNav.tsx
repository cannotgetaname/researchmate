interface TopNavProps {
  projectName: string;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}

export default function TopNav({ projectName, onOpenSettings, onOpenAbout }: TopNavProps) {
  return (
    <div className="topnav">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-base)" }}>
        <span className="topnav-brand">ResearchMate</span>
        <span className="topnav-project">课题：{projectName}</span>
      </div>
      <div className="topnav-right">
        <button className="topnav-btn" onClick={onOpenSettings}>设置</button>
        <button className="topnav-btn" onClick={onOpenAbout}>关于</button>
      </div>
    </div>
  );
}
