// ==UserScript==
// @name         MLflow Agent Chat
// @match        https://<MLFLOW_URL>/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const AGENT_URL = "<ASSISTANT_URL>/chat";

  const DEFAULT_PANEL_WIDTH = 420;
  const MIN_PANEL_WIDTH = 320;
  const MAX_PANEL_WIDTH = 900;
  const COLLAPSED_WIDTH = 56;

  const STORAGE_KEY_COLLAPSED = "mlflow-agent-panel-collapsed";
  const STORAGE_KEY_WIDTH = "mlflow-agent-panel-width";

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatInline(text) {
    let html = escapeHtml(text || "");

    const codeTokens = [];
    html = html.replace(/`([^`]+)`/g, (_, code) => {
      const token = `__CODE_TOKEN_${codeTokens.length}__`;
      codeTokens.push(
        `<code style="
          background:#2a2a2a;
          color:#f5f5f5;
          padding:2px 6px;
          border-radius:6px;
          font-size:12px;
          font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
        ">${code}</code>`
      );
      return token;
    });

    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="
          color:#7ab7ff;
          text-decoration:none;
          border-bottom:1px solid rgba(122,183,255,0.35);
          word-break:break-word;
        ">${label}</a>`;
      }
    );

    html = html.replace(
      /(^|[\s(>])((https?:\/\/[^\s<]+))/g,
      (_, prefix, url) => {
        return `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer" style="
          color:#7ab7ff;
          text-decoration:none;
          border-bottom:1px solid rgba(122,183,255,0.35);
          word-break:break-word;
        ">${url}</a>`;
      }
    );

    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    codeTokens.forEach((snippet, i) => {
      html = html.replace(`__CODE_TOKEN_${i}__`, snippet);
    });

    return html;
  }

  function formatMessage(text) {
    const raw = String(text || "");
    const lines = raw.split("\n");

    let htmlParts = [];
    let paragraph = [];
    let listItems = [];
    let inCode = false;
    let codeLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;

      htmlParts.push(`
        <p style="
          margin:0 0 10px 0;
          line-height:1.6;
          overflow-wrap:anywhere;
          white-space:normal;
        ">
          ${formatInline(paragraph.join(" "))}
        </p>
      `);

      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) return;

      const itemsHtml = listItems
        .map(item => `<li style="margin:0 0 4px 0; line-height:1.55;">${formatInline(item)}</li>`)
        .join("");

      htmlParts.push(`
        <ul style="
          margin:0 0 10px 18px;
          padding-left:0;
        ">
          ${itemsHtml}
        </ul>
      `);

      listItems = [];
    }

    function flushCode() {
      if (!codeLines.length) return;

      htmlParts.push(`
        <pre style="
          background:#171717;
          color:#e8e8e8;
          border:1px solid #2f2f2f;
          border-radius:10px;
          padding:10px 12px;
          white-space:pre-wrap;
          word-break:break-word;
          overflow-x:auto;
          font-size:12px;
          margin:0 0 10px 0;
          line-height:1.55;
        "><code>${escapeHtml(codeLines.join("\n"))}</code></pre>
      `);

      codeLines = [];
    }

    function addHeader(level, text) {
      const sizes = {
        1: "18px",
        2: "16px",
        3: "14px",
        4: "13px"
      };

      const colors = {
        1: "#f5f5f5",
        2: "#dcdcdc",
        3: "#bdbdbd",
        4: "#a8a8a8"
      };

      htmlParts.push(`
        <div style="
          font-weight:600;
          font-size:${sizes[level] || "13px"};
          margin:12px 0 6px 0;
          color:${colors[level] || "#a8a8a8"};
          line-height:1.35;
          overflow-wrap:anywhere;
        ">
          ${formatInline(text)}
        </div>
      `);
    }

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("```")) {
        flushParagraph();
        flushList();

        if (inCode) {
          flushCode();
          inCode = false;
        } else {
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      const headerMatch = trimmed.match(/^(#{1,4})\s+(.*)/);
      if (headerMatch) {
        flushParagraph();
        flushList();

        const level = headerMatch[1].length;
        const content = headerMatch[2];

        addHeader(level, content);
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        flushParagraph();
        listItems.push(trimmed.replace(/^[-*]\s+/, ""));
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        flushParagraph();
        listItems.push(trimmed.replace(/^\d+\.\s+/, ""));
        continue;
      }

      flushList();
      paragraph.push(trimmed);
    }

    flushParagraph();
    flushList();
    flushCode();

    return htmlParts.join("");
  }

  function getRunId() {
    const full = window.location.href;
    const match = full.match(/\/runs\/([a-f0-9]+)/i);
    return match ? match[1] : null;
  }

  function makeEl(tag, styles = {}, text = "") {
    const el = document.createElement(tag);
    Object.assign(el.style, styles);
    if (text) el.textContent = text;
    return el;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function init() {
    const savedCollapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED) === "true";
    const savedWidthRaw = parseInt(localStorage.getItem(STORAGE_KEY_WIDTH) || "", 10);
    let currentWidth = Number.isFinite(savedWidthRaw)
      ? clamp(savedWidthRaw, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH)
      : DEFAULT_PANEL_WIDTH;

    const panel = makeEl("div", {
      position: "fixed",
      top: "0",
      right: "0",
      width: savedCollapsed ? `${COLLAPSED_WIDTH}px` : `${currentWidth}px`,
      height: "100vh",
      background: "#212121",
      color: "#ececec",
      borderLeft: "1px solid #353535",
      zIndex: "999999",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 0 32px rgba(0,0,0,0.35)",
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      transition: "width 0.18s ease",
      overflow: "hidden",
      boxSizing: "border-box"
    });

    const resizeHandle = makeEl("div", {
      position: "absolute",
      top: "0",
      left: "0",
      width: "8px",
      height: "100%",
      cursor: "ew-resize",
      zIndex: "2",
      background: "transparent"
    });

    const resizeHandleVisual = makeEl("div", {
      position: "absolute",
      top: "0",
      left: "3px",
      width: "2px",
      height: "100%",
      background: "transparent",
      transition: "background 0.15s ease"
    });

    resizeHandle.appendChild(resizeHandleVisual);

    const header = makeEl("div", {
      height: "56px",
      minHeight: "56px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 12px 0 14px",
      borderBottom: "1px solid #353535",
      background: "#212121",
      boxSizing: "border-box"
    });

    const titleWrap = makeEl("div", {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      minWidth: "0"
    });

    const icon = makeEl("div", {
      width: "28px",
      height: "28px",
      minWidth: "28px",
      borderRadius: "8px",
      background: "#2f2f2f",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "14px",
      color: "#fff"
    }, "◫");

    const titleBlock = makeEl("div", {
      display: "flex",
      flexDirection: "column",
      minWidth: "0"
    });

    const title = makeEl("div", {
      fontSize: "14px",
      fontWeight: "600",
      color: "#f5f5f5",
      whiteSpace: "nowrap"
    }, "MLflow Agent");

    const subtitle = makeEl("div", {
      fontSize: "11px",
      color: "#a7a7a7",
      whiteSpace: "nowrap"
    }, "Run-aware chat panel");

    titleBlock.appendChild(title);
    titleBlock.appendChild(subtitle);
    titleWrap.appendChild(icon);
    titleWrap.appendChild(titleBlock);

    const controls = makeEl("div", {
      display: "flex",
      alignItems: "center",
      gap: "8px"
    });

    const toggleBtn = makeEl("button", {
      width: "32px",
      height: "32px",
      borderRadius: "8px",
      border: "1px solid #3a3a3a",
      background: "#2a2a2a",
      color: "#f0f0f0",
      cursor: "pointer",
      fontSize: "14px",
      lineHeight: "1"
    });

    toggleBtn.onmouseenter = () => { toggleBtn.style.background = "#343434"; };
    toggleBtn.onmouseleave = () => { toggleBtn.style.background = "#2a2a2a"; };

    controls.appendChild(toggleBtn);
    header.appendChild(titleWrap);
    header.appendChild(controls);

    const content = makeEl("div", {
      flex: "1",
      minHeight: "0",
      display: "flex",
      flexDirection: "column",
      background: "#212121"
    });

    const messages = makeEl("div", {
      flex: "1",
      minHeight: "0",
      overflowY: "auto",
      padding: "18px 14px",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
      scrollBehavior: "smooth",
      boxSizing: "border-box"
    });

    const composerWrap = makeEl("div", {
      borderTop: "1px solid #353535",
      padding: "12px",
      background: "#212121",
      boxSizing: "border-box"
    });

    const composerBox = makeEl("div", {
      border: "1px solid #3a3a3a",
      background: "#2a2a2a",
      borderRadius: "20px",
      padding: "10px 10px 10px 14px",
      display: "flex",
      alignItems: "flex-end",
      gap: "8px",
      boxSizing: "border-box"
    });

    const input = document.createElement("textarea");
    Object.assign(input.style, {
      flex: "1",
      minHeight: "22px",
      maxHeight: "180px",
      resize: "none",
      border: "none",
      outline: "none",
      background: "transparent",
      color: "#ececec",
      fontSize: "14px",
      lineHeight: "1.5",
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflowY: "auto"
    });
    input.placeholder = "Message MLflow Agent";

    const sendBtn = makeEl("button", {
      width: "34px",
      height: "34px",
      minWidth: "34px",
      borderRadius: "999px",
      border: "none",
      background: "#ffffff",
      color: "#111111",
      cursor: "pointer",
      fontSize: "16px",
      fontWeight: "700",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }, "↑");

    sendBtn.onmouseenter = () => { sendBtn.style.opacity = "0.9"; };
    sendBtn.onmouseleave = () => { sendBtn.style.opacity = "1"; };

    const footer = makeEl("div", {
      fontSize: "11px",
      color: "#8e8e8e",
      paddingTop: "8px",
      paddingLeft: "4px"
    }, "Answers are based on the current MLflow run context.");

    composerBox.appendChild(input);
    composerBox.appendChild(sendBtn);
    composerWrap.appendChild(composerBox);
    composerWrap.appendChild(footer);

    content.appendChild(messages);
    content.appendChild(composerWrap);

    panel.appendChild(resizeHandle);
    panel.appendChild(header);
    panel.appendChild(content);
    document.body.appendChild(panel);

    function autoResizeTextarea() {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    }

    function scrollMessagesToBottom() {
      messages.scrollTop = messages.scrollHeight;
    }

    function applyWidth() {
      const collapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED) === "true";
      panel.style.width = collapsed ? `${COLLAPSED_WIDTH}px` : `${currentWidth}px`;
    }

    function setCollapsed(collapsed) {
      panel.style.width = collapsed ? `${COLLAPSED_WIDTH}px` : `${currentWidth}px`;
      content.style.display = collapsed ? "none" : "flex";
      titleBlock.style.display = collapsed ? "none" : "flex";
      resizeHandle.style.display = collapsed ? "none" : "block";
      toggleBtn.textContent = collapsed ? "❮" : "❯";
      toggleBtn.title = collapsed ? "Expand panel" : "Collapse panel";
      localStorage.setItem(STORAGE_KEY_COLLAPSED, String(collapsed));
    }

    function addBubble(sender, text, kind = "agent") {
      const row = makeEl("div", {
        display: "flex",
        flexDirection: "column",
        alignItems: kind === "user" ? "flex-end" : "stretch"
      });

      const label = makeEl("div", {
        fontSize: "11px",
        color: "#8e8e8e",
        marginBottom: "6px",
        paddingLeft: kind === "user" ? "0" : "2px",
        paddingRight: kind === "user" ? "2px" : "0"
      }, sender);

      const bubble = makeEl("div", {
        maxWidth: kind === "user" ? "88%" : "100%",
        width: kind === "user" ? "auto" : "100%",
        boxSizing: "border-box",
        background: kind === "user" ? "#303030" : "#2a2a2a",
        color: "#ececec",
        border: kind === "user" ? "1px solid #3a3a3a" : "1px solid #353535",
        borderRadius: kind === "user" ? "18px" : "16px",
        padding: "12px 14px",
        fontSize: "14px",
        lineHeight: "1.6",
        overflowWrap: "anywhere"
      });

      bubble.innerHTML = formatMessage(text);

      row.appendChild(label);
      row.appendChild(bubble);
      messages.appendChild(row);
      scrollMessagesToBottom();
    }

    function addThinkingBubble() {
      const row = makeEl("div", {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch"
      });

      const label = makeEl("div", {
        fontSize: "11px",
        color: "#8e8e8e",
        marginBottom: "6px",
        paddingLeft: "2px"
      }, "Agent");

      const bubble = makeEl("div", {
        width: "100%",
        boxSizing: "border-box",
        background: "#2a2a2a",
        color: "#bdbdbd",
        border: "1px solid #353535",
        borderRadius: "16px",
        padding: "12px 14px",
        fontSize: "14px",
        lineHeight: "1.6"
      });

      bubble.innerHTML = `<p style="margin:0;">Thinking...</p>`;

      row.appendChild(label);
      row.appendChild(bubble);
      messages.appendChild(row);
      scrollMessagesToBottom();

      return {
        update(newText) {
          bubble.innerHTML = formatMessage(newText);
          scrollMessagesToBottom();
        },
        remove() {
          row.remove();
        }
      };
    }

    async function sendMessage() {
      const runId = getRunId();
      const text = input.value.trim();

      if (!runId) {
        addBubble("Agent", "Could not detect a run ID from this page.", "agent");
        return;
      }

      if (!text) return;

      addBubble("You", text, "user");
      input.value = "";
      autoResizeTextarea();

      const thinking = addThinkingBubble();

      try {
        const res = await fetch(AGENT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            run_id: runId,
            message: text
          })
        });

        if (!res.ok) {
          const errText = await res.text();
          thinking.update(`**Request failed**\n\n- Status: \`${res.status}\`\n- Details: ${errText}`);
          return;
        }

        const data = await res.json();
        thinking.remove();
        addBubble("Agent", data.answer || "No response returned.", "agent");
      } catch (err) {
        thinking.update(`**Network error**\n\n${err && err.message ? err.message : String(err)}`);
      }
    }

    let isResizing = false;

    resizeHandle.addEventListener("mouseenter", () => {
      resizeHandleVisual.style.background = "#4a4a4a";
    });

    resizeHandle.addEventListener("mouseleave", () => {
      if (!isResizing) {
        resizeHandleVisual.style.background = "transparent";
      }
    });

    resizeHandle.addEventListener("mousedown", (e) => {
      if (localStorage.getItem(STORAGE_KEY_COLLAPSED) === "true") return;
      isResizing = true;
      panel.style.transition = "none";
      resizeHandleVisual.style.background = "#6a6a6a";
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const newWidth = clamp(window.innerWidth - e.clientX, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
      currentWidth = newWidth;
      localStorage.setItem(STORAGE_KEY_WIDTH, String(currentWidth));
      applyWidth();
    });

    window.addEventListener("mouseup", () => {
      if (!isResizing) return;
      isResizing = false;
      panel.style.transition = "width 0.18s ease";
      resizeHandleVisual.style.background = "transparent";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });

    toggleBtn.onclick = () => {
      const collapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED) === "true";
      setCollapsed(!collapsed);
    };

    sendBtn.onclick = sendMessage;

    input.addEventListener("input", autoResizeTextarea);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    autoResizeTextarea();
    setCollapsed(savedCollapsed);

    if (!savedCollapsed) {
      addBubble(
        "Agent",
        "Ready.\n\nAsk about the current run, compare behavior across runs, or inspect logged artifacts and metrics.",
        "agent"
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();