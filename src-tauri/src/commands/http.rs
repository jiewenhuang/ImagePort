use crate::services::http_client;
use crate::services::http_client::{
    NativeJsonRequest, NativeJsonResponse, NativeMultipartRequest, NativeMultipartStreamRequest,
    NativeStreamRequest,
};

#[tauri::command]
pub async fn native_json_request(request: NativeJsonRequest) -> Result<NativeJsonResponse, String> {
    http_client::send_json_request(request).await
}

#[tauri::command]
pub async fn native_json_stream_request(
    app: tauri::AppHandle,
    request: NativeStreamRequest,
) -> Result<NativeJsonResponse, String> {
    http_client::send_json_stream_request(app, request).await
}

#[tauri::command]
pub async fn cancel_native_json_stream_request(request_id: String) -> Result<bool, String> {
    Ok(http_client::cancel_json_stream_request(request_id))
}

#[tauri::command]
pub async fn native_multipart_request(
    request: NativeMultipartRequest,
) -> Result<NativeJsonResponse, String> {
    http_client::send_multipart_request(request).await
}

#[tauri::command]
pub async fn native_multipart_stream_request(
    app: tauri::AppHandle,
    request: NativeMultipartStreamRequest,
) -> Result<NativeJsonResponse, String> {
    http_client::send_multipart_stream_request(app, request).await
}

#[tauri::command]
pub async fn download_image_as_data_url(
    url: String,
    fallback_mime: String,
) -> Result<String, String> {
    http_client::download_image_as_data_url(url, fallback_mime).await
}
