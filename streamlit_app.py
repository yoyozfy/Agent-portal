"""Streamlit interface for the Agent portal."""
from __future__ import annotations

import base64
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
import streamlit as st
from streamlit.runtime.uploaded_file_manager import UploadedFile

CONFIG_PATH = Path("config/app-config.json")
DEFAULT_SETTINGS: Dict[str, Any] = {
    "baseUrl": "",
    "endpoint": "/agent/invoke",
    "method": "POST",
    "mock": True,
    "apiKey": "",
    "temperature": 0.7,
    "extraHeaders": {},
    "systemPrompt": "你是一个专业且可靠的智能助手，注意精炼回答，并在需要时引用上传的资料。",
}
ENV_OVERRIDE_MAP = {
    "AGENT_PORTAL_BASE_URL": "baseUrl",
    "AGENT_PORTAL_ENDPOINT": "endpoint",
    "AGENT_PORTAL_METHOD": "method",
    "AGENT_PORTAL_USE_MOCK": "mock",
    "AGENT_PORTAL_API_KEY": "apiKey",
    "AGENT_PORTAL_TEMPERATURE": "temperature",
    "AGENT_PORTAL_EXTRA_HEADERS": "extraHeaders",
    "AGENT_PORTAL_SYSTEM_PROMPT": "systemPrompt",
}
ROLE_LABELS = {
    "system": "系统",
    "user": "你",
    "assistant": "智能体",
}


def apply_env_overrides(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Override settings using environment variables for container deployments."""
    overridden = settings.copy()

    for env_var, key in ENV_OVERRIDE_MAP.items():
        value = os.getenv(env_var)
        if value is None:
            continue

        if key == "mock":
            overridden[key] = value.lower() in {"1", "true", "t", "yes", "y"}
        elif key == "temperature":
            try:
                overridden[key] = float(value)
            except ValueError:
                continue
        elif key == "extraHeaders":
            try:
                parsed_value = json.loads(value)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed_value, dict):
                overridden[key] = parsed_value
        else:
            overridden[key] = value

    return overridden


@st.cache_data(show_spinner=False)
def load_config() -> Dict[str, Any]:
    """Load settings from the JSON config file and apply environment overrides."""
    if not CONFIG_PATH.exists():
        return apply_env_overrides(DEFAULT_SETTINGS.copy())

    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        return apply_env_overrides(DEFAULT_SETTINGS.copy())

    if not isinstance(data, dict):
        return apply_env_overrides(DEFAULT_SETTINGS.copy())

    normalized: Dict[str, Any] = DEFAULT_SETTINGS.copy()
    normalized.update(data)
    normalized = apply_env_overrides(normalized)

    method = normalized.get("method")
    if isinstance(method, str):
        normalized["method"] = method.upper()

    return normalized


def init_session_state() -> None:
    """Initialise Streamlit session state values."""
    if "settings" not in st.session_state:
        st.session_state.settings = load_config()

    if "messages" not in st.session_state:
        st.session_state.messages = []
        system_prompt = st.session_state.settings.get("systemPrompt")
        if isinstance(system_prompt, str) and system_prompt.strip():
            st.session_state.messages.append(
                {
                    "id": create_id(),
                    "role": "system",
                    "content": system_prompt.strip(),
                    "timestamp": datetime.utcnow().isoformat(),
                    "attachments": [],
                }
            )


def create_id() -> str:
    return f"id-{datetime.utcnow().timestamp():.6f}"


def render_sidebar(uploaded_files: Optional[List[UploadedFile]]) -> List[Dict[str, Any]]:
    settings = st.session_state.settings

    with st.sidebar:
        st.title("控制面板")

        with st.expander("请求配置", expanded=True):
            with st.form("settings_form", clear_on_submit=False):
                base_url = st.text_input("Base URL", value=settings.get("baseUrl", ""))
                endpoint = st.text_input("Endpoint", value=settings.get("endpoint", "/agent/invoke"))
                method_options = ["POST", "GET", "PUT", "PATCH"]
                current_method = str(settings.get("method", "POST")).upper()
                if current_method not in method_options:
                    method_options = [current_method] + [item for item in method_options if item != current_method]
                method = st.selectbox(
                    "HTTP 方法",
                    method_options,
                    index=0,
                    help="请求将使用的 HTTP 方法",
                )
                mock = st.toggle("使用模拟响应", value=bool(settings.get("mock", False)))
                api_key = st.text_input("API Key", value=settings.get("apiKey", ""), type="password")
                temperature = st.slider("Temperature", 0.0, 1.0, float(settings.get("temperature", 0.7)), 0.05)
                system_prompt = st.text_area(
                    "System Prompt",
                    value=settings.get("systemPrompt", ""),
                    help="发送给智能体的全局提示。留空则不附带系统提示。",
                )
                extra_headers_raw = st.text_area(
                    "额外请求头 (JSON)",
                    value=json.dumps(settings.get("extraHeaders", {}), ensure_ascii=False, indent=2),
                    help="以 JSON 格式填写需要附加的自定义请求头",
                )

                submitted = st.form_submit_button("更新配置")

                if submitted:
                    try:
                        extra_headers = json.loads(extra_headers_raw) if extra_headers_raw.strip() else {}
                        if not isinstance(extra_headers, dict):
                            raise ValueError
                    except ValueError:
                        st.error("额外请求头需为合法的 JSON 对象。")
                    else:
                        st.session_state.settings = {
                            "baseUrl": base_url.strip(),
                            "endpoint": endpoint.strip() or "/",
                            "method": method,
                            "mock": mock,
                            "apiKey": api_key.strip(),
                            "temperature": temperature,
                            "extraHeaders": extra_headers,
                            "systemPrompt": system_prompt.strip(),
                        }

                        new_system_prompt = system_prompt.strip()
                        if st.session_state.messages:
                            first_message = st.session_state.messages[0]
                            if first_message.get("role") == "system":
                                if new_system_prompt:
                                    first_message["content"] = new_system_prompt
                                else:
                                    st.session_state.messages.pop(0)
                            elif new_system_prompt:
                                st.session_state.messages.insert(0, create_message("system", new_system_prompt))
                        elif new_system_prompt:
                            st.session_state.messages.append(create_message("system", new_system_prompt))

                        st.success("配置已更新")

        st.divider()
        st.subheader("附件上传")
        if uploaded_files:
            for file in uploaded_files:
                st.caption(f"📎 {file.name} · {file.size / 1024:.1f} KB")
        else:
            st.caption("尚未选择附件")
        if st.button("清空已选附件"):
            st.session_state.file_uploader = []
            st.experimental_rerun()

    return encode_attachments(uploaded_files or [])


def encode_attachments(files: List[UploadedFile]) -> List[Dict[str, Any]]:
    attachments: List[Dict[str, Any]] = []
    for file in files:
        file_bytes = file.getvalue()
        attachments.append(
            {
                "name": file.name,
                "size": len(file_bytes),
                "type": file.type,
                "lastModified": getattr(file, "last_modified", None),
                "base64": base64.b64encode(file_bytes).decode("utf-8"),
            }
        )
    return attachments


def compose_url(settings: Dict[str, Any]) -> str:
    base = (settings.get("baseUrl") or "").rstrip("/")
    endpoint = settings.get("endpoint") or "/"
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    return f"{base}{endpoint}" if base else endpoint


def build_headers(settings: Dict[str, Any]) -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}

    api_key = settings.get("apiKey")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    extras = settings.get("extraHeaders")
    if isinstance(extras, dict):
        for key, value in extras.items():
            if value is not None:
                headers[str(key)] = str(value)

    return headers


def build_payload(settings: Dict[str, Any], user_content: str, attachments: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "system": settings.get("systemPrompt"),
        "input": user_content,
        "attachments": attachments,
        "temperature": settings.get("temperature", 0.7),
        "timestamp": datetime.utcnow().isoformat(),
    }


def generate_mock_response(payload: Dict[str, Any]) -> str:
    attachment_note = (
        f"我已接收到 {len(payload['attachments'])} 个附件，可用于辅助分析。"
        if payload["attachments"]
        else "本次请求未附带额外资料。"
    )
    mood = "创造性" if float(payload.get("temperature", 0.7)) > 0.6 else "严谨"
    return f"收到指令：\n{payload['input']}\n\n{attachment_note}\n当前工作模式：{mood}。"


def normalize_backend_response(data: Any) -> str:
    if isinstance(data, dict):
        messages = data.get("messages")
        if isinstance(messages, list):
            for message in messages:
                if isinstance(message, dict) and message.get("role") == "assistant":
                    content = message.get("content")
                    if isinstance(content, str):
                        return content
        content = data.get("content")
        if isinstance(content, str):
            return content
        return json.dumps(data, ensure_ascii=False, indent=2)
    if isinstance(data, list):
        return json.dumps(data, ensure_ascii=False, indent=2)
    return str(data)


def dispatch_request(settings: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    if settings.get("mock", True):
        content = generate_mock_response(payload)
        return create_message("assistant", content, is_error=False)

    if not settings.get("baseUrl"):
        return create_message(
            "assistant",
            "请求失败：请在配置中填写 Base URL，或启用模拟响应模式。",
            is_error=True,
        )

    url = compose_url(settings)
    method = str(settings.get("method", "POST") or "POST").upper()

    try:
        response = requests.request(
            method=method,
            url=url,
            headers=build_headers(settings),
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
        try:
            data = response.json()
        except ValueError:
            data = response.text
        content = normalize_backend_response(data)
        return create_message("assistant", content, is_error=False)
    except requests.RequestException as error:
        return create_message(
            "assistant",
            f"请求失败：{error}",
            is_error=True,
        )


def create_message(role: str, content: str, attachments: Optional[List[Dict[str, Any]]] = None, *, is_error: bool = False) -> Dict[str, Any]:
    return {
        "id": create_id(),
        "role": role,
        "content": content,
        "timestamp": datetime.utcnow().isoformat(),
        "attachments": attachments or [],
        "is_error": is_error,
    }


def render_messages(messages: List[Dict[str, Any]]) -> None:
    for message in messages:
        role = message["role"]
        label = ROLE_LABELS.get(role, role)
        with st.chat_message("assistant" if role == "assistant" else role, avatar=label[0] if label else None):
            st.markdown(message["content"])
            attachments = message.get("attachments") or []
            if attachments:
                attachment_texts = [
                    f"📁 {item['name']} · {item['size'] / 1024:.1f} KB"
                    for item in attachments
                ]
                st.caption("\n".join(attachment_texts))
            timestamp = message.get("timestamp")
            if timestamp:
                try:
                    ts = datetime.fromisoformat(timestamp)
                    st.caption(ts.strftime("%Y-%m-%d %H:%M:%S UTC"))
                except ValueError:
                    st.caption(timestamp)
            if message.get("is_error"):
                st.error("请求失败，请检查配置或后端服务。")


def main() -> None:
    st.set_page_config(page_title="Agent Portal", page_icon="🤖", layout="wide")
    init_session_state()

    st.title("Agent Portal")
    st.caption("通过 Streamlit 与智能体 API 交互，并支持附件上传。")

    uploaded_files = st.sidebar.file_uploader(
        "上传附件",
        accept_multiple_files=True,
        key="file_uploader",
        help="所选附件将在下一条消息中一并发送",
    )

    attachments_payload = render_sidebar(uploaded_files)

    render_messages(st.session_state.messages)

    prompt = st.chat_input("请输入要发送的消息…")

    if prompt:
        user_message = create_message("user", prompt, attachments_payload)
        st.session_state.messages.append(user_message)

        payload = build_payload(st.session_state.settings, prompt, attachments_payload)

        with st.spinner("等待智能体响应…"):
            assistant_message = dispatch_request(st.session_state.settings, payload)

        st.session_state.messages.append(assistant_message)

        if attachments_payload:
            st.session_state.file_uploader = []

        st.experimental_rerun()


if __name__ == "__main__":
    main()
