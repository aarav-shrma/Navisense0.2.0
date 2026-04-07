/**
 * NaviSense Mobile · Settings Screen
 * ────────────────────────────────────
 * Allows users to tune accessibility preferences:
 *   • TTS speed, voice language
 *   • Obstacle alert distance threshold
 *   • Font size, high-contrast UI
 *   • Saved locations management
 *
 * All controls are fully accessible via screen readers.
 */
import React, { useEffect, useState } from "react";
import {
  View, Text, Switch, ScrollView, StyleSheet, TouchableOpacity,
  AccessibilityInfo, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Speech from "expo-speech";

import { useNaviStore } from "../hooks/useNaviStore";
import { updatePreferences, getMyProfile } from "../services/api";

const DISTANCE_OPTIONS = ["near", "medium", "far"];
const FONT_OPTIONS = ["medium", "large", "xlarge"];
const FONT_SCALE = { medium: 16, large: 20, xlarge: 26 };

export default function SettingsScreen() {
  const { preferences, setPreferences } = useNaviStore();
  const [saving, setSaving] = useState(false);

  const save = async (patch) => {
    setPreferences(patch);
    setSaving(true);
    try {
      await updatePreferences({ ...preferences, ...patch });
    } catch (e) {
      Alert.alert("Save failed", e.message);
    } finally {
      setSaving(false);
    }
  };

  const fontSize = FONT_SCALE[preferences.font_size] || 20;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.heading, { fontSize: fontSize + 6 }]}>Settings</Text>

        {/* ── TTS Speed ──────────────────────────────────── */}
        <Section title="Voice Speed" fontSize={fontSize}>
          <Row>
            {[0.75, 1.0, 1.25, 1.5, 2.0].map((speed) => (
              <TouchableOpacity
                key={speed}
                style={[styles.chip, preferences.tts_speed === speed && styles.chipActive]}
                onPress={() => {
                  save({ tts_speed: speed });
                  Speech.speak(`Speed set to ${speed}`, { rate: speed });
                }}
                accessibilityLabel={`TTS speed ${speed}x`}
                accessibilityRole="radio"
                accessibilityState={{ selected: preferences.tts_speed === speed }}
              >
                <Text style={[styles.chipText, { fontSize }]}>{speed}×</Text>
              </TouchableOpacity>
            ))}
          </Row>
        </Section>

        {/* ── Alert Distance ─────────────────────────────── */}
        <Section title="Obstacle Alert Distance" fontSize={fontSize}>
          <Row>
            {DISTANCE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, preferences.obstacle_alert_distance === opt && styles.chipActive]}
                onPress={() => save({ obstacle_alert_distance: opt })}
                accessibilityLabel={`Alert for ${opt} obstacles`}
                accessibilityRole="radio"
                accessibilityState={{ selected: preferences.obstacle_alert_distance === opt }}
              >
                <Text style={[styles.chipText, { fontSize }]}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </Row>
        </Section>

        {/* ── Font Size ──────────────────────────────────── */}
        <Section title="Text Size" fontSize={fontSize}>
          <Row>
            {FONT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, preferences.font_size === opt && styles.chipActive]}
                onPress={() => save({ font_size: opt })}
                accessibilityLabel={`Font size: ${opt}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: preferences.font_size === opt }}
              >
                <Text style={[styles.chipText, { fontSize: FONT_SCALE[opt] - 2 }]}>Aa</Text>
              </TouchableOpacity>
            ))}
          </Row>
        </Section>

        {/* ── Toggles ────────────────────────────────────── */}
        <Section title="Navigation" fontSize={fontSize}>
          <SwitchRow
            label="Prefer accessible routes"
            hint="Avoids paths without tactile paving or kerb cuts"
            value={preferences.prefer_accessible_routes}
            onChange={(v) => save({ prefer_accessible_routes: v })}
            fontSize={fontSize}
          />
          <SwitchRow
            label="Announce cross-streets"
            hint="Reads out street names at every turn"
            value={preferences.announce_cross_streets}
            onChange={(v) => save({ announce_cross_streets: v })}
            fontSize={fontSize}
          />
        </Section>

        <Section title="Display" fontSize={fontSize}>
          <SwitchRow
            label="High contrast UI"
            hint="Increases colour contrast throughout the app"
            value={preferences.high_contrast_ui}
            onChange={(v) => save({ high_contrast_ui: v })}
            fontSize={fontSize}
          />
        </Section>

        {saving && (
          <Text style={[styles.savingText, { fontSize }]} accessibilityLiveRegion="polite">
            Saving…
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────
function Section({ title, children, fontSize }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { fontSize: fontSize - 2 }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }) {
  return <View style={styles.row}>{children}</View>;
}

function SwitchRow({ label, hint, value, onChange, fontSize }) {
  return (
    <View style={styles.switchRow} accessible={true} accessibilityLabel={label} accessibilityHint={hint}>
      <Text style={[styles.switchLabel, { fontSize }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#3A3A3C", true: "#34C759" }}
        thumbColor="#FFF"
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  scroll: { padding: 20, paddingBottom: 48 },
  heading: { color: "#FFF", fontWeight: "800", marginBottom: 24 },
  section: { marginBottom: 28 },
  sectionTitle: { color: "#8E8E93", fontWeight: "600", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
    backgroundColor: "#1C1C1E", borderWidth: 2, borderColor: "#3A3A3C",
    minWidth: 60, alignItems: "center",
  },
  chipActive: { borderColor: "#007AFF", backgroundColor: "#0A2140" },
  chipText: { color: "#FFF", fontWeight: "600" },
  switchRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1C1C1E",
    minHeight: 56,    // WCAG 2.5.5 minimum touch target
  },
  switchLabel: { color: "#FFF", flex: 1, marginRight: 16 },
  savingText: { color: "#8E8E93", textAlign: "center", marginTop: 16 },
});
