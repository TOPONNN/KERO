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
import { Loader2, VideoOff, Mic, MicOff, Video, CameraOff } from "lucide-react";

interface VideoRoomProps {
  roomCode: string;
  participantName: string;
  participantId?: string;
  hideControls?: boolean;
  onStatusChange?: (status: { isCameraOn: boolean; isMicOn: boolean }) => void;
}

export default function VideoRoom({ roomCode, participantName, participantId, hideControls = false, onStatusChange }: VideoRoomProps) {
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
      style={{ height: "100%", background: "#000" }}
    >
      <RoomContent hideControls={hideControls} onStatusChange={onStatusChange} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function RoomContent({ hideControls, onStatusChange }: { hideControls: boolean; onStatusChange?: (status: { isCameraOn: boolean; isMicOn: boolean }) => void }) {
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
    <div className={`flex flex-col ${hideControls ? '' : 'h-full'}`}>
      <div className={hideControls ? '' : 'flex-1 overflow-hidden'}>
        <VideoGrid />
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

function VideoGrid() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const cameraTracks = tracks.filter(
    (track): track is TrackReference => 
      track.source === Track.Source.Camera && 
      track.publication !== undefined &&
      track.publication.track !== undefined
  );

  if (cameraTracks.length === 0) {
    return (
      <div className="flex items-center justify-center aspect-[4/3] text-white/60 text-xs">
        <div className="flex flex-col items-center gap-1.5">
          <CameraOff className="w-6 h-6 text-gray-500" />
          <span>카메라 대기 중...</span>
        </div>
      </div>
    );
  }

  const gridClass = cameraTracks.length === 1 ? "grid-cols-1" :
                    cameraTracks.length === 2 ? "grid-cols-1" :
                    "grid-cols-2";

  return (
    <div className={`grid ${gridClass} gap-0.5 p-0.5`}>
      {cameraTracks.map((trackRef) => (
        <div
          key={trackRef.participant.sid}
          className="relative aspect-[4/3] bg-zinc-900 rounded-md overflow-hidden border border-white/5"
        >
          <VideoTrack
            trackRef={trackRef}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute bottom-0.5 left-0.5 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[8px] font-bold text-white/90 flex items-center gap-0.5">
            <div className="w-1 h-1 rounded-full bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.8)]" />
            {trackRef.participant.name || trackRef.participant.identity}
          </div>
        </div>
      ))}
    </div>
  );
}
