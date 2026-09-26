import { useEffect, useRef, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import { formatApiError } from '../utils/apiErrors';
import './ChatWindow.css';

interface GroupChatMessageItem {
  id: string;
  senderKey: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface GroupChatWindowProps {
  threadId: string;
  organizationId?: string;
  myKey: string;
  myName: string;
  organizationName: string;
  canModerate?: boolean;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 4000;

export function GroupChatWindow({
  threadId,
  organizationId,
  myKey,
  myName,
  organizationName,
  canModerate = false,
  onClose,
}: GroupChatWindowProps) {
  const [messages, setMessages] = useState<GroupChatMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<GroupChatMessageItem | null>(null);
  const [isModeratorUser, setIsModeratorUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // ログインユーザーが保護団体アカウント自身、または該当団体のモデレータであるかを判定
  useEffect(() => {
    let cancelled = false;
    async function checkModerator() {
      if (organizationId && myKey === `organization#${organizationId}`) {
        if (!cancelled) setIsModeratorUser(true);
        return;
      }
      if (organizationId && myKey.startsWith('volunteer#')) {
        const volId = myKey.replace('volunteer#', '');
        try {
          const affRes = await dataClient.models.Affiliation.list({
            filter: {
              organizationId: { eq: organizationId },
              volunteerId: { eq: volId },
            },
            authMode: 'userPool',
          });
          const aff = affRes.data.find((a) => a.status === 'APPROVED');
          if (aff?.isModerator && !cancelled) {
            setIsModeratorUser(true);
          }
        } catch {
          // ignore
        }
      }
    }
    checkModerator();
    return () => {
      cancelled = true;
    };
  }, [myKey, organizationId]);

  const hasDeleteAuthority = canModerate || isModeratorUser;

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

  async function fetchMessages(): Promise<GroupChatMessageItem[]> {
    // 検索対象となる threadId の候補(threadId および organizationId があれば両方)
    const targetThreadIds = Array.from(new Set([threadId, organizationId].filter((id): id is string => !!id)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawItems: any[] = [];

    for (const tid of targetThreadIds) {
      // 1. GSI インデックスによるソート取得
      try {
        const result = await dataClient.models.GroupChatMessage.listGroupMessagesByThread(
          { threadId: tid },
          { sortDirection: 'ASC', authMode: 'userPool' },
        );
        if (result.data && result.data.length > 0) {
          rawItems.push(...result.data);
        }
      } catch (gsiErr) {
        console.warn(`listGroupMessagesByThread failed for ${tid}:`, gsiErr);
      }

      // 2. 標準 list (filter) によるフォールバック取得
      try {
        const listResult = await dataClient.models.GroupChatMessage.list({
          filter: { threadId: { eq: tid } },
          limit: 1000,
          authMode: 'userPool',
        });
        if (listResult.data && listResult.data.length > 0) {
          rawItems.push(...listResult.data);
        }
      } catch (listErr) {
        console.warn(`GroupChatMessage.list fallback failed for ${tid}:`, listErr);
      }
    }

    // 重複を id で排除
    const map = new Map<string, GroupChatMessageItem>();
    for (const message of rawItems) {
      if (!map.has(message.id)) {
        map.set(message.id, {
          id: message.id,
          senderKey: message.senderKey,
          senderName: message.senderName,
          body: message.body,
          createdAt: message.createdAt ?? new Date().toISOString(),
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetched = await fetchMessages();
      if (!cancelled) {
        setMessages((prev) => {
          // 取得結果が空で、ローカルに既にメッセージがある場合は消さない
          if (fetched.length === 0 && prev.length > 0) {
            return prev;
          }
          const map = new Map<string, GroupChatMessageItem>();
          for (const m of prev) map.set(m.id, m);
          for (const m of fetched) map.set(m.id, m);
          return Array.from(map.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        });
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
  }, [threadId, organizationId]);

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
      const now = new Date().toISOString();
      const messageInput = {
        threadId,
        senderKey: myKey,
        senderName: myName,
        body,
        createdAt: now,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await dataClient.models.GroupChatMessage.create(messageInput as any, {
        authMode: 'userPool',
      });
      if (result.errors?.length || !result.data) {
        throw new Error(formatApiError(result.errors, 'データベースへのメッセージ保存に失敗しました。'));
      }
      setDraft('');

      const sentItem: GroupChatMessageItem = {
        id: result.data.id,
        senderKey: result.data.senderKey,
        senderName: result.data.senderName,
        body: result.data.body,
        createdAt: result.data.createdAt ?? now,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === sentItem.id)) return prev;
        return [...prev, sentItem];
      });
      scrollToBottom(true);

      const updatedMessages = await fetchMessages();
      setMessages((prev) => {
        const map = new Map<string, GroupChatMessageItem>();
        for (const m of prev) map.set(m.id, m);
        for (const m of updatedMessages) map.set(m.id, m);
        return Array.from(map.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
      scrollToBottom(true);
    } catch (err) {
      setError(formatApiError(err, 'メッセージの送信に失敗しました。時間をおいて再度お試しください。'));
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmDelete(target: GroupChatMessageItem) {
    setDeleting(true);
    setError(null);
    try {
      const result = await dataClient.models.GroupChatMessage.delete(
        { id: target.id },
        { authMode: 'userPool' },
      );
      if (result.errors?.length) {
        throw new Error(formatApiError(result.errors, 'メッセージの削除に失敗しました。'));
      }
      setMessages((prev) => prev.filter((m) => m.id !== target.id));
      setMessageToDelete(null);
    } catch (err) {
      setError(formatApiError(err, 'メッセージの削除に失敗しました。'));
    } finally {
      setDeleting(false);
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
            const canDelete = isMine || hasDeleteAuthority;
            return (
              <div
                key={message.id}
                className={`chat-window__bubble-row ${isMine ? 'chat-window__bubble-row--mine' : ''} chat-window__bubble-row--group`}
              >
                {!isMine && (
                  <span className="chat-window__sender-name">{message.senderName}</span>
                )}
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
                  {canDelete && (
                    <button
                      type="button"
                      className="chat-window__delete-btn"
                      onClick={() => setMessageToDelete(message)}
                      aria-label="メッセージを削除"
                      title={isMine ? 'メッセージを削除' : '管理者/モデレータとして削除'}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && <p className="chat-window__error">{error}</p>}

      {messageToDelete && (
        <div className="chat-window__confirm-overlay" onClick={() => !deleting && setMessageToDelete(null)}>
          <div className="chat-window__confirm-modal" onClick={(e) => e.stopPropagation()}>
            <p className="chat-window__confirm-title">メッセージの削除</p>
            <p className="chat-window__confirm-text">
              このメッセージを削除しますか？<br />
              削除したメッセージは元に戻せません。
            </p>
            <div className="chat-window__confirm-actions">
              <button
                type="button"
                className="chat-window__confirm-cancel"
                disabled={deleting}
                onClick={() => setMessageToDelete(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="chat-window__confirm-delete"
                disabled={deleting}
                onClick={() => handleConfirmDelete(messageToDelete)}
              >
                {deleting ? '削除中…' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

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
