import { Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { muted, text } from "./components/theme";

export interface AccountDeletionConfirmedEmailProps {
  name: string;
}

export function AccountDeletionConfirmedEmail({
  name,
}: AccountDeletionConfirmedEmailProps) {
  return (
    <WichtelLayout preview="Dein Konto wurde gelöscht" heading="Konto gelöscht">
      <Text style={text}>Hallo {name},</Text>
      <Text style={text}>
        dein Konto und deine persönlichen Daten wurden gelöscht. Diese E-Mail
        dient als Bestätigung.
      </Text>
      <Text style={muted}>
        Dein Name bleibt in bereits stattgefundenen Auslosungen sichtbar, damit
        bestehende Zuteilungen für andere Teilnehmer nachvollziehbar bleiben.
      </Text>
    </WichtelLayout>
  );
}

export default AccountDeletionConfirmedEmail;
