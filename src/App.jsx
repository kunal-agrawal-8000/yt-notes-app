import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

/**
 * YouTube Study App (Local Only)
 * - Paste & play YouTube links (YouTube Iframe API, no DB)
 * - Time-synced controls (seek/jump)
 * - Auto-resume per video (persist last watch time)
 * - Timestamped notes (Markdown + preview)
 * - Bookmarks (title, tag, color, jump, drag-reorder)
 * - Projects/Collections (organize many videos)
 * - Search in notes
 * - Export/Import JSON + Export Markdown
 * - Reminders (local Notification API)
 * - Dark/Light Mode, Focus Mode, Hotkeys
 * - All data stored in localStorage (no backend/database)
 *
 * FIX: Guarded player API calls so we never call undefined methods like
 * getCurrentTime()/getPlayerState when the Iframe API isn’t ready.
 */

// ----------------------------- Helpers ---------------------------------
const LS_KEY = "yt_study_app_state_v1";

// const defaultState = {
//     theme: "system", // "light" | "dark" | "system"
//     compact: false,
//     distractionFree: false,
//     projects: [
//         {
//             id: cryptoRandomId(),
//             name: "My First Study Set",
//             videos: [],
//             createdAt: Date.now(),
//         },
//     ],
//     currentProjectId: null,
// };

function cryptoRandomId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2);
}

function parseYouTubeId(urlOrId) {
    if (!urlOrId) return null;
    // If it's already a plain 11-char id, return as-is
    if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
    try {
        const u = new URL(urlOrId);
        if (u.hostname === "youtu.be") return u.pathname.slice(1);
        if (u.hostname.includes("youtube.com")) {
            const v = u.searchParams.get("v");
            if (v) return v;
            const match = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
            if (match) return match[1];
        }
    } catch (e) {
        // not a URL, fallthrough
    }
    return null;
}

function formatTime(t) {
    if (isNaN(t) || t == null) return "0:00";
    t = Math.floor(t);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function markdownToHtml(md) {
    // Lightweight markdown: **bold**, *italic*, `code`, - lists, # headers, [text](url)
    let html = md || "";
    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/^###### (.*)$/gm, '<h6 class="text-sm font-semibold">$1</h6>');
    html = html.replace(/^##### (.*)$/gm, '<h5 class="text-base font-semibold">$1</h5>');
    html = html.replace(/^#### (.*)$/gm, '<h4 class="text-lg font-semibold">$1</h4>');
    html = html.replace(/^### (.*)$/gm, '<h3 class="text-xl font-semibold">$1</h3>');
    html = html.replace(/^## (.*)$/gm, '<h2 class="text-2xl font-semibold">$1</h2>');
    html = html.replace(/^# (.*)$/gm, '<h1 class="text-3xl font-bold">$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10">$1</code>');
    html = html.replace(/^\s*- (.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul class="list-disc pl-5 space-y-1">${block}</ul>`);
    html = html.replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a class="underline" target="_blank" rel="noreferrer" href="$2">$1<\/a>');
    html = html.replace(/\n/g, '<br/>');
    return html;
}

function downloadFile(filename, content, type = "application/json") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function useLocalState() {
    const [state, setState] = useState(() => {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) return JSON.parse(raw);
        } catch { }
        const s = { ...defaultState };
        s.currentProjectId = s.projects[0].id;
        return s;
    });

    useEffect(() => {
        localStorage.setItem(LS_KEY, JSON.stringify(state));
    }, [state]);

    return [state, setState];
}

// --------------------------- YouTube Player ------------------------------
function useYouTube(playerId, videoId, onReady) {
    const playerRef = useRef(null);

    // Helper: check if player method exists before calling
    const has = (method) => playerRef.current && typeof playerRef.current[method] === "function";

    useEffect(() => {
        // Load Iframe API once
        if (!window.YT) {
            const tag = document.createElement("script");
            tag.src = "https://www.youtube.com/iframe_api";
            document.body.appendChild(tag);
        }

        function create() {
            if (!videoId) return;
            if (playerRef.current && has("destroy")) {
                try { playerRef.current.destroy(); } catch { }
                playerRef.current = null;
            }
            playerRef.current = new window.YT.Player(playerId, {
                height: "100%",
                width: "100%",
                videoId,
                playerVars: {
                    modestbranding: 1,
                    rel: 0,
                    enablejsapi: 1,
                    origin: window.location.origin,
                },
                events: {
                    onReady: () => {
                        onReady && onReady(playerRef.current);
                    },
                    onStateChange: (e) => {
                        try {
                            const YT = window.YT;
                            if (!YT || !YT.PlayerState) return;
                            if (e.data === YT.PlayerState.PLAYING) {
                                // eslint-disable-next-line no-console
                                console.log("play");
                            } else if (e.data === YT.PlayerState.PAUSED) {
                                // eslint-disable-next-line no-console
                                console.log("pause");
                            }
                        } catch {}
                    },
                },
            });
        }

        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            prev && prev();
            if (window.YT && window.YT.Player) create();
        };
        if (window.YT && window.YT.Player) create();

        return () => {
            window.onYouTubeIframeAPIReady = prev || undefined;
            if (playerRef.current && has("destroy")) {
                try { playerRef.current.destroy(); } catch { }
                playerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playerId, videoId]);

    return {
        getCurrentTime: () => (has("getCurrentTime") ? Math.floor(playerRef.current.getCurrentTime() || 0) : 0),
        seekTo: (t) => { if (has("seekTo")) try { playerRef.current.seekTo(t, true); } catch { } },
        play: () => { if (has("playVideo")) try { playerRef.current.playVideo(); } catch { } },
        pause: () => { if (has("pauseVideo")) try { playerRef.current.pauseVideo(); } catch { } },
        getPlayerState: () => (has("getPlayerState") ? playerRef.current.getPlayerState() : -1),
        isReady: () => !!(playerRef.current && has("getPlayerState")),
        player: playerRef,
    };
}

// ----------------------------- Main App ---------------------------------
export default function App() {
    const [state, setState] = useLocalState();
    const currentProject = useMemo(
        () => state.projects.find((p) => p.id === state.currentProjectId) || state.projects[0],
        [state.projects, state.currentProjectId]
    );
    const [urlInput, setUrlInput] = useState("");
    const [currentVideoId, setCurrentVideoId] = useState(null);
    const [currentVideo, setCurrentVideo] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [noteDraft, setNoteDraft] = useState("");
    const [notePreview, setNotePreview] = useState(false);
    const [bookmarkTitle, setBookmarkTitle] = useState("");
    const [bookmarkTag, setBookmarkTag] = useState("");
    const [bookmarkColor, setBookmarkColor] = useState("emerald");
    const [playerSeconds, setPlayerSeconds] = useState(0); // live ticker display

    const [isVideoplay, setIsVideoplay] = useState(false);

    const playerContainerId = "yt-player-container";
    const { getCurrentTime, seekTo, play, pause, isReady, getPlayerState, player } = useYouTube(
        playerContainerId,
        currentVideoId,
        (p) => {
            // Auto-resume (guarding the API call)
            const t = currentVideo?.lastTime || 0;
            if (t > 0) {
                setTimeout(() => {
                    try { seekTo(t); } catch { }
                }, 500);
            }
        }
    );

    // Unified control: playPause("play" | "pause" | "toggle")
    const playPause = useCallback((mode = "toggle") => {
        if (!isReady()) return;
        const state = getPlayerState();
        if (mode === "play") {
            play();
            setIsVideoplay(true);
        } else if (mode === "pause") {
            pause();
            setIsVideoplay(false);
        } else {
            state === 1 ? (pause(), setIsVideoplay(false)) : (play(), setIsVideoplay(true));
        }
    }, [getPlayerState, isReady, pause, play]);

    // Expose globally if needed (e.g., window.playPause("play"))
    useEffect(() => {
        window.playPause = playPause;
        return () => { if (window.playPause === playPause) delete window.playPause; };
    }, [playPause]);



    // Live ticker: update displayed current time every 500ms when player is ready
    useEffect(() => {
        const iv = setInterval(() => {
            setPlayerSeconds(getCurrentTime());
        }, 500);
        return () => clearInterval(iv);
    }, [getCurrentTime]);

    // Update currentVideo when id changes
    useEffect(() => {
        if (!currentProject) return;
        const v = currentProject?.videos.find((v) => v.videoId === currentVideoId) || null;
        setCurrentVideo(v);
    }, [currentVideoId, currentProject]);

    // Persist last watch time every 3s while player is ready
    useEffect(() => {
        const int = setInterval(() => {
            if (currentVideoId && isReady()) {
                const t = getCurrentTime();
                setState((s) => ({
                    ...s,
                    projects: s.projects.map((p) =>
                        p.id !== currentProject.id
                            ? p
                            : {
                                ...p,
                                videos: p.videos.map((v) =>
                                    v.videoId === currentVideoId ? { ...v, lastTime: t } : v
                                ),
                            }
                    ),
                }));
            }
        }, 3000);
        return () => clearInterval(int);
    }, [currentVideoId, isReady, getCurrentTime, currentProject?.id, setState]);

    // Hotkeys
    useEffect(() => {
        function onKey(e) {
            if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
            if (e.key === " ") { // space to play/pause
                e.preventDefault();
                playPause("toggle");
            }
            if (e.key === "n") {
                e.preventDefault();
                handleAddNote("prompt");
            }
            if (e.key === "b") {
                e.preventDefault();
                handleAddBookmark();
            }
            if (e.key === "ArrowRight") seekTo(getCurrentTime() + 5);
            if (e.key === "ArrowLeft") seekTo(Math.max(0, getCurrentTime() - 5));
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [getCurrentTime, seekTo, play, pause, getPlayerState]);

    // // Theme handling
    // useEffect(() => {
    //     const root = document.documentElement;
    //     const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    //     const useDark = state.theme === "dark" || (state.theme === "system" && prefersDark);
    //     root.classList.toggle("dark", useDark);
    // }, [state.theme]);

    const filteredNotes = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        if (!currentVideo) return [];
        if (!q) return currentVideo.notes;
        return currentVideo.notes.filter((n) => (n.text || "").toLowerCase().includes(q));
    }, [searchTerm, currentVideo]);

    function ensureProjectSelected() {
        if (!state.currentProjectId) {
            setState((s) => ({ ...s, currentProjectId: s.projects[0]?.id }));
        }
    }

    function handleAddProject() {
        const name = prompt("Project name?");
        if (!name) return;
        const proj = { id: cryptoRandomId(), name, videos: [], createdAt: Date.now() };
        setState((s) => ({
            ...s,
            projects: [...s.projects, proj],
            currentProjectId: proj.id,
        }));
    }

    function handleRenameProject() {
        if (!currentProject) return;
        const name = prompt("Rename project:", currentProject.name);
        if (!name) return;
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) => (p.id === currentProject.id ? { ...p, name } : p)),
        }));
    }

    function handleDeleteProject() {
        if (!currentProject) return;
        if (!confirm(`Delete project "${currentProject.name}"?`)) return;
        setState((s) => {
            const others = s.projects.filter((p) => p.id !== currentProject.id);
            return {
                ...s,
                projects: others.length ? others : [{ id: cryptoRandomId(), name: "New Project", videos: [], createdAt: Date.now() }],
                currentProjectId: others[0]?.id || null,
            };
        });
    }

    function handleAddVideo() {
        ensureProjectSelected();
        const vid = parseYouTubeId(urlInput.trim());
        if (!vid) return alert("Please paste a valid YouTube link or ID.");
        const exists = currentProject.videos.some((v) => v.videoId === vid);
        const meta = {
            id: cryptoRandomId(),
            title: "Untitled Video",
            videoId: vid,
            source: urlInput.trim(),
            notes: [],
            bookmarks: [],
            lastTime: 0,
            createdAt: Date.now(),
        };
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id === currentProject.id
                    ? { ...p, videos: exists ? p.videos : [meta, ...p.videos] }
                    : p
            ),
        }));
        setCurrentVideoId(vid);
        setUrlInput("");
    }

    function handleSetTitle() {
        if (!currentVideo) return;
        const t = prompt("Video title:", currentVideo.title || "");
        if (t == null) return;
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) => (v.videoId === currentVideo.videoId ? { ...v, title: t } : v)),
                    }
            ),
        }));
    }

    function handleRemoveVideo(vid) {
        if (!confirm("Remove this video from project?")) return;
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id ? p : { ...p, videos: p.videos.filter((v) => v.videoId !== vid) }
            ),
        }));
        if (currentVideoId === vid) setCurrentVideoId(null);
    }

    function handleAddNote(type) {
        if (!currentVideo) return;
        const t = getCurrentTime();
        const id = cryptoRandomId();
        let text = noteDraft.trim();
        if (type == "input") {
            if (!text) return alert("Write a note first.");
        }else if (type === "prompt") {
            const promptText = prompt("Enter your note:");
            if (!promptText) return alert("Note cannot be empty.");
            text = promptText;
        }else {
            if (!text) return alert("Note cannot be empty.");
        }
        const note = { id, t, text, createdAt: Date.now(), updatedAt: Date.now() };
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId ? { ...v, notes: [note, ...v.notes] } : v
                        ),
                    }
            ),
        }));
        setNoteDraft("");
    }

    function handleDeleteNote(id) {
        if (!currentVideo) return;
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId ? { ...v, notes: v.notes.filter((n) => n.id !== id) } : v
                        ),
                    }
            ),
        }));
    }

    function handleEditNote(id) {
        const n = currentVideo?.notes.find((x) => x.id === id);
        if (!n) return;
        const text = prompt("Edit note (Markdown supported):", n.text);
        if (text == null) return;
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId
                                ? {
                                    ...v,
                                    notes: v.notes.map((m) => (m.id === id ? { ...m, text, updatedAt: Date.now() } : m)),
                                }
                                : v
                        ),
                    }
            ),
        }));
    }

    function handleAddBookmark() {
        if (!currentVideo) return;
        const t = getCurrentTime();
        const title = (bookmarkTitle || "Bookmark").trim();
        const tag = bookmarkTag.trim();
        const color = bookmarkColor || "emerald";
        const b = { id: cryptoRandomId(), t, title, tag, color, createdAt: Date.now() };
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId ? { ...v, bookmarks: [b, ...v.bookmarks] } : v
                        ),
                    }
            ),
        }));
        setBookmarkTitle("");
        setBookmarkTag("");
    }

    function handleDeleteBookmark(id) {
        if (!currentVideo) return;
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId
                                ? { ...v, bookmarks: v.bookmarks.filter((b) => b.id !== id) }
                                : v
                        ),
                    }
            ),
        }));
    }

    // Drag & drop for bookmarks
    function onDragStart(e, id) {
        e.dataTransfer.setData("text/plain", id);
    }
    function onDropBookmark(e) {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (!id || !currentVideo) return;
        const items = [...currentVideo.bookmarks];
        const fromIdx = items.findIndex((b) => b.id === id);
        if (fromIdx < 0) return;
        // insert at top for simplicity (or compute target index)
        const [moved] = items.splice(fromIdx, 1);
        items.splice(0, 0, moved);
        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId ? { ...v, bookmarks: items } : v
                        ),
                    }
            ),
        }));
    }

    function allowDrop(e) { e.preventDefault(); }

    function exportProjectJSON() {
        const data = state.projects.find((p) => p.id === currentProject.id);
        downloadFile(`${currentProject.name.replace(/\s+/g, "_")}.json`, JSON.stringify(data, null, 2));
    }

    function importProjectJSON(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const proj = JSON.parse(reader.result);
                if (!proj || !proj.id || !proj.videos) throw new Error("Invalid file");
                setState((s) => ({ ...s, projects: [...s.projects, proj], currentProjectId: proj.id }));
            } catch (err) {
                alert("Invalid JSON file");
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    }

    function exportVideoMarkdown() {
        if (!currentVideo) return;
        const lines = [];
        lines.push(`# ${currentVideo.title || "Video Notes"}`);
        lines.push("");
        lines.push(`Source: ${currentVideo.source || currentVideo.videoId}`);
        lines.push("");
        lines.push("## Bookmarks");
        currentVideo.bookmarks.forEach((b) => {
            lines.push(`- [${formatTime(b.t)}] ${b.title}${b.tag ? ` (#${b.tag})` : ""}`);
        });
        lines.push("");
        lines.push("## Notes");
        currentVideo.notes.forEach((n) => {
            lines.push(`- [${formatTime(n.t)}] ${n.text.replace(/\n/g, " ")}`);
        });
        downloadFile(`${(currentVideo.title || currentVideo.videoId).replace(/\s+/g, "_")}.md`, lines.join("\n"), "text/markdown");
    }

    function scheduleReminder(payload) {
        let reminderMinutes = prompt("Set reminder in minutes (default 5):", "5");
        if (reminderMinutes === null) return; // Cancelled
        const mins = parseInt(reminderMinutes || 5, 10);
        if (!Number.isFinite(mins) || mins <= 0) return alert("Enter minutes > 0");
        if (!("Notification" in window)) return alert("Notifications not supported in this browser.");
        Notification.requestPermission().then((perm) => {
            if (perm !== "granted") return alert("Notification permission denied.");
            setTimeout(() => {
                new Notification(payload.title, { body: payload.body });
            }, mins * 60 * 1000);
            alert(`Reminder set for ${mins} minute(s).`);
        });

        if (payload?.action === "videoPause") {
            setTimeout(() => {
                playPause("pause");
            }, reminderMinutes * 60 * 1000);
        }
    }

    // ----------------------------- Self Tests ------------------------------
    // Always run lightweight tests once (results in console + optional alert)
    useEffect(() => {
        const results = runSelfTests();
        // Uncomment next line if you want a quick inline summary popup
        // alert(results.join("\n"));
    }, []);

    function runSelfTests() {
        const out = [];

        // parseYouTubeId tests
        const id = "dQw4w9WgXcQ";
        const cases = [
            [id, id],
            ["https://www.youtube.com/watch?v=" + id, id],
            ["https://youtu.be/" + id, id],
            ["https://www.youtube.com/embed/" + id + "?start=30", id],
            ["notaurl", null],
        ];
        cases.forEach(([input, expected], i) => {
            const got = parseYouTubeId(input);
            const pass = got === expected;
            out.push(`parseYouTubeId#${i + 1}: ${pass ? "PASS" : `FAIL (exp ${expected}, got ${got})`}`);
            // eslint-disable-next-line no-console
            if (!pass) console.error("parseYouTubeId test failed", { input, expected, got });
        });

        // formatTime tests
        const tCases = [
            [0, "0:00"],
            [59, "0:59"],
            [60, "1:00"],
            [61, "1:01"],
            [3661, "1:01:01"],
            [NaN, "0:00"]
        ];
        tCases.forEach(([input, expected], i) => {
            const got = formatTime(input);
            const pass = got === expected;
            out.push(`formatTime#${i + 1}: ${pass ? "PASS" : `FAIL (exp ${expected}, got ${got})`}`);
            if (!pass) console.error("formatTime test failed", { input, expected, got });
        });

        // Player method guards (no crashes when not ready)
        try {
            const t = getCurrentTime();
            void t;
            out.push("player guard: PASS (safe getCurrentTime)");
        } catch (e) {
            out.push("player guard: FAIL (getCurrentTime threw)");
        }

        // eslint-disable-next-line no-console
        console.table(out);
        return out;
    }

    return (
        <div className="min-h-screen min-w-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 transition-colors">
            {/* Top Bar */}
            <div className="sticky top-0 z-30 backdrop-blur bg-white/70 dark:bg-neutral-900/70 border-b border-neutral-200 dark:border-neutral-800">
                <div className="max-w-8xl mx-auto px-3 sm:px-6 py-2 flex items-center gap-2">
                    {/* Project Selector */}
                    <div className="flex items-center gap-2">
                        <select
                            className="px-3 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                            value={currentProject?.id || ""}
                            onChange={(e) => setState((s) => ({ ...s, currentProjectId: e.target.value }))}
                        >
                            {state.projects.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        <button onClick={handleAddProject} className="px-3 py-2 rounded-2xl bg-orange-800 text-white! dark:bg-white dark:text-neutral-900">+ Project</button>
                        <button onClick={handleRenameProject} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">Rename</button>
                        <button onClick={handleDeleteProject} className="px-3 py-2 rounded-2xl border border-red-300 text-red-600 dark:border-red-700">Delete</button>
                    </div>

                    {/* URL input */}
                    <div className="flex items-center gap-1">
                        <input
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            placeholder="Paste YouTube link or ID"
                            className="w-full px-4 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                        />
                        <button onClick={handleAddVideo} className="px-4 py-2 rounded-2xl bg-emerald-600 text-white">Add</button>
                    </div>

                    {/* Utilities */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => setState((s) => ({ ...s, distractionFree: !s.distractionFree }))} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">{state.distractionFree ? "Exit Focus" : "Focus Mode"}</button>

                        {/* <select
                            className="px-3 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                            value={state.theme}
                            onChange={(e) => setState((s) => ({ ...s, theme: e.target.value }))}
                        >
                            <option value="system">System</option>
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                        </select> */}

                        <button onClick={exportProjectJSON} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">Export JSON</button>
                        <label className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700 cursor-pointer">
                            Import JSON
                            <input type="file" accept="application/json" className="hidden" onChange={importProjectJSON} />
                        </label>
                        <button onClick={exportVideoMarkdown} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">Export MD</button>
                        <button onClick={() => alert(runSelfTests().join("\n"))} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">Self‑Tests</button>
                    </div>
                </div>
            </div>

            {/* Main Layout */}
            <div className={`max-w-8xl mx-auto px-1 sm:px-6 py-4 grid ${state.distractionFree ? "grid-cols-1" : "md:grid-cols-[2fr_1fr]"
                } gap-4`}>
                {/* Left: Player + Video List */}
                <div className="space-y-4">
                    {/* Player Card */}
                    <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-sm">
                        <div className="aspect-video bg-black">
                            <div id={playerContainerId} className="w-full h-full" />
                        </div>
                        <div className="p-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <button onClick={() => seekTo(Math.max(0, getCurrentTime() - 5))} className="px-3 py-1.5 rounded-xl border">-5s</button>
                                <button onClick={() => playPause("toggle")} className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white! dark:bg-white dark:text-neutral-900">{getPlayerState() === 1 ? "Pause" : "Play"}</button>
                                <button onClick={() => seekTo(getCurrentTime() + 5)} className="px-3 py-1.5 rounded-xl border">+5s</button>
                                <span className="text-sm opacity-70">{formatTime(playerSeconds)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => seekTo(0)} className="px-3 py-1.5 rounded-xl border">Start</button>
                                <button onClick={() => seekTo((currentVideo?.lastTime || 0))} className="px-3 py-1.5 rounded-xl border">Resume</button>
                                <button onClick={handleSetTitle} className="px-3 py-1.5 rounded-xl border">Title</button>
                            </div>
                        </div>
                    </div>

                    {/* Videos in Project */}
                    {!state.distractionFree && (
                        <div className="rounded-2xl p-3 border border-neutral-200 dark:border-neutral-800">
                            <div className="flex items-center justify-between mb-2">
                                <h2 className="text-lg font-semibold">Project Videos</h2>
                                <span className="text-sm opacity-60">{currentProject?.videos.length || 0} items</span>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {currentProject?.videos.map((v) => (
                                    <div key={v.id} className={`p-3 rounded-xl border transition ${currentVideoId === v.videoId ? "border-emerald-400" : "border-neutral-200 dark:border-neutral-800"}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="truncate font-medium">{v.title || v.videoId}</div>
                                                <div className="text-xs opacity-60">Last at {formatTime(v.lastTime || 0)}</div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button onClick={() => setCurrentVideoId(v.videoId)} className="px-2 py-1 rounded-lg border">Open</button>
                                                <button onClick={() => handleRemoveVideo(v.videoId)} className="px-2 py-1 rounded-lg border border-red-300 text-red-600">Remove</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {(!currentProject || currentProject.videos.length === 0) && (
                                    <div className="text-sm opacity-70">No videos yet. Paste a link above and click Add.</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Notes & Bookmarks */}
                {!state.distractionFree && (
                    <div className="space-y-4">
                        <div className="w-full flex justify-center">
                        <button onClick={() => scheduleReminder({ title: `Reminding you for a break`, action: "videoPause" })} className="px-2 py-1 rounded-lg text-white border-2! border-amber-200!">Set break reminder</button>
                        </div>
                        {/* Notes Card */}
                        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                            <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                                <h2 className="text-lg font-semibold">Notes</h2>
                                <input
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search notes..."
                                    className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                                />
                            </div>
                            <div className="p-3 space-y-3">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setNotePreview((x) => !x)} className="px-3 py-1.5 rounded-xl border">{notePreview ? "Edit" : "Preview"}</button>
                                        <button onClick={()=>{handleAddNote("input")}} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white">+ Add Note @ {formatTime(playerSeconds)} (N)</button>
                                    </div>
                                    {!notePreview ? (
                                        <textarea
                                            value={noteDraft}
                                            onChange={(e) => setNoteDraft(e.target.value)}
                                            rows={5}
                                            placeholder="Write note (Markdown supported: **bold**, *italic*, - list, [text](url))"
                                            className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                                        />
                                    ) : (
                                        <div
                                            className="prose prose-neutral dark:prose-invert max-w-none bg-neutral-100 dark:bg-neutral-800 rounded-xl p-3 border border-neutral-200 dark:border-neutral-700"
                                            dangerouslySetInnerHTML={{ __html: markdownToHtml(noteDraft) }}
                                        />
                                    )}
                                </div>

                                <div className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
                                    {filteredNotes.map((n) => (
                                        <div key={n.id} className="p-3 flex items-start gap-3">
                                            <button onClick={() => seekTo(n.t)} className="px-2 py-1 rounded-lg border shrink-0">{formatTime(n.t)}</button>
                                            <div className="flex-1 min-w-0">
                                                <div className="prose prose-neutral dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: markdownToHtml(n.text) }} />
                                                <div className="text-xs opacity-60 mt-1">Updated {new Date(n.updatedAt).toLocaleString()}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => handleEditNote(n.id)} className="px-2 py-1 rounded-lg border">Edit</button>
                                                <button onClick={() => handleDeleteNote(n.id)} className="px-2 py-1 rounded-lg border border-red-300 text-red-600">Delete</button>
                                            </div>
                                        </div>
                                    ))}
                                    {filteredNotes.length === 0 && (
                                        <div className="p-3 text-sm opacity-70">No notes yet.</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Bookmarks */}
                        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden" onDrop={onDropBookmark} onDragOver={allowDrop}>
                            <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                                <h2 className="text-lg font-semibold">Bookmarks</h2>
                                <div className="flex items-center gap-2">
                                    <input
                                        value={bookmarkTitle}
                                        onChange={(e) => setBookmarkTitle(e.target.value)}
                                        placeholder="Title"
                                        className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                                    />
                                    <input
                                        value={bookmarkTag}
                                        onChange={(e) => setBookmarkTag(e.target.value)}
                                        placeholder="Tag (e.g. formula)"
                                        className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                                    />
                                    {/* <select value={bookmarkColor} onChange={(e) => setBookmarkColor(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                    {['emerald','sky','violet','amber','rose','cyan','lime','fuchsia'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select> */}
                                    <button onClick={handleAddBookmark} className="px-3 py-2 rounded-2xl bg-emerald-600 text-white">+ Add (B) @ {formatTime(playerSeconds)}</button>

                                </div>
                            </div>
                            <div className="p-3 grid sm:grid-cols-1 gap-3">
                                {currentVideo?.bookmarks.map((b) => (
                                    <div
                                        key={b.id}
                                        draggable
                                        onDragStart={(e) => onDragStart(e, b.id)}
                                        className={`p-3 rounded-xl border shadow-sm border-${b.color}-300/60 bg-${b.color}-50/40 dark:border-${b.color}-800/60 dark:bg-${b.color}-900/20`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => seekTo(b.t)} className="px-2 py-1 rounded-lg border">{formatTime(b.t)}</button>
                                                <div className="">
                                                    <div className="font-medium truncate max-w-[160px]" title={b.title}>{b.title}</div>
                                                    {b.tag && <div className="text-xs opacity-70">#{b.tag}</div>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => scheduleReminder({ title: `Revisit: ${b.title}`, body: `Jump back to ${formatTime(b.t)} in ${currentVideo?.title || 'video'}` })} className="px-2 py-1 rounded-lg border">Remind</button>
                                                <button onClick={() => handleDeleteBookmark(b.id)} className="px-2 py-1 rounded-lg border border-red-300 text-red-600">Delete</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {(!currentVideo || currentVideo.bookmarks.length === 0) && (
                                    <div className="text-sm opacity-70">No bookmarks yet. Add some above.</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom sticky current video info & quick actions */}
            {currentVideo && (
                <div className="sticky bottom-3 z-20">
                    <div className="max-w-3xl mx-auto rounded-2xl shadow-md backdrop-blur bg-white/80 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 px-3 py-2 flex items-center justify-between gap-2">
                        <div className="truncate">
                            <div className="text-sm opacity-70">Now studying</div>
                            <div className="font-semibold truncate">{currentVideo.title || currentVideo.videoId}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => seekTo(Math.max(0, getCurrentTime() - 10))} className="px-3 py-1.5 rounded-xl border">-10s</button>
                            <button onClick={() => handleAddBookmark()} className="px-3 py-1.5 rounded-xl border">+ Bookmark</button>
                            <button onClick={() => handleAddNote("prompt")} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white">+ Note</button>
                        </div>
                    </div>
                </div>
            )}

            {/* When selecting a video from list: set currentVideoId */}
            <EffectSelectFirstVideo project={currentProject} setCurrentVideoId={setCurrentVideoId} />
        </div>
    );
}

function EffectSelectFirstVideo({ project, setCurrentVideoId }) {
    useEffect(() => {
        if (!project) return;
        if (project.videos.length && !project.videos.some(v => v.videoId === (setCurrentVideoId.__current || null))) {
            setCurrentVideoId(project.videos[0].videoId);
            setCurrentVideoId.__current = project.videos[0].videoId;
        }
    }, [project, setCurrentVideoId]);
    return null;
}
