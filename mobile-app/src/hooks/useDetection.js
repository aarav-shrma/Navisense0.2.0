/**
 * NaviSense Mobile · useDetection Hook
 * ──────────────────────────────────────
 * Drives the real-time obstacle detection loop:
 *   Camera → JPEG frame → API → YOLO → obstacles → TTS alert
 *
 * Uses Expo Camera's takePictureAsync on an interval controlled by
 * the user's detection_frequency_ms preference (default 500 ms).
 *
 * LATENCY NOTE: On a good WiFi connection, round-trip is ~200–400 ms,
 * comfortably within the 500 ms polling window.
 * On poor networks, the hook skips frames (non-blocking) to prevent
 * a backlog that would cause stale / out-of-order obstacle alerts.
 */
import { useEffect, useRef, useCallback } from "react";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import { useNaviStore, AppState } from "./useNaviStore";
import { detectObstacles } from "../services/api";

export function useDetection(cameraRef) {
  const { appState, preferences, setObstacles } = useNaviStore();
  const isRunning = useRef(false);         // prevents concurrent requests
  const intervalRef = useRef(null);

  // ── Build spoken alert from obstacles list ───────────────
  const buildAlert = useCallback((obstacles) => {
    if (!obstacles.length) return null;
    const nearest = obstacles[0];    // already sorted closest-first by AI service
    return `${nearest.distance_hint} ${nearest.class_label} ahead`;
  }, []);

  // ── Single detection cycle ───────────────────────────────
  const runDetection = useCallback(async () => {
    // Skip if camera unavailable, already running, or wrong app state
    if (!cameraRef?.current || isRunning.current) return;
    if (![AppState.IDLE, AppState.NAVIGATING].includes(appState)) return;

    isRunning.current = true;
    try {
      // Capture frame — low quality to minimise upload size & latency
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.4,         // ~60–100 KB JPEG
        skipProcessing: true, // bypass EXIF writing for speed
        base64: false,
      });

      // Convert URI to Blob for multipart upload
      const response = await fetch(photo.uri);
      const frameBlob = await response.blob();

      const result = await detectObstacles(frameBlob);
      setObstacles(result.obstacles || []);

      const alert = buildAlert(result.obstacles || []);
      if (alert) {
        // Haptic + audio alert for the nearest obstacle
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Speech.speak(alert, {
          rate: preferences.tts_speed,
          language: "en-IN",
          // Interrupt any ongoing speech — obstacle alerts are highest priority
          onStart: () => Speech.stop(),
        });
      }
    } catch (err) {
      // LATENCY / NETWORK ERROR: log silently, skip this frame
      // Never surface network errors as modals — it would block the user's navigation.
      console.warn("[useDetection] Frame skipped:", err.message);
    } finally {
      isRunning.current = false;
    }
  }, [appState, cameraRef, buildAlert, preferences.tts_speed, setObstacles]);

  // ── Polling loop ─────────────────────────────────────────
  useEffect(() => {
    const freq = preferences.detection_frequency_ms || 500;
    intervalRef.current = setInterval(runDetection, freq);
    return () => clearInterval(intervalRef.current);
  }, [runDetection, preferences.detection_frequency_ms]);
}
