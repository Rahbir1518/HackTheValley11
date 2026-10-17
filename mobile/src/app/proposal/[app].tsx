import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Chip, Label, Notice, Row } from "@/components/ui";
import { apiImage, buildModel, plannerName, storeysText, useApi, type Place, type Proposal } from "@/lib/api";
import { color } from "@/lib/theme";

/** Light markdown from the Narrator: drop the markers, keep the words. */
const plain = (md: string) => md.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\s)\*(\S.*?\S)\*/g, "$1$2").replace(/^#+\s*/gm, "");

export default function ProposalScreen() {
  const { app, address } = useLocalSearchParams<{ app: string; address?: string }>();
  const api = useApi();
  const [p, setP] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [reload, setReload] = useState(0); // bumped after the 3D model is built
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Proposal>(`/api/proposal?app_number=${encodeURIComponent(app)}`)
      .then(async (data) => {
        if (cancelled) return;
        setP(data);
        // Opening a proposal records it in the synced places (same list as the website).
        const where = address && !address.startsWith("Your location") ? address : data.application.address;
        const saved = await api<Place>("/api/me/places", {
          method: "POST",
          body: JSON.stringify({ address: where, app_number: app, label: data.narration?.headline ?? data.application.type_name }),
        });
        if (!cancelled) setPlace(saved);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [api, app, address, reload]);

  const build = useCallback(async () => {
    if (!p) return;
    setBuilding(true);
    setBuildNote(null);
    const where = address && !address.startsWith("Your location") ? address : p.application.address;
    const res = await buildModel(where, p.application.app_number);
    setBuilding(false);
    if (res.ok) setReload((n) => n + 1);
    else setBuildNote(res.message ?? "Ordis couldn't build a model for this application.");
  }, [p, address]);

  /** The interactive 3D model, inside the app. */
  const open3d = useCallback(() => {
    if (p) router.push({ pathname: "/model/[app]", params: { app: p.application.app_number, title: p.application.address } });
  }, [p]);

  const toggleWatch = useCallback(async () => {
    if (!place) return;
    setPlace(await api<Place>("/api/me/places", { method: "POST", body: JSON.stringify({ address: place.address, app_number: app, watched: !place.watched }) }));
  }, [api, app, place]);

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 20, gap: 16 }}>
        <Back />
        <Notice>{error}</Notice>
      </SafeAreaView>
    );
  }
  if (!p) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={color.ink} />
      </SafeAreaView>
    );
  }

  const a = p.application;
  const spec = p.spec;
  const planner = plannerName(p.involved.planner.name);
  const meeting = p.involved.upcoming_meetings[0];
  const lastMeeting = p.involved.past_meetings.at(-1)?.date;
  const where = address && !address.startsWith("Your location") ? address : a.address;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.white }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 56 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Back />
          {place && (
            <Pressable onPress={toggleWatch} hitSlop={8} style={[s.watch, place.watched && { backgroundColor: color.select }]}>
              <Text style={{ color: place.watched ? color.propInk : color.muted, fontSize: 13 }}>{place.watched ? "★ Watching" : "☆ Watch"}</Text>
            </Pressable>
          )}
        </View>

        {p.preview_url ? (
          <View style={{ gap: 8 }}>
            <Pressable onPress={open3d}>
              <Image source={apiImage(p.preview_url)} style={s.preview} contentFit="cover" transition={200} />
              <View style={s.previewBadge}>
                <Text style={{ color: color.white, fontSize: 12 }}>Tap to explore in 3D</Text>
              </View>
            </Pressable>
            <Button title="Explore in 3D" onPress={open3d} />
            <Text style={s.caption}>3D massing approximation from the application, among the City&apos;s buildings.</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {a.modelled ? (
              <>
                <Notice>
                  {building
                    ? "Ordis is reading the application and building the 3D model. This takes about a minute the first time…"
                    : "Ordis hasn't modelled this application yet. It reads the application text, builds the 3D model and writes a plain-language summary."}
                </Notice>
                <Button title={building ? "Building…" : "Build the 3D model"} onPress={build} busy={building} />
              </>
            ) : (
              <Notice>{`This is a ${a.type_name.toLowerCase()} application, not a new building, so there is no 3D model.`}</Notice>
            )}
            {buildNote && <Notice>{buildNote}</Notice>}
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Chip>{a.status}</Chip>
          <Text style={s.title}>{a.address}</Text>
          <Text style={{ color: color.muted, fontSize: 12 }}>
            {a.type_name} · {a.app_number}
            {a.date_submitted ? ` · submitted ${a.date_submitted.slice(0, 10)}` : ""}
          </Text>
        </View>

        {p.narration ? (
          <View style={{ gap: 8 }}>
            <Text style={s.headline}>{p.narration.headline}</Text>
            {plain(p.narration.summary)
              .split(/\n\s*\n/)
              .map((para, i) => (
                <Text key={i} style={s.body}>
                  {para.trim()}
                </Text>
              ))}
          </View>
        ) : (
          a.description && <Text style={s.body}>{a.description}</Text>
        )}

        {spec && (
          <View style={{ gap: 4 }}>
            <Chip tone="prop">Stated in the application</Chip>
            <Row label="Use / storeys" value={`${spec.use_type.replace("-", " ")} · ${storeysText(spec)}`} />
            {spec.height_stated && <Row label="Height" value={`${spec.height_m} m`} />}
            {spec.units != null && <Row label="Homes" value={spec.units.toLocaleString()} />}
            {spec.gfa_m2 != null && <Row label="Floor area" value={`${spec.gfa_m2.toLocaleString()} m²`} />}
          </View>
        )}

        {(p.rentals.length > 0 || p.heritage_on_site.length > 0 || p.rental_mentions.length > 0) && (
          <View style={[s.box, { gap: 8 }]}>
            <Label>ON THIS SITE TODAY</Label>
            {p.rentals.length > 0 && (
              <Text style={{ fontSize: 15, color: color.ink }}>
                {p.rentals.length === 1 ? "A registered rental building" : `${p.rentals.length} registered rental buildings`} ·{" "}
                {p.rental_units.toLocaleString()} homes
              </Text>
            )}
            {p.rental_mentions.length > 0 && <Text style={{ fontSize: 12, color: color.muted }}>The application says:</Text>}
            {p.rental_mentions.map((m, i) => (
              <Text key={i} style={s.quote}>
                “{m}”
              </Text>
            ))}
            {p.heritage_on_site.map((h) => (
              <Text key={h.address + h.status_label} style={{ fontSize: 13, color: color.ink }}>
                Heritage · {h.status_label}
                {h.built ? ` · built ${h.built}` : ""}
              </Text>
            ))}
            {p.rental_rule && <Text style={{ fontSize: 12, color: color.muted, lineHeight: 18 }}>{p.rental_rule}</Text>}
          </View>
        )}

        <View style={{ gap: 10 }}>
          <Label>TAKE PART</Label>
          <Text style={s.body}>
            {meeting
              ? `Community meeting: ${meeting.date}${meeting.time ? ` · ${meeting.time}` : ""}${meeting.location ? ` · ${meeting.location}` : ""}`
              : `No upcoming meeting is listed in the City's data${lastMeeting ? ` (last: ${lastMeeting})` : ""}.`}
          </Text>
          {planner && <Text style={{ fontSize: 14, color: color.ink }}>City planner: {planner}</Text>}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {p.involved.planner.email && (
              <Button
                title="Email the planner"
                style={{ flex: 1 }}
                onPress={() =>
                  Linking.openURL(
                    `mailto:${p.involved.planner.email}?subject=${encodeURIComponent(`Question about application ${a.app_number} (${a.address})`)}&body=${encodeURIComponent(
                      `Hello ${planner ?? ""},\n\nI live near ${where} and I have a question about development application ${a.app_number}.\n\n[your question]\n\nThank you,\n[your name]`,
                    )}`,
                  )
                }
              />
            )}
            {p.involved.planner.phone && <Button title="Call" kind="secondary" onPress={() => Linking.openURL(`tel:${p.involved.planner.phone}`)} />}
          </View>
        </View>

        <View style={{ gap: 10 }}>
          {a.application_url && (
            <Pressable onPress={() => WebBrowser.openBrowserAsync(a.application_url!)}>
              <Text style={{ color: color.propInk, fontSize: 13, textAlign: "center" }}>Official City record ↗</Text>
            </Pressable>
          )}
        </View>

        <Text style={s.caption}>Ordis explains; it doesn&apos;t take a position. Stated = in the City&apos;s record; estimated = Ordis&apos; documented rules.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Back() {
  return (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={10}>
      <Text style={{ color: color.ink, fontSize: 15 }}>← Back</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  watch: { borderWidth: 1, borderColor: color.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  preview: { width: "100%", aspectRatio: 16 / 10, borderRadius: 10, backgroundColor: color.canvas },
  previewBadge: { position: "absolute", right: 10, bottom: 10, backgroundColor: "rgba(32,35,34,0.75)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  caption: { fontSize: 11, color: color.muted, lineHeight: 16 },
  title: { fontSize: 24, color: color.ink },
  headline: { fontSize: 17, color: color.ink, lineHeight: 24, fontWeight: "500" },
  body: { fontSize: 14, color: color.muted, lineHeight: 21 },
  box: { borderWidth: 1, borderColor: color.line, borderRadius: 10, padding: 14 },
  quote: { fontSize: 13, color: color.ink, fontStyle: "italic", lineHeight: 19, borderLeftWidth: 2, borderLeftColor: color.prop, paddingLeft: 10 },
});
