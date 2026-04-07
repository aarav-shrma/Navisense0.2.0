/**
 * NaviSense Mobile · Global State Store (Zustand)
 * ─────────────────────────────────────────────────
 * Mirrors the server-side FSM state locally so the UI can react
 * to state transitions without an extra round-trip.
 *
 * AppState enum mirrors NaviSenseFSM in ai-service/app/routers/voice.py
 */
import { create } from "zustand";

export const AppState = Object.freeze({
  IDLE:        "IDLE",
  LISTENING:   "LISTENING",
  NAVIGATING:  "NAVIGATING",
  RECOGNIZING: "RECOGNIZING",
  READING:     "READING",
  CROSSING:    "CROSSING",
  EMERGENCY:   "EMERGENCY",
});

export const useNaviStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────
  user: null,
  setUser: (user) => set({ user }),

  // ── FSM state (kept in sync with server FSM) ──────────────
  appState: AppState.IDLE,
  setAppState: (appState) => set({ appState }),

  // ── Detected obstacles (Module A) ─────────────────────────
  obstacles: [],         // List[BoundingBox] — mirrored from YOLO response
  setObstacles: (obstacles) => set({ obstacles }),

  // ── Navigation (Module A) ─────────────────────────────────
  navigationPath: null,  // list of NavigationStep
  currentStepIndex: 0,
  setNavigationPath: (path) => set({ navigationPath: path, currentStepIndex: 0 }),
  advanceStep: () => {
    const { currentStepIndex, navigationPath } = get();
    if (navigationPath && currentStepIndex < navigationPath.length - 1) {
      set({ currentStepIndex: currentStepIndex + 1 });
    } else {
      set({ appState: AppState.IDLE, navigationPath: null });
    }
  },

  // ── Recognition (Module B) ────────────────────────────────
  lastRecognizedFaces: [],
  setRecognizedFaces: (faces) => set({ lastRecognizedFaces: faces }),

  // ── OCR (Module B) ────────────────────────────────────────
  lastOCRText: "",
  setOCRText: (text) => set({ lastOCRText: text }),

  // ── Voice (Module C) ──────────────────────────────────────
  isListening: false,
  setListening: (v) => set({ isListening: v }),
  lastCommand: null,
  setLastCommand: (cmd) => set({ lastCommand: cmd }),

  // ── User preferences ─────────────────────────────────────
  preferences: {
    tts_speed: 1.0,
    obstacle_alert_distance: "near",
    high_contrast_ui: true,
    font_size: "large",
    prefer_accessible_routes: true,
  },
  setPreferences: (prefs) => set((s) => ({ preferences: { ...s.preferences, ...prefs } })),
}));
