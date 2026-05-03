interface TopNavProps {
  projectName: string;
}

export default function TopNav({ projectName }: TopNavProps) {
  return (
    <div className="topnav">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-base)" }}>
        <span className="topnav-brand">ResearchMate</span>
        <span className="topnav-project">课题：{projectName}</span>
      </div>
      <div className="topnav-right">
        <button className="topnav-btn">设置</button>
        <button className="topnav-btn">关于</button>
      </div>
    </div>
  );
}
