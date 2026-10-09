import { Section, Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { box, muted, text } from "./components/theme";

export interface AccountDeletionAdminNoticeEmailProps {
  groupName: string;
  /** Group already drawn: name stays, re-draw may be needed. Open: member removed. */
  postDraw: boolean;
}

export function AccountDeletionAdminNoticeEmail({
  groupName,
  postDraw,
}: AccountDeletionAdminNoticeEmailProps) {
  return (
    <WichtelLayout
      preview={`Teilnehmer hat Konto gelöscht – ${groupName}`}
      heading="Teilnehmer hat Konto gelöscht"
    >
      <Text style={text}>
        Ein Teilnehmer deiner Gruppe <strong>{groupName}</strong> hat sein Konto
        gelöscht.{" "}
        {postDraw
          ? "Da die Auslosung bereits stattgefunden hat, ist möglicherweise eine manuelle Aktion erforderlich."
          : "Die Person wurde aus der Gruppe entfernt und nimmt an der Auslosung nicht teil."}
      </Text>
      <Section style={box}>
        <Text style={{ ...muted, margin: 0 }}>
          {postDraw
            ? "Der frühere Teilnehmer ist in der Gruppe weiterhin mit seinem Namen sichtbar, hat aber kein aktives Konto mehr."
            : "Alle Ausschlüsse mit dieser Person wurden ebenfalls entfernt."}
        </Text>
      </Section>
    </WichtelLayout>
  );
}

export default AccountDeletionAdminNoticeEmail;
