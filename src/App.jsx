import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

/**
 * YouTube Study App (Local Only) - Clean Version
 * Features:
 * - Individual video & playlist support
 * - Time-synced controls and auto-resume
 * - Timestamped notes with Markdown support
 * - Bookmarks with drag & drop reordering
 * - Projects/Collections organization
 * - Search functionality
 * - Export/Import (JSON & Markdown)
 * - Reminders with Notification API
 * - Focus Mode and hotkeys
 * - All data stored in localStorage
 */

// ----------------------------- Constants & Helpers ---------------------------------
const LS_KEY = "yt_study_app_state_v1";
const YOUTUBE_API_KEY = "AIzaSyBC6U1_A4qg1o-RFzZHr-9xI9U3dl39TDs"; // Add your YouTube API key here if you want playlist support

const defaultState = {
    theme: "system",
    compact: false,
    distractionFree: false,
    projects: [{
        id: generateId(),
        name: "My First Study Set",
        videos: [],
        createdAt: Date.now(),
    }],
    currentProjectId: null,
};

function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2);
}

function parseYouTubeId(urlOrId) {
    if (!urlOrId) return { type: null, id: null };

    // If it's already a plain 11-char video id
    if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
        return { type: 'video', id: urlOrId };
    }

    try {
        const url = new URL(urlOrId);

        // Check for playlist
        if (url.hostname.includes("youtube.com") && url.searchParams.has('list')) {
            const playlistId = url.searchParams.get('list');
            if (playlistId) return { type: 'playlist', id: playlistId };
        }

        // Check for video
        if (url.hostname === "youtu.be") {
            return { type: 'video', id: url.pathname.slice(1) };
        }

        if (url.hostname.includes("youtube.com")) {
            const videoId = url.searchParams.get("v");
            if (videoId) return { type: 'video', id: videoId };

            const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
            if (embedMatch) return { type: 'video', id: embedMatch[1] };
        }
    } catch (e) {
        // Not a valid URL
    }

    return { type: null, id: null };
}

async function fetchPlaylistVideos(playlistId, sourceUrl = '') {
    // Try API method first if key is available
    if (YOUTUBE_API_KEY) {
        try {
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}`
            );

            if (response.ok) {
                const data = await response.json();
                return data.items.map((item, index) => ({
                    id: generateId(),
                    title: item.snippet.title,
                    videoId: item.snippet.resourceId.videoId,
                    source: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
                    playlistIndex: index + 1,
                    notes: [],
                    bookmarks: [],
                    lastTime: 0,
                    createdAt: Date.now(),
                }));
            }
        } catch (error) {
            console.warn('API method failed, trying fallback:', error);
        }
    }

    // Fallback method: Use a proxy service or return manual entry suggestion
    try {
        // If the original URL contains a video ID, at least add that one video
        if (sourceUrl) {
            const url = new URL(sourceUrl);
            const videoId = url.searchParams.get('v');
            if (videoId) {
                return [{
                    id: generateId(),
                    title: "Video from Playlist",
                    videoId: videoId,
                    source: sourceUrl,
                    playlistIndex: 1,
                    notes: [],
                    bookmarks: [],
                    lastTime: 0,
                    createdAt: Date.now(),
                }];
            }
        }

        // If no video ID in URL, suggest manual addition
        return [];
    } catch (error) {
        console.error('Fallback method failed:', error);
        return [];
    }
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds == null) return "0:00";

    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const formattedMinutes = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
    const formattedSeconds = String(secs).padStart(2, "0");

    return hours > 0 ? `${hours}:${formattedMinutes}:${formattedSeconds}` : `${formattedMinutes}:${formattedSeconds}`;
}

function markdownToHtml(markdown) {
    if (!markdown) return "";

    let html = markdown
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Headers
    html = html.replace(/^######\s(.*)$/gm, '<h6 class="text-sm font-semibold">$1</h6>');
    html = html.replace(/^#####\s(.*)$/gm, '<h5 class="text-base font-semibold">$1</h5>');
    html = html.replace(/^####\s(.*)$/gm, '<h4 class="text-lg font-semibold">$1</h4>');
    html = html.replace(/^###\s(.*)$/gm, '<h3 class="text-xl font-semibold">$1</h3>');
    html = html.replace(/^##\s(.*)$/gm, '<h2 class="text-2xl font-semibold">$1</h2>');
    html = html.replace(/^#\s(.*)$/gm, '<h1 class="text-3xl font-bold">$1</h1>');

    // Formatting
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10">$1</code>');

    // Lists
    html = html.replace(/^\s*-\s(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul class="list-disc pl-5 space-y-1">${block}</ul>`);

    // Links
    html = html.replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a class="underline" target="_blank" rel="noreferrer" href="$2">$1</a>');

    // Line breaks
    html = html.replace(/\n/g, '<br/>');

    return html;
}

function downloadFile(filename, content, type = "application/json") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// ----------------------------- Custom Hooks ---------------------------------
function useLocalStorage() {
    const [state, setState] = useState(() => {
        try {
            const saved = localStorage.getItem(LS_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return { ...parsed, currentProjectId: parsed.currentProjectId || parsed.projects[0]?.id };
            }
        } catch (error) {
            console.error('Error loading from localStorage:', error);
        }

        const initialState = { ...defaultState };
        initialState.currentProjectId = initialState.projects[0].id;
        return initialState;
    });

    useEffect(() => {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(state));
        } catch (error) {
            console.error('Error saving to localStorage:', error);
        }
    }, [state]);

    return [state, setState];
}

function useYouTubePlayer(containerId, videoId, onReady) {
    const playerRef = useRef(null);

    const hasMethod = useCallback((method) => {
        return playerRef.current && typeof playerRef.current[method] === "function";
    }, []);

    useEffect(() => {
        // Load YouTube IFrame API
        if (!window.YT) {
            const script = document.createElement("script");
            script.src = "https://www.youtube.com/iframe_api";
            document.body.appendChild(script);
        }

        function createPlayer() {
            if (!videoId) return;

            // Destroy existing player
            if (playerRef.current && hasMethod("destroy")) {
                try {
                    playerRef.current.destroy();
                } catch (error) {
                    console.error('Error destroying player:', error);
                }
                playerRef.current = null;
            }

            // Create new player
            playerRef.current = new window.YT.Player(containerId, {
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
                    onReady: () => onReady?.(playerRef.current),
                    onStateChange: (event) => {
                        const YT = window.YT;
                        if (!YT?.PlayerState) return;

                        if (event.data === YT.PlayerState.PLAYING) {
                            console.log('Video playing');
                        } else if (event.data === YT.PlayerState.PAUSED) {
                            console.log('Video paused');
                        }
                    },
                },
            });
        }

        const originalCallback = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            originalCallback?.();
            if (window.YT?.Player) createPlayer();
        };

        if (window.YT?.Player) createPlayer();

        return () => {
            window.onYouTubeIframeAPIReady = originalCallback;
            if (playerRef.current && hasMethod("destroy")) {
                try {
                    playerRef.current.destroy();
                } catch (error) {
                    console.error('Error destroying player on cleanup:', error);
                }
                playerRef.current = null;
            }
        };
    }, [containerId, videoId, hasMethod, onReady]);

    return {
        getCurrentTime: useCallback(() => {
            return hasMethod("getCurrentTime") ? Math.floor(playerRef.current.getCurrentTime() || 0) : 0;
        }, [hasMethod]),

        seekTo: useCallback((time) => {
            if (hasMethod("seekTo")) {
                try {
                    playerRef.current.seekTo(time, true);
                } catch (error) {
                    console.error('Error seeking to time:', error);
                }
            }
        }, [hasMethod]),

        play: useCallback(() => {
            if (hasMethod("playVideo")) {
                try {
                    playerRef.current.playVideo();
                } catch (error) {
                    console.error('Error playing video:', error);
                }
            }
        }, [hasMethod]),

        pause: useCallback(() => {
            if (hasMethod("pauseVideo")) {
                try {
                    playerRef.current.pauseVideo();
                } catch (error) {
                    console.error('Error pausing video:', error);
                }
            }
        }, [hasMethod]),

        getPlayerState: useCallback(() => {
            return hasMethod("getPlayerState") ? playerRef.current.getPlayerState() : -1;
        }, [hasMethod]),

        isReady: useCallback(() => {
            return !!(playerRef.current && hasMethod("getPlayerState"));
        }, [hasMethod]),
    };
}

// ----------------------------- Main Components ---------------------------------
// function ProjectSelector({ projects, currentProjectId, onProjectChange, onAddProject, onRenameProject, onDeleteProject }) {
//     return (
//         <div className="flex items-center gap-2">
//             <select
//                 className="px-3 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
//                 value={currentProjectId || ""}
//                 onChange={(e) => onProjectChange(e.target.value)}
//             >
//                 {projects.map((project) => (
//                     <option key={project.id} value={project.id}>
//                         {project.name}
//                     </option>
//                 ))}
//             </select>
//             <button 
//                 onClick={onAddProject} 
//                 className="px-3 py-2 rounded-2xl bg-orange-800 text-white dark:bg-white dark:text-neutral-900"
//             >
//                 + Project
//             </button>
//             <button 
//                 onClick={onRenameProject} 
//                 className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700"
//             >
//                 Rename
//             </button>
//             <button 
//                 onClick={onDeleteProject} 
//                 className="px-3 py-2 rounded-2xl border border-red-300 text-red-600 dark:border-red-700"
//             >
//                 Delete
//             </button>
//         </div>
//     );
// }

// The issue is likely in your ProjectSelector component
// Make sure you're not rendering duplicate elements with the same key

// Wrap ProjectSelector with React.memo to prevent unnecessary re-renders
const ProjectSelector = React.memo(({ projects, currentProjectId, onProjectChange, onAddProject, onRenameProject, onDeleteProject }) => {
    return (
        <div className="flex items-center gap-2">
            <select
                className="px-3 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                value={currentProjectId || ""}
                onChange={(e) => onProjectChange(e.target.value)}
            >
                {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                        {project.name}
                    </option>
                ))}
            </select>
            <button 
                onClick={onAddProject} 
                className="px-3 py-2 rounded-2xl bg-orange-800 text-white dark:bg-white dark:text-neutral-900"
            >
                + Project
            </button>
            <button 
                onClick={onRenameProject} 
                className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700"
            >
                Rename
            </button>
            <button 
                onClick={onDeleteProject} 
                className="px-3 py-2 rounded-2xl border border-red-300 text-red-600 dark:border-red-700"
            >
                Delete
            </button>
        </div>
    );
});
function VideoInput({ urlInput, onUrlInputChange, onAddVideo, isLoading }) {
    return (
        <div className="flex items-center gap-1">
            <input
                value={urlInput}
                onChange={(e) => onUrlInputChange(e.target.value)}
                placeholder="Paste YouTube video/playlist link or ID"
                disabled={isLoading}
                className="w-full px-4 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 disabled:opacity-50"
            />
            <button
                onClick={onAddVideo}
                disabled={isLoading}
                className="px-4 py-2 rounded-2xl bg-emerald-600 text-white disabled:opacity-50"
            >
                {isLoading ? "Adding..." : "Add"}
            </button>
        </div>
    );
}

function VideoPlayer({
    containerId,
    currentTime,
    playerState,
    onSeek,
    onPlayPause,
    onSetTitle,
    currentVideo
}) {
    return (
        <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-sm">
            <div className="aspect-video bg-black">
                <div id={containerId} className="w-full h-full" />
            </div>
            <div className="p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onSeek(Math.max(0, currentTime - 5))}
                        className="px-3 py-1.5 rounded-xl border"
                    >
                        -5s
                    </button>
                    <button
                        onClick={() => onPlayPause("toggle")}
                        className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    >
                        {playerState === 1 ? "Pause" : "Play"}
                    </button>
                    <button
                        onClick={() => onSeek(currentTime + 5)}
                        className="px-3 py-1.5 rounded-xl border"
                    >
                        +5s
                    </button>
                    <span className="text-sm opacity-70">{formatTime(currentTime)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onSeek(0)}
                        className="px-3 py-1.5 rounded-xl border"
                    >
                        Start
                    </button>
                    <button
                        onClick={() => onSeek(currentVideo?.lastTime || 0)}
                        className="px-3 py-1.5 rounded-xl border"
                    >
                        Resume
                    </button>
                    <button
                        onClick={onSetTitle}
                        className="px-3 py-1.5 rounded-xl border"
                    >
                        Title
                    </button>
                </div>
            </div>
        </div>
    );
}

function VideoList({ videos, currentVideoId, onVideoSelect, onVideoRemove }) {
    if (!videos?.length) {
        return (
            <div className="text-sm opacity-70">
                No videos yet. Paste a link above and click Add.
            </div>
        );
    }

    return (
        <div className="grid sm:grid-cols-2 gap-3">
            {videos.map((video, index) => (
                <div
                    key={video.id}
                    className={`p-3 rounded-xl border transition ${currentVideoId === video.videoId
                        ? "border-emerald-400"
                        : "border-neutral-200 dark:border-neutral-800"
                        }`}
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                {video.playlistIndex && (
                                    <span className="text-xs bg-neutral-200 dark:bg-neutral-700 px-2 py-1 rounded">
                                        #{video.playlistIndex}
                                    </span>
                                )}
                                <div className="truncate font-medium">
                                    {video.title || video.videoId}
                                </div>
                            </div>
                            <div className="text-xs opacity-60">
                                Last at {formatTime(video.lastTime || 0)}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => onVideoSelect(video.videoId)}
                                className="px-2 py-1 rounded-lg border"
                            >
                                Open
                            </button>
                            <button
                                onClick={() => onVideoRemove(video.videoId)}
                                className="px-2 py-1 rounded-lg border border-red-300 text-red-600"
                            >
                                Remove
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function NotesSection({
    notes,
    searchTerm,
    onSearchChange,
    noteDraft,
    onNoteDraftChange,
    notePreview,
    onTogglePreview,
    onAddNote,
    onEditNote,
    onDeleteNote,
    onSeekTo,
    currentTime
}) {
    return (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Notes</h2>
                <input
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search notes..."
                    className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
                />
            </div>
            <div className="p-3 space-y-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onTogglePreview}
                            className="px-3 py-1.5 rounded-xl border"
                        >
                            {notePreview ? "Edit" : "Preview"}
                        </button>
                        <button
                            onClick={() => onAddNote("input")}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white"
                        >
                            + Add Note @ {formatTime(currentTime)} (N)
                        </button>
                    </div>
                    {!notePreview ? (
                        <textarea
                            value={noteDraft}
                            onChange={(e) => onNoteDraftChange(e.target.value)}
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
                    {notes.map((note) => (
                        <div key={note.id} className="p-3 flex items-start gap-3">
                            <button
                                onClick={() => onSeekTo(note.t)}
                                className="px-2 py-1 rounded-lg border shrink-0"
                            >
                                {formatTime(note.t)}
                            </button>
                            <div className="flex-1 min-w-0">
                                <div
                                    className="prose prose-neutral dark:prose-invert max-w-none"
                                    dangerouslySetInnerHTML={{ __html: markdownToHtml(note.text) }}
                                />
                                <div className="text-xs opacity-60 mt-1">
                                    Updated {new Date(note.updatedAt).toLocaleString()}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => onEditNote(note.id)}
                                    className="px-2 py-1 rounded-lg border"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => onDeleteNote(note.id)}
                                    className="px-2 py-1 rounded-lg border border-red-300 text-red-600"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                    {notes.length === 0 && (
                        <div className="p-3 text-sm opacity-70">No notes yet.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ----------------------------- Main App ---------------------------------
export default function App() {
    const [state, setState] = useLocalStorage();
    const [urlInput, setUrlInput] = useState("");
    const [currentVideoId, setCurrentVideoId] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [noteDraft, setNoteDraft] = useState("");
    const [notePreview, setNotePreview] = useState(false);
    const [bookmarkTitle, setBookmarkTitle] = useState("");
    const [bookmarkTag, setBookmarkTag] = useState("");
    const [bookmarkColor, setBookmarkColor] = useState("emerald");
    const [playerSeconds, setPlayerSeconds] = useState(0);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // const currentProject = useMemo(
    //     () => state.projects.find((p) => p.id === state.currentProjectId) || state.projects[0],
    //     [state.projects, state.currentProjectId]
    // );

    // const currentVideo = useMemo(
    //     () => currentProject?.videos.find((v) => v.videoId === currentVideoId) || null,
    //     [currentProject, currentVideoId]
    // );

    // const filteredNotes = useMemo(() => {
    //     const query = searchTerm.trim().toLowerCase();
    //     if (!currentVideo || !query) return currentVideo?.notes || [];
    //     return currentVideo.notes.filter((note) => 
    //         (note.text || "").toLowerCase().includes(query)
    //     );
    // }, [searchTerm, currentVideo]);

    // Add these memoized values to prevent unnecessary re-renders
    const currentProject = useMemo(
        () => state.projects.find((p) => p.id === state.currentProjectId) || state.projects[0],
        [state.projects, state.currentProjectId]
    );

    const currentVideo = useMemo(
        () => currentProject?.videos.find((v) => v.videoId === currentVideoId) || null,
        [currentProject?.videos, currentVideoId] // More specific dependency
    );

    const filteredNotes = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        if (!currentVideo?.notes || !query) return currentVideo?.notes || [];
        return currentVideo.notes.filter((note) =>
            (note.text || "").toLowerCase().includes(query)
        );
    }, [searchTerm, currentVideo?.notes]); // More specific dependency

    // Memoize project list to prevent ProjectSelector re-renders
    const memoizedProjects = useMemo(() => state.projects, [state.projects]);

    const playerContainerId = "yt-player-container";
    const { getCurrentTime, seekTo, play, pause, isReady, getPlayerState } = useYouTubePlayer(
        playerContainerId,
        currentVideoId,
        (player) => {
            const resumeTime = currentVideo?.lastTime || 0;
            if (resumeTime > 0) {
                setTimeout(() => seekTo(resumeTime), 500);
            }
        }
    );

    // Unified play/pause control
    const handlePlayPause = useCallback((mode = "toggle") => {
        if (!isReady()) return;

        const state = getPlayerState();
        if (mode === "play") {
            play();
            setIsVideoPlaying(true);
        } else if (mode === "pause") {
            pause();
            setIsVideoPlaying(false);
        } else {
            state === 1 ? (pause(), setIsVideoPlaying(false)) : (play(), setIsVideoPlaying(true));
        }
    }, [getPlayerState, isReady, pause, play]);

    // Live time ticker
    // useEffect(() => {
    //     const interval = setInterval(() => {
    //         setPlayerSeconds(getCurrentTime());
    //     }, 500);
    //     return () => clearInterval(interval);
    // }, [getCurrentTime]);

    // Replace your current time ticker useEffect with this optimized version
    useEffect(() => {
        let interval;

        const updateTime = () => {
            if (isReady()) {
                const newTime = getCurrentTime();
                // Only update state if time actually changed significantly (avoid micro-updates)
                setPlayerSeconds(prevTime => {
                    const timeDiff = Math.abs(newTime - prevTime);
                    return timeDiff >= 1 ? newTime : prevTime;
                });
            }
        };

        // Only run interval when video is playing
        if (isVideoPlaying && isReady()) {
            interval = setInterval(updateTime, 1000); // Reduced from 500ms to 1000ms
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [getCurrentTime, isReady, isVideoPlaying]); // Add isVideoPlaying dependency

    // Persist watch time
    // useEffect(() => {
    //     const interval = setInterval(() => {
    //         if (currentVideoId && isReady()) {
    //             const time = getCurrentTime();
    //             setState((s) => ({
    //                 ...s,
    //                 projects: s.projects.map((p) =>
    //                     p.id !== currentProject.id
    //                         ? p
    //                         : {
    //                             ...p,
    //                             videos: p.videos.map((v) =>
    //                                 v.videoId === currentVideoId ? { ...v, lastTime: time } : v
    //                             ),
    //                         }
    //                 ),
    //             }));
    //         }
    //     }, 3000);
    //     return () => clearInterval(interval);
    // }, [currentVideoId, isReady, getCurrentTime, currentProject?.id, setState]);
    // Optimize the save interval to reduce unnecessary updates
    useEffect(() => {
        let interval;
        let lastSavedTime = 0;

        if (currentVideoId && isReady()) {
            interval = setInterval(() => {
                const currentTime = getCurrentTime();
                // Only save if time changed by more than 5 seconds to reduce writes
                if (Math.abs(currentTime - lastSavedTime) >= 5) {
                    lastSavedTime = currentTime;
                    setState((s) => ({
                        ...s,
                        projects: s.projects.map((p) =>
                            p.id !== currentProject?.id
                                ? p
                                : {
                                    ...p,
                                    videos: p.videos.map((v) =>
                                        v.videoId === currentVideoId ? { ...v, lastTime: currentTime } : v
                                    ),
                                }
                        ),
                    }));
                }
            }, 5000); // Increased from 3000ms to 5000ms
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [currentVideoId, isReady, getCurrentTime, currentProject?.id, setState]);

    // Keyboard shortcuts
    useEffect(() => {
        function handleKeyDown(event) {
            if (event.target && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA")) return;

            switch (event.key) {
                case " ":
                    event.preventDefault();
                    handlePlayPause("toggle");
                    break;
                case "n":
                    event.preventDefault();
                    handleAddNote("prompt");
                    break;
                case "b":
                    event.preventDefault();
                    handleAddBookmark();
                    break;
                case "ArrowRight":
                    seekTo(getCurrentTime() + 5);
                    break;
                case "ArrowLeft":
                    seekTo(Math.max(0, getCurrentTime() - 5));
                    break;
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [getCurrentTime, seekTo, handlePlayPause]);

    // Project management functions
    const handleProjectChange = useCallback((projectId) => {
        setState((s) => ({ ...s, currentProjectId: projectId }));
    }, [setState]);

    const handleAddProject = useCallback(() => {
        const name = prompt("Project name?");
        if (!name) return;

        const newProject = {
            id: generateId(),
            name,
            videos: [],
            createdAt: Date.now()
        };

        setState((s) => ({
            ...s,
            projects: [...s.projects, newProject],
            currentProjectId: newProject.id,
        }));
    }, [setState]);

    const handleRenameProject = useCallback(() => {
        if (!currentProject) return;

        const name = prompt("Rename project:", currentProject.name);
        if (!name) return;

        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id === currentProject.id ? { ...p, name } : p
            ),
        }));
    }, [currentProject, setState]);

    const handleDeleteProject = useCallback(() => {
        if (!currentProject) return;
        if (!confirm(`Delete project "${currentProject.name}"?`)) return;

        setState((s) => {
            const remainingProjects = s.projects.filter((p) => p.id !== currentProject.id);
            const projects = remainingProjects.length
                ? remainingProjects
                : [{ id: generateId(), name: "New Project", videos: [], createdAt: Date.now() }];

            return {
                ...s,
                projects,
                currentProjectId: projects[0]?.id || null,
            };
        });
    }, [currentProject, setState]);

    // Video management functions
    const handleAddVideo = useCallback(async () => {
        if (!currentProject) return;

        const { type, id } = parseYouTubeId(urlInput.trim());
        if (!type || !id) {
            alert("Please paste a valid YouTube video or playlist link/ID.");
            return;
        }

        setIsLoading(true);

        try {
            let videosToAdd = [];

            if (type === 'video') {
                const existingVideo = currentProject.videos.find((v) => v.videoId === id);
                if (existingVideo) {
                    setCurrentVideoId(id);
                    setUrlInput("");
                    return;
                }

                videosToAdd = [{
                    id: generateId(),
                    title: "Untitled Video",
                    videoId: id,
                    source: urlInput.trim(),
                    notes: [],
                    bookmarks: [],
                    lastTime: 0,
                    createdAt: Date.now(),
                }];
            } else if (type === 'playlist') {
                const playlistVideos = await fetchPlaylistVideos(id, urlInput.trim());

                if (playlistVideos.length === 0) {
                    // Provide helpful message and alternative
                    const useManual = confirm(
                        "Automatic playlist import requires a YouTube API key. " +
                        "Would you like to manually add videos from this playlist instead? " +
                        "\n\nClick OK to get instructions, or Cancel to try again with a single video URL."
                    );

                    if (useManual) {
                        alert(
                            "To manually add playlist videos:\n\n" +
                            "1. Open the playlist on YouTube\n" +
                            "2. Copy individual video URLs\n" +
                            "3. Add them one by one using this form\n\n" +
                            "Tip: You can also add a video URL with &list= parameter - it will add just that video from the playlist!"
                        );
                    }
                    return;
                }

                // Filter out videos that already exist in the project
                const existingVideoIds = new Set(currentProject.videos.map(v => v.videoId));
                videosToAdd = playlistVideos.filter(video => !existingVideoIds.has(video.videoId));

                if (videosToAdd.length === 0) {
                    alert("All videos from this playlist are already in the project.");
                    return;
                }

                // Notify user about successful addition
                if (videosToAdd.length === 1) {
                    alert("Added 1 video from the playlist. For full playlist support, add a YouTube API key to the code.");
                } else {
                    alert(`Added ${videosToAdd.length} videos from the playlist.`);
                }
            }

            setState((s) => ({
                ...s,
                projects: s.projects.map((p) =>
                    p.id === currentProject.id
                        ? { ...p, videos: [...p.videos, ...videosToAdd] }
                        : p
                ),
            }));

            // Set the first added video as current
            if (videosToAdd.length > 0) {
                setCurrentVideoId(videosToAdd[0].videoId);
            }

            setUrlInput("");
        } catch (error) {
            console.error('Error adding video(s):', error);
            alert("Error adding video(s). Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, [currentProject, urlInput, setState]);

    const handleSetTitle = useCallback(() => {
        if (!currentVideo) return;

        const title = prompt("Video title:", currentVideo.title || "");
        if (title == null) return;

        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId ? { ...v, title } : v
                        ),
                    }
            ),
        }));
    }, [currentVideo, currentProject, setState]);

    const handleRemoveVideo = useCallback((videoId) => {
        if (!confirm("Remove this video from project?")) return;

        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : { ...p, videos: p.videos.filter((v) => v.videoId !== videoId) }
            ),
        }));

        if (currentVideoId === videoId) setCurrentVideoId(null);
    }, [currentProject, currentVideoId, setState]);

    // Notes management functions
    const handleAddNote = useCallback((type) => {
        if (!currentVideo) return;

        const time = getCurrentTime();
        const noteId = generateId();
        let text = noteDraft.trim();

        if (type === "input") {
            if (!text) {
                alert("Write a note first.");
                return;
            }
        } else if (type === "prompt") {
            const promptText = prompt("Enter your note:");
            if (!promptText) {
                alert("Note cannot be empty.");
                return;
            }
            text = promptText;
        }

        const note = {
            id: noteId,
            t: time,
            text,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId
                                ? { ...v, notes: [note, ...v.notes] }
                                : v
                        ),
                    }
            ),
        }));

        setNoteDraft("");
    }, [currentVideo, currentProject, getCurrentTime, noteDraft, setState]);

    const handleEditNote = useCallback((noteId) => {
        const note = currentVideo?.notes.find((n) => n.id === noteId);
        if (!note) return;

        const text = prompt("Edit note (Markdown supported):", note.text);
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
                                    notes: v.notes.map((n) =>
                                        n.id === noteId
                                            ? { ...n, text, updatedAt: Date.now() }
                                            : n
                                    ),
                                }
                                : v
                        ),
                    }
            ),
        }));
    }, [currentVideo, currentProject, setState]);

    const handleDeleteNote = useCallback((noteId) => {
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
                                ? { ...v, notes: v.notes.filter((n) => n.id !== noteId) }
                                : v
                        ),
                    }
            ),
        }));
    }, [currentVideo, currentProject, setState]);

    // Bookmark management functions
    const handleAddBookmark = useCallback(() => {
        if (!currentVideo) return;

        const time = getCurrentTime();
        const title = (bookmarkTitle || "Bookmark").trim();
        const tag = bookmarkTag.trim();
        const color = bookmarkColor || "emerald";

        const bookmark = {
            id: generateId(),
            t: time,
            title,
            tag,
            color,
            createdAt: Date.now()
        };

        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId
                                ? { ...v, bookmarks: [bookmark, ...v.bookmarks] }
                                : v
                        ),
                    }
            ),
        }));

        setBookmarkTitle("");
        setBookmarkTag("");
    }, [currentVideo, currentProject, getCurrentTime, bookmarkTitle, bookmarkTag, bookmarkColor, setState]);

    const handleDeleteBookmark = useCallback((bookmarkId) => {
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
                                ? { ...v, bookmarks: v.bookmarks.filter((b) => b.id !== bookmarkId) }
                                : v
                        ),
                    }
            ),
        }));
    }, [currentVideo, currentProject, setState]);

    // Drag and drop for bookmarks
    const handleBookmarkDragStart = useCallback((event, bookmarkId) => {
        event.dataTransfer.setData("text/plain", bookmarkId);
    }, []);

    const handleBookmarkDrop = useCallback((event) => {
        event.preventDefault();
        const bookmarkId = event.dataTransfer.getData("text/plain");
        if (!bookmarkId || !currentVideo) return;

        const bookmarks = [...currentVideo.bookmarks];
        const fromIndex = bookmarks.findIndex((b) => b.id === bookmarkId);
        if (fromIndex < 0) return;

        const [movedBookmark] = bookmarks.splice(fromIndex, 1);
        bookmarks.splice(0, 0, movedBookmark);

        setState((s) => ({
            ...s,
            projects: s.projects.map((p) =>
                p.id !== currentProject.id
                    ? p
                    : {
                        ...p,
                        videos: p.videos.map((v) =>
                            v.videoId === currentVideo.videoId
                                ? { ...v, bookmarks }
                                : v
                        ),
                    }
            ),
        }));
    }, [currentVideo, currentProject, setState]);

    // Import/Export functions
    const handleExportJSON = useCallback(() => {
        const data = state.projects.find((p) => p.id === currentProject.id);
        downloadFile(
            `${currentProject.name.replace(/\s+/g, "_")}.json`,
            JSON.stringify(data, null, 2)
        );
    }, [state.projects, currentProject]);

    const handleImportJSON = useCallback((event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const project = JSON.parse(reader.result);
                if (!project || !project.id || !project.videos) {
                    throw new Error("Invalid file format");
                }
                setState((s) => ({
                    ...s,
                    projects: [...s.projects, project],
                    currentProjectId: project.id
                }));
            } catch (error) {
                alert("Invalid JSON file");
            }
        };
        reader.readAsText(file);
        event.target.value = "";
    }, [setState]);

    const handleExportMarkdown = useCallback(() => {
        if (!currentVideo) return;

        const lines = [];
        lines.push(`# ${currentVideo.title || "Video Notes"}`);
        lines.push("");
        lines.push(`Source: ${currentVideo.source || currentVideo.videoId}`);
        lines.push("");
        lines.push("## Bookmarks");
        currentVideo.bookmarks.forEach((bookmark) => {
            lines.push(`- [${formatTime(bookmark.t)}] ${bookmark.title}${bookmark.tag ? ` (#${bookmark.tag})` : ""}`);
        });
        lines.push("");
        lines.push("## Notes");
        currentVideo.notes.forEach((note) => {
            lines.push(`- [${formatTime(note.t)}] ${note.text.replace(/\n/g, " ")}`);
        });

        downloadFile(
            `${(currentVideo.title || currentVideo.videoId).replace(/\s+/g, "_")}.md`,
            lines.join("\n"),
            "text/markdown"
        );
    }, [currentVideo]);

    // Reminder function
    const handleScheduleReminder = useCallback((payload) => {
        const reminderMinutes = prompt("Set reminder in minutes (default 5):", "5");
        if (reminderMinutes === null) return;

        const minutes = parseInt(reminderMinutes || "5", 10);
        if (!Number.isFinite(minutes) || minutes <= 0) {
            alert("Enter minutes > 0");
            return;
        }

        if (!("Notification" in window)) {
            alert("Notifications not supported in this browser.");
            return;
        }

        Notification.requestPermission().then((permission) => {
            if (permission !== "granted") {
                alert("Notification permission denied.");
                return;
            }

            setTimeout(() => {
                new Notification(payload.title, { body: payload.body });
            }, minutes * 60 * 1000);

            alert(`Reminder set for ${minutes} minute(s).`);
        });

        if (payload?.action === "videoPause") {
            setTimeout(() => {
                handlePlayPause("pause");
            }, minutes * 60 * 1000);
        }
    }, [handlePlayPause]);

    // Auto-select first video when project changes
    useEffect(() => {
        if (!currentProject) return;

        if (currentProject.videos.length && !currentProject.videos.some(v => v.videoId === currentVideoId)) {
            setCurrentVideoId(currentProject.videos[0].videoId);
        }
    }, [currentProject, currentVideoId]);

    // Add this effect to debug duplicate IDs
    useEffect(() => {
        // Check for duplicate project IDs
        const projectIds = state.projects.map(p => p.id);
        const uniqueIds = new Set(projectIds);

        if (projectIds.length !== uniqueIds.size) {
            console.error('Duplicate project IDs found:', projectIds);

            // Fix duplicate IDs automatically
            setState(prevState => ({
                ...prevState,
                projects: prevState.projects.map((project, index) => ({
                    ...project,
                    id: project.id === '2e1d9cd0-5a2a-47c7-89c5-5bda0acd1054' && index > 0
                        ? generateId()
                        : project.id
                }))
            }));
        }

        // Check for duplicate video IDs within projects
        state.projects.forEach((project, projectIndex) => {
            const videoIds = project.videos.map(v => v.id);
            const uniqueVideoIds = new Set(videoIds);

            if (videoIds.length !== uniqueVideoIds.size) {
                console.error(`Duplicate video IDs in project ${project.name}:`, videoIds);
            }
        });
    }, [state.projects, setState]);

    return (
        <div className="min-h-screen min-w-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 transition-colors">
            {/* Top Bar */}
            <div className="sticky top-0 z-30 backdrop-blur bg-white/70 dark:bg-neutral-900/70 border-b border-neutral-200 dark:border-neutral-800">
                <div className="max-w-8xl mx-auto px-3 sm:px-6 py-2 flex items-center gap-2">
                    <ProjectSelector
                        projects={state.projects}
                        currentProjectId={currentProject?.id}
                        onProjectChange={handleProjectChange}
                        onAddProject={handleAddProject}
                        onRenameProject={handleRenameProject}
                        onDeleteProject={handleDeleteProject}
                    />

                    <VideoInput
                        urlInput={urlInput}
                        onUrlInputChange={setUrlInput}
                        onAddVideo={handleAddVideo}
                        isLoading={isLoading}
                    />

                    {/* Utilities */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setState((s) => ({ ...s, distractionFree: !s.distractionFree }))}
                            className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700"
                        >
                            {state.distractionFree ? "Exit Focus" : "Focus Mode"}
                        </button>

                        <button
                            onClick={handleExportJSON}
                            className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700"
                        >
                            Export JSON
                        </button>

                        <label className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700 cursor-pointer">
                            Import JSON
                            <input
                                type="file"
                                accept="application/json"
                                className="hidden"
                                onChange={handleImportJSON}
                            />
                        </label>

                        <button
                            onClick={handleExportMarkdown}
                            className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700"
                        >
                            Export MD
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Layout */}
            <div className={`max-w-8xl mx-auto px-1 sm:px-6 py-4 grid ${state.distractionFree ? "grid-cols-1" : "md:grid-cols-[2fr_1fr]"
                } gap-4`}>
                {/* Left: Player + Video List */}
                <div className="space-y-4">
                    <VideoPlayer
                        containerId={playerContainerId}
                        currentTime={playerSeconds}
                        playerState={getPlayerState()}
                        onSeek={seekTo}
                        onPlayPause={handlePlayPause}
                        onSetTitle={handleSetTitle}
                        currentVideo={currentVideo}
                    />

                    {/* Videos in Project */}
                    {!state.distractionFree && (
                        <div className="rounded-2xl p-3 border border-neutral-200 dark:border-neutral-800">
                            <div className="flex items-center justify-between mb-2">
                                <h2 className="text-lg font-semibold">Project Videos</h2>
                                <span className="text-sm opacity-60">
                                    {currentProject?.videos.length || 0} items
                                </span>
                            </div>
                            <VideoList
                                videos={currentProject?.videos}
                                currentVideoId={currentVideoId}
                                onVideoSelect={setCurrentVideoId}
                                onVideoRemove={handleRemoveVideo}
                            />
                        </div>
                    )}
                </div>

                {/* Right: Notes & Bookmarks */}
                {!state.distractionFree && (
                    <div className="space-y-4">
                        <div className="w-full flex justify-center">
                            <button
                                onClick={() => handleScheduleReminder({
                                    title: "Reminding you for a break",
                                    action: "videoPause"
                                })}
                                className="px-2 py-1 rounded-lg text-white border-2 border-amber-200"
                            >
                                Set break reminder
                            </button>
                        </div>

                        <NotesSection
                            notes={filteredNotes}
                            searchTerm={searchTerm}
                            onSearchChange={setSearchTerm}
                            noteDraft={noteDraft}
                            onNoteDraftChange={setNoteDraft}
                            notePreview={notePreview}
                            onTogglePreview={() => setNotePreview(!notePreview)}
                            onAddNote={handleAddNote}
                            onEditNote={handleEditNote}
                            onDeleteNote={handleDeleteNote}
                            onSeekTo={seekTo}
                            currentTime={playerSeconds}
                        />

                        {/* Bookmarks */}
                        <div
                            className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden"
                            onDrop={handleBookmarkDrop}
                            onDragOver={(e) => e.preventDefault()}
                        >
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
                                    <button
                                        onClick={handleAddBookmark}
                                        className="px-3 py-2 rounded-2xl bg-emerald-600 text-white"
                                    >
                                        + Add (B) @ {formatTime(playerSeconds)}
                                    </button>
                                </div>
                            </div>
                            <div className="p-3 grid sm:grid-cols-1 gap-3">
                                {currentVideo?.bookmarks.map((bookmark) => (
                                    <div
                                        key={bookmark.id}
                                        draggable
                                        onDragStart={(e) => handleBookmarkDragStart(e, bookmark.id)}
                                        className={`p-3 rounded-xl border shadow-sm border-${bookmark.color}-300/60 bg-${bookmark.color}-50/40 dark:border-${bookmark.color}-800/60 dark:bg-${bookmark.color}-900/20`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => seekTo(bookmark.t)}
                                                    className="px-2 py-1 rounded-lg border"
                                                >
                                                    {formatTime(bookmark.t)}
                                                </button>
                                                <div>
                                                    <div className="font-medium truncate max-w-[160px]" title={bookmark.title}>
                                                        {bookmark.title}
                                                    </div>
                                                    {bookmark.tag && (
                                                        <div className="text-xs opacity-70">#{bookmark.tag}</div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleScheduleReminder({
                                                        title: `Revisit: ${bookmark.title}`,
                                                        body: `Jump back to ${formatTime(bookmark.t)} in ${currentVideo?.title || 'video'}`
                                                    })}
                                                    className="px-2 py-1 rounded-lg border"
                                                >
                                                    Remind
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteBookmark(bookmark.id)}
                                                    className="px-2 py-1 rounded-lg border border-red-300 text-red-600"
                                                >
                                                    Delete
                                                </button>
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
                            <div className="font-semibold truncate">
                                {currentVideo.title || currentVideo.videoId}
                                {currentVideo.playlistIndex && (
                                    <span className="text-xs ml-2 opacity-60">
                                        (#{currentVideo.playlistIndex})
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => seekTo(Math.max(0, getCurrentTime() - 10))}
                                className="px-3 py-1.5 rounded-xl border"
                            >
                                -10s
                            </button>
                            <button
                                onClick={handleAddBookmark}
                                className="px-3 py-1.5 rounded-xl border"
                            >
                                + Bookmark
                            </button>
                            <button
                                onClick={() => handleAddNote("prompt")}
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white"
                            >
                                + Note
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}





















// import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

// /**
//  * YouTube Study App (Local Only)
//  * - Paste & play YouTube links (YouTube Iframe API, no DB)
//  * - Time-synced controls (seek/jump)
//  * - Auto-resume per video (persist last watch time)
//  * - Timestamped notes (Markdown + preview)
//  * - Bookmarks (title, tag, color, jump, drag-reorder)
//  * - Projects/Collections (organize many videos)
//  * - Search in notes
//  * - Export/Import JSON + Export Markdown
//  * - Reminders (local Notification API)
//  * - Dark/Light Mode, Focus Mode, Hotkeys
//  * - All data stored in localStorage (no backend/database)
//  *
//  * FIX: Guarded player API calls so we never call undefined methods like
//  * getCurrentTime()/getPlayerState when the Iframe API isn’t ready.
//  */

// // ----------------------------- Helpers ---------------------------------
// const LS_KEY = "yt_study_app_state_v1";

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

// function cryptoRandomId() {
//     if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
//     return Math.random().toString(36).slice(2);
// }

// function parseYouTubeId(urlOrId) {
//     if (!urlOrId) return null;
//     // If it's already a plain 11-char id, return as-is
//     if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
//     try {
//         const u = new URL(urlOrId);
//         if (u.hostname === "youtu.be") return u.pathname.slice(1);
//         if (u.hostname.includes("youtube.com")) {
//             const v = u.searchParams.get("v");
//             if (v) return v;
//             const match = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
//             if (match) return match[1];
//         }
//     } catch (e) {
//         // not a URL, fallthrough
//     }
//     return null;
// }

// function formatTime(t) {
//     if (isNaN(t) || t == null) return "0:00";
//     t = Math.floor(t);
//     const h = Math.floor(t / 3600);
//     const m = Math.floor((t % 3600) / 60);
//     const s = t % 60;
//     const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
//     const ss = String(s).padStart(2, "0");
//     return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
// }

// function markdownToHtml(md) {
//     // Lightweight markdown: **bold**, *italic*, `code`, - lists, # headers, [text](url)
//     let html = md || "";
//     html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
//     html = html.replace(/^###### (.*)$/gm, '<h6 class="text-sm font-semibold">$1</h6>');
//     html = html.replace(/^##### (.*)$/gm, '<h5 class="text-base font-semibold">$1</h5>');
//     html = html.replace(/^#### (.*)$/gm, '<h4 class="text-lg font-semibold">$1</h4>');
//     html = html.replace(/^### (.*)$/gm, '<h3 class="text-xl font-semibold">$1</h3>');
//     html = html.replace(/^## (.*)$/gm, '<h2 class="text-2xl font-semibold">$1</h2>');
//     html = html.replace(/^# (.*)$/gm, '<h1 class="text-3xl font-bold">$1</h1>');
//     html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
//     html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
//     html = html.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10">$1</code>');
//     html = html.replace(/^\s*- (.*)$/gm, '<li>$1</li>');
//     html = html.replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul class="list-disc pl-5 space-y-1">${block}</ul>`);
//     html = html.replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a class="underline" target="_blank" rel="noreferrer" href="$2">$1<\/a>');
//     html = html.replace(/\n/g, '<br/>');
//     return html;
// }

// function downloadFile(filename, content, type = "application/json") {
//     const blob = new Blob([content], { type });
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement("a");
//     a.href = url;
//     a.download = filename;
//     document.body.appendChild(a);
//     a.click();
//     a.remove();
//     URL.revokeObjectURL(url);
// }

// function useLocalState() {
//     const [state, setState] = useState(() => {
//         try {
//             const raw = localStorage.getItem(LS_KEY);
//             if (raw) return JSON.parse(raw);
//         } catch { }
//         const s = { ...defaultState };
//         s.currentProjectId = s.projects[0].id;
//         return s;
//     });

//     useEffect(() => {
//         localStorage.setItem(LS_KEY, JSON.stringify(state));
//     }, [state]);

//     return [state, setState];
// }

// // --------------------------- YouTube Player ------------------------------
// function useYouTube(playerId, videoId, onReady) {
//     const playerRef = useRef(null);

//     // Helper: check if player method exists before calling
//     const has = (method) => playerRef.current && typeof playerRef.current[method] === "function";

//     useEffect(() => {
//         // Load Iframe API once
//         if (!window.YT) {
//             const tag = document.createElement("script");
//             tag.src = "https://www.youtube.com/iframe_api";
//             document.body.appendChild(tag);
//         }

//         function create() {
//             if (!videoId) return;
//             if (playerRef.current && has("destroy")) {
//                 try { playerRef.current.destroy(); } catch { }
//                 playerRef.current = null;
//             }
//             playerRef.current = new window.YT.Player(playerId, {
//                 height: "100%",
//                 width: "100%",
//                 videoId,
//                 playerVars: {
//                     modestbranding: 1,
//                     rel: 0,
//                     enablejsapi: 1,
//                     origin: window.location.origin,
//                 },
//                 events: {
//                     onReady: () => {
//                         onReady && onReady(playerRef.current);
//                     },
//                     onStateChange: (e) => {
//                         try {
//                             const YT = window.YT;
//                             if (!YT || !YT.PlayerState) return;
//                             if (e.data === YT.PlayerState.PLAYING) {
//                                 // eslint-disable-next-line no-console
//                                 console.log("play");
//                             } else if (e.data === YT.PlayerState.PAUSED) {
//                                 // eslint-disable-next-line no-console
//                                 console.log("pause");
//                             }
//                         } catch {}
//                     },
//                 },
//             });
//         }

//         const prev = window.onYouTubeIframeAPIReady;
//         window.onYouTubeIframeAPIReady = () => {
//             prev && prev();
//             if (window.YT && window.YT.Player) create();
//         };
//         if (window.YT && window.YT.Player) create();

//         return () => {
//             window.onYouTubeIframeAPIReady = prev || undefined;
//             if (playerRef.current && has("destroy")) {
//                 try { playerRef.current.destroy(); } catch { }
//                 playerRef.current = null;
//             }
//         };
//         // eslint-disable-next-line react-hooks/exhaustive-deps
//     }, [playerId, videoId]);

//     return {
//         getCurrentTime: () => (has("getCurrentTime") ? Math.floor(playerRef.current.getCurrentTime() || 0) : 0),
//         seekTo: (t) => { if (has("seekTo")) try { playerRef.current.seekTo(t, true); } catch { } },
//         play: () => { if (has("playVideo")) try { playerRef.current.playVideo(); } catch { } },
//         pause: () => { if (has("pauseVideo")) try { playerRef.current.pauseVideo(); } catch { } },
//         getPlayerState: () => (has("getPlayerState") ? playerRef.current.getPlayerState() : -1),
//         isReady: () => !!(playerRef.current && has("getPlayerState")),
//         player: playerRef,
//     };
// }

// // ----------------------------- Main App ---------------------------------
// export default function App() {
//     const [state, setState] = useLocalState();
//     const currentProject = useMemo(
//         () => state.projects.find((p) => p.id === state.currentProjectId) || state.projects[0],
//         [state.projects, state.currentProjectId]
//     );
//     const [urlInput, setUrlInput] = useState("");
//     const [currentVideoId, setCurrentVideoId] = useState(null);
//     const [currentVideo, setCurrentVideo] = useState(null);
//     const [searchTerm, setSearchTerm] = useState("");
//     const [noteDraft, setNoteDraft] = useState("");
//     const [notePreview, setNotePreview] = useState(false);
//     const [bookmarkTitle, setBookmarkTitle] = useState("");
//     const [bookmarkTag, setBookmarkTag] = useState("");
//     const [bookmarkColor, setBookmarkColor] = useState("emerald");
//     const [playerSeconds, setPlayerSeconds] = useState(0); // live ticker display

//     const [isVideoplay, setIsVideoplay] = useState(false);

//     const playerContainerId = "yt-player-container";
//     const { getCurrentTime, seekTo, play, pause, isReady, getPlayerState, player } = useYouTube(
//         playerContainerId,
//         currentVideoId,
//         (p) => {
//             // Auto-resume (guarding the API call)
//             const t = currentVideo?.lastTime || 0;
//             if (t > 0) {
//                 setTimeout(() => {
//                     try { seekTo(t); } catch { }
//                 }, 500);
//             }
//         }
//     );

//     // Unified control: playPause("play" | "pause" | "toggle")
//     const playPause = useCallback((mode = "toggle") => {
//         if (!isReady()) return;
//         const state = getPlayerState();
//         if (mode === "play") {
//             play();
//             setIsVideoplay(true);
//         } else if (mode === "pause") {
//             pause();
//             setIsVideoplay(false);
//         } else {
//             state === 1 ? (pause(), setIsVideoplay(false)) : (play(), setIsVideoplay(true));
//         }
//     }, [getPlayerState, isReady, pause, play]);

//     // Expose globally if needed (e.g., window.playPause("play"))
//     useEffect(() => {
//         window.playPause = playPause;
//         return () => { if (window.playPause === playPause) delete window.playPause; };
//     }, [playPause]);



//     // Live ticker: update displayed current time every 500ms when player is ready
//     useEffect(() => {
//         const iv = setInterval(() => {
//             setPlayerSeconds(getCurrentTime());
//         }, 500);
//         return () => clearInterval(iv);
//     }, [getCurrentTime]);

//     // Update currentVideo when id changes
//     useEffect(() => {
//         if (!currentProject) return;
//         const v = currentProject?.videos.find((v) => v.videoId === currentVideoId) || null;
//         setCurrentVideo(v);
//     }, [currentVideoId, currentProject]);

//     // Persist last watch time every 3s while player is ready
//     useEffect(() => {
//         const int = setInterval(() => {
//             if (currentVideoId && isReady()) {
//                 const t = getCurrentTime();
//                 setState((s) => ({
//                     ...s,
//                     projects: s.projects.map((p) =>
//                         p.id !== currentProject.id
//                             ? p
//                             : {
//                                 ...p,
//                                 videos: p.videos.map((v) =>
//                                     v.videoId === currentVideoId ? { ...v, lastTime: t } : v
//                                 ),
//                             }
//                     ),
//                 }));
//             }
//         }, 3000);
//         return () => clearInterval(int);
//     }, [currentVideoId, isReady, getCurrentTime, currentProject?.id, setState]);

//     // Hotkeys
//     useEffect(() => {
//         function onKey(e) {
//             if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
//             if (e.key === " ") { // space to play/pause
//                 e.preventDefault();
//                 playPause("toggle");
//             }
//             if (e.key === "n") {
//                 e.preventDefault();
//                 handleAddNote("prompt");
//             }
//             if (e.key === "b") {
//                 e.preventDefault();
//                 handleAddBookmark();
//             }
//             if (e.key === "ArrowRight") seekTo(getCurrentTime() + 5);
//             if (e.key === "ArrowLeft") seekTo(Math.max(0, getCurrentTime() - 5));
//         }
//         window.addEventListener("keydown", onKey);
//         return () => window.removeEventListener("keydown", onKey);
//     }, [getCurrentTime, seekTo, play, pause, getPlayerState]);

//     // // Theme handling
//     // useEffect(() => {
//     //     const root = document.documentElement;
//     //     const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
//     //     const useDark = state.theme === "dark" || (state.theme === "system" && prefersDark);
//     //     root.classList.toggle("dark", useDark);
//     // }, [state.theme]);

//     const filteredNotes = useMemo(() => {
//         const q = searchTerm.trim().toLowerCase();
//         if (!currentVideo) return [];
//         if (!q) return currentVideo.notes;
//         return currentVideo.notes.filter((n) => (n.text || "").toLowerCase().includes(q));
//     }, [searchTerm, currentVideo]);

//     function ensureProjectSelected() {
//         if (!state.currentProjectId) {
//             setState((s) => ({ ...s, currentProjectId: s.projects[0]?.id }));
//         }
//     }

//     function handleAddProject() {
//         const name = prompt("Project name?");
//         if (!name) return;
//         const proj = { id: cryptoRandomId(), name, videos: [], createdAt: Date.now() };
//         setState((s) => ({
//             ...s,
//             projects: [...s.projects, proj],
//             currentProjectId: proj.id,
//         }));
//     }

//     function handleRenameProject() {
//         if (!currentProject) return;
//         const name = prompt("Rename project:", currentProject.name);
//         if (!name) return;
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) => (p.id === currentProject.id ? { ...p, name } : p)),
//         }));
//     }

//     function handleDeleteProject() {
//         if (!currentProject) return;
//         if (!confirm(`Delete project "${currentProject.name}"?`)) return;
//         setState((s) => {
//             const others = s.projects.filter((p) => p.id !== currentProject.id);
//             return {
//                 ...s,
//                 projects: others.length ? others : [{ id: cryptoRandomId(), name: "New Project", videos: [], createdAt: Date.now() }],
//                 currentProjectId: others[0]?.id || null,
//             };
//         });
//     }

//     function handleAddVideo() {
//         ensureProjectSelected();
//         const vid = parseYouTubeId(urlInput.trim());
//         if (!vid) return alert("Please paste a valid YouTube link or ID.");
//         const exists = currentProject.videos.some((v) => v.videoId === vid);
//         const meta = {
//             id: cryptoRandomId(),
//             title: "Untitled Video",
//             videoId: vid,
//             source: urlInput.trim(),
//             notes: [],
//             bookmarks: [],
//             lastTime: 0,
//             createdAt: Date.now(),
//         };
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id === currentProject.id
//                     ? { ...p, videos: exists ? p.videos : [meta, ...p.videos] }
//                     : p
//             ),
//         }));
//         setCurrentVideoId(vid);
//         setUrlInput("");
//     }

//     function handleSetTitle() {
//         if (!currentVideo) return;
//         const t = prompt("Video title:", currentVideo.title || "");
//         if (t == null) return;
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id !== currentProject.id
//                     ? p
//                     : {
//                         ...p,
//                         videos: p.videos.map((v) => (v.videoId === currentVideo.videoId ? { ...v, title: t } : v)),
//                     }
//             ),
//         }));
//     }

//     function handleRemoveVideo(vid) {
//         if (!confirm("Remove this video from project?")) return;
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id !== currentProject.id ? p : { ...p, videos: p.videos.filter((v) => v.videoId !== vid) }
//             ),
//         }));
//         if (currentVideoId === vid) setCurrentVideoId(null);
//     }

//     function handleAddNote(type) {
//         if (!currentVideo) return;
//         const t = getCurrentTime();
//         const id = cryptoRandomId();
//         let text = noteDraft.trim();
//         if (type == "input") {
//             if (!text) return alert("Write a note first.");
//         }else if (type === "prompt") {
//             const promptText = prompt("Enter your note:");
//             if (!promptText) return alert("Note cannot be empty.");
//             text = promptText;
//         }else {
//             if (!text) return alert("Note cannot be empty.");
//         }
//         const note = { id, t, text, createdAt: Date.now(), updatedAt: Date.now() };
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id !== currentProject.id
//                     ? p
//                     : {
//                         ...p,
//                         videos: p.videos.map((v) =>
//                             v.videoId === currentVideo.videoId ? { ...v, notes: [note, ...v.notes] } : v
//                         ),
//                     }
//             ),
//         }));
//         setNoteDraft("");
//     }

//     function handleDeleteNote(id) {
//         if (!currentVideo) return;
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id !== currentProject.id
//                     ? p
//                     : {
//                         ...p,
//                         videos: p.videos.map((v) =>
//                             v.videoId === currentVideo.videoId ? { ...v, notes: v.notes.filter((n) => n.id !== id) } : v
//                         ),
//                     }
//             ),
//         }));
//     }

//     function handleEditNote(id) {
//         const n = currentVideo?.notes.find((x) => x.id === id);
//         if (!n) return;
//         const text = prompt("Edit note (Markdown supported):", n.text);
//         if (text == null) return;
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id !== currentProject.id
//                     ? p
//                     : {
//                         ...p,
//                         videos: p.videos.map((v) =>
//                             v.videoId === currentVideo.videoId
//                                 ? {
//                                     ...v,
//                                     notes: v.notes.map((m) => (m.id === id ? { ...m, text, updatedAt: Date.now() } : m)),
//                                 }
//                                 : v
//                         ),
//                     }
//             ),
//         }));
//     }

//     function handleAddBookmark() {
//         if (!currentVideo) return;
//         const t = getCurrentTime();
//         const title = (bookmarkTitle || "Bookmark").trim();
//         const tag = bookmarkTag.trim();
//         const color = bookmarkColor || "emerald";
//         const b = { id: cryptoRandomId(), t, title, tag, color, createdAt: Date.now() };
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id !== currentProject.id
//                     ? p
//                     : {
//                         ...p,
//                         videos: p.videos.map((v) =>
//                             v.videoId === currentVideo.videoId ? { ...v, bookmarks: [b, ...v.bookmarks] } : v
//                         ),
//                     }
//             ),
//         }));
//         setBookmarkTitle("");
//         setBookmarkTag("");
//     }

//     function handleDeleteBookmark(id) {
//         if (!currentVideo) return;
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id !== currentProject.id
//                     ? p
//                     : {
//                         ...p,
//                         videos: p.videos.map((v) =>
//                             v.videoId === currentVideo.videoId
//                                 ? { ...v, bookmarks: v.bookmarks.filter((b) => b.id !== id) }
//                                 : v
//                         ),
//                     }
//             ),
//         }));
//     }

//     // Drag & drop for bookmarks
//     function onDragStart(e, id) {
//         e.dataTransfer.setData("text/plain", id);
//     }
//     function onDropBookmark(e) {
//         e.preventDefault();
//         const id = e.dataTransfer.getData("text/plain");
//         if (!id || !currentVideo) return;
//         const items = [...currentVideo.bookmarks];
//         const fromIdx = items.findIndex((b) => b.id === id);
//         if (fromIdx < 0) return;
//         // insert at top for simplicity (or compute target index)
//         const [moved] = items.splice(fromIdx, 1);
//         items.splice(0, 0, moved);
//         setState((s) => ({
//             ...s,
//             projects: s.projects.map((p) =>
//                 p.id !== currentProject.id
//                     ? p
//                     : {
//                         ...p,
//                         videos: p.videos.map((v) =>
//                             v.videoId === currentVideo.videoId ? { ...v, bookmarks: items } : v
//                         ),
//                     }
//             ),
//         }));
//     }

//     function allowDrop(e) { e.preventDefault(); }

//     function exportProjectJSON() {
//         const data = state.projects.find((p) => p.id === currentProject.id);
//         downloadFile(`${currentProject.name.replace(/\s+/g, "_")}.json`, JSON.stringify(data, null, 2));
//     }

//     function importProjectJSON(e) {
//         const file = e.target.files?.[0];
//         if (!file) return;
//         const reader = new FileReader();
//         reader.onload = () => {
//             try {
//                 const proj = JSON.parse(reader.result);
//                 if (!proj || !proj.id || !proj.videos) throw new Error("Invalid file");
//                 setState((s) => ({ ...s, projects: [...s.projects, proj], currentProjectId: proj.id }));
//             } catch (err) {
//                 alert("Invalid JSON file");
//             }
//         };
//         reader.readAsText(file);
//         e.target.value = "";
//     }

//     function exportVideoMarkdown() {
//         if (!currentVideo) return;
//         const lines = [];
//         lines.push(`# ${currentVideo.title || "Video Notes"}`);
//         lines.push("");
//         lines.push(`Source: ${currentVideo.source || currentVideo.videoId}`);
//         lines.push("");
//         lines.push("## Bookmarks");
//         currentVideo.bookmarks.forEach((b) => {
//             lines.push(`- [${formatTime(b.t)}] ${b.title}${b.tag ? ` (#${b.tag})` : ""}`);
//         });
//         lines.push("");
//         lines.push("## Notes");
//         currentVideo.notes.forEach((n) => {
//             lines.push(`- [${formatTime(n.t)}] ${n.text.replace(/\n/g, " ")}`);
//         });
//         downloadFile(`${(currentVideo.title || currentVideo.videoId).replace(/\s+/g, "_")}.md`, lines.join("\n"), "text/markdown");
//     }

//     function scheduleReminder(payload) {
//         let reminderMinutes = prompt("Set reminder in minutes (default 5):", "5");
//         if (reminderMinutes === null) return; // Cancelled
//         const mins = parseInt(reminderMinutes || 5, 10);
//         if (!Number.isFinite(mins) || mins <= 0) return alert("Enter minutes > 0");
//         if (!("Notification" in window)) return alert("Notifications not supported in this browser.");
//         Notification.requestPermission().then((perm) => {
//             if (perm !== "granted") return alert("Notification permission denied.");
//             setTimeout(() => {
//                 new Notification(payload.title, { body: payload.body });
//             }, mins * 60 * 1000);
//             alert(`Reminder set for ${mins} minute(s).`);
//         });

//         if (payload?.action === "videoPause") {
//             setTimeout(() => {
//                 playPause("pause");
//             }, reminderMinutes * 60 * 1000);
//         }
//     }

//     // ----------------------------- Self Tests ------------------------------
//     // Always run lightweight tests once (results in console + optional alert)
//     useEffect(() => {
//         const results = runSelfTests();
//         // Uncomment next line if you want a quick inline summary popup
//         // alert(results.join("\n"));
//     }, []);

//     function runSelfTests() {
//         const out = [];

//         // parseYouTubeId tests
//         const id = "dQw4w9WgXcQ";
//         const cases = [
//             [id, id],
//             ["https://www.youtube.com/watch?v=" + id, id],
//             ["https://youtu.be/" + id, id],
//             ["https://www.youtube.com/embed/" + id + "?start=30", id],
//             ["notaurl", null],
//         ];
//         cases.forEach(([input, expected], i) => {
//             const got = parseYouTubeId(input);
//             const pass = got === expected;
//             out.push(`parseYouTubeId#${i + 1}: ${pass ? "PASS" : `FAIL (exp ${expected}, got ${got})`}`);
//             // eslint-disable-next-line no-console
//             if (!pass) console.error("parseYouTubeId test failed", { input, expected, got });
//         });

//         // formatTime tests
//         const tCases = [
//             [0, "0:00"],
//             [59, "0:59"],
//             [60, "1:00"],
//             [61, "1:01"],
//             [3661, "1:01:01"],
//             [NaN, "0:00"]
//         ];
//         tCases.forEach(([input, expected], i) => {
//             const got = formatTime(input);
//             const pass = got === expected;
//             out.push(`formatTime#${i + 1}: ${pass ? "PASS" : `FAIL (exp ${expected}, got ${got})`}`);
//             if (!pass) console.error("formatTime test failed", { input, expected, got });
//         });

//         // Player method guards (no crashes when not ready)
//         try {
//             const t = getCurrentTime();
//             void t;
//             out.push("player guard: PASS (safe getCurrentTime)");
//         } catch (e) {
//             out.push("player guard: FAIL (getCurrentTime threw)");
//         }

//         // eslint-disable-next-line no-console
//         console.table(out);
//         return out;
//     }

//     return (
//         <div className="min-h-screen min-w-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 transition-colors">
//             {/* Top Bar */}
//             <div className="sticky top-0 z-30 backdrop-blur bg-white/70 dark:bg-neutral-900/70 border-b border-neutral-200 dark:border-neutral-800">
//                 <div className="max-w-8xl mx-auto px-3 sm:px-6 py-2 flex items-center gap-2">
//                     {/* Project Selector */}
//                     <div className="flex items-center gap-2">
//                         <select
//                             className="px-3 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
//                             value={currentProject?.id || ""}
//                             onChange={(e) => setState((s) => ({ ...s, currentProjectId: e.target.value }))}
//                         >
//                             {state.projects.map((p) => (
//                                 <option key={p.id} value={p.id}>{p.name}</option>
//                             ))}
//                         </select>
//                         <button onClick={handleAddProject} className="px-3 py-2 rounded-2xl bg-orange-800 text-white! dark:bg-white dark:text-neutral-900">+ Project</button>
//                         <button onClick={handleRenameProject} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">Rename</button>
//                         <button onClick={handleDeleteProject} className="px-3 py-2 rounded-2xl border border-red-300 text-red-600 dark:border-red-700">Delete</button>
//                     </div>

//                     {/* URL input */}
//                     <div className="flex items-center gap-1">
//                         <input
//                             value={urlInput}
//                             onChange={(e) => setUrlInput(e.target.value)}
//                             placeholder="Paste YouTube link or ID"
//                             className="w-full px-4 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
//                         />
//                         <button onClick={handleAddVideo} className="px-4 py-2 rounded-2xl bg-emerald-600 text-white">Add</button>
//                     </div>

//                     {/* Utilities */}
//                     <div className="flex items-center gap-2">
//                         <button onClick={() => setState((s) => ({ ...s, distractionFree: !s.distractionFree }))} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">{state.distractionFree ? "Exit Focus" : "Focus Mode"}</button>

//                         {/* <select
//                             className="px-3 py-2 rounded-2xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
//                             value={state.theme}
//                             onChange={(e) => setState((s) => ({ ...s, theme: e.target.value }))}
//                         >
//                             <option value="system">System</option>
//                             <option value="light">Light</option>
//                             <option value="dark">Dark</option>
//                         </select> */}

//                         <button onClick={exportProjectJSON} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">Export JSON</button>
//                         <label className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700 cursor-pointer">
//                             Import JSON
//                             <input type="file" accept="application/json" className="hidden" onChange={importProjectJSON} />
//                         </label>
//                         <button onClick={exportVideoMarkdown} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">Export MD</button>
//                         <button onClick={() => alert(runSelfTests().join("\n"))} className="px-3 py-2 rounded-2xl border border-neutral-300 dark:border-neutral-700">Self‑Tests</button>
//                     </div>
//                 </div>
//             </div>

//             {/* Main Layout */}
//             <div className={`max-w-8xl mx-auto px-1 sm:px-6 py-4 grid ${state.distractionFree ? "grid-cols-1" : "md:grid-cols-[2fr_1fr]"
//                 } gap-4`}>
//                 {/* Left: Player + Video List */}
//                 <div className="space-y-4">
//                     {/* Player Card */}
//                     <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-sm">
//                         <div className="aspect-video bg-black">
//                             <div id={playerContainerId} className="w-full h-full" />
//                         </div>
//                         <div className="p-3 flex items-center justify-between gap-2">
//                             <div className="flex items-center gap-2">
//                                 <button onClick={() => seekTo(Math.max(0, getCurrentTime() - 5))} className="px-3 py-1.5 rounded-xl border">-5s</button>
//                                 <button onClick={() => playPause("toggle")} className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white! dark:bg-white dark:text-neutral-900">{getPlayerState() === 1 ? "Pause" : "Play"}</button>
//                                 <button onClick={() => seekTo(getCurrentTime() + 5)} className="px-3 py-1.5 rounded-xl border">+5s</button>
//                                 <span className="text-sm opacity-70">{formatTime(playerSeconds)}</span>
//                             </div>
//                             <div className="flex items-center gap-2">
//                                 <button onClick={() => seekTo(0)} className="px-3 py-1.5 rounded-xl border">Start</button>
//                                 <button onClick={() => seekTo((currentVideo?.lastTime || 0))} className="px-3 py-1.5 rounded-xl border">Resume</button>
//                                 <button onClick={handleSetTitle} className="px-3 py-1.5 rounded-xl border">Title</button>
//                             </div>
//                         </div>
//                     </div>

//                     {/* Videos in Project */}
//                     {!state.distractionFree && (
//                         <div className="rounded-2xl p-3 border border-neutral-200 dark:border-neutral-800">
//                             <div className="flex items-center justify-between mb-2">
//                                 <h2 className="text-lg font-semibold">Project Videos</h2>
//                                 <span className="text-sm opacity-60">{currentProject?.videos.length || 0} items</span>
//                             </div>
//                             <div className="grid sm:grid-cols-2 gap-3">
//                                 {currentProject?.videos.map((v) => (
//                                     <div key={v.id} className={`p-3 rounded-xl border transition ${currentVideoId === v.videoId ? "border-emerald-400" : "border-neutral-200 dark:border-neutral-800"}`}>
//                                         <div className="flex items-center justify-between gap-2">
//                                             <div className="min-w-0">
//                                                 <div className="truncate font-medium">{v.title || v.videoId}</div>
//                                                 <div className="text-xs opacity-60">Last at {formatTime(v.lastTime || 0)}</div>
//                                             </div>
//                                             <div className="flex items-center gap-2 shrink-0">
//                                                 <button onClick={() => setCurrentVideoId(v.videoId)} className="px-2 py-1 rounded-lg border">Open</button>
//                                                 <button onClick={() => handleRemoveVideo(v.videoId)} className="px-2 py-1 rounded-lg border border-red-300 text-red-600">Remove</button>
//                                             </div>
//                                         </div>
//                                     </div>
//                                 ))}
//                                 {(!currentProject || currentProject.videos.length === 0) && (
//                                     <div className="text-sm opacity-70">No videos yet. Paste a link above and click Add.</div>
//                                 )}
//                             </div>
//                         </div>
//                     )}
//                 </div>

//                 {/* Right: Notes & Bookmarks */}
//                 {!state.distractionFree && (
//                     <div className="space-y-4">
//                         <div className="w-full flex justify-center">
//                         <button onClick={() => scheduleReminder({ title: `Reminding you for a break`, action: "videoPause" })} className="px-2 py-1 rounded-lg text-white border-2! border-amber-200!">Set break reminder</button>
//                         </div>
//                         {/* Notes Card */}
//                         <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
//                             <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
//                                 <h2 className="text-lg font-semibold">Notes</h2>
//                                 <input
//                                     value={searchTerm}
//                                     onChange={(e) => setSearchTerm(e.target.value)}
//                                     placeholder="Search notes..."
//                                     className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
//                                 />
//                             </div>
//                             <div className="p-3 space-y-3">
//                                 <div className="space-y-2">
//                                     <div className="flex items-center gap-2">
//                                         <button onClick={() => setNotePreview((x) => !x)} className="px-3 py-1.5 rounded-xl border">{notePreview ? "Edit" : "Preview"}</button>
//                                         <button onClick={()=>{handleAddNote("input")}} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white">+ Add Note @ {formatTime(playerSeconds)} (N)</button>
//                                     </div>
//                                     {!notePreview ? (
//                                         <textarea
//                                             value={noteDraft}
//                                             onChange={(e) => setNoteDraft(e.target.value)}
//                                             rows={5}
//                                             placeholder="Write note (Markdown supported: **bold**, *italic*, - list, [text](url))"
//                                             className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
//                                         />
//                                     ) : (
//                                         <div
//                                             className="prose prose-neutral dark:prose-invert max-w-none bg-neutral-100 dark:bg-neutral-800 rounded-xl p-3 border border-neutral-200 dark:border-neutral-700"
//                                             dangerouslySetInnerHTML={{ __html: markdownToHtml(noteDraft) }}
//                                         />
//                                     )}
//                                 </div>

//                                 <div className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
//                                     {filteredNotes.map((n) => (
//                                         <div key={n.id} className="p-3 flex items-start gap-3">
//                                             <button onClick={() => seekTo(n.t)} className="px-2 py-1 rounded-lg border shrink-0">{formatTime(n.t)}</button>
//                                             <div className="flex-1 min-w-0">
//                                                 <div className="prose prose-neutral dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: markdownToHtml(n.text) }} />
//                                                 <div className="text-xs opacity-60 mt-1">Updated {new Date(n.updatedAt).toLocaleString()}</div>
//                                             </div>
//                                             <div className="flex items-center gap-2">
//                                                 <button onClick={() => handleEditNote(n.id)} className="px-2 py-1 rounded-lg border">Edit</button>
//                                                 <button onClick={() => handleDeleteNote(n.id)} className="px-2 py-1 rounded-lg border border-red-300 text-red-600">Delete</button>
//                                             </div>
//                                         </div>
//                                     ))}
//                                     {filteredNotes.length === 0 && (
//                                         <div className="p-3 text-sm opacity-70">No notes yet.</div>
//                                     )}
//                                 </div>
//                             </div>
//                         </div>

//                         {/* Bookmarks */}
//                         <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden" onDrop={onDropBookmark} onDragOver={allowDrop}>
//                             <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
//                                 <h2 className="text-lg font-semibold">Bookmarks</h2>
//                                 <div className="flex items-center gap-2">
//                                     <input
//                                         value={bookmarkTitle}
//                                         onChange={(e) => setBookmarkTitle(e.target.value)}
//                                         placeholder="Title"
//                                         className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
//                                     />
//                                     <input
//                                         value={bookmarkTag}
//                                         onChange={(e) => setBookmarkTag(e.target.value)}
//                                         placeholder="Tag (e.g. formula)"
//                                         className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
//                                     />
//                                     {/* <select value={bookmarkColor} onChange={(e) => setBookmarkColor(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
//                     {['emerald','sky','violet','amber','rose','cyan','lime','fuchsia'].map(c => <option key={c} value={c}>{c}</option>)}
//                   </select> */}
//                                     <button onClick={handleAddBookmark} className="px-3 py-2 rounded-2xl bg-emerald-600 text-white">+ Add (B) @ {formatTime(playerSeconds)}</button>

//                                 </div>
//                             </div>
//                             <div className="p-3 grid sm:grid-cols-1 gap-3">
//                                 {currentVideo?.bookmarks.map((b) => (
//                                     <div
//                                         key={b.id}
//                                         draggable
//                                         onDragStart={(e) => onDragStart(e, b.id)}
//                                         className={`p-3 rounded-xl border shadow-sm border-${b.color}-300/60 bg-${b.color}-50/40 dark:border-${b.color}-800/60 dark:bg-${b.color}-900/20`}
//                                     >
//                                         <div className="flex items-center justify-between gap-2">
//                                             <div className="flex items-center gap-2">
//                                                 <button onClick={() => seekTo(b.t)} className="px-2 py-1 rounded-lg border">{formatTime(b.t)}</button>
//                                                 <div className="">
//                                                     <div className="font-medium truncate max-w-[160px]" title={b.title}>{b.title}</div>
//                                                     {b.tag && <div className="text-xs opacity-70">#{b.tag}</div>}
//                                                 </div>
//                                             </div>
//                                             <div className="flex items-center gap-2">
//                                                 <button onClick={() => scheduleReminder({ title: `Revisit: ${b.title}`, body: `Jump back to ${formatTime(b.t)} in ${currentVideo?.title || 'video'}` })} className="px-2 py-1 rounded-lg border">Remind</button>
//                                                 <button onClick={() => handleDeleteBookmark(b.id)} className="px-2 py-1 rounded-lg border border-red-300 text-red-600">Delete</button>
//                                             </div>
//                                         </div>
//                                     </div>
//                                 ))}
//                                 {(!currentVideo || currentVideo.bookmarks.length === 0) && (
//                                     <div className="text-sm opacity-70">No bookmarks yet. Add some above.</div>
//                                 )}
//                             </div>
//                         </div>
//                     </div>
//                 )}
//             </div>

//             {/* Bottom sticky current video info & quick actions */}
//             {currentVideo && (
//                 <div className="sticky bottom-3 z-20">
//                     <div className="max-w-3xl mx-auto rounded-2xl shadow-md backdrop-blur bg-white/80 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 px-3 py-2 flex items-center justify-between gap-2">
//                         <div className="truncate">
//                             <div className="text-sm opacity-70">Now studying</div>
//                             <div className="font-semibold truncate">{currentVideo.title || currentVideo.videoId}</div>
//                         </div>
//                         <div className="flex items-center gap-2">
//                             <button onClick={() => seekTo(Math.max(0, getCurrentTime() - 10))} className="px-3 py-1.5 rounded-xl border">-10s</button>
//                             <button onClick={() => handleAddBookmark()} className="px-3 py-1.5 rounded-xl border">+ Bookmark</button>
//                             <button onClick={() => handleAddNote("prompt")} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white">+ Note</button>
//                         </div>
//                     </div>
//                 </div>
//             )}

//             {/* When selecting a video from list: set currentVideoId */}
//             <EffectSelectFirstVideo project={currentProject} setCurrentVideoId={setCurrentVideoId} />
//         </div>
//     );
// }

// function EffectSelectFirstVideo({ project, setCurrentVideoId }) {
//     useEffect(() => {
//         if (!project) return;
//         if (project.videos.length && !project.videos.some(v => v.videoId === (setCurrentVideoId.__current || null))) {
//             setCurrentVideoId(project.videos[0].videoId);
//             setCurrentVideoId.__current = project.videos[0].videoId;
//         }
//     }, [project, setCurrentVideoId]);
//     return null;
// }
