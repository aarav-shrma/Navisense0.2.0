/**
 * NaviSense Mobile · Home Screen
 * ────────────────────────────────
 * This is the primary screen — a full-screen camera viewfinder
 * with a large accessible voice button and obstacle overlay.
 *
 * Accessibility principles applied:
 *   • All interactive elements have accessibilityLabel + accessibilityHint
 *   • Large touch targets (≥ 44 × 44 pt, WCAG 2.5.5)
 *   • High contrast colours (≥ 4.5:1 ratio)
 *   • Screen reader (VoiceOver / TalkBack) fully supported
 *   • No visual-only affordances — every state change is spoken aloud
 */
import React, { useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  AccessibilityInfo,
  Dimensions,
  StatusBar,
  Platform,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Speech from "expo-speech";

import { useDetection } from "../hooks/useDetection";
import { useVoiceAssistant } from "../hooks/useVoiceAssistant";
import { useNaviStore, AppState } from "../hooks/useNaviStore";
import { ObstacleOverlay, StateIndicator } from "../components/ObstacleOverlay";

const { width, height } = Dimensions.get("window");

export default function HomeScreen() {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const { obstacles, appState, isListening } = useNaviStore();
  const { startListening, stopListeningAndDispatch } = useVoiceAssistant();

  // Start the detection polling loop (attaches to cameraRef)
  useDetection(cameraRef);

  // ── Permission gate ──────────────────────────────────────
  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.permissionText}>
          NaviSense needs camera access to detect obstacles and read text.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
          accessibilityLabel="Grant camera permission"
          accessibilityRole="button"
        >
          <Text style={styles.permissionButtonText}>Enable Camera</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const voiceButtonLabel = isListening ? "Release to send command" : "Hold to speak a command";

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      {/* ── Live camera viewfinder ─────────────────────────── */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        accessibilityLabel="Live camera viewfinder for obstacle detection"
        accessibilityElementsHidden={true}   // camera itself is not tappable
      />

      {/* ── Obstacle bounding-box overlay ─────────────────── */}
      <ObstacleOverlay obstacles={obstacles} frameWidth={width} frameHeight={height} />

      {/* ── State indicator banner ─────────────────────────── */}
      <StateIndicator state={appState} />

      {/* ── Obstacle summary (screen reader) ──────────────── */}
      <View
        style={styles.obstacleBar}
        accessibilityLabel={
          obstacles.length
            ? `${obstacles.length} obstacle${obstacles.length > 1 ? "s" : ""} detected. Nearest: ${obstacles[0]?.class_label} ${obstacles[0]?.distance_hint}`
            : "No obstacles detected"
        }
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.obstacleText} numberOfLines={2}>
          {obstacles.length
            ? `⚠ ${obstacles[0].class_label} — ${obstacles[0].distance_hint}`
            : "Path clear"}
        </Text>
      </View>

      {/* ── Voice command button ───────────────────────────── */}
      {/* Large target (120×120) for low motor control users. */}
      <TouchableOpacity
        style={[styles.voiceButton, isListening && styles.voiceButtonActive]}
        onPressIn={startListening}
        onPressOut={stopListeningAndDispatch}
        activeOpacity={0.8}
        accessibilityLabel={voiceButtonLabel}
        accessibilityHint="Say a command like: What is in front of me, Navigate to, or Read this"
        accessibilityRole="button"
        accessible={true}
      >
        <Text style={styles.voiceButtonIcon}>{isListening ? "🎙" : "🎤"}</Text>
        <Text style={styles.voiceButtonText}>{isListening ? "Listening…" : "Hold to Speak"}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },

  // ── Obstacle banner ───────────────────────────────────────
  obstacleBar: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#FF3B30",    // high-contrast red — WCAG AA compliant on black
  },
  obstacleText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  // ── Voice button ──────────────────────────────────────────
  voiceButton: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#007AFF",    // iOS blue — easily distinguishable
    alignItems: "center",
    justifyContent: "center",
    // Elevation / shadow for depth cue
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  voiceButtonActive: {
    backgroundColor: "#FF3B30",    // switches to red when actively recording
    transform: [{ scale: 1.08 }],
  },
  voiceButtonIcon: {
    fontSize: 36,
  },
  voiceButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
    textAlign: "center",
  },

  // ── Permission screen ────────────────────────────────────
  permissionText: {
    color: "#FFF",
    fontSize: 18,
    textAlign: "center",
    marginHorizontal: 32,
    marginTop: 48,
    lineHeight: 28,
  },
  permissionButton: {
    marginTop: 32,
    backgroundColor: "#007AFF",
    marginHorizontal: 48,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
    minHeight: 56,      // WCAG 2.5.5 minimum touch target
  },
  permissionButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700",
  },
});
