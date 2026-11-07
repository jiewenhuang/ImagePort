use serde::Deserialize;
use sqlx::{Sqlite, SqlitePool, Transaction};
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkspaceSnapshot {
    Tasks { rows: Vec<TaskSnapshotRow> },
    AgentConversations { rows: Vec<ConversationSnapshotRow> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshotRow {
    id: String,
    prompt: String,
    status: String,
    created_at: i64,
    finished_at: Option<i64>,
    payload: String,
    updated_at: i64,
    preserve_raw_response: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSnapshotRow {
    id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    payload: String,
}

/// One transaction owns one acquired connection. Separate plugin execute calls use a pool.
#[tauri::command]
pub async fn save_workspace_snapshot(
    databases: tauri::State<'_, DbInstances>,
    snapshot: WorkspaceSnapshot,
) -> Result<(), String> {
    let instances = databases.0.read().await;
    let Some(DbPool::Sqlite(pool)) = instances.get("sqlite:imageport.db") else {
        return Err("图片数据库尚未加载".into());
    };
    save_snapshot(pool, snapshot)
        .await
        .map_err(|error| error.to_string())
}

async fn save_snapshot(pool: &SqlitePool, snapshot: WorkspaceSnapshot) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let result = write_snapshot(&mut transaction, snapshot).await;
    if let Err(error) = result {
        transaction.rollback().await?;
        return Err(error);
    }
    transaction.commit().await
}

async fn write_snapshot(
    transaction: &mut Transaction<'_, Sqlite>,
    snapshot: WorkspaceSnapshot,
) -> Result<(), sqlx::Error> {
    let (table, ids) = match snapshot {
        WorkspaceSnapshot::Tasks { rows } => {
            let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
            for row in rows {
                sqlx::query(
                    "INSERT INTO gallery_tasks (id,prompt,status,created_at,finished_at,payload,updated_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)
                     ON CONFLICT(id) DO UPDATE SET prompt=excluded.prompt,status=excluded.status,
                     created_at=excluded.created_at,finished_at=excluded.finished_at,updated_at=excluded.updated_at,
                     payload=CASE WHEN $8 THEN json_set(excluded.payload,'$.task.rawResponsePayload',json_extract(gallery_tasks.payload,'$.task.rawResponsePayload')) ELSE excluded.payload END",
                )
                .bind(row.id).bind(row.prompt).bind(row.status).bind(row.created_at)
                .bind(row.finished_at).bind(row.payload).bind(row.updated_at)
                .bind(row.preserve_raw_response).execute(&mut **transaction).await?;
            }
            ("gallery_tasks", ids)
        }
        WorkspaceSnapshot::AgentConversations { rows } => {
            let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
            for row in rows {
                sqlx::query(
                    "INSERT INTO agent_conversations (id,title,created_at,updated_at,payload) VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT(id) DO UPDATE SET title=excluded.title,created_at=excluded.created_at,updated_at=excluded.updated_at,payload=excluded.payload",
                )
                .bind(row.id).bind(row.title).bind(row.created_at).bind(row.updated_at)
                .bind(row.payload).execute(&mut **transaction).await?;
            }
            ("agent_conversations", ids)
        }
    };
    // Table is selected from the two fixed variants above. JSON binding avoids SQLite parameter-count limits.
    sqlx::query(&format!(
        "DELETE FROM {table} WHERE id NOT IN (SELECT value FROM json_each($1))"
    ))
    .bind(serde_json::to_string(&ids).expect("string identifiers serialize"))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{sqlite::SqlitePoolOptions, Row};

    async fn fixture() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(3)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE gallery_tasks(id TEXT PRIMARY KEY,prompt TEXT NOT NULL CHECK(prompt != 'invalid'),status TEXT,created_at INTEGER,finished_at INTEGER,payload TEXT,updated_at INTEGER)")
            .execute(&pool).await.unwrap();
        sqlx::query("CREATE TABLE agent_conversations(id TEXT PRIMARY KEY,title TEXT,created_at INTEGER,updated_at INTEGER,payload TEXT)").execute(&pool).await.unwrap();
        pool
    }

    fn row(id: &str) -> TaskSnapshotRow {
        TaskSnapshotRow {
            id: id.into(),
            prompt: "fixture".into(),
            status: "done".into(),
            created_at: 1,
            finished_at: Some(2),
            updated_at: 2,
            payload: r#"{"task":{"rawResponsePayload":"retained"}}"#.into(),
            preserve_raw_response: false,
        }
    }

    #[tokio::test]
    async fn commits_across_connections_and_preserves_preview_response() {
        let pool = fixture().await;
        save_snapshot(
            &pool,
            WorkspaceSnapshot::Tasks {
                rows: vec![row("old"), row("keep")],
            },
        )
        .await
        .unwrap();
        let mut preview = row("keep");
        preview.payload = r#"{"task":{"isFavorite":true}}"#.into();
        preview.preserve_raw_response = true;
        save_snapshot(
            &pool,
            WorkspaceSnapshot::Tasks {
                rows: vec![preview, row("new")],
            },
        )
        .await
        .unwrap();
        let _held_connection = pool.acquire().await.unwrap();
        let rows = sqlx::query("SELECT id,payload FROM gallery_tasks ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].get::<String, _>("id"), "keep");
        let payload: serde_json::Value = serde_json::from_str(rows[0].get("payload")).unwrap();
        assert_eq!(payload["task"]["rawResponsePayload"], "retained");
        assert_eq!(payload["task"]["isFavorite"], true);
        drop(_held_connection);
        pool.close().await;
    }

    #[tokio::test]
    async fn rolls_back_all_rows_on_failure_and_retains_existing_history() {
        let pool = fixture().await;
        save_snapshot(
            &pool,
            WorkspaceSnapshot::Tasks {
                rows: vec![row("old")],
            },
        )
        .await
        .unwrap();
        let mut invalid = row("bad");
        invalid.prompt = "invalid".into();
        assert!(save_snapshot(
            &pool,
            WorkspaceSnapshot::Tasks {
                rows: vec![row("new"), invalid]
            }
        )
        .await
        .is_err());
        let ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM gallery_tasks")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(ids, vec![("old".into(),)]);
        pool.close().await;
    }

    #[tokio::test]
    async fn persists_conversations_without_changing_tasks() {
        let pool = fixture().await;
        save_snapshot(
            &pool,
            WorkspaceSnapshot::Tasks {
                rows: vec![row("keep")],
            },
        )
        .await
        .unwrap();
        save_snapshot(
            &pool,
            WorkspaceSnapshot::AgentConversations {
                rows: vec![ConversationSnapshotRow {
                    id: "conversation".into(),
                    title: "fixture".into(),
                    created_at: 1,
                    updated_at: 2,
                    payload: "{}".into(),
                }],
            },
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM agent_conversations")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM gallery_tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        save_snapshot(
            &pool,
            WorkspaceSnapshot::AgentConversations { rows: vec![] },
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM agent_conversations")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        pool.close().await;
    }
}
