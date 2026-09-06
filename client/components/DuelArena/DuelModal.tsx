import { ReactNode, useEffect, useRef } from "react";

/** Keep keyboard focus and world clicks within a negotiation or wallet window. */
export function DuelModal({ title, children, onClose, wide = false }: {
    title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
    const panel = useRef<HTMLElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        panel.current?.focus();
        return () => previous?.focus?.();
    }, []);
    return <div className="duel-modal-backdrop" onPointerDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
        <section className={`duel-panel duel-modal ${wide ? "duel-modal-wide" : ""}`} ref={panel} tabIndex={-1}
            role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => {
                if (e.key === "Escape") { e.preventDefault(); onClose(); }
                if (e.key !== "Tab") return;
                const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
                if (!items?.length) { e.preventDefault(); return; }
                const first = items[0], last = items[items.length - 1];
                if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
                if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }}>
            <div className="duel-modal-heading"><span className="duel-eyebrow">DUEL ARENA</span>
                <button className="duel-close" aria-label={`Close ${title}`} onClick={onClose}>×</button></div>
            <h2>{title}</h2>{children}
        </section>
    </div>;
}
