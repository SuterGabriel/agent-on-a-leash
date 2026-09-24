/** "CHF 44.50", "CHF 1'000" (Swiss thousands separator '). */
export const formatChf = (value: number, { cents = true }: { cents?: boolean } = {}) => {
    const fixed = cents ? value.toFixed(2) : String(Math.round(value));
    const [int, dec] = fixed.split(".");
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return `CHF ${grouped}${dec ? `.${dec}` : ""}`;
};

/** 114 → "1:54" */
export const formatClock = (seconds: number) => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
