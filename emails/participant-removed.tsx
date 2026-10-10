import { Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { text } from "./components/theme";

export interface ParticipantRemovedEmailProps {
  groupName: string;
  adminName: string | null;
  adminEmail: string | null;
}

export function ParticipantRemovedEmail({
  groupName,
  adminName,
  adminEmail,
}: ParticipantRemovedEmailProps) {
  return (
    <WichtelLayout
      preview={`Du wurdest aus ${groupName} entfernt`}
      heading="Du wurdest aus der Gruppe entfernt"
    >
      <Text style={text}>
        Du wurdest von einem Admin aus der Gruppe <strong>{groupName}</strong>{" "}
        entfernt.
      </Text>
      {adminName && adminEmail && (
        <Text style={text}>
          Fragen dazu? Wende dich an {adminName} ({adminEmail}).
        </Text>
      )}
    </WichtelLayout>
  );
}

export default ParticipantRemovedEmail;
