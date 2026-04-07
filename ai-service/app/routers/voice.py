"""
NaviSense · Module C: AI Voice Assistant (NLP Pipeline)
════════════════════════════════════════════════════════
DSA used:
  • Trie (Prefix Tree)  — O(L) command lookup, where L = word length
  • Queue (deque)       — FIFO command buffer; sequential, drop-free processing
  • Stack (list)        — LIFO conversation context; resolves pronouns like "it" / "that"
  • Finite State Machine (FSM) — governs application mode transitions

Full pipeline:  Audio → Whisper STT → FSM/Trie dispatch → action → Coqui TTS → Audio
"""
import asyncio
from collections import deque
from enum import Enum, auto
from typing import Optional

from fastapi import APIRouter, File, UploadFile, HTTPException
from pydantic import BaseModel
from loguru import logger

router = APIRouter()


# ══════════════════════════════════════════════════════════════
#  DATA STRUCTURE 1: TRIE (PREFIX TREE)
# ══════════════════════════════════════════════════════════════

class TrieNode:
    """Single node in the Trie. Each node holds a character and children map."""
    __slots__ = ("children", "command", "is_terminal")

    def __init__(self):
        self.children: dict[str, "TrieNode"] = {}
        self.command: Optional[str] = None    # payload stored at terminal nodes
        self.is_terminal: bool = False


class CommandTrie:
    """
    Trie (Prefix Tree) for fast, typo-tolerant command routing.

    Stores canonical command phrases as paths through the tree.
    A recognised utterance is tokenised → words traverse the trie.
    The trie handles prefix matching, enabling partial-command completion
    and graceful degradation for mispronunciation.

    Insert time: O(L)  — L = number of words in command
    Search time: O(L)  — much faster than scanning a flat list
    """

    def __init__(self):
        self.root = TrieNode()

    def insert(self, phrase: str, command_id: str) -> None:
        """Insert a command phrase (space-tokenised words) into the trie."""
        node = self.root
        for word in phrase.lower().split():
            node = node.children.setdefault(word, TrieNode())
        node.is_terminal = True
        node.command = command_id

    def search(self, phrase: str) -> Optional[str]:
        """
        Exact phrase lookup. Returns command_id or None.
        Used after Levenshtein fuzzy-correction resolves the utterance.
        """
        node = self.root
        for word in phrase.lower().split():
            if word not in node.children:
                return None
            node = node.children[word]
        return node.command if node.is_terminal else None

    def starts_with(self, prefix: str) -> list[str]:
        """
        Return all commands reachable from a given prefix.
        Enables real-time command suggestion as the user speaks.

        Time: O(L + K), where K = number of matching commands.
        """
        node = self.root
        for word in prefix.lower().split():
            if word not in node.children:
                return []
            node = node.children[word]
        return self._collect(node)

    def _collect(self, node: TrieNode) -> list[str]:
        result = []
        if node.is_terminal and node.command:
            result.append(node.command)
        for child in node.children.values():
            result.extend(self._collect(child))
        return result


# ── Pre-built command trie ────────────────────────────────────
COMMAND_TRIE = CommandTrie()
_commands = {
    "what is in front of me":     "CMD_DETECT_OBSTACLES",
    "what do i see":              "CMD_DETECT_OBSTACLES",
    "who is this":                "CMD_RECOGNIZE_FACE",
    "navigate to":                "CMD_START_NAVIGATION",
    "how far is it":              "CMD_QUERY_DISTANCE",
    "read this":                  "CMD_OCR",
    "read the sign":              "CMD_OCR",
    "stop navigation":            "CMD_STOP_NAVIGATION",
    "is it safe to cross":        "CMD_SAFE_CROSSING",
    "call for help":              "CMD_EMERGENCY",
    "describe my surroundings":   "CMD_DETECT_OBSTACLES",
}
for phrase, cmd_id in _commands.items():
    COMMAND_TRIE.insert(phrase, cmd_id)


# ══════════════════════════════════════════════════════════════
#  DATA STRUCTURE 2: COMMAND QUEUE (FIFO)
# ══════════════════════════════════════════════════════════════

class CommandQueue:
    """
    FIFO queue (collections.deque) for sequential voice command processing.

    Guarantees no command is lost or reordered — critical when the user
    issues rapid sequential commands (e.g., "Read this. Now navigate to pharmacy.").

    deque is preferred over list for O(1) popleft() (vs O(N) for list.pop(0)).
    maxlen caps memory usage if the AI service is temporarily slow.
    """

    def __init__(self, maxlen: int = 50):
        self._queue: deque[dict] = deque(maxlen=maxlen)
        self._lock = asyncio.Lock()

    async def enqueue(self, command: dict) -> None:
        async with self._lock:
            if len(self._queue) == self._queue.maxlen:
                logger.warning("Command queue full — oldest command discarded")
            self._queue.append(command)

    async def dequeue(self) -> Optional[dict]:
        async with self._lock:
            return self._queue.popleft() if self._queue else None

    @property
    def size(self) -> int:
        return len(self._queue)


# ══════════════════════════════════════════════════════════════
#  DATA STRUCTURE 3: CONTEXT STACK (LIFO)
# ══════════════════════════════════════════════════════════════

class ConversationContext:
    """
    LIFO stack that tracks conversational context across sequential commands.

    Example:
        User: "What is in front of me?"   → push {subject: "obstacle", detail: "car"}
        User: "How far is it?"            → peek stack → resolve "it" = "car"
        User: "Navigate around it"        → peek stack → resolve "it" = "car"

    Without context, the second command "How far is it?" is ambiguous.
    The stack allows the FSM to resolve pronouns to their most recent referent.

    Stack depth limit prevents memory leaks in long sessions.
    """
    MAX_DEPTH = 20

    def __init__(self):
        self._stack: list[dict] = []

    def push(self, context: dict) -> None:
        if len(self._stack) >= self.MAX_DEPTH:
            self._stack.pop(0)  # evict oldest if at capacity (bounded stack)
        self._stack.append(context)

    def peek(self) -> Optional[dict]:
        return self._stack[-1] if self._stack else None

    def pop(self) -> Optional[dict]:
        return self._stack.pop() if self._stack else None

    def clear(self) -> None:
        self._stack.clear()

    @property
    def depth(self) -> int:
        return len(self._stack)


# ══════════════════════════════════════════════════════════════
#  DATA STRUCTURE 4: FINITE STATE MACHINE (FSM)
# ══════════════════════════════════════════════════════════════

class AppState(Enum):
    """Enumeration of all valid application states."""
    IDLE           = auto()   # Waiting for wake word
    LISTENING      = auto()   # Actively capturing audio
    NAVIGATING     = auto()   # Turn-by-turn navigation active
    RECOGNIZING    = auto()   # Face / object recognition active
    READING        = auto()   # OCR / text-reading active
    CROSSING       = auto()   # Safe-crossing analysis active
    EMERGENCY      = auto()   # SOS mode — high priority

# Valid transitions: {current_state: set_of_allowed_next_states}
_VALID_TRANSITIONS: dict[AppState, set[AppState]] = {
    AppState.IDLE:        {AppState.LISTENING},
    AppState.LISTENING:   {AppState.NAVIGATING, AppState.RECOGNIZING, AppState.READING,
                           AppState.CROSSING, AppState.EMERGENCY, AppState.IDLE},
    AppState.NAVIGATING:  {AppState.LISTENING, AppState.IDLE, AppState.EMERGENCY},
    AppState.RECOGNIZING: {AppState.LISTENING, AppState.IDLE, AppState.EMERGENCY},
    AppState.READING:     {AppState.LISTENING, AppState.IDLE, AppState.EMERGENCY},
    AppState.CROSSING:    {AppState.NAVIGATING, AppState.IDLE, AppState.EMERGENCY},
    AppState.EMERGENCY:   {AppState.IDLE},   # only manual reset exits emergency
}

class NaviSenseFSM:
    """
    Finite State Machine governing the application lifecycle.

    Only allows transitions defined in _VALID_TRANSITIONS, preventing
    impossible state combinations (e.g., CROSSING while NAVIGATING).
    Invalid transitions are logged and silently rejected — the device
    remains in a valid state rather than throwing an unhandled exception.
    """

    def __init__(self):
        self.state = AppState.IDLE
        self._history: list[AppState] = [AppState.IDLE]

    def transition(self, new_state: AppState) -> bool:
        """
        Attempt a state transition.
        Returns True on success, False if the transition is invalid.
        """
        if new_state in _VALID_TRANSITIONS.get(self.state, set()):
            logger.debug(f"FSM: {self.state.name} → {new_state.name}")
            self.state = new_state
            self._history.append(new_state)
            return True
        logger.warning(f"FSM: Invalid transition {self.state.name} → {new_state.name} (rejected)")
        return False

    def command_to_state(self, command_id: str) -> Optional[AppState]:
        """Map a recognised command to the target application state."""
        mapping = {
            "CMD_DETECT_OBSTACLES": AppState.RECOGNIZING,
            "CMD_RECOGNIZE_FACE":   AppState.RECOGNIZING,
            "CMD_START_NAVIGATION": AppState.NAVIGATING,
            "CMD_STOP_NAVIGATION":  AppState.IDLE,
            "CMD_OCR":              AppState.READING,
            "CMD_SAFE_CROSSING":    AppState.CROSSING,
            "CMD_EMERGENCY":        AppState.EMERGENCY,
        }
        return mapping.get(command_id)


# ── Global singletons ─────────────────────────────────────────
_fsm = NaviSenseFSM()
_cmd_queue = CommandQueue()
_context_stack = ConversationContext()


# ══════════════════════════════════════════════════════════════
#  STT / TTS STUBS
#  Replace with Whisper (STT) and Coqui TTS in production.
# ══════════════════════════════════════════════════════════════

async def speech_to_text(audio_bytes: bytes) -> str:
    """
    Whisper STT stub.
    Production: load whisper.load_model("base") at startup (≈ 140 MB on VRAM).
    Returns transcribed text string.

    LATENCY NOTE: Whisper "base" runs in ~200–400 ms on RTX 3050.
    Use "tiny" model (39 M params) for < 150 ms if accuracy is acceptable.
    """
    # TODO: import whisper; model.transcribe(audio_bytes)
    return "what is in front of me"   # stub


async def text_to_speech(text: str) -> bytes:
    """
    Coqui TTS stub.
    Production: TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC")
    Returns WAV bytes ready for the mobile client to play.

    LATENCY NOTE: Synthesise asynchronously so navigation continues while
    audio is being generated — never block the main loop on TTS.
    """
    # TODO: tts.tts_to_file(text=text, file_path=tmp_path)
    return b""   # stub


def levenshtein_distance(s1: str, s2: str) -> int:
    """
    Dynamic programming Levenshtein distance for fuzzy command correction.
    Handles mispronunciations by finding the command phrase with minimum edit distance.
    Time: O(|s1| × |s2|)
    """
    m, n = len(s1), len(s2)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            temp = dp[j]
            if s1[i - 1] == s2[j - 1]:
                dp[j] = prev
            else:
                dp[j] = 1 + min(prev, dp[j], dp[j - 1])
            prev = temp
    return dp[n]


def fuzzy_match_command(utterance: str) -> Optional[str]:
    """
    Try exact Trie lookup first; fall back to Levenshtein fuzzy matching.
    Returns matched command_id or None if confidence is too low.
    """
    exact = COMMAND_TRIE.search(utterance)
    if exact:
        return exact

    best_cmd, best_dist = None, 999
    for phrase, cmd_id in _commands.items():
        dist = levenshtein_distance(utterance.lower(), phrase)
        if dist < best_dist:
            best_dist, best_cmd = dist, cmd_id

    # Accept fuzzy match only if edit distance is within 30% of phrase length
    if best_dist <= len(utterance) * 0.30:
        logger.debug(f"Fuzzy match: '{utterance}' → '{best_cmd}' (dist={best_dist})")
        return best_cmd
    return None


# ══════════════════════════════════════════════════════════════
#  API ENDPOINTS
# ══════════════════════════════════════════════════════════════

class VoiceCommandResponse(BaseModel):
    transcription: str
    command_id: Optional[str]
    app_state: str
    context_depth: int
    suggestions: list[str]
    tts_response: str


@router.post("/command", response_model=VoiceCommandResponse, summary="Process voice command audio")
async def process_voice_command(audio: UploadFile = File(..., description="WAV/OGG audio of user command")):
    """
    Full voice pipeline:
    1. STT → transcribe audio to text
    2. Trie/Levenshtein → resolve to canonical command
    3. Queue → enqueue command for sequential processing
    4. FSM → attempt state transition
    5. Context Stack → push/resolve conversational context
    6. TTS → synthesise spoken response

    ERROR HANDLING: If STT returns an empty string (silence / noise),
    respond with a gentle reprompt rather than crashing.
    """
    raw_audio = await audio.read()

    # Step 1: STT
    utterance = await speech_to_text(raw_audio)
    if not utterance.strip():
        return VoiceCommandResponse(
            transcription="",
            command_id=None,
            app_state=_fsm.state.name,
            context_depth=_context_stack.depth,
            suggestions=[],
            tts_response="Sorry, I didn't catch that. Could you repeat?",
        )

    # Step 2: Command resolution (Trie → fuzzy fallback)
    command_id = fuzzy_match_command(utterance)

    # Step 3: Enqueue
    await _cmd_queue.enqueue({"utterance": utterance, "command_id": command_id})

    # Step 4: FSM transition
    tts_response = ""
    if command_id:
        target_state = _fsm.command_to_state(command_id)
        if target_state:
            _fsm.transition(target_state)

        # Step 5: Context stack management
        context = {"command": command_id, "utterance": utterance, "state": _fsm.state.name}
        _context_stack.push(context)

        tts_response = _build_tts_response(command_id, utterance)
    else:
        # Pronoun resolution: "How far is it?" → peek stack to find referent
        prev = _context_stack.peek()
        if prev and "how far" in utterance.lower():
            tts_response = f"Based on what I detected earlier ({prev.get('utterance', 'that')}), I'm checking the distance."
        else:
            suggestions = COMMAND_TRIE.starts_with(utterance.split()[0] if utterance.split() else "")
            tts_response = "I didn't understand. Try saying: " + (suggestions[0] if suggestions else "What is in front of me?")

    # Step 6: TTS (fire and forget — non-blocking)
    asyncio.create_task(text_to_speech(tts_response))

    return VoiceCommandResponse(
        transcription=utterance,
        command_id=command_id,
        app_state=_fsm.state.name,
        context_depth=_context_stack.depth,
        suggestions=COMMAND_TRIE.starts_with(utterance.split()[0]) if utterance.split() else [],
        tts_response=tts_response,
    )


def _build_tts_response(command_id: str, utterance: str) -> str:
    """Map a command to a natural spoken response that will be read aloud to the user."""
    responses = {
        "CMD_DETECT_OBSTACLES": "Scanning your environment. Please hold.",
        "CMD_RECOGNIZE_FACE":   "Looking for a familiar face. One moment.",
        "CMD_START_NAVIGATION": "Starting navigation. I'll guide you step by step.",
        "CMD_STOP_NAVIGATION":  "Navigation stopped.",
        "CMD_OCR":              "Reading the text now.",
        "CMD_SAFE_CROSSING":    "Analysing traffic. I'll tell you when it's safe to cross.",
        "CMD_QUERY_DISTANCE":   "Checking the distance to the nearest obstacle.",
        "CMD_EMERGENCY":        "Calling for help immediately.",
    }
    return responses.get(command_id, "Processing your request.")


@router.get("/state", summary="Get current FSM state and command queue depth")
async def get_state():
    return {
        "app_state": _fsm.state.name,
        "queue_depth": _cmd_queue.size,
        "context_depth": _context_stack.depth,
        "valid_next_states": [s.name for s in _VALID_TRANSITIONS.get(_fsm.state, set())],
    }
