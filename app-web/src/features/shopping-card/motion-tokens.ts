// All animation values for the shopping card prototype live here. Change timing in one place.
// Easing: iOS-like "ease out" for sheets and screens; linear for the countdown ring.

export const ease = {
    /** iOS sheet / navigation curve */
    ios: [0.32, 0.72, 0, 1] as [number, number, number, number],
    /** Quick UI response (banners, overlays) */
    out: [0.23, 1, 0.32, 1] as [number, number, number, number],
};

export const duration = {
    screen: 0.24,
    sheet: 0.38,
    scrim: 0.2,
    banner: 0.36,
    faceIdScan: 0.5,
    faceIdTotal: 0.8,
    meter: 0.45,
};

/** Distance a new screen slides in from (px). */
export const screenOffset = 24;

/** How long a push banner stays before it slides away (ms). */
export const bannerDwellMs = 7000;

/** Fake "Reading your words" delay (ms). */
export const readingDelayMs = 1800;
