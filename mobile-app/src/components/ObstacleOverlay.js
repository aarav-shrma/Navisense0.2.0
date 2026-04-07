/**
 * NaviSense Mobile · ObstacleOverlay Component
 * ──────────────────────────────────────────────
 * Renders normalised bounding boxes from YOLO over the camera feed.
 * accessibilityElementsHidden=true because the visual overlay is
 * supplementary — all information is conveyed via Speech.speak().
 */
import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const LABEL_COLORS = {
  person:     "#FF9500",
  car:        "#FF3B30",
  staircase:  "#FF3B30",
  door:       "#34C759",
  default:    "#007AFF",
};

export function ObstacleOverlay({ obstacles = [], frameWidth, frameHeight }) {
  if (!obstacles.length) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {obstacles.map((obs, i) => {
        // Convert normalised [0–1] coords to screen pixels
        const x  = (obs.x - obs.width  / 2) * SCREEN_W;
        const y  = (obs.y - obs.height / 2) * SCREEN_H;
        const bw = obs.width  * SCREEN_W;
        const bh = obs.height * SCREEN_H;
        const color = LABEL_COLORS[obs.class_label] || LABEL_COLORS.default;

        return (
          <View
            key={i}
            style={[styles.box, { left: x, top: y, width: bw, height: bh, borderColor: color }]}
          >
            <View style={[styles.labelBg, { backgroundColor: color }]}>
              <Text style={styles.labelText} numberOfLines={1}>
                {obs.class_label} {Math.round(obs.confidence_score * 100)}%
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}


/**
 * StateIndicator — shows the current FSM mode as a small pill badge.
 * High contrast, compact (doesn't occlude the viewfinder).
 */
import { AppState } from "../hooks/useNaviStore";

const STATE_CONFIG = {
  [AppState.IDLE]:        { label: "Ready",       color: "#8E8E93" },
  [AppState.LISTENING]:   { label: "Listening",   color: "#FF9500" },
  [AppState.NAVIGATING]:  { label: "Navigating",  color: "#34C759" },
  [AppState.RECOGNIZING]: { label: "Recognizing", color: "#007AFF" },
  [AppState.READING]:     { label: "Reading",     color: "#AF52DE" },
  [AppState.CROSSING]:    { label: "Crossing",    color: "#FF9500" },
  [AppState.EMERGENCY]:   { label: "SOS",         color: "#FF3B30" },
};

export function StateIndicator({ state }) {
  const cfg = STATE_CONFIG[state] || STATE_CONFIG[AppState.IDLE];
  return (
    <View
      style={[styles.statePill, { backgroundColor: cfg.color }]}
      accessibilityLabel={`App mode: ${cfg.label}`}
      accessibilityLiveRegion="assertive"
    >
      <Text style={styles.stateText}>{cfg.label.toUpperCase()}</Text>
    </View>
  );
}


const styles = StyleSheet.create({
  // ── Bounding box ─────────────────────────────────────────
  box: {
    position: "absolute",
    borderWidth: 2,
    borderRadius: 4,
  },
  labelBg: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    alignSelf: "flex-start",
  },
  labelText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },

  // ── State pill ───────────────────────────────────────────
  statePill: {
    position: "absolute",
    bottom: 192,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    opacity: 0.92,
  },
  stateText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
});
