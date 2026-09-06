import { FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { sanitizeChatText } from "../../common/chat/chatFormatting";
import { DuelChatChannel, duelChatStore, subscribeDuelChatEvents } from "../../game/duel/DuelChatChannels";
import { executeDuelChatCommand } from "../../game/duel/DuelChatCommands";
import { sendChat } from "../../network/ServerConnection";
import { useChatSprites } from "./useChatSprites";
import "./DuelPublicChat.css";

const TABS = ["All", "Game", "Public", "Private", "Clan", "Trade", "Duel"] as const;
export function DuelPublicChat({ playerName, scope }: { playerName: string; scope: "lobby" | "arena" }) {
    const all = useSyncExternalStore(duelChatStore.subscribe, duelChatStore.getSnapshot);
    const [channel, setChannel] = useState<DuelChatChannel>("all");
    const messages = useMemo(() => all.filter(message => channel === "all" || message.channel === channel), [all, channel]);
    const [draft, setDraft] = useState("");
    const [collapsed, setCollapsed] = useState(scope === "arena");
    const [notice, setNotice] = useState("");
    const [unread, setUnread] = useState(0);
    const log = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null), following = useRef(true);
    const lastSeenId = useRef(all.at(-1)?.id ?? 0);
    const sprites = useChatSprites();
    useEffect(subscribeDuelChatEvents, []);
    useEffect(() => { setCollapsed(scope === "arena"); }, [scope]);
    useEffect(() => {
        const startTyping = (event: KeyboardEvent) => {
            if (event.key !== "Enter" || event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, [contenteditable='true'], [role='menu']")) return;
            if (document.querySelector(".duel-modal-backdrop, .duel-player-menu")) return;
            event.preventDefault(); event.stopPropagation();
            previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setCollapsed(false);
            if (input.current) input.current.focus();
            else requestAnimationFrame(() => input.current?.focus());
        };
        document.addEventListener("keydown", startTyping, true);
        return () => document.removeEventListener("keydown", startTyping, true);
    }, []);
    useEffect(() => {
        const latest = all.at(-1)?.id ?? 0;
        if (!latest) { lastSeenId.current = 0; setUnread(0); return; }
        if (latest === lastSeenId.current) return;
        const count = all.filter(message => message.id > lastSeenId.current).length;
        lastSeenId.current = latest;
        if (collapsed || !following.current) setUnread(value => value + count);
        else if (log.current) log.current.scrollTop = log.current.scrollHeight;
    }, [all, collapsed]);
    useEffect(() => {
        if (collapsed || !log.current) return;
        log.current.scrollTop = log.current.scrollHeight; following.current = true; setUnread(0);
    }, [collapsed, channel]);
    function submit(event: FormEvent) {
        event.preventDefault();
        const text = sanitizeChatText(draft).slice(0, 200);
        if (!text) return;
        if (!executeDuelChatCommand(text)) {
            if (text.startsWith("::")) { setNotice("Unknown command. Try ::shop, or use the duel controls."); return; }
            sendChat(text, "public");
        }
        setDraft(""); setNotice(""); setUnread(0); following.current = true;
        if (log.current) log.current.scrollTop = log.current.scrollHeight;
    }
    function choose(label: typeof TABS[number]) {
        if (label === "Private" || label === "Clan") return;
        const next = label.toLowerCase() as DuelChatChannel;
        setCollapsed(next === channel && !collapsed); setChannel(next);
    }
    return <section style={sprites} className={`duel-public-chat ${scope === "arena" ? "duel-public-chat-arena" : ""} ${collapsed ? "duel-public-chat-collapsed" : ""}`}
        aria-label="Public chat" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
        {!collapsed && <div className="duel-chat-paper">
            <div id="duel-public-log" ref={log} className="duel-chat-log" role="log" aria-label="Public messages" aria-live="polite"
                aria-relevant="additions" tabIndex={0} onScroll={() => {
                    if (!log.current) return;
                    following.current = log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 20;
                    if (following.current) setUnread(0);
                }}><div className="duel-chat-lines">
                {messages.map(message => <p key={message.id} className={`duel-chat-line duel-chat-${message.channel}`}>
                    {message.sender && <strong>{message.sender}: </strong>}<span>{message.text}</span></p>)}
            </div></div>
            <button type="button" className="duel-chat-collapse" aria-label="Collapse public chat" onClick={() => setCollapsed(true)}>−</button>
            {unread > 0 && <button className="duel-chat-new" type="button" onClick={() => {
                if (log.current) log.current.scrollTop = log.current.scrollHeight;
                following.current = true; setUnread(0);
            }}>{unread} new ↓</button>}
            <form className="duel-chat-input" onSubmit={submit}><label htmlFor="duel-public-input">{playerName}:</label>
                <input id="duel-public-input" ref={input} aria-label="Public chat message" type="text" autoComplete="off" maxLength={200}
                    placeholder="Click here to chat..." title={scope === "arena" ? "Your duel — messages go to your opponent" : "Public — everyone in the courtyard"}
                    value={draft} onChange={event => { setDraft(event.target.value); setNotice(""); }}
                    onFocus={event => { if (event.relatedTarget instanceof HTMLElement) previousFocus.current = event.relatedTarget; }}
                    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); input.current?.blur(); previousFocus.current?.focus(); } }} />
                <button type="submit" aria-label="Send public message" disabled={!draft.trim()}>↵</button></form>
            {notice && <p className="duel-chat-notice" role="status">{notice}</p>}
        </div>}
        <nav className="duel-chat-tabs" aria-label="Chat channels">{TABS.map(label => {
            const disabled = label === "Private" || label === "Clan";
            const active = channel === label.toLowerCase() && !collapsed;
            return <button key={label} type="button" disabled={disabled} aria-pressed={active} title={disabled ? `${label} chat is not available` : `Show ${label.toLowerCase()} messages; click again to collapse`}
                onClick={() => choose(label)}><span>{label}</span>{label !== "All" && <small>{disabled ? "Off" : label === "Game" ? "All" : "On"}</small>}
                {label === "All" && unread > 0 && <small>{unread}</small>}</button>;
        })}<button className="duel-chat-report" type="button" disabled title="Abuse reporting is not available">Report Abuse</button></nav>
        {collapsed && <button type="button" className="duel-chat-expand" aria-label="Expand public chat" onClick={() => setCollapsed(false)}>+</button>}
        <span className="duel-chat-audience" aria-live="polite">{scope === "arena" ? "Your duel" : "Everyone in the courtyard"}</span>
    </section>;
}
