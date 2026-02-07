"use client";

import { useEffect, useState, useCallback } from "react";
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  RoomAudioRenderer,
  useLocalParticipant,
  TrackReference,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Loader2, VideoOff, Mic, MicOff, Video, CameraOff, Maximize2, X } from "lucide-react";


interface VideoRoomProps {
  roomCode: string;
  participantName: string;
  participantId?: string;
  hideControls?: boolean;
  layout?: "grid" | "row" | "column";
  onStatusChange?: (status: { isCameraOn: boolean; isMicOn: boolean }) => void;
}

export default function VideoRoom({ roomCode, participantName, participantId, hideControls = false, layout = "grid", onStatusChange }: VideoRoomProps) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://plyst.info";

  useEffect(() => {
    const getToken = async () => {
      try {
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomName: `kero-${roomCode}`,
            participantName,
            participantId,
          }),
        });

        const data = await res.json();

        if (!data.success) {
          throw new Error(data.message || "Failed to get token");
        }

        setToken(data.data.token);
      } catch (e: any) {
        setError(e.message || "Failed to connect to video room");
      } finally {
        setIsConnecting(false);
      }
    };

    getToken();
  }, [roomCode, participantName, participantId]);

  if (isConnecting) {
    return (
      <div className="flex items-center justify-center h-full bg-black/50 rounded-xl">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-white" />
          <span className="text-white/60 text-sm">카메라 연결 중...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-black/50 rounded-xl">
        <div className="flex flex-col items-center gap-3 text-center p-4">
          <VideoOff className="w-8 h-8 text-red-400" />
          <span className="text-white/60 text-sm">{error}</span>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex items-center justify-center h-full bg-black/50 rounded-xl">
        <div className="flex flex-col items-center gap-3">
          <VideoOff className="w-8 h-8 text-gray-400" />
          <span className="text-white/60 text-sm">비디오를 사용할 수 없습니다</span>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={livekitUrl}
      connect={true}
      video={true}
      audio={true}
      style={{ height: "100%", background: "transparent" }}
    >
      <RoomContent hideControls={hideControls} layout={layout} onStatusChange={onStatusChange} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function RoomContent({ hideControls, layout = "grid", onStatusChange }: { hideControls: boolean; layout?: "grid" | "row" | "column"; onStatusChange?: (status: { isCameraOn: boolean; isMicOn: boolean }) => void }) {
  const { localParticipant } = useLocalParticipant();
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);

   const toggleMicrophone = useCallback(async () => {
     if (localParticipant) {
       const newState = !isMicOn;
       await localParticipant.setMicrophoneEnabled(newState);
       setIsMicOn(newState);
       window.dispatchEvent(new CustomEvent("kero:micStatus", { detail: { isMicOn: newState } }));
       onStatusChange?.({ isCameraOn: isCamOn, isMicOn: newState });
     }
   }, [localParticipant, isMicOn, isCamOn, onStatusChange]);

   const toggleCamera = useCallback(async () => {
     if (localParticipant) {
       const newState = !isCamOn;
       await localParticipant.setCameraEnabled(newState);
       setIsCamOn(newState);
       window.dispatchEvent(new CustomEvent("kero:camStatus", { detail: { isCamOn: newState } }));
       onStatusChange?.({ isCameraOn: newState, isMicOn });
     }
   }, [localParticipant, isCamOn, isMicOn, onStatusChange]);

  useEffect(() => {
    onStatusChange?.({ isCameraOn: isCamOn, isMicOn });
  }, []);

  useEffect(() => {
    const handleToggleCamera = () => toggleCamera();
    const handleToggleMic = () => toggleMicrophone();

    window.addEventListener("kero:toggleCamera", handleToggleCamera);
    window.addEventListener("kero:toggleMic", handleToggleMic);

    return () => {
      window.removeEventListener("kero:toggleCamera", handleToggleCamera);
      window.removeEventListener("kero:toggleMic", handleToggleMic);
    };
  }, [toggleCamera, toggleMicrophone]);

  return (
    <div className={`flex flex-col ${hideControls ? 'h-full' : 'h-full'}`}>
      <div className={hideControls ? 'h-full overflow-hidden' : 'flex-1 overflow-hidden'}>
        <VideoGrid layout={layout} />
      </div>
      {!hideControls && (
        <div className="flex items-center justify-center gap-3 p-3 border-t border-white/10 bg-zinc-900/50">
          <button
            onClick={toggleMicrophone}
            className={`p-3 rounded-full transition-colors ${
              isMicOn 
                ? "bg-zinc-700 hover:bg-zinc-600 text-white" 
                : "bg-red-500 hover:bg-red-600 text-white"
            }`}
            title={isMicOn ? "마이크 끄기" : "마이크 켜기"}
          >
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
          
          <button
            onClick={toggleCamera}
            className={`p-3 rounded-full transition-colors ${
              isCamOn 
                ? "bg-zinc-700 hover:bg-zinc-600 text-white" 
                : "bg-red-500 hover:bg-red-600 text-white"
            }`}
            title={isCamOn ? "카메라 끄기" : "카메라 켜기"}
          >
            {isCamOn ? <Video className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
          </button>
        </div>
      )}
    </div>
  );
}

function VideoGrid({ layout = "grid" }: { layout?: "grid" | "row" | "column" }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const [expandedTrackSid, setExpandedTrackSid] = useState<string | null>(null);

  const cameraTracks = tracks.filter(
    (track): track is TrackReference => 
      track.source === Track.Source.Camera
  );

  const expandedTrack = cameraTracks.find(t => t.publication?.track?.sid === expandedTrackSid);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedTrackSid(null);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  if (cameraTracks.length === 0) {
    if (layout === "row" || layout === "column") {
      return (
        <div className={`flex items-center justify-center ${layout === 'row' ? 'h-full gap-3 px-4' : 'w-full flex-col gap-3 py-4'}`}>
          <div className="relative w-44 h-36 md:w-48 md:h-40 bg-zinc-800/80 rounded-xl overflow-hidden border border-white/10 shadow-xl shrink-0 flex items-center justify-center backdrop-blur-sm">
            <CameraOff className="w-8 h-8 text-white/20" />
            <div className="absolute bottom-0 left-0 right-0 py-1.5 bg-black/60 backdrop-blur-sm text-[11px] font-bold text-white/50 text-center">
              카메라 OFF
            </div>
          </div>
        </div>
      );
    }
    
    return (
      <div className="flex items-center justify-center aspect-[4/3] text-white/60 text-xs">
        <div className="flex flex-col items-center gap-1.5">
          <CameraOff className="w-6 h-6 text-gray-500" />
          <span>카메라 대기 중...</span>
        </div>
      </div>
    );
  }

  if (layout === "row" || layout === "column") {
    const isColumn = layout === "column";
    return (
      <div className="relative w-full h-full">
        <div className={`flex ${isColumn ? 'flex-col w-full h-auto py-3' : 'flex-row h-full px-3'} items-center ${isColumn ? 'justify-center' : 'justify-start'} gap-3`} style={{ overflow: 'visible' }}>
          {cameraTracks.map((trackRef) => {
            const hasTrack = trackRef.publication?.track !== undefined;
            return (
              <div
                key={trackRef.participant.sid}
                onClick={() => hasTrack ? setExpandedTrackSid(trackRef.publication.track?.sid || null) : undefined}
                className={`relative ${isColumn ? 'w-44 h-36 md:w-48 md:h-40' : 'h-36 w-44 md:h-40 md:w-48'} bg-zinc-900/80 rounded-xl overflow-hidden border border-white/10 hover:border-white/30 shadow-xl shrink-0 ${hasTrack ? 'cursor-pointer' : ''} transition-all hover:scale-[1.03] active:scale-95 group backdrop-blur-sm`}
              >
                {hasTrack ? (
                  <VideoTrack
                    trackRef={trackRef}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-800/90">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-base font-bold text-white shadow-lg">
                      {(trackRef.participant.name || trackRef.participant.identity)?.charAt(0) || '?'}
                    </div>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  {hasTrack && <Maximize2 className="w-7 h-7 text-white drop-shadow-lg" />}
                </div>
                <div className="absolute bottom-0 left-0 right-0 py-1.5 bg-gradient-to-t from-black/70 to-transparent text-[11px] font-bold text-white text-center truncate px-2">
                  {trackRef.participant.name || trackRef.participant.identity}
                </div>
                {trackRef.participant.isSpeaking && (
                  <div className="absolute inset-0 border-2 border-green-400 rounded-xl pointer-events-none shadow-[inset_0_0_12px_rgba(74,222,128,0.3)]" />
                )}
              </div>
            );
          })}
        </div>

        {expandedTrack && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-8" style={{ animation: 'fadeIn 0.2s ease-out' }} onClick={() => setExpandedTrackSid(null)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-[560px] aspect-[4/3]" onClick={e => e.stopPropagation()}>
              <div className="relative w-full h-full bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/20 ring-1 ring-white/10">
                <VideoTrack
                  trackRef={expandedTrack}
                  className="w-full h-full object-cover"
                />
                
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent pt-12">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${expandedTrack.participant.isSpeaking ? 'bg-green-500 shadow-[0_0_8px_rgba(74,222,128,0.8)]' : 'bg-white/20'}`} />
                    <span className="text-lg font-bold text-white drop-shadow-md">
                      {expandedTrack.participant.name || expandedTrack.participant.identity}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setExpandedTrackSid(null)}
                  className="absolute top-3 right-3 p-2.5 rounded-full bg-black/50 hover:bg-white/20 text-white transition-colors backdrop-blur-md border border-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const gridClass = cameraTracks.length === 1 ? "grid-cols-1" :
                    cameraTracks.length === 2 ? "grid-cols-1" :
                    "grid-cols-2";

  return (
    <div className={`grid ${gridClass} gap-0.5 p-0.5 h-full`}>
      {cameraTracks.map((trackRef) => {
        const hasTrack = trackRef.publication?.track !== undefined;
        return (
          <div
            key={trackRef.participant.sid}
            className="relative w-full h-full bg-zinc-900 rounded-md overflow-hidden border border-white/5"
          >
            {hasTrack ? (
              <VideoTrack
                trackRef={trackRef}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm font-bold text-white">
                  {(trackRef.participant.name || trackRef.participant.identity)?.charAt(0) || '?'}
                </div>
              </div>
            )}
            <div className="absolute bottom-0.5 left-0.5 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[8px] font-bold text-white/90 flex items-center gap-0.5">
              <div className={`w-1 h-1 rounded-full ${trackRef.participant.isSpeaking ? 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]' : 'bg-white/50'}`} />
              {trackRef.participant.name || trackRef.participant.identity}
            </div>
          </div>
        );
      })}
    </div>
  );
}
