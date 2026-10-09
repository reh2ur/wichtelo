import { Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { text } from "./components/theme";

export interface ParticipantLeftConfirmationEmailProps {
  groupName: string;
}

export function ParticipantLeftConfirmationEmail({
  groupName,
}: ParticipantLeftConfirmationEmailProps) {
  return (
    <WichtelLayout
      preview={`Du hast ${groupName} verlassen`}
      heading="Du hast die Gruppe verlassen"
    >
      <Text style={text}>
        Du hast die Gruppe <strong>{groupName}</strong> verlassen. Diese E-Mail
        dient als Bestätigung.
      </Text>
    </WichtelLayout>
  );
}

export default ParticipantLeftConfirmationEmail;
