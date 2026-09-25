// Voice approval with an ElevenLabs agent. An accessibility layer over the ask-me sheet: the question is read
// aloud, a clear spoken yes or no becomes the same RESOLVE_ASK a tap dispatches. Needs VITE_ELEVENLABS_AGENT_ID;
// without it the app behaves as before and the voice controls say so.
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import { usePrototype } from "@/features/shopping-card/prototype-state";
import type { VoiceContext, VoiceToolName } from "@/features/voice/voice-tools";
import { VOICE_TOOLS, buildVoiceTools, openingFor } from "@/features/voice/voice-tools";

export type VoiceState = "unconfigured" | "off" | "connecting" | "listening" | "speaking" | "error";

interface VoiceValue {
    /** The cardholder switched voice on (asks start a call by themselves). */
    enabled: boolean;
    setEnabled: (on: boolean) => void;
    state: VoiceState;
    /** Error text from the SDK, when state is "error". */
    message: string | undefined;
    /** Start a call now (setup by voice, or re-read the question). */
    start: () => void;
    stop: () => void;
    /** Whether the Agent Card exists yet; picks the label of the manual call button. */
    cardCreated: boolean;
}

const VoiceCtx = createContext<VoiceValue | null>(null);

export const useVoice = () => {
    const ctx = useContext(VoiceCtx);
    if (!ctx) throw new Error("useVoice must be used inside <VoiceProvider>");
    return ctx;
};

const agentId = (import.meta.env.VITE_ELEVENLABS_AGENT_ID as string | undefined)?.trim() || undefined;

/** How long the agent gets to say its closing line before the call ends by itself. */
const HANG_UP_AFTER_MS = 8000;

/** Registers one client tool; the handler always sees the latest context through the ref. */
const RegisterTool = ({ name, ctxRef }: { name: VoiceToolName; ctxRef: React.RefObject<VoiceContext> }) => {
    const tools = useMemo(() => buildVoiceTools(() => ctxRef.current), [ctxRef]);
    useConversationClientTool(name, tools[name]);
    return null;
};

const VoiceBridge = ({ children }: { children: ReactNode }) => {
    const { state, dispatch, secondsLeft } = usePrototype();
    const { startSession, endSession, status, isSpeaking, message } = useConversation();
    const [enabled, setEnabled] = useState(false);
    const [failed, setFailed] = useState(false);

    const ctxRef = useRef<VoiceContext>({ state, dispatch, secondsLeft, endCall: () => undefined });
    ctxRef.current = { state, dispatch, secondsLeft, endCall: () => window.setTimeout(() => endSession(), 1500) };

    const start = useCallback(() => {
        if (!agentId || status !== "disconnected") return;
        setFailed(false);
        const { state: s, secondsLeft: left } = ctxRef.current;
        startSession({ agentId, dynamicVariables: { opening: openingFor(s, left) } });
    }, [startSession, status]);

    const stop = useCallback(() => endSession(), [endSession]);

    // An ask arrives while voice is on: call once per question.
    const startedFor = useRef<string | null>(null);
    const waitingId = state.waiting?.decisionId ?? null;
    useEffect(() => {
        if (!enabled || !waitingId || startedFor.current === waitingId) return;
        startedFor.current = waitingId;
        start();
    }, [enabled, waitingId, start]);

    // The question is gone (answered, timed out, cancelled): let the agent finish its sentence, then hang up.
    useEffect(() => {
        if (waitingId || status === "disconnected" || !startedFor.current) return;
        const t = window.setTimeout(() => endSession(), HANG_UP_AFTER_MS);
        return () => window.clearTimeout(t);
    }, [waitingId, status, endSession]);

    useEffect(() => {
        if (status === "error") setFailed(true);
    }, [status]);

    const voiceState: VoiceState = !agentId
        ? "unconfigured"
        : failed && status !== "connected"
          ? "error"
          : status === "connecting"
            ? "connecting"
            : status === "connected"
              ? isSpeaking
                  ? "speaking"
                  : "listening"
              : "off";

    const cardCreated = state.cardCreated;
    const value = useMemo<VoiceValue>(
        () => ({ enabled, setEnabled, state: voiceState, message, start, stop, cardCreated }),
        [enabled, voiceState, message, start, stop, cardCreated],
    );

    return (
        <VoiceCtx.Provider value={value}>
            {Object.values(VOICE_TOOLS).map((name) => (
                <RegisterTool key={name} name={name} ctxRef={ctxRef} />
            ))}
            {children}
        </VoiceCtx.Provider>
    );
};

/** Mount inside <PrototypeProvider>. */
export const VoiceProvider = ({ children }: { children: ReactNode }) => (
    <ConversationProvider onError={(err) => console.error("voice", err)}>
        <VoiceBridge>{children}</VoiceBridge>
    </ConversationProvider>
);
