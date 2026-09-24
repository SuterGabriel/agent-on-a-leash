import { createContext, useContext } from "react";

/**
 * Whether the fake iOS chrome (status bar content, home indicator) is drawn.
 * Off when the prototype runs full screen on a real phone, which has its own.
 */
export const DeviceChromeContext = createContext(true);

export const useDeviceChrome = () => useContext(DeviceChromeContext);
