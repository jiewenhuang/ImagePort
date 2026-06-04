use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::multipart::{Form, Part};
use reqwest::Response;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

static CANCELLED_STREAM_REQUESTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeJsonRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<Value>,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

#[derive(Debug, Serialize)]
pub struct NativeJsonResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMultipartFile {
    pub field: String,
    pub file_name: String,
    pub mime: String,
    pub data_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMultipartRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub fields: HashMap<String, String>,
    #[serde(default)]
    pub files: Vec<NativeMultipartFile>,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMultipartStreamRequest {
    pub request_id: String,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub fields: HashMap<String, String>,
    #[serde(default)]
    pub files: Vec<NativeMultipartFile>,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStreamRequest {
    pub request_id: String,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<Value>,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeStreamChunkPayload {
    pub request_id: String,
    pub chunk: String,
}

fn default_timeout_secs() -> u64 {
    600
}

pub async fn send_json_request(request: NativeJsonRequest) -> Result<NativeJsonResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_secs.max(1)))
        .build()
        .map_err(|err| format!("创建 HTTP 客户端失败：{err}"))?;

    let method = request
        .method
        .parse::<reqwest::Method>()
        .map_err(|err| format!("请求方法无效：{err}"))?;

    let mut builder = client
        .request(method, request.url)
        .headers(to_header_map(&request.headers)?);
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|err| format!("请求失败：{err}"))?;
    let status = response.status().as_u16();
    let headers = from_header_map(response.headers());
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取响应失败：{err}"))?;
    let body = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };

    Ok(NativeJsonResponse {
        status,
        headers,
        body,
    })
}

pub async fn send_multipart_request(
    request: NativeMultipartRequest,
) -> Result<NativeJsonResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_secs.max(1)))
        .build()
        .map_err(|err| format!("创建 HTTP 客户端失败：{err}"))?;

    let method = request
        .method
        .parse::<reqwest::Method>()
        .map_err(|err| format!("请求方法无效：{err}"))?;

    let form = build_multipart_form(request.fields, request.files)?;

    let response = client
        .request(method, request.url)
        .headers(to_header_map(&request.headers)?)
        .multipart(form)
        .send()
        .await
        .map_err(|err| format!("请求失败：{err}"))?;

    let status = response.status().as_u16();
    let headers = from_header_map(response.headers());
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取响应失败：{err}"))?;
    let body = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };

    Ok(NativeJsonResponse {
        status,
        headers,
        body,
    })
}

pub async fn download_image_as_data_url(
    url: String,
    fallback_mime: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(default_timeout_secs()))
        .build()
        .map_err(|err| format!("创建 HTTP 客户端失败：{err}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("图片下载失败：{err}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "图片 URL 下载失败：HTTP {}",
            response.status().as_u16()
        ));
    }

    let mime = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| !value.trim().is_empty())
        .map(str::trim)
        .unwrap_or_else(|| fallback_mime.trim())
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取图片失败：{err}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);

    Ok(format!("data:{mime};base64,{encoded}"))
}

pub async fn send_json_stream_request(
    app: AppHandle,
    request: NativeStreamRequest,
) -> Result<NativeJsonResponse, String> {
    clear_stream_cancellation(&request.request_id);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_secs.max(1)))
        .build()
        .map_err(|err| format!("创建 HTTP 客户端失败：{err}"))?;

    let method = request
        .method
        .parse::<reqwest::Method>()
        .map_err(|err| format!("请求方法无效：{err}"))?;

    let mut builder = client
        .request(method, request.url)
        .headers(to_header_map(&request.headers)?);
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|err| format!("请求失败：{err}"))?;
    read_streaming_response(app, request.request_id, response).await
}

pub async fn send_multipart_stream_request(
    app: AppHandle,
    request: NativeMultipartStreamRequest,
) -> Result<NativeJsonResponse, String> {
    clear_stream_cancellation(&request.request_id);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_secs.max(1)))
        .build()
        .map_err(|err| format!("创建 HTTP 客户端失败：{err}"))?;

    let method = request
        .method
        .parse::<reqwest::Method>()
        .map_err(|err| format!("请求方法无效：{err}"))?;

    let form = build_multipart_form(request.fields, request.files)?;
    let response = client
        .request(method, request.url)
        .headers(to_header_map(&request.headers)?)
        .multipart(form)
        .send()
        .await
        .map_err(|err| format!("请求失败：{err}"))?;

    read_streaming_response(app, request.request_id, response).await
}

pub fn cancel_json_stream_request(request_id: String) -> bool {
    let mut cancelled = stream_cancel_set()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cancelled.insert(request_id)
}

fn stream_cancel_set() -> &'static Mutex<HashSet<String>> {
    CANCELLED_STREAM_REQUESTS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn clear_stream_cancellation(request_id: &str) {
    let mut cancelled = stream_cancel_set()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cancelled.remove(request_id);
}

fn take_stream_cancellation(request_id: &str) -> bool {
    let mut cancelled = stream_cancel_set()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cancelled.remove(request_id)
}

async fn read_streaming_response(
    app: AppHandle,
    request_id: String,
    response: Response,
) -> Result<NativeJsonResponse, String> {
    let status = response.status().as_u16();
    let headers = from_header_map(response.headers());

    if !response.status().is_success() {
        let text = response
            .text()
            .await
            .map_err(|err| format!("读取响应失败：{err}"))?;
        let body = parse_response_text_body(text);
        return Ok(NativeJsonResponse {
            status,
            headers,
            body,
        });
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if take_stream_cancellation(&request_id) {
            return Ok(NativeJsonResponse {
                status,
                headers,
                body: Value::String("cancelled".to_string()),
            });
        }
        let bytes = chunk.map_err(|err| format!("读取流式响应失败：{err}"))?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        app.emit(
            "imageport://stream-chunk",
            NativeStreamChunkPayload {
                request_id: request_id.clone(),
                chunk: text,
            },
        )
        .map_err(|err| format!("发送流式事件失败：{err}"))?;
    }

    Ok(NativeJsonResponse {
        status,
        headers,
        body: Value::Null,
    })
}

fn build_multipart_form(
    fields: HashMap<String, String>,
    files: Vec<NativeMultipartFile>,
) -> Result<Form, String> {
    let mut form = Form::new();
    for (key, value) in fields {
        form = form.text(key, value);
    }

    for file in files {
        let bytes = decode_data_url(&file.data_url)?;
        let part = Part::bytes(bytes)
            .file_name(file.file_name)
            .mime_str(&file.mime)
            .map_err(|err| format!("文件 MIME 类型无效：{err}"))?;
        form = form.part(file.field, part);
    }
    Ok(form)
}

fn parse_response_text_body(text: String) -> Value {
    if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    }
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let (_, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "文件数据不是有效的 data URL".to_string())?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|err| format!("解码 data URL 失败：{err}"))
}

fn to_header_map(headers: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (key, value) in headers {
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|err| format!("请求头名称无效 {key}: {err}"))?;
        let header_value =
            HeaderValue::from_str(value).map_err(|err| format!("请求头值无效 {key}: {err}"))?;
        map.insert(name, header_value);
    }
    Ok(map)
}

fn from_header_map(headers: &HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|text| (key.as_str().to_string(), text.to_string()))
        })
        .collect()
}
