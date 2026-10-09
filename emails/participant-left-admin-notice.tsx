import { Section, Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { box, colors, text } from "./components/theme";

export interface ParticipantLeftAdminNoticeEmailProps {
  groupName: string;
  participantName: string;
  postDraw: boolean;
}

export function ParticipantLeftAdminNoticeEmail({
  groupName,
  participantName,
  postDraw,
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
      {postDraw && (
        <Section style={{ ...box, borderColor: colors.crimson }}>
          <Text style={{ ...text, margin: 0 }}>
            Die Auslosung hat bereits stattgefunden — eventuell ist eine
            manuelle Anpassung der Zuteilungen nötig.
          </Text>
        </Section>
      )}
    </WichtelLayout>
  );
}

export default ParticipantLeftAdminNoticeEmail;
