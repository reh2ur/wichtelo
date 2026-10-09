import { Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { text } from "./components/theme";

export interface ParticipantJoinedEmailProps {
  groupName: string;
  participantName: string;
}

export function ParticipantJoinedEmail({
  groupName,
  participantName,
}: ParticipantJoinedEmailProps) {
  return (
    <WichtelLayout
      preview={`${participantName} ist ${groupName} beigetreten`}
      heading="Neuer Teilnehmer beigetreten 🎄"
    >
      <Text style={text}>
        <strong>{participantName}</strong> ist deiner Gruppe{" "}
        <strong>{groupName}</strong> beigetreten.
      </Text>
    </WichtelLayout>
  );
}

export default ParticipantJoinedEmail;
