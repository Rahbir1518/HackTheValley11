import { useSignIn, useSignUp } from "@clerk/expo";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Label, Wordmark } from "@/components/ui";
import { color } from "@/lib/theme";

type ClerkErr = { message?: string; longMessage?: string; code?: string; errors?: { code?: string; longMessage?: string; message?: string }[] } | null;

const codesOf = (e: ClerkErr) => [e?.code, ...(e?.errors ?? []).map((x) => x.code)].filter(Boolean) as string[];
const messageOf = (e: ClerkErr) => e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? e?.longMessage ?? e?.message ?? "Something went wrong.";

/** Email code sign-in (the method enabled on the Ordis Clerk instance). An email without an
 *  account gets one: same flow, via sign-up. Same account as the web app. */
export default function SignIn() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await signIn.emailCode.sendCode({ emailAddress: email.trim() });
      if (!e) {
        setMode("sign-in");
        setStep("code");
        return;
      }
      if (!codesOf(e as ClerkErr).some((c) => c.includes("identifier_not_found"))) {
        setError(messageOf(e as ClerkErr));
        return;
      }
      // No account yet: create one with the same email code.
      const created = await signUp.create({ emailAddress: email.trim() });
      if (created.error) return setError(messageOf(created.error as ClerkErr));
      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) return setError(messageOf(sent.error as ClerkErr));
      setMode("sign-up");
      setStep("code");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        const { error: e } = await signIn.emailCode.verifyCode({ code: code.trim() });
        if (e) return setError(messageOf(e as ClerkErr));
        if (signIn.status !== "complete") return setError(`Sign-in needs another step (${signIn.status}); finish it on the web.`);
        const done = await signIn.finalize();
        if (done.error) setError(messageOf(done.error as ClerkErr));
      } else {
        const { error: e } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (e) return setError(messageOf(e as ClerkErr));
        if (signUp.status !== "complete") return setError("Your account needs more details; finish signing up on the web.");
        const done = await signUp.finalize();
        if (done.error) setError(messageOf(done.error as ClerkErr));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.side }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
        <Wordmark size={30} />
        <View style={{ gap: 8 }}>
          <Text style={s.title}>What&apos;s being built near you?</Text>
          <Text style={s.sub}>Sign in with the same email you use on the Ordis website. Your saved and watched places sync.</Text>
        </View>
        {step === "email" ? (
          <View style={{ gap: 12 }}>
            <Label>EMAIL</Label>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={color.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={s.input}
            />
            <Button title="Send me a code" onPress={sendCode} busy={busy} disabled={!email.includes("@")} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Label>CODE SENT TO {email.trim().toUpperCase()}</Label>
            <TextInput value={code} onChangeText={setCode} placeholder="6-digit code" placeholderTextColor={color.muted} keyboardType="number-pad" style={s.input} />
            <Button title={mode === "sign-in" ? "Sign in" : "Create account"} onPress={verify} busy={busy} disabled={code.trim().length < 6} />
            <Button
              title="Use another email"
              kind="secondary"
              onPress={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            />
          </View>
        )}
        {error && <Text style={s.error}>{error}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 28, justifyContent: "center" },
  title: { fontSize: 26, color: color.ink, lineHeight: 32 },
  sub: { fontSize: 14, color: color.muted, lineHeight: 21 },
  input: { height: 48, borderWidth: 1, borderColor: color.line, borderRadius: 8, paddingHorizontal: 14, fontSize: 16, color: color.ink, backgroundColor: color.white },
  error: { color: color.danger, fontSize: 13, lineHeight: 19 },
});
