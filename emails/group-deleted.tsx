import { Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { text } from "./components/theme";

export interface GroupDeletedEmailProps {
  groupName: string;
  year: number;
  recipientName: string;
  adminName: string | null;
  adminEmail: string | null;
}

export function GroupDeletedEmail({
  groupName,
  year,
  recipientName,
  adminName,
  adminEmail,
}: GroupDeletedEmailProps) {
  return (
    <WichtelLayout
      preview={`${groupName} wurde gelöscht`}
      heading="Gruppe wurde gelöscht"
    >
      <Text style={text}>Hallo {recipientName},</Text>
      <Text style={text}>
        die Gruppe <strong>{groupName}</strong> ({year}) wurde
        {adminName ? ` von ${adminName}` : ""} gelöscht. Der Wichtel-Austausch
        für diese Gruppe findet nicht statt.
      </Text>
      {adminName && adminEmail && (
        <Text style={text}>
          Fragen dazu? Wende dich an {adminName} ({adminEmail}).
        </Text>
      )}
    </WichtelLayout>
  );
}

export default GroupDeletedEmail;
