import { useAuth } from "@clerk/expo";
import { Image } from "expo-image";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip, Label, Notice, Wordmark } from "@/components/ui";
import { API_URL, useApi, type Nearby, type NearbyApplication, type Place } from "@/lib/api";
import { color } from "@/lib/theme";

const DEMO_PLACES = ["135 Liberty St", "100 Queen St W", "240 Wellesley St E", "5250 Yonge St"];

export default function Home() {
  const { signOut } = useAuth();
  const [tab, setTab] = useState<"near" | "places">("near");
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.white }} edges={["top"]}>
      <View style={s.header}>
        <Wordmark />
        <Pressable onPress={() => signOut()} hitSlop={8}>
          <Text style={{ color: color.muted, fontSize: 13 }}>Sign out</Text>
        </Pressable>
      </View>
      <View style={s.tabs}>
        {(
          [
            ["near", "Near me"],
            ["places", "My places"],
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} onPress={() => setTab(key)} style={[s.tab, tab === key && s.tabOn]}>
            <Text style={{ fontSize: 13, color: tab === key ? color.propInk : color.muted }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "near" ? <NearMe /> : <MyPlaces />}
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------ near me

function NearMe() {
  const api = useApi();
  const [result, setResult] = useState<Nearby | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");

  const loadAt = useCallback(
    async (lat: number, lon: number, label: string) => {
      setBusy(true);
      setError(null);
      try {
        setResult(await api<Nearby>(`/api/nearby?lat=${lat}&lon=${lon}&radius_m=400`));
        setSource(label);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const locate = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setError("Location permission is off. Search an address instead.");
      return;
    }
    setBusy(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await loadAt(pos.coords.latitude, pos.coords.longitude, "Your location");
    } catch {
      setBusy(false);
      setError("Couldn't get your location. Search an address instead.");
    }
  }, [loadAt]);

  const search = useCallback(
    async (address: string) => {
      setBusy(true);
      setError(null);
      try {
        const g = await api<{ geocode: { address_full: string; lat: number; lon: number } }>(
          `/api/applications?address=${encodeURIComponent(address)}&radius_m=50`,
        );
        await loadAt(g.geocode.lat, g.geocode.lon, g.geocode.address_full);
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [api, loadAt],
  );

  useEffect(() => {
    locate(); // eslint-disable-line react-hooks/set-state-in-effect -- asks for location once on open; state is set after awaits
  }, [locate]);

  return (
    <FlatList
      data={result?.applications ?? []}
      keyExtractor={(a) => a.app_number}
      contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 48 }}
      ListHeaderComponent={
        <View style={{ gap: 14, marginBottom: 6 }}>
          <View style={s.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => query.trim() && search(query.trim())}
              placeholder="Search a Toronto address"
              placeholderTextColor={color.muted}
              returnKeyType="search"
              style={s.search}
            />
            <Pressable onPress={locate} style={s.gps} hitSlop={6}>
              <Text style={{ color: color.propInk, fontSize: 13 }}>◎ GPS</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {DEMO_PLACES.map((p) => (
              <Pressable key={p} onPress={() => search(p)} style={s.demo}>
                <Text style={{ fontSize: 12, color: color.ink }}>{p}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {busy && <ActivityIndicator color={color.ink} style={{ marginTop: 12 }} />}
          {error && <Notice>{error}</Notice>}
          {result && !busy && (
            <View style={{ gap: 4 }}>
              <Label>{`${source.toUpperCase()}${result.here && source !== result.here ? ` · NEAR ${result.here.toUpperCase()}` : ""}`}</Label>
              <Text style={{ color: color.muted, fontSize: 13 }}>
                {result.applications.length
                  ? `${result.applications.length} active application${result.applications.length > 1 ? "s" : ""} within ${result.radius_m} m`
                  : `No active applications within ${result.radius_m} m.`}
              </Text>
            </View>
          )}
        </View>
      }
      renderItem={({ item }) => <ApplicationCard item={item} address={source} />}
    />
  );
}

function ApplicationCard({ item, address }: { item: NearbyApplication; address: string }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/proposal/[app]", params: { app: item.app_number, address } })}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: color.side }]}
    >
      {item.preview_url ? (
        <Image source={{ uri: `${API_URL}${item.preview_url}` }} style={s.thumb} contentFit="cover" transition={150} />
      ) : (
        <View style={[s.thumb, { alignItems: "center", justifyContent: "center", backgroundColor: color.soft }]}>
          <Text style={{ color: color.muted, fontSize: 10, textAlign: "center" }}>{item.modelled ? "3D on\nfirst open" : "No 3D"}</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ fontSize: 15, color: color.ink, flexShrink: 1 }} numberOfLines={1}>
            {item.address}
          </Text>
          <Text style={{ fontSize: 12, color: color.muted }}>{Math.round(item.distance_m)} m</Text>
        </View>
        <Chip>{item.status}</Chip>
        <Text style={{ fontSize: 12, color: color.muted, lineHeight: 17 }} numberOfLines={2}>
          {item.headline ?? item.type_name}
        </Text>
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ my places

function MyPlaces() {
  const api = useApi();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ places: Place[] }>("/api/me/places");
      setPlaces(d.places);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  // Reload whenever the tab or screen comes back into view (changes made on the web show up).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggleWatch = async (p: Place) => {
    await api("/api/me/places", { method: "POST", body: JSON.stringify({ address: p.address, app_number: p.app_number, label: p.label, watched: !p.watched }) });
    load();
  };

  return (
    <FlatList
      data={places ?? []}
      keyExtractor={(p) => p.address}
      contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 4 }}>
          <Label>YOUR PLACES · SYNCED WITH THE WEBSITE</Label>
          {error && <Notice>{error}</Notice>}
          {places && !places.length && <Notice>Places you open (here or on the website) appear here. Star one to watch it for status changes and new community meetings.</Notice>}
        </View>
      }
      renderItem={({ item: p }) => (
        <Pressable
          onPress={async () => {
            if (p.changes.length) await api("/api/me/places/seen", { method: "POST", body: JSON.stringify({ address: p.address }) });
            if (p.app_number) router.push({ pathname: "/proposal/[app]", params: { app: p.app_number, address: p.address } });
          }}
          style={({ pressed }) => [s.place, pressed && { backgroundColor: color.side }]}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 15, color: color.ink }}>{p.address}</Text>
            {!!p.label && (
              <Text style={{ fontSize: 12, color: color.muted }} numberOfLines={1}>
                {p.label}
              </Text>
            )}
            {p.changes.map((c) => (
              <Text key={c} style={{ fontSize: 12, color: color.rust }}>
                {c}
              </Text>
            ))}
          </View>
          {p.app_number && (
            <Pressable onPress={() => toggleWatch(p)} hitSlop={10}>
              <Text style={{ fontSize: 20, color: p.watched ? color.propInk : color.line }}>{p.watched ? "★" : "☆"}</Text>
            </Pressable>
          )}
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12 },
  tabs: { flexDirection: "row", marginHorizontal: 20, backgroundColor: color.soft, borderRadius: 8, padding: 3 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 6 },
  tabOn: { backgroundColor: color.white },
  searchRow: { flexDirection: "row", gap: 8 },
  search: { flex: 1, height: 44, borderWidth: 1, borderColor: color.line, borderRadius: 8, paddingHorizontal: 12, fontSize: 15, color: color.ink },
  gps: { height: 44, paddingHorizontal: 12, borderRadius: 8, backgroundColor: color.select, justifyContent: "center" },
  demo: { borderWidth: 1, borderColor: color.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  card: { flexDirection: "row", gap: 12, borderWidth: 1, borderColor: color.line, borderRadius: 10, padding: 10 },
  thumb: { width: 84, height: 84, borderRadius: 6, backgroundColor: color.canvas },
  place: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: color.line, borderRadius: 10, padding: 14 },
});
