import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { color, mono } from "@/lib/theme";

/** The Ordis wordmark: a dark square with an "O", as on the web app. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
      <View style={{ width: size, height: size, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: color.white, fontSize: size * 0.62, fontWeight: "600" }}>O</Text>
      </View>
      <Text style={{ color: color.ink, fontSize: 15, letterSpacing: 1.5, fontWeight: "600" }}>ORDIS</Text>
    </View>
  );
}

export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "prop" | "rust" }) {
  const bg = tone === "prop" ? color.select : tone === "rust" ? color.dangerSoft : color.soft;
  const fg = tone === "prop" ? color.propInk : tone === "rust" ? color.danger : color.muted;
  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[s.chipText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = kind === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.button,
        primary ? { backgroundColor: color.ink } : { borderWidth: 1, borderColor: color.line, backgroundColor: color.white },
        (disabled || pressed) && { opacity: 0.6 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? color.white : color.ink} /> : <Text style={{ color: primary ? color.white : color.ink, fontSize: 14 }}>{title}</Text>}
    </Pressable>
  );
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={{ color: color.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: color.ink, fontSize: 13, fontWeight: "500", flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: color.side, borderRadius: 8, padding: 14 }}>
      <Text style={{ color: color.muted, fontSize: 13, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontFamily: mono, fontSize: 11, color: color.muted, letterSpacing: 0.5 },
  chip: { alignSelf: "flex-start", borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 },
  chipText: { fontFamily: mono, fontSize: 10, textTransform: "uppercase" },
  button: { height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
});
