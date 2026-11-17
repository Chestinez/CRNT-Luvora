/* global io */
const list = document.querySelector("#conversations");
const history = document.querySelector("#messages");
const status = document.querySelector("#status");
const input = document.querySelector("#body");
const send = document.querySelector("#send");
const older = document.querySelector("#older");
let viewer;
let selected;
let selectedConversation;
let cursor;
let sending = false;
let refreshing = false;
let refreshAgain = false;
const socket = io({ transports: ["websocket"] });
let retry;
let messages = new Map();
const drafts = new Map();

async function api(path = "", options = {}) {
  const response = await fetch(`/api/chat${path}`, {
    ...options,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load messages.");
  return data;
}

function controls(conversation) {
  selectedConversation = conversation;
  document.querySelector("#name").textContent =
    conversation.name || "Luvora member";
  document.querySelector("#connection-status").textContent =
    conversation.can_send
      ? "Connected · You can message each other."
      : "Connection ended · Your chat history is still here.";
  input.disabled = sending || !conversation.can_send;
  send.disabled = sending || !conversation.can_send;
  document.querySelector("#composer").hidden = conversation.status === "ended";
  input.placeholder = conversation.can_send
    ? "Say something kind…"
    : "Messaging is unavailable.";
}

function renderMessages() {
  const scrollTop = history.scrollTop;
  const nearBottom =
    history.scrollHeight - history.scrollTop - history.clientHeight < 80;
  history.replaceChildren();
  const sorted = [...messages.values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  if (!sorted.length)
    history.textContent = selectedConversation?.can_send
      ? "No messages yet. Start with a hello!"
      : "No messages were exchanged in this conversation.";
  for (const message of sorted) {
    const bubble = document.createElement("div");
    bubble.className = `message${message.sender_id === viewer ? " mine" : ""}`;
    const body = document.createElement("p");
    body.textContent = message.body;
    const time = document.createElement("time");
    time.dateTime = message.created_at;
    time.textContent = `${message.sender_id === viewer ? "You" : "Them"} · ${new Date(message.created_at).toLocaleString()}`;
    bubble.append(body, time);
    history.append(bubble);
  }
  history.scrollTop = nearBottom ? history.scrollHeight : scrollTop;
}

async function loadMessages(id, before) {
  const data = await api(`/${id}/messages${before ? `?before=${before}` : ""}`);
  if (selected !== id) return;
  controls(data.conversation);
  // Refetch all loaded pages on refresh, so a burst of >50 messages cannot leave gaps.
  if (!before && messages.size) {
    let page = data;
    const oldest = [...messages.values()].sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    )[0];
    while (
      page.next_cursor &&
      page.messages[0].created_at >= oldest.created_at
    ) {
      page = await api(`/${id}/messages?before=${page.next_cursor}`);
      data.messages.push(...page.messages);
    }
    data.next_cursor = page.next_cursor;
  }
  if (selected !== id) return;
  for (const message of data.messages) messages.set(message.id, message);
  cursor = data.next_cursor;
  older.hidden = !cursor;
  renderMessages();
}

async function select(id) {
  if (sending) return;
  if (selected) drafts.set(selected, input.value);
  selected = id;
  selectedConversation = null;
  document.querySelector("#composer").hidden = true;
  retry = null;
  messages = new Map();
  history.replaceChildren();
  input.value = drafts.get(id) || "";
  input.disabled = send.disabled = true;
  older.hidden = true;
  status.textContent = "Loading conversation…";
  try {
    await loadMessages(id);
    status.textContent = "";
    await loadInbox();
  } catch (error) {
    status.textContent = error.message;
  }
}

async function loadInbox() {
  const data = await api();
  viewer = data.viewer_id;
  list.replaceChildren();
  if (!data.conversations.length)
    list.textContent =
      "No conversations yet. Accept a connection in Discovery to start chatting.";
  for (const group of [
    {
      title: "Matched",
      ended: false,
      empty:
        "No current matches. Connect with someone in Discovery to start chatting.",
    },
    { title: "Ended", ended: true, empty: "No ended conversations." },
  ]) {
    const section = document.createElement("section");
    section.className = "conversation-group";
    const heading = document.createElement("h3");
    const conversations = data.conversations.filter(
      (c) => (c.status === "ended") === group.ended,
    );
    heading.textContent = `${group.title} (${conversations.length})`;
    section.setAttribute("aria-label", group.title);
    section.append(heading);
    if (!conversations.length) {
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent = group.empty;
      section.append(empty);
    }
    for (const conversation of conversations) {
      const button = document.createElement("button");
      button.className = "conversation";
      button.setAttribute("aria-current", String(conversation.id === selected));
      const name = document.createElement("strong");
      name.textContent = conversation.name || "Luvora member";
      const preview = document.createElement("span");
      const fallback = conversation.can_send
        ? "Say hello"
        : "No messages exchanged";
      preview.textContent = (conversation.last_message || fallback).slice(
        0,
        90,
      );
      button.append(name, preview);
      button.onclick = () => select(conversation.id);
      section.append(button);
    }
    list.append(section);
  }
  if (selected && !data.conversations.some((c) => c.id === selected)) {
    selected = null;
    selectedConversation = null;
    document.querySelector("#composer").hidden = true;
    messages.clear();
    history.replaceChildren();
    input.disabled = send.disabled = true;
    document.querySelector("#name").textContent = "Conversation unavailable";
    document.querySelector("#connection-status").textContent = "";
    older.hidden = true;
  }
}

older.onclick = async () => {
  if (!selected || !cursor) return;
  older.disabled = true;
  const height = history.scrollHeight;
  try {
    await loadMessages(selected, cursor);
    history.scrollTop += history.scrollHeight - height;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    older.disabled = false;
  }
};

input.addEventListener("keydown", (event) => {
  // Let IME composition finish without accidentally sending the message.
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.isComposing ||
    event.keyCode === 229
  )
    return;
  event.preventDefault();
  if (
    event.repeat ||
    sending ||
    input.disabled ||
    send.disabled ||
    !input.value.trim()
  )
    return;
  document.querySelector("#composer").requestSubmit();
});

document.querySelector("#composer").onsubmit = async (event) => {
  event.preventDefault();
  const body = input.value.trim();
  if (!body || !selected || !selectedConversation?.can_send || sending) return;
  if (!socket.connected) {
    status.textContent =
      "Reconnecting. Your draft is saved; send when connected.";
    return;
  }
  const id = selected;
  if (!retry || retry.body !== body) retry = { id: crypto.randomUUID(), body };
  sending = true;
  input.disabled = send.disabled = true;
  status.textContent = "Sending…";
  try {
    const result = await socket
      .timeout(10000)
      .emitWithAck("chat:send", { conversation_id: id, ...retry });
    if (!result.ok) throw new Error(result.error);
    const message = result.message;
    messages.set(message.id, message);
    renderMessages();
    history.scrollTop = history.scrollHeight;
    input.value = "";
    drafts.delete(id);
    retry = null;
    status.textContent = "";
  } catch (error) {
    status.textContent = `${error.message} Your message has been kept.`;
  } finally {
    sending = false;
    try {
      await loadMessages(id);
      await loadInbox();
    } catch (error) {
      status.textContent = error.message;
    }
    if (!input.disabled) input.focus();
  }
};

async function refresh() {
  if (document.hidden) return;
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    await loadInbox();
    if (selected) await loadMessages(selected);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      refresh();
    }
  }
}
socket.on("connect", () => {
  status.textContent = "";
  refresh();
});
socket.on("chat:changed", refresh);
socket.on("disconnect", () => {
  status.textContent = "Reconnecting… Your draft is saved.";
});
socket.on("connect_error", (error) => {
  status.textContent = error.message;
});
refresh();
document.addEventListener("visibilitychange", refresh);
