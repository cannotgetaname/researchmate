pub mod models;

use rusqlite::{Connection, Result as SqlResult};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_dir: &PathBuf) -> SqlResult<Self> {
        std::fs::create_dir_all(app_dir).expect("failed to create app dir");
        let db_path = app_dir.join("data.db");
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Self { conn: Mutex::new(conn) };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS project (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL REFERENCES project(id),
                module      TEXT NOT NULL,
                title       TEXT,
                created_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS message (
                id          TEXT PRIMARY KEY,
                session_id  TEXT NOT NULL REFERENCES session(id),
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS document (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL REFERENCES project(id),
                filename    TEXT NOT NULL,
                file_path   TEXT NOT NULL,
                title       TEXT,
                authors     TEXT,
                year        INTEGER,
                journal     TEXT,
                doi         TEXT,
                abstract    TEXT,
                domain      TEXT,
                subdomain   TEXT,
                keywords    TEXT,
                methodology TEXT,
                dataset     TEXT,
                claims      TEXT,
                full_text   TEXT,
                chunk_count INTEGER DEFAULT 0,
                status      TEXT DEFAULT 'pending',
                created_at  TEXT NOT NULL
            );


            CREATE TABLE IF NOT EXISTS doc_chunk (
                id          TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                heading     TEXT,
                role        TEXT,
                text        TEXT NOT NULL,
                vector      TEXT NOT NULL
            );

            INSERT OR IGNORE INTO project (id, name, description, created_at, updated_at)
            VALUES ('default', '默认课题', '默认科研项目', datetime('now'), datetime('now'));
            ",
        )?;

        // Safe migration: add new columns that may not exist in older DBs
        let _ = conn.execute_batch(
            "ALTER TABLE document ADD COLUMN full_text TEXT;
             ALTER TABLE document ADD COLUMN methodology TEXT;
             ALTER TABLE document ADD COLUMN dataset TEXT;
             ALTER TABLE document ADD COLUMN claims TEXT;
             ALTER TABLE document ADD COLUMN subdomain TEXT;
             ALTER TABLE document ADD COLUMN keywords TEXT;",
        );
        Ok(())
    }
}
