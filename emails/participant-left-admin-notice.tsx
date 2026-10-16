import { Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { text } from "./components/theme";

export interface ParticipantLeftAdminNoticeEmailProps {
  groupName: string;
  participantName: string;
}

export function ParticipantLeftAdminNoticeEmail({
  groupName,
  participantName,
}: ParticipantLeftAdminNoticeEmailProps) {
  return (
    <WichtelLayout
      preview={`${participantName} hat ${groupName} verlassen`}
      heading="Teilnehmer hat die Gruppe verlassen"
    >
      <Text style={text}>
        <strong>{participantName}</strong> hat deine Gruppe{" "}
        <strong>{groupName}</strong> verlassen.
      </Text>
    </WichtelLayout>
  );
}

export default ParticipantLeftAdminNoticeEmail;
