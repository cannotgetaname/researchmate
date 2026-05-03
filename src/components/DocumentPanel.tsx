import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface DocInfo {
  id: string;
  title: string | null;
  authors: string | null;
  year: number | null;
  journal: string | null;
  domain: string | null;
  filename: string;
  status: string;
  created_at: string;
}

export default function DocumentPanel() {
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");

  const loadDocs = async () => {
    try {
      const result = await invoke("get_documents", { projectId: "default" }) as DocInfo[];
      setDocs(result);
    } catch (e) {
      setStatus(`加载文献列表失败：${e}`);
    }
  };

  useEffect(() => { loadDocs(); }, []);

  const handleUpload = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!selected) return;

    setUploading(true);
    setStatus("正在上传...");

    for (const path of Array.isArray(selected) ? selected : [selected]) {
      try {
        await invoke("upload_document", {
          filePath: path,
          projectId: "default",
        });
        setStatus(`已上传：${path.split("/").pop()}`);
      } catch (e) {
        setStatus(`上传失败：${e}`);
      }
    }

    setUploading(false);
    await loadDocs();
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_document", { docId: id });
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setStatus("已删除");
    } catch (e) {
      setStatus(`删除失败：${e}`);
    }
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      padding: "var(--space-base)",
    }}>
      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={uploading}
        style={{
          height: "40px", padding: "0 18px", marginBottom: "var(--space-base)",
          border: "none", borderRadius: "var(--radius-md)",
          backgroundColor: "var(--color-primary)",
          color: "var(--color-on-primary)",
          fontFamily: "var(--font-ui)", fontSize: "14px",
          fontWeight: 500, cursor: uploading ? "not-allowed" : "pointer",
          opacity: uploading ? 0.6 : 1,
          width: "100%",
        }}
      >
        {uploading ? "上传中..." : "+ 上传 PDF 文献"}
      </button>

      {status && (
        <div style={{
          fontSize: "12px", color: "var(--color-muted)",
          marginBottom: "var(--space-sm)",
        }}>
          {status}
        </div>
      )}

      {/* Document list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {docs.length === 0 && (
          <div style={{
            textAlign: "center", color: "var(--color-muted)",
            marginTop: "var(--space-xxl)", fontSize: "13px",
          }}>
            还没有上传文献
          </div>
        )}

        {docs.map((doc) => (
          <div
            key={doc.id}
            style={{
              padding: "var(--space-sm)", marginBottom: "var(--space-sm)",
              border: "1px solid var(--color-hairline)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--color-surface-card)",
              cursor: "default",
              transition: "border-color 0.1s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--color-hairline-strong)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--color-hairline)";
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, fontSize: "14px",
                  color: "var(--color-ink)", marginBottom: "var(--space-xxs)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {doc.title ?? doc.filename}
                </div>

                <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                  {doc.authors && (
                    <span>{(() => {
                      try {
                        const a = JSON.parse(doc.authors);
                        return a.slice(0, 2).map((x: {name: string}) => x.name).join(", ");
                      } catch { return doc.authors; }
                    })()}</span>
                  )}
                  {doc.year && <span> ({doc.year})</span>}
                </div>

                <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-xxs)", fontSize: "11px", color: "var(--color-muted-soft)" }}>
                  {doc.journal && <span>{doc.journal}</span>}
                  {doc.domain && (
                    <span style={{
                      padding: "0 6px", borderRadius: "var(--radius-pill)",
                      backgroundColor: "var(--color-canvas-soft)",
                    }}>
                      {doc.domain}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleDelete(doc.id)}
                style={{
                  background: "none", border: "none",
                  color: "var(--color-muted-soft)", cursor: "pointer",
                  fontSize: "16px", padding: "0 4px", lineHeight: 1,
                  flexShrink: 0,
                }}
                title="删除"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
