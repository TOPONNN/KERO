import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type RoomStatus = "waiting" | "playing" | "finished";

interface Participant {
  id: string | number;
  nickname: string;
  isHost: boolean;
  isReady: boolean;
  score?: number;
  profileImage?: string | null;
}

interface RoomState {
  id: string | null;
  code: string | null;
  name: string | null;
  gameMode: "normal" | "perfect_score" | "lyrics_quiz" | null;
  status: RoomStatus;
  participants: Participant[];
  hostId: string | null;
  maxParticipants: number;
  isConnected: boolean;
}

const initialState: RoomState = {
  id: null,
  code: null,
  name: null,
  gameMode: null,
  status: "waiting",
  participants: [],
  hostId: null,
  maxParticipants: 6,
  isConnected: false,
};

const roomSlice = createSlice({
  name: "room",
  initialState,
  reducers: {
    setRoom: (state, action: PayloadAction<Partial<RoomState>>) => {
      return { ...state, ...action.payload };
    },
    setConnected: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload;
    },
    addParticipant: (state, action: PayloadAction<Participant>) => {
      const exists = state.participants.find((p) => p.id === action.payload.id);
      if (!exists) {
        state.participants.push(action.payload);
      }
    },
    removeParticipant: (state, action: PayloadAction<string>) => {
      state.participants = state.participants.filter((p) => p.id !== action.payload);
    },
    updateParticipant: (state, action: PayloadAction<{ id: string; updates: Partial<Participant> }>) => {
      const participant = state.participants.find((p) => p.id === action.payload.id);
      if (participant) {
        Object.assign(participant, action.payload.updates);
      }
    },
    setRoomStatus: (state, action: PayloadAction<RoomStatus>) => {
      state.status = action.payload;
    },
    leaveRoom: () => initialState,
  },
});

export const {
  setRoom,
  setConnected,
  addParticipant,
  removeParticipant,
  updateParticipant,
  setRoomStatus,
  leaveRoom,
} = roomSlice.actions;

export default roomSlice.reducer;
