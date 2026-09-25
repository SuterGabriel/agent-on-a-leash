import React, { useEffect, useState } from "react";
import { Easing, continueRender, delayRender, interpolate } from "remotion";

/** Parts both videos use: colours, font, animation helpers, the phone frame, the caption on the right. */

export const FPS = 30;

// iOS greys from app-web/src/styles/figma-tokens.css. The app is monochrome: no green, red or yellow.
export const C = {
  black: "#000000",
  gray900: "#1c1c1e",
  gray500: "#6e6e73",
  gray400: "#8e8e93",
  gray200: "#c7c7cc",
  gray100: "#e5e5ea",
  gray50: "#f2f2f7",
  white: "#ffffff",
} as const;

export const FONT = "'Inter', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export const GITHUB = "github.com/SuterGabriel/agent-on-a-leash";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeOut = Easing.out(Easing.cubic);

export const fade = (frame: number, from: number, len = 12) =>
  interpolate(frame, [from, from + len], [0, 1], { ...clamp, easing: easeOut });
export const rise = (frame: number, from: number, len = 14, px = 10) =>
  interpolate(frame, [from, from + len], [px, 0], { ...clamp, easing: easeOut });
export const pop = (frame: number, from: number, len = 14) =>
  interpolate(frame, [from, from + len * 0.6, from + len], [0.6, 1.08, 1], { ...clamp, easing: easeOut });

/** Inter from Google Fonts; the render waits until the four weights are in. Needs internet. */
export const useInter = () => {
  const [handle] = useState(() => delayRender("Loading Inter"));
  useEffect(() => {
    const finish = () => continueRender(handle);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    link.onload = () => {
      Promise.all(["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 16px Inter`)))
        .then(finish)
        .catch(finish);
    };
    link.onerror = finish;
    document.head.appendChild(link);
  }, [handle]);
};

// ---------- phone ----------

export const StatusBar: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 54,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      padding: "0 30px 6px",
    }}
  >
    <span style={{ fontSize: 16, fontWeight: 600, color: C.black, letterSpacing: -0.2 }}>14:05</span>
    <div
      style={{
        position: "absolute",
        top: 11,
        left: "50%",
        transform: "translateX(-50%)",
        width: 122,
        height: 36,
        borderRadius: 20,
        background: C.black,
      }}
    />
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <svg width="18" height="12" viewBox="0 0 18 12">
        <rect x="0" y="8" width="3" height="4" rx="1" fill={C.black} />
        <rect x="5" y="5" width="3" height="7" rx="1" fill={C.black} />
        <rect x="10" y="2" width="3" height="10" rx="1" fill={C.black} />
        <rect x="15" y="0" width="3" height="12" rx="1" fill={C.black} />
      </svg>
      <svg width="27" height="12" viewBox="0 0 27 12">
        <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke={C.black} strokeOpacity="0.4" />
        <rect x="2" y="2" width="19" height="8" rx="1.5" fill={C.black} />
        <rect x="24" y="4" width="2" height="4" rx="1" fill={C.black} fillOpacity="0.4" />
      </svg>
    </div>
  </div>
);

export const NavBar: React.FC<{ title: string }> = ({ title }) => (
  <div
    style={{
      position: "absolute",
      top: 54,
      left: 0,
      right: 0,
      height: 44,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg style={{ position: "absolute", left: 16, top: 12 }} width="20" height="20" viewBox="0 0 20 20">
      <path d="M12.5 4 6.5 10l6 6" fill="none" stroke={C.black} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span style={{ fontSize: 17, fontWeight: 600, color: C.black }}>{title}</span>
  </div>
);

export const HomeIndicator: React.FC<{ color?: string }> = ({ color = C.black }) => (
  <div
    style={{
      position: "absolute",
      bottom: 8,
      left: "50%",
      transform: "translateX(-50%)",
      width: 134,
      height: 5,
      borderRadius: 3,
      background: color,
    }}
  />
);

/** The 393 × 852 screen inside a bezel, scaled by 1.1, fading and rising in at the start. */
export const PhoneFrame: React.FC<{ frame: number; children: React.ReactNode }> = ({ frame, children }) => (
  <div
    style={{
      position: "absolute",
      left: 150,
      top: 56,
      opacity: fade(frame, 0, 20),
      transform: `translateY(${rise(frame, 0, 24, 24)}px) scale(1.1)`,
      transformOrigin: "top left",
    }}
  >
    <div
      style={{
        padding: 10,
        borderRadius: 60,
        background: "#0a0a0a",
        boxShadow: "0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.12)",
      }}
    >
      <div
        style={{
          width: 393,
          height: 852,
          borderRadius: 50,
          background: C.gray50,
          overflow: "hidden",
          position: "relative",
          fontFamily: FONT,
          color: C.black,
        }}
      >
        {children}
      </div>
    </div>
  </div>
);

// ---------- right side ----------

/** One line of text for one range of frames, fading in at `from` and out before `to`. */
export const Caption: React.FC<{ frame: number; from: number; to: number; text: string; sub?: string }> = ({ frame, from, to, text, sub }) => {
  if (frame < from - 2 || frame >= to) return null;
  const opacity = Math.min(fade(frame, from, 14), interpolate(frame, [to - 10, to], [1, 0], clamp));
  const y = rise(frame, from, 16, 16);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, opacity, transform: `translateY(${y}px)` }}>
      <div style={{ fontSize: 60, fontWeight: 600, lineHeight: 1.15, color: C.white, letterSpacing: -1, maxWidth: 980 }}>{text}</div>
      {sub && <div style={{ marginTop: 28, fontSize: 32, lineHeight: 1.3, color: C.gray400, maxWidth: 940 }}>{sub}</div>}
    </div>
  );
};

/** The small grey line at the top right. */
export const TopLabel: React.FC<{ frame: number; text: string; fadeOutAt?: number }> = ({ frame, text, fadeOutAt }) => (
  <div
    style={{
      position: "absolute",
      left: 760,
      top: 96,
      fontSize: 24,
      fontWeight: 500,
      color: C.gray400,
      opacity: Math.min(fade(frame, 6, 16), fadeOutAt === undefined ? 1 : interpolate(frame, [fadeOutAt - 12, fadeOutAt], [1, 0], clamp)),
      letterSpacing: 0.2,
    }}
  >
    {text}
  </div>
);

/** The small grey line at the bottom right. */
export const Footnote: React.FC<{ frame: number; text: string; hideFrom?: number }> = ({ frame, text, hideFrom }) => (
  <div
    style={{
      position: "absolute",
      left: 760,
      bottom: 84,
      fontSize: 22,
      color: C.gray500,
      opacity: fade(frame, 20, 20) * (hideFrom !== undefined && frame >= hideFrom ? 0 : 1),
    }}
  >
    {text}
  </div>
);

/** Wordmark, tagline and the repo link. */
export const Wordmark: React.FC<{ frame: number; from: number; big?: boolean; top?: number }> = ({ frame, from, big = true, top }) => (
  <div style={{ position: "absolute", left: 760, top: top ?? (big ? 400 : 640), opacity: fade(frame, from, 18), transform: `translateY(${rise(frame, from, 18, 14)}px)` }}>
    <div style={{ fontSize: big ? 88 : 48, fontWeight: 700, color: C.white, letterSpacing: big ? -2 : -1, lineHeight: 1 }}>The Agent Card</div>
    <div style={{ marginTop: big ? 22 : 12, fontSize: big ? 32 : 24, color: C.gray400 }}>Viseca · Agent on a Leash · Swiss {"{ai}"} Weeks 2026</div>
    <div style={{ marginTop: big ? 56 : 20, fontSize: big ? 28 : 22, color: C.gray200, fontWeight: 500 }}>{GITHUB}</div>
  </div>
);
