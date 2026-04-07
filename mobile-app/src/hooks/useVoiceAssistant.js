/**
 * NaviSense Mobile · useVoiceAssistant Hook
 * ──────────────────────────────────────────
 * Manages the full voice pipeline on the client side:
 *   Press & hold → record audio → send to /voice/command
 *   → receive TTS text → speak aloud → update FSM state
 *
 * The server STT (Whisper) + Trie dispatch + FSM transition happen
 * in the AI service. The hook mirrors the returned app_state into
 * the local Zustand store to drive UI state changes.
 */
import { useRef, useCallback } from "react";
import { Audio } from "expo-av";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import { useNaviStore } from "./useNaviStore";
import { sendVoiceCommand } from "../services/api";

export function useVoiceAssistant() {
  const { preferences, setAppState, setListening, setLastCommand } = useNaviStore();
  const recordingRef = useRef(null);

  // ── Start recording ───────────────────────────────────────
  const startListening = useCallback(async () => {
    try {
      // Request microphone permission
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Speech.speak("Microphone permission is required for voice commands.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setListening(true);

      // Short haptic pulse to confirm listening started
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.error("[useVoiceAssistant] Recording start failed:", err.message);
      Speech.speak("Could not start recording. Please try again.");
    }
  }, [setListening]);

  // ── Stop recording and dispatch ───────────────────────────
  const stopListeningAndDispatch = useCallback(async () => {
    if (!recordingRef.current) return;

    setListening(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      const audioResponse = await fetch(uri);
      const audioBlob = await audioResponse.blob();

      // Send to API Gateway → AI Service voice pipeline
      const result = await sendVoiceCommand(audioBlob);

      // Mirror server FSM state into local store
      setAppState(result.app_state);
      setLastCommand(result.command_id);

      // Speak the TTS response returned by the AI service
      if (result.tts_response) {
        Speech.speak(result.tts_response, {
          rate: preferences.tts_speed,
          language: "en-IN",
        });
      }
    } catch (err) {
      console.warn("[useVoiceAssistant] Command failed:", err.message);
      Speech.speak("Sorry, I could not process that command. Please try again.");
    }
  }, [setListening, setAppState, setLastCommand, preferences.tts_speed]);

  return { startListening, stopListeningAndDispatch };
}
