const form = document.getElementById("quickForm");
const conversationList = document.getElementById("conversationList");
const inputText = document.getElementById("inputText");
const statusText = document.getElementById("statusText");
const submitButton = document.getElementById("submitButton");
const imageInput = document.getElementById("imageInput");
const attachImageButton = document.getElementById("attachImageButton");
const attachmentHint = document.getElementById("attachmentHint");

const MAX_IMAGE_ATTACHMENTS = 3;
const MAX_IMAGE_SIZE_BYTES = 6 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_PREFIX = "image/";

let currentSessionId = null;
let loading = false;
let attachedImages = [];

function setStatus(message, tone = "default") {
  const text = String(message || "").trim();
  statusText.textContent = text;
  statusText.dataset.tone = tone;
  statusText.hidden = !text || tone === "default";
  statusText.title = text ? "Cmd+C またはダブルクリックでコピーできます" : "";
}

function hasSubmittableInput() {
  return Boolean(inputText.value.trim()) || attachedImages.length > 0;
}

function updateSubmitButtonState() {
  submitButton.disabled = loading || !hasSubmittableInput();
}

function setLoading(isLoading) {
  loading = Boolean(isLoading);
  updateSubmitButtonState();
}

function updateAttachmentHint() {
  const count = attachedImages.length;
  if (count === 0) {
    attachmentHint.hidden = true;
    attachmentHint.textContent = "";
    updateSubmitButtonState();
    return;
  }

  attachmentHint.hidden = false;
  attachmentHint.textContent = `画像${count}件を添付中`;
  updateSubmitButtonState();
}

function clearAttachedImages() {
  attachedImages = [];
  imageInput.value = "";
  updateAttachmentHint();
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function normalizeMimeType(file) {
  const value = String(file?.type || "").trim().toLowerCase();
  if (value.startsWith(ALLOWED_IMAGE_MIME_PREFIX)) {
    return value;
  }
  return "";
}

async function toImagePayload(file) {
  const name = String(file?.name || "image").trim();
  const sizeBytes = Number(file?.size || 0);
  const mimeType = normalizeMimeType(file);

  if (!mimeType) {
    throw new Error(`画像形式のみ添付できます: ${name}`);
  }
  if (sizeBytes <= 0) {
    throw new Error(`画像ファイルが空です: ${name}`);
  }
  if (sizeBytes > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `画像サイズが大きすぎます（最大${Math.floor(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))}MB）: ${name}`
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  return {
    name,
    mimeType,
    sizeBytes,
    dataBase64: arrayBufferToBase64(arrayBuffer)
  };
}

async function appendImageFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) {
    return;
  }

  if (attachedImages.length >= MAX_IMAGE_ATTACHMENTS) {
    setStatus(`画像は最大${MAX_IMAGE_ATTACHMENTS}件までです。`, "warn");
    return;
  }

  try {
    const remaining = MAX_IMAGE_ATTACHMENTS - attachedImages.length;
    const targetFiles = files.slice(0, remaining);
    const payloads = await Promise.all(targetFiles.map((file) => toImagePayload(file)));
    attachedImages = [...attachedImages, ...payloads];
    updateAttachmentHint();
    setStatus("", "default");
  } catch (error) {
    setStatus(`画像添付に失敗しました: ${error.message || error}`, "error");
  } finally {
    imageInput.value = "";
  }
}

function scrollConversationToBottom() {
  conversationList.scrollTop = conversationList.scrollHeight;
}

function updateConversationVisibility() {
  const hasMessages = conversationList.childElementCount > 0;
  document.body.classList.toggle("has-history", hasMessages);
}

function handleConversationWheel(event) {
  if (!(event.deltaY || event.deltaX)) {
    return;
  }

  const maxScrollTop = conversationList.scrollHeight - conversationList.clientHeight;
  if (maxScrollTop <= 0) {
    return;
  }

  event.preventDefault();
  conversationList.scrollTop += event.deltaY;
}

function appendMessage({ role, text, linkUrl = "", linkLabel = "" }) {
  const message = document.createElement("article");
  message.className = `message message-${role}`;

  const body = document.createElement("p");
  body.className = "message-text";
  body.textContent = String(text || "").trim();
  message.appendChild(body);

  if (linkUrl) {
    const link = document.createElement("a");
    link.className = "message-link";
    link.href = linkUrl;
    link.dataset.externalUrl = linkUrl;
    link.textContent = linkLabel || "登録した予定を開く";
    message.appendChild(link);
  }

  conversationList.appendChild(message);
  updateConversationVisibility();
  scrollConversationToBottom();
  
  // メッセージが追加されたらウィンドウを展開する
  if (window.quickApi?.setExpanded) {
    void window.quickApi.setExpanded(true);
  }
}

function resetSession() {
  currentSessionId = null;
  conversationList.innerHTML = ""; // 履歴削除
  updateConversationVisibility(); // 履歴なし状態へ更新
  inputText.value = "";
  clearAttachedImages();
  setStatus("", "default");
  focusMainInput();
  
  // ウィンドウを縮小
  if (window.quickApi?.setExpanded) {
    void window.quickApi.setExpanded(false);
  }
  // リサイズ
  requestAnimationFrame(() => {
    const form = document.querySelector('.quick-form');
    const height = form ? form.offsetHeight : document.body.scrollHeight;
    if (window.quickApi?.resize) {
        void window.quickApi.resize(height);
    }
  });
}

function focusMainInput() {
  const maxAttempts = 8;
  let attempt = 0;

  const applyFocus = () => {
    attempt += 1;
    window.focus();
    inputText.focus({ preventScroll: true });

    if (document.activeElement === inputText) {
      const cursor = inputText.value.length;
      inputText.setSelectionRange(cursor, cursor);
      return;
    }

    if (attempt < maxAttempts) {
      setTimeout(applyFocus, 40);
    }
  };

  setTimeout(applyFocus, 10);
}

function setImeComposing(active) {
  const next = Boolean(active);
  if (window.quickApi?.setImeComposing) {
    void window.quickApi.setImeComposing(next);
  }
}

function isComposingEnter(event) {
  return event.key === "Enter" && (event.isComposing || event.keyCode === 229);
}

async function handleResult(result) {
  if (!result) {
    appendMessage({
      role: "assistant",
      text: "応答を取得できませんでした。"
    });
    setStatus("応答を取得できませんでした。", "error");
    return;
  }

  if (result.status === "needs_clarification") {
    currentSessionId = result.sessionId;
    appendMessage({
      role: "assistant",
      text: result.question || "追加情報が必要です。"
    });
    setStatus("追加確認が必要です。", "warn");
    focusMainInput();
    return;
  }

  if (result.status === "success") {
    currentSessionId = null;
    appendMessage({
      role: "assistant",
      text: result.message || "登録が完了しました。",
      linkUrl: result.event?.htmlLink || "",
      linkLabel: "登録した予定を開く"
    });
    setStatus(result.message || "登録が完了しました。", "success");
    focusMainInput();
    return;
  }

  if (result.status === "cancelled") {
    currentSessionId = null;
    appendMessage({
      role: "assistant",
      text: result.message || "キャンセルしました。"
    });
    setStatus(result.message || "キャンセルしました。", "warn");
    focusMainInput();
    return;
  }

  appendMessage({
    role: "assistant",
    text: result.message || "処理に失敗しました。"
  });
  setStatus(result.message || "処理に失敗しました。", "error");
}

async function submit() {
  if (loading) {
    return;
  }

  try {
    setLoading(true);

    const text = inputText.value.trim();
    const hasAttachedImages = attachedImages.length > 0;
    if (!text && !hasAttachedImages) {
      setStatus("入力または画像添付をしてください。", "warn");
      return;
    }

    setImeComposing(false);
    const imageInputs = attachedImages.map((image) => ({ ...image }));
    const userMessage = [
      text || "(画像入力)",
      imageInputs.length > 0 ? `[+${imageInputs.length}]` : ""
    ]
      .filter(Boolean)
      .join("\n");
    appendMessage({
      role: "user",
      text: userMessage
    });

    inputText.value = "";
    clearAttachedImages();

    let result;
    if (currentSessionId) {
      result = await window.quickApi.answerClarification(currentSessionId, {
        text,
        imageInputs
      });
    } else {
      result = await window.quickApi.createSchedule({
        text,
        imageInputs
      });
    }

    await handleResult(result);
  } catch (error) {
    appendMessage({
      role: "assistant",
      text: `エラー: ${error.message || error}`
    });
    setStatus(`エラー: ${error.message || error}`, "error");
  } finally {
    setLoading(false);
  }
}

async function copyStatusText() {
  const text = String(statusText.textContent || "").trim();
  if (!text) {
    return;
  }
  try {
    await window.quickApi.copyText(text);
  } catch {
    // コピー補助が失敗しても入力フローを止めない。
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submit();
});

inputText.addEventListener("keydown", (event) => {
  if (isComposingEnter(event)) {
    return;
  }

  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    form.requestSubmit();
  }
});

attachImageButton.addEventListener("click", () => {
  imageInput.click();
});

imageInput.addEventListener("change", async () => {
  await appendImageFiles(imageInput.files);
  focusMainInput();
});

inputText.addEventListener("paste", async (event) => {
  const items = Array.from(event.clipboardData?.items || []);
  const imageFiles = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (imageFiles.length === 0) {
    return;
  }

  event.preventDefault();
  await appendImageFiles(imageFiles);
  focusMainInput();
});

inputText.addEventListener("input", () => {
  if (statusText.dataset.tone === "error") {
    setStatus("", "default");
  }
  updateSubmitButtonState();
});

inputText.addEventListener("compositionstart", () => {
  setImeComposing(true);
});

inputText.addEventListener("compositionend", () => {
  setImeComposing(false);
});

inputText.addEventListener("blur", () => {
  setImeComposing(false);
});

statusText.addEventListener("dblclick", async () => {
  await copyStatusText();
});

conversationList.addEventListener("click", async (event) => {
  const anchor = event.target.closest("a[data-external-url]");
  if (!anchor) {
    return;
  }
  event.preventDefault();

  try {
    const url = String(anchor.dataset.externalUrl || "").trim();
    if (!url) {
      return;
    }
    const response = await window.quickApi.openExternal(url);
    if (!response?.ok) {
      throw new Error(response?.message || "既定ブラウザでリンクを開けませんでした。");
    }
  } catch (error) {
    setStatus(`リンクを開けません: ${error.message || error}`, "error");
  }
});

conversationList.addEventListener("wheel", handleConversationWheel, {
  passive: false
});

window.addEventListener("keydown", async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
    const selection = window.getSelection()?.toString() || "";
    const isTypingTarget =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement;
    if (!selection && !isTypingTarget && !statusText.hidden) {
      event.preventDefault();
      await copyStatusText();
      return;
    }
  }

  if (event.key === "Escape") {
    await window.quickApi.hideWindow();
  }

  if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "o" || event.key === "O")) {
    event.preventDefault();
    resetSession();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === ",") {
    event.preventDefault();
    try {
      const response = await window.quickApi.openSettings();
      if (!response?.ok) {
        throw new Error(response?.message || "設定画面を開けませんでした");
      }
      setStatus("設定画面を開きました。", "success");
    } catch (error) {
      setStatus(`設定を開けません: ${error.message || error}`, "error");
    }
  }
});

window.quickApi.onFocusRequested(() => {
  setImeComposing(false);
  clearAttachedImages();
  focusMainInput();
  
  // 履歴がない場合はウィンドウを縮小状態に戻す（リサイズも行う）
  if (conversationList.childElementCount === 0) {
    if (window.quickApi?.setExpanded) {
      void window.quickApi.setExpanded(false);
    }
    // 強制リサイズ
    requestAnimationFrame(() => {
        const form = document.querySelector('.quick-form');
        const height = form ? form.offsetHeight : document.body.scrollHeight;
        if (window.quickApi?.resize) {
            void window.quickApi.resize(height);
        }
    });
  } else {
    // 履歴がある場合も、念のため現在のコンテンツに合わせてリサイズ
    requestAnimationFrame(() => {
        const form = document.querySelector('.quick-form');
        const height = form ? form.offsetHeight : document.body.scrollHeight;
        if (window.quickApi?.resize) {
            void window.quickApi.resize(height);
        }
    });
  }
});

window.addEventListener("focus", () => {
  focusMainInput();
});

// ResizeObserverで高さを監視してメインプロセスに通知
// bodyではなく中身のフォームを監視する（bodyは100%でウィンドウ追従するため）
const resizeObserver = new ResizeObserver(() => {
  const form = document.querySelector('.quick-form');
  if (form && window.quickApi?.resize) {
    void window.quickApi.resize(form.offsetHeight);
  }
});
const formElement = document.querySelector('.quick-form');
if (formElement) {
  resizeObserver.observe(formElement);
}

updateAttachmentHint();
updateConversationVisibility();
updateSubmitButtonState();
setStatus("", "default");
focusMainInput();
