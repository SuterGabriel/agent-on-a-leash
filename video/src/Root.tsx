import { Composition } from "remotion";
import { AGENT_CARD_DECLINE, AgentCardDecline } from "./AgentCardDecline";

export const RemotionRoot: React.FC = () => (
  <Composition
    id={AGENT_CARD_DECLINE.id}
    component={AgentCardDecline}
    durationInFrames={AGENT_CARD_DECLINE.durationInFrames}
    fps={AGENT_CARD_DECLINE.fps}
    width={AGENT_CARD_DECLINE.width}
    height={AGENT_CARD_DECLINE.height}
  />
);
