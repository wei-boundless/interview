import { useEffect, useRef, useState } from 'react';
import type { KbSlot, StoredSession } from '../../shared/protocol';
import { useT } from '../i18n';

export type TurnKind = 'segment' | 'continuous' | 'free' | 'translate' | 'vision';

export interface AnswerTurn {
  id: string;
  kind: TurnKind;
  label: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
  visionRootImageId?: string;
  visionRootImageIds?: string[];
  activeRequestId?: string;
}

/**
 * 智能体 conversation panel (R4) with a multi-session bar. Answers ACCUMULATE
 * as a scrolling session (never replaced); each meeting is its own session
 * with its own knowledge base. The 📷 screenshot button only appears in
 * multimodal mode (it needs a vision model).
 */
export function AnswerSession({
  sessions,
  currentId,
  turns,
  textOnly = false,
  selectedVisionTurnId,
  scrollCommand,
  resumeName,
  resumeChars,
  jdName,
  jdChars,
  notice,
  visionReady,
  answersReady,
  answersHint,
  inputValue,
  onInputValueChange,
  onSwitch,
  onNew,
  onDelete,
  onRename,
  onPickKb,
  onClearKb,
  onCancel,
  onClear,
  onFreeAsk,
  onShotAsk,
}: {
  sessions: StoredSession[];
  currentId: string;
  turns: AnswerTurn[];
  textOnly?: boolean;
  selectedVisionTurnId?: string;
  scrollCommand?: { direction: 'up' | 'down'; sequence: number };
  resumeName?: string;
  resumeChars: number;
  jdName?: string;
  jdChars: number;
  /** transient parse warning (e.g. scanned PDF with no text layer) */
  notice?: string | null;
  visionReady: boolean;
  /** false = no LLM configured; asking is disabled with an explanation */
  answersReady: boolean;
  answersHint: string;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onPickKb: (slot: KbSlot) => void;
  onClearKb: (slot: KbSlot) => void;
  onCancel: (cardId: string, requestId: string) => void;
  onClear: () => void;
  onFreeAsk: (question: string) => void;
  onShotAsk: (question: string, imageDataUrl?: string) => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const lastScrollTop = useRef(0);
  const suppressScrollDetection = useRef(false);
  const lastTurnId = useRef<string | undefined>(undefined);
  const lastSessionId = useRef(currentId);
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const [hasUnseenLatest, setHasUnseenLatest] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const currentName = sessions.find((s) => s.id === currentId)?.name ?? '';
  // Display selection must not filter the stored turns or change the follow-up target.
  const newestTurn = (textOnly && turns.find((turn) => turn.id === selectedVisionTurnId)) || turns[turns.length - 1];
  const hasStreamingTurn = textOnly ? newestTurn?.status === 'streaming' : turns.some((turn) => turn.status === 'streaming');

  const setFollowLatest = (value: boolean) => {
    followLatest.current = value;
    setShowJumpLatest(!value);
    if (value) setHasUnseenLatest(false);
  };

  const scrollToLatest = () => {
    const frame = requestAnimationFrame(() => {
      const el = boxRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  };

  // Session switches open at that session's latest answer. A new card only
  // takes the user to the bottom when they were already following the latest
  // content; otherwise keep their reading position and mark unseen content.
  useEffect(() => {
    const sessionChanged = lastSessionId.current !== currentId;
    lastSessionId.current = currentId;
    const isNewCard = newestTurn?.id !== lastTurnId.current;
    lastTurnId.current = newestTurn?.id;
    if (sessionChanged) {
      setFollowLatest(true);
      return scrollToLatest();
    }
    if (!isNewCard) return;
    if (followLatest.current) return scrollToLatest();
    setHasUnseenLatest(true);
  }, [currentId, newestTurn?.id]);

  // While an answer is streaming, follow each rendered delta unless the user
  // has explicitly scrolled upward. Content growth alone must never disable
  // following — that was the cause of the view getting stuck mid-answer.
  useEffect(() => {
    if (!hasStreamingTurn) return;
    if (!followLatest.current) {
      setHasUnseenLatest(true);
      return;
    }
    return scrollToLatest();
  }, [turns, hasStreamingTurn]);

  useEffect(() => {
    if (!selectedVisionTurnId || !boxRef.current) return;
    const selected = boxRef.current.querySelector<HTMLElement>(
      `[data-turn-id="${CSS.escape(selectedVisionTurnId)}"]`,
    );
    suppressScrollDetection.current = true;
    if (textOnly) boxRef.current.scrollTop = 0;
    else selected?.scrollIntoView({ block: 'nearest' });
    const frame = requestAnimationFrame(() => {
      if (boxRef.current) lastScrollTop.current = boxRef.current.scrollTop;
      suppressScrollDetection.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedVisionTurnId, textOnly]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !scrollCommand) return;
    if (scrollCommand.direction === 'up') setFollowLatest(false);
    const distance = Math.max(100, Math.round(el.clientHeight * 0.45));
    el.scrollBy({
      top: scrollCommand.direction === 'up' ? -distance : distance,
      behavior: 'auto',
    });
    const frame = requestAnimationFrame(() => {
      const current = boxRef.current;
      if (!current) return;
      lastScrollTop.current = current.scrollTop;
      if (current.scrollHeight - current.scrollTop - current.clientHeight < 48) {
        setFollowLatest(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollCommand]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    const currentTop = el.scrollTop;
    const atBottom = el.scrollHeight - currentTop - el.clientHeight < 48;
    if (!suppressScrollDetection.current) {
      if (atBottom) setFollowLatest(true);
      else if (currentTop < lastScrollTop.current - 1) setFollowLatest(false);
    }
    lastScrollTop.current = currentTop;
  };

  const submit = () => {
    const q = inputValue.trim();
    if (!q) return;
    onFreeAsk(q);
    onInputValueChange('');
  };

  return (
    <section className="pane pane-answer">
      <header className="pane-head session-bar">
        {editing ? (
          <input
            className="session-select"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              onRename(currentId, nameDraft);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename(currentId, nameDraft);
                setEditing(false);
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
          />
        ) : (
          <select
            className="session-select"
            value={currentId}
            onChange={(e) => onSwitch(e.target.value)}
            title={t.answer.switchTitle}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn btn-sm"
          onClick={() => {
            setNameDraft(currentName);
            setEditing(true);
          }}
          title={t.answer.renameTitle}
        >
          ✎
        </button>
        <button className="btn btn-sm" onClick={onNew} title={t.answer.newTitle}>
          ＋
        </button>
        <button className="btn btn-sm" onClick={() => onDelete(currentId)} title={t.answer.deleteTitle}>
          🗑
        </button>
        <button
          className={resumeChars > 0 ? 'btn btn-sm btn-on' : 'btn btn-sm'}
          onClick={() => onPickKb('resume')}
          title={
            resumeChars > 0
              ? t.answer.resumeSetTitle(resumeName ?? '', resumeChars)
              : t.answer.resumeEmptyTitle
          }
        >
          📄{resumeChars > 0 ? resumeName ?? t.answer.resume : t.answer.resume}
        </button>
        {resumeChars > 0 && (
          <button className="btn btn-sm" onClick={() => onClearKb('resume')} title={t.answer.resumeRemoveTitle}>
            ×
          </button>
        )}
        <button
          className={jdChars > 0 ? 'btn btn-sm btn-on' : 'btn btn-sm'}
          onClick={() => onPickKb('jd')}
          title={jdChars > 0 ? t.answer.jdSetTitle(jdName ?? '', jdChars) : t.answer.jdEmptyTitle}
        >
          📋{jdChars > 0 ? jdName ?? t.answer.jd : t.answer.jd}
        </button>
        {jdChars > 0 && (
          <button className="btn btn-sm" onClick={() => onClearKb('jd')} title={t.answer.jdRemoveTitle}>
            ×
          </button>
        )}
        <span className="session-spacer" />
        <button className="btn btn-sm" onClick={onClear} title={t.answer.clearTitle}>
          {t.answer.clear}
        </button>
      </header>
      {notice && <div className="kb-notice">{notice}</div>}
      <div className="session" ref={boxRef} onScroll={onScroll}>
        {turns.length === 0 ? (
          <div className="pane-empty">
            {t.answer.empty}
            {resumeChars === 0 && t.answer.emptyKbHint}
          </div>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              data-turn-id={turn.id}
              className={`turn turn-${turn.kind}${turn.id === selectedVisionTurnId ? ' turn-selected' : ''}${turn.id === newestTurn?.id ? ' turn-output-current' : ''}`}
            >
              <div className="turn-head">
                <span className="turn-tag">{t.answer.kindTag[turn.kind]}</span>
                <span className="turn-label" title={turn.label}>
                  {turn.label}
                </span>
                {turn.id === selectedVisionTurnId && (
                  <span className="turn-target">{t.answer.followupTarget}</span>
                )}
                {turn.status === 'streaming' ? (
                  <button
                    className="btn btn-sm"
                    onClick={() => onCancel(turn.id, turn.activeRequestId ?? turn.id)}
                  >
                    {t.answer.stop}
                  </button>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => void navigator.clipboard.writeText(turn.text)}
                    title={t.answer.copyTitle}
                  >
                    {t.answer.copy}
                  </button>
                )}
              </div>
              <div className="turn-body">
                {turn.status === 'error' ? (
                  <>
                    {turn.text && <>{turn.text}{'\n\n'}</>}
                    <span className="answer-error">{turn.error}</span>
                  </>
                ) : (
                  <>
                    {turn.text || (turn.kind === 'vision' ? t.answer.visionWaiting : t.answer.genWaiting)}
                    {turn.status === 'streaming' && <span className="cursor">▍</span>}
                  </>
                )}
              </div>
            </div>
          ))
        )}
        {showJumpLatest && (
          <button
            className="jump-bottom"
            onClick={() => {
              setFollowLatest(true);
              scrollToLatest();
            }}
          >
            {hasUnseenLatest ? t.answer.newAnswers : t.answer.jumpLatest}
          </button>
        )}
      </div>
      {!answersReady && <div className="kb-notice answer-service-notice">{answersHint}</div>}
      <div className="answer-input">
        <input
          value={inputValue}
          onChange={(e) => onInputValueChange(e.target.value)}
          disabled={!answersReady}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={answersReady ? t.answer.freePlaceholder : answersHint}
        />
        <button
          className="btn btn-primary"
          disabled={!answersReady}
          title={answersReady ? undefined : answersHint}
          onClick={submit}
        >
          {t.answer.ask}
        </button>
        {visionReady && (
          <button
            className="btn"
            title={t.answer.shotTitle}
            onClick={async () => {
              const q = inputValue.trim();
              const img = await window.mc.pickRegion();
              if (!img) return; // cancelled
              onShotAsk(q, img);
            }}
          >
            📷
          </button>
        )}
      </div>
    </section>
  );
}
