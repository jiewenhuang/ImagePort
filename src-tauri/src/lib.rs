mod commands;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::http::native_json_request,
            commands::http::native_json_stream_request,
            commands::http::cancel_native_json_stream_request,
            commands::http::cancel_native_request,
            commands::http::native_multipart_request,
            commands::http::native_multipart_stream_request,
            commands::http::download_image_as_data_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
