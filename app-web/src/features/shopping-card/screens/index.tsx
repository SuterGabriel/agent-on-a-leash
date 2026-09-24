import type { ReactNode } from "react";
import type { ScreenId } from "@/features/shopping-card/prototype-state";
import { CardDetailsScreen, NotMeScreen, PaymentDetailsScreen, RulesScreen, YesMeScreen } from "@/features/shopping-card/screens/detail-screens";
import { HomeScreen } from "@/features/shopping-card/screens/everyday-screens";
import { LockScreen } from "@/features/shopping-card/screens/lock-screen";
import { CardReadyScreen, CardTabScreen, HowItWorksScreen } from "@/features/shopping-card/screens/onboarding-screens";
import { RulesFromShoppingScreen, SmartSettingsScreen } from "@/features/shopping-card/screens/setup-screens";

export { SheetHost } from "@/features/shopping-card/screens/sheets";

/** Screen id → component. Sheets (1.3a, 4.1–4.5, 6.2, 7.2, 8.1, 8.2) render on top via <SheetHost />. */
export const screens: Record<ScreenId, () => ReactNode> = {
    "1.1": () => <CardTabScreen />,
    "1.2": () => <HowItWorksScreen />,
    "1.3": () => <RulesFromShoppingScreen />,
    "1.4": () => <SmartSettingsScreen />,
    "1.5": () => <CardReadyScreen />,
    "3.1": () => <HomeScreen />,
    "4.0": () => <LockScreen kind="ask" />,
    "5.1": () => <LockScreen kind="stopped" />,
    "5.2": () => <PaymentDetailsScreen />,
    "6.1": () => <RulesScreen />,
    "6.3": () => <CardDetailsScreen />,
    "7.1": () => <LockScreen kind="burst" />,
    "7.3": () => <NotMeScreen />,
    "7.3b": () => <YesMeScreen />,
};
