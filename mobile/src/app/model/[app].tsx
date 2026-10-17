import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Notice } from "@/components/ui";
import { TUNNEL_HEADERS, WEB_URL } from "@/lib/api";
import { color } from "@/lib/theme";

/** The interactive 3D model inside the app: the website's phone view (/embed), which renders the
 *  same scene as the web viewer. Public City data only, so no second sign-in. */
export default function ModelScreen() {
  const { app, title } = useLocalSearchParams<{ app: string; title?: string }>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={10}>
          <Text style={{ color: color.ink, fontSize: 15 }}>← Back</Text>
        </Pressable>
        <Text style={s.title} numberOfLines={1}>
          {title ?? "3D model"}
        </Text>
        <View style={{ width: 48 }} />
      </View>
      {failed ? (
        <View style={{ padding: 20 }}>
          <Notice>{`Couldn't load the 3D model (${failed}). Check the website is running and reachable at ${WEB_URL}.`}</Notice>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <WebView
            source={{ uri: `${WEB_URL}/embed?app=${encodeURIComponent(app)}`, headers: TUNNEL_HEADERS }}
            style={{ flex: 1, backgroundColor: color.canvas }}
            onLoadEnd={() => setLoading(false)}
            onError={(e) => setFailed(e.nativeEvent.description || "network error")}
            onHttpError={(e) => setFailed(`HTTP ${e.nativeEvent.statusCode}`)}
            overScrollMode="never"
            bounces={false}
            setSupportMultipleWindows={false}
          />
          {loading && (
            <View style={s.loading} pointerEvents="none">
              <ActivityIndicator color={color.ink} />
              <Text style={{ color: color.muted, fontSize: 13 }}>Loading the 3D model…</Text>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: color.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  title: { flex: 1, textAlign: "center", fontSize: 15, color: color.ink, fontWeight: "500" },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: color.canvas },
});
