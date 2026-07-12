import { useEffect, useRef, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import './ChatWindow.css';

interface GroupChatMessageItem {
  id: string;
  senderKey: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface GroupChatWindowProps {
  threadId: string; // organizationId
  myKey: string;
  myName: string;
  organizationName: string;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 4000;

export function GroupChatWindow({ threadId, myKey, myName, organizationName, onClose }: GroupChatWindowProps) {
  const [messages, setMessages] = useState<GroupChatMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  async function fetchMessages(): Promise<GroupChatMessageItem[]> {
    const result = await dataClient.models.GroupChatMessage.listGroupMessagesByThread(
      { threadId },
      { sortDirection: 'ASC', authMode: 'userPool' },
    );
    return result.data.map((message) => ({
      id: message.id,
      senderKey: message.senderKey,
      senderName: message.senderName,
      body: message.body,
      createdAt: message.createdAt ?? new Date().toISOString(),
    }));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetched = await fetchMessages();
      if (!cancelled) {
        setMessages(fetched);
        setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const messageInput = { threadId, senderKey: myKey, senderName: myName, body };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.GroupChatMessage.create(messageInput as any);
      if (result.errors?.length) {
        throw new Error(result.errors.map((e) => e.message).join(' / '));
      }
      setDraft('');
      setMessages(await fetchMessages());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'メッセージの送信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-window">
      <header className="chat-window__header">
        <span className="chat-window__title">{organizationName} グループチャット</span>
        <button type="button" className="chat-window__close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </header>

      <div className="chat-window__messages" ref={listRef}>
        {loading ? (
          <p className="chat-window__empty">読み込み中…</p>
        ) : messages.length === 0 ? (
          <p className="chat-window__empty">まだメッセージはありません</p>
        ) : (
          messages.map((message) => {
            const isMine = message.senderKey === myKey;
            return (
              <div
                key={message.id}
                className={`chat-window__bubble-row ${isMine ? 'chat-window__bubble-row--mine' : ''} chat-window__bubble-row--group`}
              >
                {!isMine && (
                  <span className="chat-window__sender-name">{message.senderName}</span>
                )}
                <div className="chat-window__bubble">
                  <p className="chat-window__bubble-body">{message.body}</p>
                  <span className="chat-window__bubble-time">
                    {new Date(message.createdAt).toLocaleString('ja-JP', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && <p className="chat-window__error">{error}</p>}

      <form
        className="chat-window__composer"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <textarea
          className="chat-window__input"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="メッセージを入力"
        />
        <button
          type="submit"
          className="chat-window__send"
          disabled={!draft.trim() || sending}
        >
          送信
        </button>
      </form>
    </div>
  );
}
