import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, Caption, FONT, FPS, Footnote, HomeIndicator, PhoneFrame, StatusBar, TopLabel, Wordmark, clamp, fade, pop, useInter } from "./shared";

/**
 * AgentCardVoice: 10 s, 16:9, silent. Says that the voice channel exists and what it is for.
 *
 * The phone shows the app's ask-me sheet for the CHF 299 PixelHarbor question (AU0040) with the
 * real VoiceStatus element under the heading: the "Read it to me" button, then the pill that says
 * "Connecting…", "Speaking" and "Listening" while a call runs. Layout and copy follow
 * app-web/src/features/shopping-card/screens/sheets.tsx and app-web/src/features/voice/voice-status.tsx.
 *
 * Beats (30 fps, 300 frames):
 *   0–100    "Now with voice."                       button tapped at 45, Connecting at 55, Speaking at 75
 *   100–200  what the card does and who it is for
 *   200–300  the voice never decides                Listening from 200, wordmark from 215
 */

const T = {
  tap: 45,
  connecting: 55,
  speaking: 75,
  listening: 200,
  brand: 215,
  cap1: 100,
  cap2: 200,
} as const;

const ASK = {
  shop: "PixelHarbor",
  item: "27-inch computer monitor",
  amount: "CHF 299.00",
  card: "Agent Card •• 7310",
  because: "The shop's text tried to give us orders. We ignored it. Everything else fits your rules.",
  secondsLeft: 107,
};

type VoiceState = "button" | "connecting" | "speaking" | "listening";

const voiceStateAt = (frame: number): VoiceState =>
  frame >= T.listening ? "listening" : frame >= T.speaking ? "speaking" : frame >= T.connecting ? "connecting" : "button";

const MicIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
  </svg>
);

const FaceIdGlyph: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    <path d="M8 9v1M16 9v1M12 9v4h-1M9 15.5s1 1.5 3 1.5 3-1.5 3-1.5" />
  </svg>
);

/** The app's countdown: 96 px ring, 4 px grey track, black progress, the time in the centre. */
const CountdownRing: React.FC<{ frame: number }> = ({ frame }) => {
  const left = ASK.secondsLeft - frame / FPS;
  const s = Math.max(0, Math.ceil(left));
  const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const r = 44;
  const c = 2 * Math.PI * r;
  const progress = left / 120;
  return (
    <div style={{ position: "relative", width: 96, height: 96 }}>
      <svg viewBox="0 0 96 96" width="96" height="96" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="48" cy="48" r={r} fill="none" strokeWidth="4" stroke={C.gray100} />
        <circle cx="48" cy="48" r={r} fill="none" strokeWidth="4" strokeLinecap="round" stroke={C.gray900} strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{label}</span>
    </div>
  );
};

/** VoiceStatus as in voice-status.tsx: one button, or the aria-live pill while a call runs. */
const VoiceStatus: React.FC<{ frame: number }> = ({ frame }) => {
  const state = voiceStateAt(frame);
  if (state === "button") {
    const press = interpolate(frame, [T.tap, T.tap + 5, T.tap + 10], [1, 0.95, 1], clamp);
    const dark = interpolate(frame, [T.tap, T.tap + 5, T.tap + 10], [0, 1, 0], clamp);
    return (
      <span
        style={{
          display: "inline-flex",
          height: 36,
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          color: C.black,
          background: `rgba(0,0,0,${0.06 * dark})`,
          transform: `scale(${press})`,
        }}
      >
        <MicIcon color={C.gray500} />
        Read it to me
      </span>
    );
  }
  const label = state === "connecting" ? "Connecting…" : state === "speaking" ? "Speaking" : "Listening";
  const pulse = state === "speaking" ? 0.55 + 0.45 * Math.abs(Math.sin(frame / 9)) : 1;
  const dotColor = state === "connecting" ? C.gray200 : C.gray900;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px 6px 12px",
        borderRadius: 999,
        background: C.gray50,
        fontSize: 14,
        fontWeight: 500,
        color: C.black,
        opacity: fade(frame, T.connecting, 8),
        transform: `scale(${pop(frame, T.connecting, 12)})`,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 4, background: dotColor, opacity: pulse }} />
      {label}
    </span>
  );
};

const DetailLine: React.FC<{ label: string; value: string; last?: boolean }> = ({ label, value, last }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 44, padding: "0 16px", borderBottom: last ? "none" : `1px solid ${C.gray100}` }}>
    <span style={{ fontSize: 16, color: C.gray500 }}>{label}</span>
    <span style={{ fontSize: 16, fontWeight: 500, color: C.black, fontVariantNumeric: "tabular-nums" }}>{value}</span>
  </div>
);

/** The ask-me sheet over a dimmed screen. */
const AskSheet: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    {/* the screen underneath, dimmed */}
    <div style={{ position: "absolute", inset: 0, background: C.gray50 }}>
      <div style={{ position: "absolute", top: 110, left: 16, fontSize: 28, fontWeight: 700 }}>Agent Card</div>
    </div>
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
    <StatusBar />

    {/* the sheet */}
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        background: C.white,
        borderRadius: "28px 28px 50px 50px",
        padding: "10px 16px 44px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ width: 36, height: 5, borderRadius: 3, background: C.gray200, alignSelf: "center" }} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 4 }}>
        <CountdownRing frame={frame} />
        <span style={{ fontSize: 20, fontWeight: 600 }}>Your agent wants to pay</span>
        <VoiceStatus frame={frame} />
      </div>

      <div style={{ borderRadius: 16, background: C.gray50, overflow: "hidden" }}>
        <DetailLine label="Shop" value={ASK.shop} />
        <DetailLine label="Item" value={ASK.item} />
        <DetailLine label="Amount" value={ASK.amount} />
        <DetailLine label="Card" value={ASK.card} last />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", borderRadius: 16, background: C.gray50, padding: "14px 16px" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.black} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 2, flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Why we ask</span>
          <span style={{ fontSize: 16, lineHeight: "24px", color: C.gray500 }}>{ASK.because}</span>
        </div>
      </div>

      <span style={{ alignSelf: "center", fontSize: 14, fontWeight: 600, padding: "8px 14px" }}>See checks</span>

      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ flex: 1, height: 48, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, border: `1px solid ${C.gray200}`, fontSize: 16, fontWeight: 600 }}>Decline</span>
        <span style={{ flex: 1, height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, background: C.gray900, color: C.white, fontSize: 16, fontWeight: 600 }}>
          <FaceIdGlyph />
          Approve
        </span>
      </div>
    </div>
    <HomeIndicator />
  </>
);

export const AgentCardVoice: React.FC = () => {
  useInter();
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: C.gray900, fontFamily: FONT }}>
      <PhoneFrame frame={frame}>
        <AskSheet frame={frame} />
      </PhoneFrame>

      <TopLabel frame={frame} text="The Agent Card · Voice" />

      <div style={{ position: "absolute", left: 760, top: 300, width: 1000, height: 400 }}>
        <Caption frame={frame} from={4} to={T.cap1} text="Now with voice." sub="ElevenLabs, built in as an accessibility layer." />
        <Caption
          frame={frame}
          from={T.cap1}
          to={T.cap2}
          text="The card reads its question aloud and takes your yes or no."
          sub="For anyone who cannot look at or tap the screen right now."
        />
        <Caption frame={frame} from={T.cap2} to={301} text="The voice never decides." sub="Your answer goes to the same endpoint a tap uses. Approve still needs Face ID." />
      </div>

      <Wordmark frame={frame} from={T.brand} big={false} top={720} />

      <Footnote frame={frame} text="ElevenLabs Agents Platform. What the voice reads is composed by the app from the engine's decision." />
    </AbsoluteFill>
  );
};

export const AGENT_CARD_VOICE = { id: "AgentCardVoice", fps: FPS, durationInFrames: 300, width: 1920, height: 1080 } as const;
