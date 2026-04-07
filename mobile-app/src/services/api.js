/**
 * NaviSense Mobile · API Service Layer
 * ─────────────────────────────────────
 * All network calls to the API Gateway are centralised here.
 * Handles: auth token injection, timeout management, retry logic.
 *
 * LATENCY NOTE: The gateway timeout is set to 3 s for detection frames.
 * On slow 3G (~1 Mbps), a 200 KB JPEG upload takes ~1.6 s.
 * Consider compressing frames to 80 KB (320×240) before upload.
 */
import axios from "axios";
import { supabase } from "./supabase";

const BASE_URL = process.env.EXPO_PUBLIC_API_GATEWAY_URL || "http://localhost:3001";

// ── Axios instance ───────────────────────────────────────────
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 5000,
});

// ── Request interceptor: inject Supabase JWT ────────────────
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: unified error normalisation ────────
api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const message =
      err.response?.data?.error ||
      (err.code === "ECONNABORTED" ? "Request timed out — check your connection." : "Network error");
    return Promise.reject(new Error(message));
  }
);


// ══════════════════════════════════════════════════════════════
//  MODULE A: Detection & Navigation
// ══════════════════════════════════════════════════════════════

/**
 * Send a camera frame for YOLO obstacle detection.
 * @param {Blob} frameBlob  — JPEG image from Expo Camera
 * @returns {Promise<DetectionResponse>}
 */
export async function detectObstacles(frameBlob) {
  const form = new FormData();
  form.append("frame", frameBlob, "frame.jpg");
  return api.post("/detect/frame", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 3000,   // tight deadline — miss it → skip frame, never block audio
  });
}

/**
 * Request a safe walking path between two graph nodes.
 * @param {string} startNodeId
 * @param {string} goalNodeId
 * @param {boolean} preferAccessible
 */
export async function getNavigationPath(startNodeId, goalNodeId, preferAccessible = true) {
  return api.post("/navigate/path", { start_node_id: startNodeId, goal_node_id: goalNodeId, prefer_accessible: preferAccessible });
}


// ══════════════════════════════════════════════════════════════
//  MODULE B: Recognition & OCR
// ══════════════════════════════════════════════════════════════

export async function recognizeFace(frameBlob) {
  const form = new FormData();
  form.append("frame", frameBlob, "frame.jpg");
  return api.post("/recognize/face", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 4000,
  });
}

export async function enrollFace(name, imageBlob) {
  const form = new FormData();
  form.append("name", name);
  form.append("image", imageBlob, "face.jpg");
  return api.post("/recognize/enroll", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}

export async function readText(frameBlob) {
  const form = new FormData();
  form.append("frame", frameBlob, "frame.jpg");
  return api.post("/recognize/ocr", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 5000,
  });
}


// ══════════════════════════════════════════════════════════════
//  MODULE C: Voice
// ══════════════════════════════════════════════════════════════

export async function sendVoiceCommand(audioBlob) {
  const form = new FormData();
  form.append("audio", audioBlob, "command.wav");
  return api.post("/voice/command", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 5000,
  });
}

export async function getAppState() {
  return api.get("/voice/state");
}


// ══════════════════════════════════════════════════════════════
//  User Preferences
// ══════════════════════════════════════════════════════════════

export async function getMyProfile() {
  return api.get("/users/me");
}

export async function updatePreferences(prefs) {
  return api.patch("/users/preferences", prefs);
}

export async function saveLocation(location) {
  return api.post("/users/locations", location);
}
