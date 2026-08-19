import { useEffect, useRef, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import { formatApiError } from '../utils/apiErrors';
import './ChatWindow.css';

interface ChatMessageItem {
  id: string;
  senderKey: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface ChatWindowProps {
  threadId: string;
  owners: string[];
  myKey: string;
  myName: string;
  counterpartName: string;
  onClose: () => void;
}

// メッセージはWebSocket購読ではなく簡易ポーリングで反映する(このアプリの他機能と同様の方式)
const POLL_INTERVAL_MS = 4000;

export function ChatWindow({ threadId, owners, myKey, myName, counterpartName, onClose }: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    hasScrolledRef.current = false;
  }, [threadId]);

  useEffect(() => {
    if (!loading && messages.length > 0 && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    }
  }, [loading, messages]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [draft]);

  async function fetchMessages(): Promise<ChatMessageItem[]> {
    const result = await dataClient.models.ChatMessage.listMessagesByThread(
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
    // threadIdはprops経由で決まっており、開いている間に変わることは想定していない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (listRef.current) {
          listRef.current.scrollTo({
            top: listRef.current.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
          });
        }
      }, 50);
    });
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const messageInput = { threadId, senderKey: myKey, senderName: myName, body, owners };
      // Organization/Dog登録と同様、data-schemaの型推論バグを回避するためas anyを使用
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.ChatMessage.create(messageInput as any);
      if (result.errors?.length) {
        throw new Error(formatApiError(result.errors));
      }
      setDraft('');
      const updatedMessages = await fetchMessages();
      setMessages(updatedMessages);
      scrollToBottom(true);
    } catch (err) {
      setError(formatApiError(err, 'メッセージの送信に失敗しました。時間をおいて再度お試しください。'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-window">
      <header className="chat-window__header">
        <span className="chat-window__title">{counterpartName}</span>
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
          messages.map((message) => (
            <div
              key={message.id}
              className={`chat-window__bubble-row ${message.senderKey === myKey ? 'chat-window__bubble-row--mine' : ''}`}
            >
              <div className="chat-window__bubble-wrapper">
                <div className="chat-window__bubble">
                  <p className="chat-window__bubble-body">{message.body}</p>
                </div>
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
          ))
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
          ref={textareaRef}
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
        <button type="submit" className="chat-window__send" disabled={sending || !draft.trim()}>
          送信
        </button>
      </form>
    </div>
  );
}
