interface StatusBarProps {
  wordCount: number;
  aiStatus: string;
  lastSaved: string;
}

export default function StatusBar({ wordCount, aiStatus, lastSaved }: StatusBarProps) {
  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>字数：{wordCount}</span>
      </div>
      <div className="statusbar-right">
        <span>AI：{aiStatus}</span>
        <span>上次保存：{lastSaved}</span>
      </div>
    </div>
  );
}
