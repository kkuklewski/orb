import { useChat } from "../stores/chat";
import { useSession } from "../stores/session";
import { closePanelChat, useViews } from "../stores/views";
import { ChatLog } from "./chat/Chat";

/** The current session's conversation as a sheet over the screen you're on. It has no input of its own: the dock
 *  below (composer and voice pill) stays the one place to talk, and the sheet only shows what was said. */
export function ChatSheet() {
  const label = useSession((s) => s.label);
  const empty = useChat((s) => s.items.length === 0);
  return (
    <aside className="chat-sheet" aria-label="Chat">
      <div className="peek-bar mono">
        <button type="button" onClick={closePanelChat} aria-label="Close chat">✕ CLOSE</button>
        <button type="button" onClick={() => useViews.setState({ view: "chat" })} aria-label="Open in Chats">OPEN IN CHATS →</button>
      </div>
      <div className="sheet-title">{label || "This session"}</div>
      {empty ? <p className="side-hint">Nothing said yet. Type or talk below.</p> : <ChatLog />}
    </aside>
  );
}
