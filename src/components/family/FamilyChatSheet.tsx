import { useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_OPEN_POLL_MS } from '../../lib/keySyncPace.mjs';
import { looksLikePhone } from '../../lib/localProfile.mjs';
import {
  chatName,
  createChatId,
  markDirectChatRead,
  mergeDirectChat,
  readDirectChat,
  subscribeChat,
  type FamilyChatMessage,
} from '../../services/familyChat';
import { familySyncConfigured, fetchDirectChat, publishChatRemote, syncTokenFor } from '../../services/familySync';
import { X } from 'lucide-react';

export interface DirectChatTarget {
  code: string;
  me: string;
  peer: string;
  label: string;
  token?: string | null;
  writeKey?: string;
  readKey?: string;
}

async function targetToken(target: DirectChatTarget): Promise<string | null> {
  if (target.token && target.token.includes('.')) return target.token;
  if (target.writeKey && target.readKey) return syncTokenFor(target.writeKey, target.readKey);
  return null;
}

export function FamilyChatSheet({
  target,
  onClose,
}: {
  target: DirectChatTarget;
  onClose: () => void;
}) {
  const me = chatName(target.me) || '나';
  const peer = chatName(target.peer);
  const [messages, setMessages] = useState<FamilyChatMessage[]>(() => readDirectChat(target.code, me, peer));
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

  useEffect(() => subscribeChat(() => {
    const current = targetRef.current;
    setMessages(readDirectChat(current.code, chatName(current.me) || '나', chatName(current.peer)));
  }), [target.code, me, peer]);

  const targetKey = `${target.code}|${me}|${peer}|${target.token ?? ''}|${target.writeKey ?? ''}|${target.readKey ?? ''}`;
  useEffect(() => {
    const current = targetRef.current;
    const mine = chatName(current.me) || '나';
    const other = chatName(current.peer);
    setMessages(readDirectChat(current.code, mine, other));
    markDirectChatRead(current.code, mine, other);
    let cancel = false;
    const pull = async () => {
      const open = targetRef.current;
      const openMe = chatName(open.me) || '나';
      const openPeer = chatName(open.peer);
      const token = await targetToken(open);
      if (!token || cancel) {
        if (!familySyncConfigured() || !token) setNote('초대가 연결되면 이 대화만 다른 폰으로 갑니다. 지금은 이 기기에만 남습니다.');
        return;
      }
      const remote = await fetchDirectChat(open.code, token, openMe, openPeer);
      if (cancel || !remote) return;
      mergeDirectChat(open.code, openMe, openPeer, remote);
      markDirectChatRead(open.code, openMe, openPeer);
    };
    void pull();
    const timer = window.setInterval(() => void pull(), CHAT_OPEN_POLL_MS);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [targetKey]);

  const ordered = useMemo(() => messages.slice().sort((left, right) => left.at - right.at), [messages]);

  const send = async () => {
    if (sending || !peer) return;
    const text = draft.trim().slice(0, 200);
    if (!text) return;
    if (looksLikePhone(text) || looksLikePhone(me) || looksLikePhone(peer)) {
      setNote('전화번호는 보내지 않습니다.');
      return;
    }
    const message: FamilyChatMessage = {
      id: createChatId(),
      from: me,
      to: peer,
      text,
      at: Date.now(),
      mine: true,
    };
    setSending(true);
    setDraft('');
    mergeDirectChat(target.code, me, peer, [message]);
    markDirectChatRead(target.code, me, peer);
    const token = await targetToken(target);
    const result = await publishChatRemote(target.code, token, message);
    setNote(result === 'ok' ? null : '가족 서버에 닿지 않아 이 기기에만 남았습니다.');
    setSending(false);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-slate-900/40">
      <div className="flex max-h-[86%] w-full flex-col rounded-t-3xl bg-white px-5 pb-6 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black">{target.label}님과 개인 대화</h2>
            <p className="text-[11px] font-semibold text-slate-400">이 두 사람만 봅니다</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-48 flex-1 space-y-2 overflow-y-auto pb-3">
          {ordered.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-500">{target.label}님에게만 보이는 글입니다. 다른 가족에게는 전달되지 않습니다.</p>
          ) : ordered.map((message) => (
            <div key={message.id} className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${message.mine ? 'bg-[#0084FF] text-white' : 'bg-slate-100 text-slate-800'}`}>
                <p className="text-sm leading-5">{message.text}</p>
              </div>
            </div>
          ))}
        </div>
        {note && <p className="mb-2 text-[11px] font-semibold leading-4 text-amber-700">{note}</p>}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={200}
            placeholder="메시지"
            aria-label="메시지"
            className="min-w-0 flex-1 rounded-full bg-slate-100 px-4 py-3 text-sm"
          />
          <button type="submit" disabled={sending || !draft.trim()} className="rounded-full bg-[#0084FF] px-4 py-3 text-sm font-black text-white disabled:opacity-40">
            보내기
          </button>
        </form>
      </div>
    </div>
  );
}
