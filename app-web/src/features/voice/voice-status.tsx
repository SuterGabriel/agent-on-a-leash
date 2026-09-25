// Visible voice state. The pill is aria-live so screen-reader users hear "Listening" and "Speaking" change.
import { Microphone01, MicrophoneOff01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import type { VoiceState } from "@/features/voice/voice-provider";
import { useVoice } from "@/features/voice/voice-provider";
import { cx } from "@/utils/cx";

const label: Record<VoiceState, string> = {
    unconfigured: "Voice not set up",
    off: "Voice off",
    connecting: "Connecting…",
    listening: "Listening",
    speaking: "Speaking",
    error: "Voice unavailable",
};

const Dot = ({ state }: { state: VoiceState }) => (
    <span
        aria-hidden
        className={cx(
            "size-2 shrink-0 rounded-full",
            state === "listening" || state === "speaking" ? "bg-utility-brand-500" : state === "connecting" ? "bg-fg-quaternary" : "bg-quaternary",
            state === "speaking" && "motion-safe:animate-pulse",
        )}
    />
);

/** On the ask-me sheet: the state while a call runs, or one button to have the question read aloud. */
export const VoiceStatus = () => {
    const voice = useVoice();
    if (voice.state === "unconfigured") return null;
    const live = voice.state === "connecting" || voice.state === "listening" || voice.state === "speaking";
    return (
        <div className="flex items-center justify-center gap-2">
            {live ? (
                <span
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-full bg-secondary py-1.5 pr-3.5 pl-3 text-sm font-medium text-primary"
                >
                    <Dot state={voice.state} />
                    {label[voice.state]}
                </span>
            ) : (
                <Button
                    size="sm"
                    color="tertiary"
                    iconLeading={Microphone01}
                    onClick={() => {
                        voice.setEnabled(true);
                        voice.start();
                    }}
                >
                    {voice.state === "error" ? "Voice unavailable, try again" : "Read it to me"}
                </Button>
            )}
        </div>
    );
};

/** In the demo controls: switch voice on for every ask, and show what the call is doing. */
export const VoiceToggle = () => {
    const voice = useVoice();
    if (voice.state === "unconfigured") {
        return <p className="text-sm text-tertiary">Voice: set VITE_ELEVENLABS_AGENT_ID in app-web/.env.local (npm run voice:agent prints it).</p>;
    }
    const live = voice.state === "connecting" || voice.state === "listening" || voice.state === "speaking";
    return (
        <div className="flex flex-col gap-2">
            <span className="text-md font-semibold text-primary">Voice (ElevenLabs)</span>
            <div className="flex flex-col gap-2 *:w-full">
                <Button
                    size="md"
                    color={voice.enabled ? "primary" : "secondary"}
                    iconLeading={voice.enabled ? Microphone01 : MicrophoneOff01}
                    aria-pressed={voice.enabled}
                    onClick={() => {
                        if (voice.enabled) voice.stop();
                        voice.setEnabled(!voice.enabled);
                    }}
                >
                    {voice.enabled ? "Asks are read aloud" : "Read asks aloud"}
                </Button>
                <Button size="md" color="secondary" onClick={live ? voice.stop : voice.start}>
                    {live ? "Hang up" : voice.cardCreated ? "Call now" : "Set up by voice"}
                </Button>
            </div>
            <p role="status" aria-live="polite" className="flex items-center gap-2 px-1 text-sm text-secondary">
                <Dot state={voice.state} />
                {label[voice.state]}
                {voice.state === "error" && voice.message ? ` · ${voice.message}` : ""}
            </p>
        </div>
    );
};
